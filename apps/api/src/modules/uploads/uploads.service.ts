import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MediaQueueService } from '../queue/media-queue.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CommunityService } from '../community/community.service';
import { InitUploadDto, UploadFileKind } from './dto/uploads.dto';
import { UploadStatus, RouteStatus } from '@prisma/client';

const ALLOWED_VIDEO = ['video/mp4', 'video/quicktime', 'video/x-matroska'];
const MAX_FILE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB per clip
const FREE_MONTHLY_UPLOAD_CAP = 3; // non-premium contributors; premium = unlimited

@Injectable()
export class UploadsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private mediaQueue: MediaQueueService,
    private subs: SubscriptionsService,
    private community: CommunityService,
  ) {}

  /**
   * Create an upload session and return presigned PUT URLs for each declared file.
   * Client uploads directly to R2/MinIO, then calls complete().
   */
  async init(userId: string, dto: InitUploadDto) {
    if (!dto.files?.length) throw new BadRequestException('No files declared');

    // Footage-licensing agreement must be accepted before any upload (GDPR/rights).
    if (!(await this.community.hasAcceptedAgreement(userId))) {
      throw new ForbiddenException(
        'You must accept the current contributor footage agreement before uploading',
      );
    }

    await this.enforceUploadQuota(userId);

    const hasGpx = dto.files.some((f) => f.kind === UploadFileKind.gpx);
    if (!hasGpx) throw new BadRequestException('A GPX file is required');

    const hasFront = dto.files.some((f) => f.kind === UploadFileKind.front);
    // Phase 14: video is optional — GPX-only uploads create a map_only route.
    const isMapOnly = !hasFront;

    for (const f of dto.files) {
      if (f.bytes > MAX_FILE_BYTES) throw new BadRequestException(`${f.originalName} too large`);
      if (f.kind !== UploadFileKind.gpx && !ALLOWED_VIDEO.includes(f.contentType)) {
        throw new BadRequestException(`Unsupported video type: ${f.contentType}`);
      }
    }

    // Create the route in draft and link the upload to it, so the worker has a
    // target to populate (videos, gpx, previews, scores) during processing.
    const route = await this.prisma.route.create({
      data: {
        contributorId: userId,
        title: dto.title,
        description: dto.description,
        testCentreId: dto.testCentreId,
        status: RouteStatus.draft,
        // Phase 14: track whether this upload includes video
        hasVideo: !isMapOnly,
      } as any,
    });

    const upload = await this.prisma.upload.create({
      data: {
        userId,
        routeId: route.id,
        status: UploadStatus.created,
        clockSource: dto.clockSource,
      },
    });

    const targets = await Promise.all(
      dto.files.map(async (f, i) => {
        const key = `uploads/${upload.id}/${f.kind}/${i}-${sanitise(f.originalName)}`;
        await this.prisma.$executeRaw`
          INSERT INTO upload_files (id, upload_id, kind, storage_key, original_name, bytes)
          VALUES (gen_random_uuid(), ${upload.id}::uuid, ${f.kind}, ${key}, ${f.originalName}, ${f.bytes})
        `;
        const url = await this.storage.presignUpload(key, f.contentType);
        return { kind: f.kind, key, uploadUrl: url };
      }),
    );

    return { uploadId: upload.id, routeId: route.id, targets };
  }

  /** Verify uploaded objects exist, then enqueue the processing pipeline. */
  async complete(userId: string, uploadId: string) {
    const upload = await this.getOwned(userId, uploadId);

    const files = await this.prisma.$queryRaw<Array<{ storage_key: string }>>`
      SELECT storage_key FROM upload_files WHERE upload_id = ${uploadId}::uuid
    `;
    for (const file of files) {
      if (!(await this.storage.exists(file.storage_key))) {
        throw new BadRequestException(`Object not uploaded: ${file.storage_key}`);
      }
    }

    await this.prisma.upload.update({
      where: { id: upload.id },
      data: { status: UploadStatus.queued },
    });
    if (upload.routeId) {
      await this.prisma.route.update({
        where: { id: upload.routeId },
        data: { status: RouteStatus.processing },
      });
    }
    await this.mediaQueue.enqueueProcessRoute(upload.id);

    return { uploadId: upload.id, status: UploadStatus.queued };
  }

  /** Pipeline status with per-stage detail (findings: gaps, overlaps, drift, scores). */
  async status(userId: string, uploadId: string) {
    const upload = await this.getOwned(userId, uploadId);
    const stages = await this.prisma.$queryRaw`
      SELECT stage, state, progress, findings, started_at, finished_at
      FROM upload_stages WHERE upload_id = ${uploadId}::uuid
      ORDER BY started_at NULLS LAST
    `;
    return { upload, stages };
  }

  /** Phase 14: Attach video files to an existing map_only route.
   *  Any verified ADI can contribute video — contributor_id stays as original. */
  async attachVideo(
    userId: string,
    routeId: string,
    files: Array<{ kind: string; originalName: string; contentType: string; bytes: number }>,
  ) {
    const route = await this.prisma.$queryRaw<any[]>`
      SELECT id, status FROM routes WHERE id = ${routeId}::uuid
    `;
    if (!route.length) throw new NotFoundException('Route not found');
    if (route[0].status !== 'map_only') {
      throw new BadRequestException('Route already has video or is not in map_only state');
    }

    if (!(await this.community.hasAcceptedAgreement(userId))) {
      throw new ForbiddenException('You must accept the footage agreement before uploading');
    }

    const upload = await this.prisma.upload.create({
      data: { userId, routeId, status: UploadStatus.created, clockSource: 'file_mtime' },
    });

    const targets = await Promise.all(
      files.map(async (f, i) => {
        const key = `uploads/${upload.id}/${f.kind}/${i}-${sanitise(f.originalName)}`;
        await this.prisma.$executeRaw`
          INSERT INTO upload_files (id, upload_id, kind, storage_key, original_name, bytes)
          VALUES (gen_random_uuid(), ${upload.id}::uuid, ${f.kind}, ${key}, ${f.originalName}, ${f.bytes})
        `;
        const url = await this.storage.presignUpload(key, f.contentType);
        return { kind: f.kind, key, uploadUrl: url };
      }),
    );

    // Record video contributor
    await this.prisma.$executeRaw`
      UPDATE routes SET video_contributor_id = ${userId}::uuid WHERE id = ${routeId}::uuid
    `;

    return { uploadId: upload.id, routeId, targets };
  }

  private async getOwned(userId: string, uploadId: string) {
    const upload = await this.prisma.upload.findUnique({ where: { id: uploadId } });
    if (!upload) throw new NotFoundException('Upload not found');
    if (upload.userId !== userId) throw new ForbiddenException('Not your upload');
    return upload;
  }

  /**
   * Cost control: premium contributors upload without limit; everyone else is capped
   * per calendar month. Counts are tracked in usage_quotas and incremented here.
   */
  private async enforceUploadQuota(userId: string) {
    if (await this.subs.isPremium(userId)) return;

    const period = `monthly:${new Date().toISOString().slice(0, 7)}`;
    const rows = await this.prisma.$queryRaw<Array<{ uploads_count: number }>>`
      INSERT INTO usage_quotas (user_id, period, uploads_count)
      VALUES (${userId}::uuid, ${period}, 0)
      ON CONFLICT (user_id) DO UPDATE
        SET period = CASE WHEN usage_quotas.period = ${period} THEN usage_quotas.period ELSE ${period} END,
            uploads_count = CASE WHEN usage_quotas.period = ${period} THEN usage_quotas.uploads_count ELSE 0 END
      RETURNING uploads_count`;
    const count = rows[0]?.uploads_count ?? 0;
    if (count >= FREE_MONTHLY_UPLOAD_CAP) {
      throw new ForbiddenException(
        `Free upload limit reached (${FREE_MONTHLY_UPLOAD_CAP}/month). Upgrade to Premium for unlimited uploads.`,
      );
    }
    await this.prisma.$executeRaw`
      UPDATE usage_quotas SET uploads_count = uploads_count + 1, updated_at = now()
      WHERE user_id = ${userId}::uuid`;
  }
}

function sanitise(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}
