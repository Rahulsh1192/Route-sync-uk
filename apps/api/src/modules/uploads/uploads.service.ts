import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MediaQueueService } from '../queue/media-queue.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CommunityService } from '../community/community.service';
import { GpsSource, GPS_FILE_KINDS, InitUploadDto, UploadFileKind } from './dto/uploads.dto';
import { UploadStatus, RouteStatus } from '@prisma/client';

const ALLOWED_VIDEO = ['video/mp4', 'video/quicktime', 'video/x-matroska'];
const MAX_FILE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB per clip
const FREE_MONTHLY_UPLOAD_CAP = 3; // non-premium contributors; premium = unlimited

/**
 * What the client needs in order to upload one declared file.
 *
 * Exactly one of three shapes, so the client never has to guess what to do:
 *   * `deduplicated` — identical bytes already exist; upload nothing.
 *   * `uploadUrl`    — small enough for a single presigned PUT.
 *   * `multipart`    — large; request part URLs and PUT them in parallel.
 */
export interface UploadTarget {
  fileId: string;
  kind: string;
  key: string;
  deduplicated: boolean;
  uploadUrl: string | null;
  multipart?: {
    uploadId: string;
    partSizeBytes: number;
    partsTotal: number;
  };
}

/** Columns of `upload_files` the multipart/cleanup paths work with. */
interface UploadFileRow {
  id: string;
  storage_key: string;
  original_name: string | null;
  multipart_upload_id: string | null;
  part_size_bytes: bigint | number | null;
  parts_total: number | null;
  sha256: string | null;
}

/**
 * Phase 24: a dashcam clock can be wrong, but only by so much before the value is
 * nonsense rather than a correction. A day either way covers timezone and DST
 * mistakes (the realistic causes) while rejecting a fat-fingered offset that would
 * silently drag the whole timeline into a different week.
 */
