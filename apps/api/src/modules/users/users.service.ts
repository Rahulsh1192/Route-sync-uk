import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        role: true,
        locale: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateProfile(userId: string, data: { displayName?: string; avatarUrl?: string }) {
    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, displayName: true, avatarUrl: true },
    });
  }

  // ---------------------------------------------------------------------------
  // Phase 19b — test details (test centre + test date)
  // Stored as history; the most recent row is the user's "current" details.
  // ---------------------------------------------------------------------------

  /** True once the user has declared their test details at least once. */
  async hasTestDetails(userId: string): Promise<boolean> {
    const n = await this.prisma.userTestDetail.count({ where: { userId } });
    return n > 0;
  }

  /** Current (latest) test details plus the full history, newest first. */
  async getTestDetails(userId: string) {
    const history = await this.prisma.userTestDetail.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, testCentreId: true, testDate: true, createdAt: true },
    });
    return { current: history[0] ?? null, history };
  }

  /** Record a new test-details entry (kept as history). */
  async addTestDetails(userId: string, testCentreId: string, testDate: string) {
    const created = await this.prisma.userTestDetail.create({
      data: { userId, testCentreId, testDate: new Date(testDate) },
      select: { id: true, testCentreId: true, testDate: true, createdAt: true },
    });
    return created;
  }

  /**
   * GDPR erasure. Records the request, anonymises PII, soft-deletes, revokes tokens.
   * Heavy artefact removal (media in R2) is delegated to an async job.
   */
  async requestErasure(userId: string) {
    await this.prisma.$transaction([
      this.prisma.dataRequest.create({ data: { userId, kind: 'erasure', status: 'pending' } }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          email: null,
          displayName: 'Deleted user',
          avatarUrl: null,
          passwordHash: null,
          deletedAt: new Date(),
        },
      }),
    ]);
    // TODO: enqueue BullMQ job to purge media/uploads owned by this user.
    return { status: 'accepted' };
  }

  /** GDPR data export — enqueue async assembly of a downloadable package. */
  async requestExport(userId: string) {
    const req = await this.prisma.dataRequest.create({
      data: { userId, kind: 'export', status: 'pending' },
    });
    // TODO: enqueue BullMQ job to assemble export → store in R2 → set result_key.
    return { status: 'accepted', requestId: req.id };
  }
}
