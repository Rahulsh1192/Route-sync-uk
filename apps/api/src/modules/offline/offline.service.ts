import {
  Injectable, ForbiddenException, NotFoundException, Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../database/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { StorageService } from '../storage/storage.service';
import * as crypto from 'crypto';

@Injectable()
export class OfflineService {
  private readonly logger = new Logger(OfflineService.name);

  constructor(
    private prisma: PrismaService,
    private subs: SubscriptionsService,
    private storage: StorageService,
    @InjectQueue('offline-packages') private packageQueue: Queue,
  ) {}

  /** Request generation of an offline package for a route (Premium only). */
  async requestPackage(userId: string, routeId: string, deviceId: string) {
    const premium = await this.subs.isPremium(userId);
    if (!premium) throw new ForbiddenException('Premium subscription required for offline access');

    const route = await this.prisma.$queryRaw<any[]>`
      SELECT id, title FROM routes WHERE id = ${routeId}::uuid AND status IN ('published','map_only')
    `;
    if (!route.length) throw new NotFoundException('Route not found');

    // Idempotent: if package already exists and hasn't expired, return it
    const existing = await this.prisma.$queryRaw<any[]>`
      SELECT id, storage_key, expires_at
      FROM offline_packages
      WHERE user_id = ${userId}::uuid AND route_id = ${routeId}::uuid
        AND (expires_at IS NULL OR expires_at > now())
        AND device_id = ${deviceId}
    `;

    if (existing.length) {
      const url = await this.storage.presignDownload(existing[0].storage_key);
      return { status: 'ready', downloadUrl: url, expiresAt: existing[0].expires_at };
    }

    // Enqueue build job
    const job = await this.packageQueue.add('build', { userId, routeId, deviceId });
    return { status: 'building', jobId: job.id };
  }

  /** Return a signed download URL for an existing package. */
  async getPackageUrl(userId: string, routeId: string) {
    const pkg = await this.prisma.$queryRaw<any[]>`
      SELECT storage_key, expires_at FROM offline_packages
      WHERE user_id = ${userId}::uuid AND route_id = ${routeId}::uuid
        AND (expires_at IS NULL OR expires_at > now())
    `;
    if (!pkg.length) throw new NotFoundException('No offline package found — request one first');
    const url = await this.storage.presignDownload(pkg[0].storage_key);
    return { downloadUrl: url, expiresAt: pkg[0].expires_at };
  }

  /** List all offline packages for a user. */
  async listPackages(userId: string) {
    return this.prisma.$queryRaw<any[]>`
      SELECT op.id, op.route_id, op.bytes, op.expires_at, op.created_at,
             r.title, r.town, r.difficulty
      FROM offline_packages op
      JOIN routes r ON r.id = op.route_id
      WHERE op.user_id = ${userId}::uuid
        AND (op.expires_at IS NULL OR op.expires_at > now())
      ORDER BY op.created_at DESC
    `;
  }

  /** Delete / revoke a package (e.g. on subscription cancel or user request). */
  async revokePackage(userId: string, routeId: string) {
    const pkg = await this.prisma.$queryRaw<any[]>`
      SELECT storage_key FROM offline_packages
      WHERE user_id = ${userId}::uuid AND route_id = ${routeId}::uuid
    `;
    if (pkg.length) {
      // Mark as expired immediately
      await this.prisma.$executeRaw`
        UPDATE offline_packages SET expires_at = now() - interval '1 second'
        WHERE user_id = ${userId}::uuid AND route_id = ${routeId}::uuid
      `;
    }
    return { ok: true };
  }

  /** Revoke ALL packages for a user when their subscription lapses. */
  async revokeAllForUser(userId: string) {
    await this.prisma.$executeRaw`
      UPDATE offline_packages SET expires_at = now() - interval '1 second'
      WHERE user_id = ${userId}::uuid AND (expires_at IS NULL OR expires_at > now())
    `;
    this.logger.log(`Revoked all offline packages for user ${userId}`);
  }

  /** Generate an AES-256-GCM encryption key from user+device+route IDs (HKDF-style). */
  static deriveKey(userId: string, deviceId: string, routeId: string, secret: string): Buffer {
    return crypto.createHash('sha256')
      .update(`${secret}:${userId}:${deviceId}:${routeId}`)
      .digest();
  }
}