const MAX_CLOCK_OFFSET_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

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

    const gpsSource = dto.gpsSource ?? GpsSource.camera;
    const gpsFiles = dto.files.filter((f) => GPS_FILE_KINDS.includes(f.kind));
    const hasFront = dto.files.some((f) => f.kind === UploadFileKind.front);

    // Phase 24: where the GPS comes from decides what must be present. With
    // `app_journey` the track already lives in `journeys`, so demanding a GPS file
    // would be asking for the same data twice; with `embedded` the worker pulls it
    // out of the video stream. Only the `camera` case requires log files.
    if (gpsSource === GpsSource.camera && gpsFiles.length === 0) {
      throw new BadRequestException(
        'At least one GPS log file is required (or choose a different GPS source)',
      );
    }
    if (gpsSource === GpsSource.embedded && !hasFront) {
      throw new BadRequestException('Embedded GPS needs at least one video file to read it from');
    }
    if (gpsSource === GpsSource.app_journey) {
      if (!hasFront) {
        throw new BadRequestException('Attaching to a recorded journey requires video files');
      }
      await this.assertAttachableJourney(userId, dto.journeyId!);
    }

    if (Math.abs(dto.cameraClockOffsetMs ?? 0) > MAX_CLOCK_OFFSET_MS) {
      throw new BadRequestException('Camera clock offset must be within ±24 hours');
    }

    // Phase 14: video is optional — GPS-only uploads create a map_only route.
    const isMapOnly = !hasFront;

    for (const f of dto.files) {
      if (f.bytes > MAX_FILE_BYTES) throw new BadRequestException(`${f.originalName} too large`);
      if (!GPS_FILE_KINDS.includes(f.kind) && !ALLOWED_VIDEO.includes(f.contentType)) {
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
      },
    });

    // Phase 14: whether this upload includes video. Written with raw SQL rather than
    // through the typed create because Prisma validates arguments against its own
    // generated schema, not the database — so passing `hasVideo` to `create()` threw
    // "Unknown argument" at runtime whenever the client hadn't been regenerated, which
    // an `as any` cast hid from the compiler. Raw SQL works either way.
    await this.prisma.$executeRaw`
      UPDATE routes SET has_video = ${!isMapOnly} WHERE id = ${route.id}::uuid`;

    const upload = await this.prisma.upload.create({
      data: {
        userId,
        routeId: route.id,
        status: UploadStatus.created,
        clockSource: dto.clockSource,
      },
    });

    // Phase 24 provenance is set with raw SQL rather than through the typed create
    // so the API builds against a Prisma client that hasn't been regenerated yet
    // (the columns are declared in schema.prisma for when it is).
    await this.prisma.$executeRaw`
      UPDATE uploads
         SET gps_source             = ${gpsSource},
             journey_id             = ${dto.journeyId ?? null}::uuid,
             reference_route_id     = ${dto.referenceRouteId ?? null}::uuid,
             camera_clock_offset_ms = ${dto.cameraClockOffsetMs ?? 0}
       WHERE id = ${upload.id}::uuid`;

    // Per-view running counter, so `ordinal` is the clip's position within its own
    // camera (front 0,1,2… rear 0,1,2…) rather than its position in the flat file
    // list. The worker orders by detected timestamp and only falls back to this.
    const perKindCount: Record<string, number> = {};

    const partSizeBytes = (await this.configMb('upload_part_size_mb', 64)) * 1024 * 1024;
    const multipartThreshold =
      (await this.configMb('upload_multipart_threshold_mb', 100)) * 1024 * 1024;

    // Files are prepared sequentially rather than with Promise.all: each one may create
    // a multipart upload in R2, and issuing dozens of those concurrently for a big
    // batch is how you get throttled on the very request that starts the upload.
    const targets: UploadTarget[] = [];
    for (let i = 0; i < dto.files.length; i++) {
      const f = dto.files[i];
      const ordinal = f.declaredOrdinal ?? perKindCount[f.kind] ?? 0;
      perKindCount[f.kind] = (perKindCount[f.kind] ?? 0) + 1;

      // Path traversal guard: the key is built from a sanitised basename under a
      // per-upload prefix, so a name like "../../other-upload/x.mp4" cannot escape.
      const key = `uploads/${upload.id}/${f.kind}/${i}-${sanitise(f.originalName)}`;

      // ---- deduplication, decided BEFORE any bytes move ----
      const existing = f.sha256 ? await this.findObjectByHash(f.sha256) : null;

      const isVideo = !GPS_FILE_KINDS.includes(f.kind);
      const useMultipart = isVideo && !existing && f.bytes > multipartThreshold;
      const partsTotal = useMultipart ? Math.ceil(f.bytes / partSizeBytes) : null;

      let multipartUploadId: string | null = null;
      if (useMultipart) {
        multipartUploadId = await this.storage.createMultipartUpload(key, f.contentType);
      }

      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO upload_files (
          id, upload_id, kind, storage_key, original_name, bytes,
          ordinal, declared_ordinal, start_source, started_at, duration_s,
          sha256, dedup_of_key, multipart_upload_id, part_size_bytes, parts_total,
          verified_at
        )
        VALUES (
          gen_random_uuid(), ${upload.id}::uuid, ${f.kind},
          ${existing ? existing.storageKey : key},
          ${f.originalName}, ${f.bytes},
          ${ordinal},
          ${f.declaredOrdinal ?? null},
          ${f.declaredOrdinal != null ? 'user' : null},
          ${f.clientStartEpochMs != null ? new Date(f.clientStartEpochMs) : null},
          ${f.clientDurationMs != null ? f.clientDurationMs / 1000 : null},
          ${f.sha256 ?? null},
          ${existing ? existing.storageKey : null},
          ${multipartUploadId},
          ${useMultipart ? partSizeBytes : null},
          ${partsTotal},
          ${existing ? new Date() : null}
        )
        RETURNING id`;
      const fileId = rows[0].id;

      if (existing) {
        // Identical bytes are already in the bucket, so this file is not transferred at
        // all: the row points at the object we already hold. That is the whole point of
        // hashing before upload — the saving is the transfer, not just the storage.
        this.logger.log(
          `Dedup hit for ${f.originalName} (${f.sha256?.slice(0, 12)}…) → ${existing.storageKey}`,
        );
        targets.push({
          fileId,
          kind: f.kind,
          key: existing.storageKey,
          deduplicated: true,
          uploadUrl: null,
        });
        continue;
      }

      if (useMultipart) {
        targets.push({
          fileId,
          kind: f.kind,
          key,
          deduplicated: false,
          uploadUrl: null,
          multipart: {
            uploadId: multipartUploadId!,
            partSizeBytes,
            partsTotal: partsTotal!,
          },
        });
        continue;
      }

      targets.push({
        fileId,
        kind: f.kind,
        key,
        deduplicated: false,
        uploadUrl: await this.storage.presignUpload(key, f.contentType, f.sha256),
      });
    }

    // UC2: mark the journey as having footage on the way, so the instructor's
    // journey list can show "video processing" instead of "awaiting video".
    if (dto.journeyId) {
      await this.prisma.$executeRaw`
        UPDATE journeys
           SET upload_id = ${upload.id}::uuid, video_upload_state = 'processing'
         WHERE id = ${dto.journeyId}::uuid
      `;
    }

    return { uploadId: upload.id, routeId: route.id, targets };
  }

  /**
   * UC2 guard: the journey must be the caller's own, must already hold a GPS track,
   * and must not already have footage attached. Without the track there is nothing
   * to sync against; without the ownership check one instructor could attach their
   * footage to somebody else's recorded drive.
   */
  private async assertAttachableJourney(userId: string, journeyId: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{ instructor_id: string; upload_id: string | null; point_count: bigint }>
    >`
      SELECT j.instructor_id,
             j.upload_id,
             (SELECT COUNT(*) FROM journey_gps_points p WHERE p.journey_id = j.id) AS point_count
        FROM journeys j
       WHERE j.id = ${journeyId}::uuid
    `;
    if (!rows.length) throw new NotFoundException('Recorded journey not found');
    const j = rows[0];
    if (j.instructor_id !== userId) throw new ForbiddenException('Not your recorded journey');
    if (j.upload_id) throw new BadRequestException('That journey already has video attached');
    if (Number(j.point_count) < 2) {
      throw new BadRequestException('That journey has no usable GPS track');
    }
  }

  /**
   * Verify uploaded objects exist, then enqueue the processing pipeline.
   *
   * Phase 25 additions: the HEAD result is recorded (size + verified_at) instead of
   * being thrown away, so orphan cleanup can later distinguish "never arrived" from
   * "arrived but was never claimed". Any multipart upload still open at this point is
   * aborted, because reaching complete() with unassembled parts means the client gave
   * up on that file — and unassembled parts are billed while being invisible.
   */
  async complete(userId: string, uploadId: string) {
    const upload = await this.getOwned(userId, uploadId);

    const files = await this.prisma.$queryRaw<
      Array<{
        id: string;
        storage_key: string;
        original_name: string | null;
        multipart_upload_id: string | null;
        dedup_of_key: string | null;
      }>
    >`
      SELECT id, storage_key, original_name, multipart_upload_id, dedup_of_key
        FROM upload_files WHERE upload_id = ${uploadId}::uuid
    `;

    for (const file of files) {
      const meta = await this.storage.objectMetadata(file.storage_key);
      if (!meta) {
        // Abort a dangling multipart so its parts stop costing money, then fail loudly.
        if (file.multipart_upload_id) {
          await this.storage.abortMultipartUpload(file.storage_key, file.multipart_upload_id);
          await this.prisma.$executeRaw`
            UPDATE upload_files SET multipart_upload_id = NULL WHERE id = ${file.id}::uuid`;
        }
        throw new BadRequestException(
          `Object not uploaded: ${file.original_name ?? file.storage_key}`,
        );
      }
      await this.prisma.$executeRaw`
        UPDATE upload_files
           SET verified_at = now(),
               bytes = ${meta.size},
               multipart_upload_id = NULL
         WHERE id = ${file.id}::uuid`;
    }

    await this.prisma.upload.update({
      where: { id: upload.id },
      data: { status: UploadStatus.queued },
    });
    // Metadata now exists for every object, so this upload can never be an orphan.
    await this.prisma.$executeRaw`
      UPDATE uploads SET cleanup_state = 'retained' WHERE id = ${upload.id}::uuid`;

    if (upload.routeId) {
      await this.prisma.route.update({
        where: { id: upload.routeId },
        data: { status: RouteStatus.processing },
      });
    }
    await this.mediaQueue.enqueueProcessRoute(upload.id);

    return { uploadId: upload.id, status: UploadStatus.queued };
  }

  // ---- Phase 25: multipart upload -------------------------------------------

  /**
   * Sign the next batch of parts for a large file.
   *
   * Re-signable on demand, which is what makes an interrupted multi-GB upload
   * resumable: the client asks again for whichever parts it still needs, rather than
   * holding ~80 URLs that all expire on the same 15-minute clock.
   */
  async signParts(userId: string, uploadId: string, fileId: string, partNumbers: number[]) {
    await this.getOwned(userId, uploadId);
    const file = await this.getUploadFile(uploadId, fileId);

    if (!file.multipart_upload_id) {
      throw new BadRequestException('That file is not a multipart upload');
    }
    if (file.parts_total && partNumbers.some((n) => n > file.parts_total!)) {
      throw new BadRequestException(`Part numbers must be between 1 and ${file.parts_total}`);
    }
    if (!partNumbers.length) throw new BadRequestException('No part numbers requested');

    const parts = await this.storage.presignParts(
      file.storage_key,
      file.multipart_upload_id,
      partNumbers,
    );
    return {
      fileId,
      key: file.storage_key,
      partSizeBytes: Number(file.part_size_bytes ?? 0),
      partsTotal: file.parts_total,
      parts,
    };
  }

  /** Assemble a multipart upload's parts into the final object. */
  async completeMultipart(
    userId: string,
    uploadId: string,
    fileId: string,
    parts: Array<{ partNumber: number; etag: string }>,
  ) {
    await this.getOwned(userId, uploadId);
    const file = await this.getUploadFile(uploadId, fileId);

    if (!file.multipart_upload_id) {
      throw new BadRequestException('That file is not a multipart upload');
    }
    if (file.parts_total && parts.length !== file.parts_total) {
      // Assembling a subset silently produces a truncated video that looks fine until
      // someone watches the end of it, so this is rejected rather than accepted.
      throw new BadRequestException(
        `Expected ${file.parts_total} parts, received ${parts.length}`,
      );
    }

    await this.storage.completeMultipartUpload(
      file.storage_key,
      file.multipart_upload_id,
      parts,
    );

    const meta = await this.storage.objectMetadata(file.storage_key);
    await this.prisma.$executeRaw`
      UPDATE upload_files
         SET multipart_upload_id = NULL,
             parts_completed = ${parts.length},
             bytes = COALESCE(${meta?.size ?? null}, bytes),
             verified_at = now()
       WHERE id = ${fileId}::uuid`;

    this.logger.log(`Multipart complete: ${file.storage_key} (${parts.length} parts)`);
    return { fileId, key: file.storage_key, bytes: meta?.size ?? null };
  }

  /**
   * Abandon an upload session the client is giving up on.
   *
   * Explicitly exposed so a cancelled upload is cleaned immediately rather than waiting
   * for the nightly sweep — the user closing the tab is the common case, but the user
   * pressing Cancel is the one we can act on at once.
   */
  async abort(userId: string, uploadId: string) {
    const upload = await this.getOwned(userId, uploadId);
    if (upload.status === UploadStatus.queued || upload.status === UploadStatus.processing) {
      throw new BadRequestException('That upload is already being processed');
    }
    const reclaimed = await this.sweepUploadObjects(uploadId, 'aborted by uploader');
    await this.prisma.upload.update({
      where: { id: uploadId },
      data: { status: UploadStatus.failed, error: 'Aborted by uploader' },
    });
    return { uploadId, ...reclaimed };
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

  // ---- Phase 25: dedup, config, cleanup -------------------------------------

  private async getUploadFile(uploadId: string, fileId: string): Promise<UploadFileRow> {
    const rows = await this.prisma.$queryRaw<UploadFileRow[]>`
      SELECT id, storage_key, original_name, multipart_upload_id,
             part_size_bytes, parts_total, sha256
        FROM upload_files
       WHERE id = ${fileId}::uuid AND upload_id = ${uploadId}::uuid`;
    if (!rows.length) throw new NotFoundException('Upload file not found');
    return rows[0];
  }

  /**
   * Find an object we already hold with the same content hash.
   *
   * Only *verified* objects qualify. A row whose upload never completed may point at a
   * key holding nothing, or holding a partial file — pointing a new video at that would
   * turn one failed upload into two broken routes. `route_videos` is checked first
   * because a published object is the strongest evidence the bytes are really there.
   */
  private async findObjectByHash(sha256: string): Promise<{ storageKey: string } | null> {
    const published = await this.prisma.$queryRaw<Array<{ storage_key: string }>>`
      SELECT storage_key FROM route_videos
       WHERE sha256 = ${sha256} AND storage_key IS NOT NULL
       ORDER BY created_at ASC LIMIT 1`;
    if (published.length) return { storageKey: published[0].storage_key };

    const uploaded = await this.prisma.$queryRaw<Array<{ storage_key: string }>>`
      SELECT storage_key FROM upload_files
       WHERE sha256 = ${sha256}
         AND verified_at IS NOT NULL
         AND dedup_of_key IS NULL
       ORDER BY created_at ASC LIMIT 1`;
    if (uploaded.length) return { storageKey: uploaded[0].storage_key };

    return null;
  }

  /** Read a numeric `platform_config` value, falling back when unset or malformed. */
  private async configMb(key: string, fallback: number): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ value: string }>>`
      SELECT value FROM platform_config WHERE key = ${key}`;
    const parsed = Number(rows[0]?.value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  /**
   * Nightly orphan sweep.
   *
   * The failure it addresses: a client gets signed URLs, PUTs several GB to R2, then
   * never calls complete() — tab closed, crash, connection lost. Those bytes are billed
   * forever and nothing will ever reference them.
   *
   * Three safety properties, because this is the only code in the system that deletes
   * media and videos are supposed to be permanent:
   *   1. It only considers uploads that never completed AND are older than the
   *      configured age, so a genuinely slow 5 GB upload is never touched.
   *   2. It skips any object whose key is referenced by `route_videos`, or by another
   *      upload_files row (the dedup case — a second route may legitimately point at
   *      the same object). A valid video therefore cannot be reached by this path.
   *   3. It refuses to run past a configured object ceiling: a sweep that suddenly wants
   *      to delete hundreds of objects is far more likely to be a bug in the reference
   *      query than a real backlog, so it stops and reports instead.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cleanupOrphanUploads(): Promise<{ examined: number; swept: number; bytesReclaimed: number }> {
    const ageHours = await this.configMb('upload_orphan_age_hours', 24);
    const maxObjects = await this.configMb('upload_orphan_max_objects', 500);

    const candidates = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM uploads
       WHERE status IN ('created', 'uploading', 'failed')
         AND cleanup_state = 'pending'
         AND created_at < now() - (${ageHours}::text || ' hours')::interval
       ORDER BY created_at ASC
       LIMIT 200`;

    if (!candidates.length) return { examined: 0, swept: 0, bytesReclaimed: 0 };

    let swept = 0;
    let bytesReclaimed = 0;
    let objectBudget = maxObjects;

    for (const c of candidates) {
      if (objectBudget <= 0) {
        this.logger.warn(
          `Orphan sweep stopped early: hit the ${maxObjects}-object ceiling. ` +
            'Raise upload_orphan_max_objects only after checking this is a real backlog.',
        );
        break;
      }
      const result = await this.sweepUploadObjects(c.id, `orphaned >${ageHours}h`);
      objectBudget -= result.objectsDeleted;
      bytesReclaimed += result.bytesReclaimed;
      if (result.objectsDeleted > 0) swept++;
    }

    this.logger.log(
      `Orphan sweep: examined ${candidates.length}, swept ${swept}, ` +
        `reclaimed ${(bytesReclaimed / 1024 / 1024).toFixed(1)} MB`,
    );
    return { examined: candidates.length, swept, bytesReclaimed };
  }

  /**
   * Remove one upload's unreferenced objects and record what happened.
   *
   * Shared by the nightly cron and the explicit abort endpoint so there is exactly one
   * implementation of "which objects is it safe to delete", rather than two that can
   * disagree about it.
   */
  private async sweepUploadObjects(
    uploadId: string,
    reason: string,
  ): Promise<{ objectsDeleted: number; bytesReclaimed: number }> {
    const files = await this.prisma.$queryRaw<
      Array<{
        id: string;
        storage_key: string;
        multipart_upload_id: string | null;
        dedup_of_key: string | null;
      }>
    >`
      SELECT id, storage_key, multipart_upload_id, dedup_of_key
        FROM upload_files WHERE upload_id = ${uploadId}::uuid`;

    const deletable: string[] = [];
    let bytesReclaimed = 0;

    for (const f of files) {
      // Always release open multipart parts: they cost money and are invisible to a
      // listing, so leaving them is a silent bill.
      if (f.multipart_upload_id) {
        await this.storage.abortMultipartUpload(f.storage_key, f.multipart_upload_id);
      }

      // A deduplicated row never owned its object — deleting it would destroy the video
      // it was pointing at.
      if (f.dedup_of_key) continue;

      if (await this.isKeyReferencedElsewhere(f.storage_key, f.id)) continue;

      const meta = await this.storage.objectMetadata(f.storage_key);
      if (!meta) continue; // nothing was ever uploaded to this key
      deletable.push(f.storage_key);
      bytesReclaimed += meta.size;
    }

    const objectsDeleted = await this.storage.deleteMany(deletable);

    await this.prisma.$executeRaw`
      UPDATE uploads
         SET cleanup_state   = ${objectsDeleted > 0 ? 'swept' : 'retained'},
             cleaned_up_at   = now(),
             cleanup_note    = ${`${reason}; ${objectsDeleted} object(s) removed`},
             bytes_reclaimed = ${bytesReclaimed}
       WHERE id = ${uploadId}::uuid`;

    if (objectsDeleted > 0) {
      this.logger.log(
        `Swept upload ${uploadId}: ${objectsDeleted} object(s), ` +
          `${(bytesReclaimed / 1024 / 1024).toFixed(1)} MB (${reason})`,
      );
    }
    return { objectsDeleted, bytesReclaimed };
  }

  /**
   * Whether any other database row depends on this object key.
   *
   * This is the guard that makes "never delete a valid video" true rather than hoped
   * for. Checked against published videos, previews and other uploads' file rows —
   * so a shared (deduplicated) object survives as long as anything still points at it.
   */
  private async isKeyReferencedElsewhere(key: string, exceptFileId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ referenced: boolean }>>`
      SELECT (
        EXISTS (SELECT 1 FROM route_videos WHERE storage_key = ${key} OR manifest_key = ${key})
        OR EXISTS (SELECT 1 FROM route_gpx WHERE storage_key = ${key})
        OR EXISTS (
          SELECT 1 FROM route_previews
           WHERE thumbnail_key = ${key} OR thumbnail_small_key = ${key}
              OR map_preview_key = ${key} OR sprite_key = ${key}
        )
        OR EXISTS (
          SELECT 1 FROM upload_files
           WHERE storage_key = ${key} AND id <> ${exceptFileId}::uuid
        )
      ) AS referenced`;
    return rows[0]?.referenced === true;
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
