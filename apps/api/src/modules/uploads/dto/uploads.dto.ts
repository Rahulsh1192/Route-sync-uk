import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

/** A lowercase hex SHA-256 digest. */
export const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export enum UploadFileKind {
  front = 'front',
  rear = 'rear',
  /**
   * A GPS log in any supported format (GPX, NMEA, CSV, brand-specific text logs).
   * Phase 24: a dashcam splits a drive across several logs, so several `gps` files
   * per upload are normal; the worker merges them on the master clock.
   */
  gps = 'gps',
  /** @deprecated Pre-Phase-24 clients send this; handled exactly like `gps`. */
  gpx = 'gpx',
}

/** Where the GPS track for this recording comes from — selects the sync strategy. */
export enum GpsSource {
  /** UC1: separate GPS log files copied off a GPS-enabled dashcam. */
  camera = 'camera',
  /** UC1 best case: GPS embedded in the video container / data stream. */
  embedded = 'embedded',
  /** UC2: track recorded live in our app; camera clock aligned by correlation. */
  app_journey = 'app_journey',
}

/** Both kinds carry GPS; `gpx` is only kept for backwards compatibility. */
export const GPS_FILE_KINDS: string[] = [UploadFileKind.gps, UploadFileKind.gpx];

export class DeclaredFileDto {
  @IsEnum(UploadFileKind)
  kind!: UploadFileKind;

  @IsString()
  originalName!: string;

  @IsString()
  contentType!: string;

  @IsInt()
  @Min(1)
  bytes!: number;

  /**
   * Phase 24: the instructor's confirmed position for this clip within its camera
   * view, set on the review screen. Upload order is not trustworthy (browsers make
   * no guarantee about file-input order) and mtime is worse (copying rewrites it),
   * so once a human has seen the detected order and accepted or corrected it, that
   * decision outranks anything the worker infers.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  declaredOrdinal?: number;

  /**
   * Client-probed clip start (epoch ms) as shown on the review screen. Advisory
   * only: the worker re-probes server-side and falls back to this just when it
   * cannot do better, so a tampered value can't fabricate a timeline.
   */
  @IsOptional()
  @IsInt()
  clientStartEpochMs?: number;

  /** Client-probed duration in ms — advisory, same caveat as above. */
  @IsOptional()
  @IsInt()
  @Min(0)
  clientDurationMs?: number;

  /**
   * Phase 25: SHA-256 of the file's bytes, computed by the client before upload.
   *
   * Sent up-front so an identical file that we already hold is never transferred a
   * second time — the dedup decision has to happen BEFORE the bytes move, or it saves
   * nothing. The worker re-hashes what actually arrived, so a wrong or forged value
   * cannot make us serve the wrong object; it only costs the client a real upload.
   */
  @IsOptional()
  @IsString()
  @Matches(SHA256_PATTERN, { message: 'sha256 must be a lowercase hex SHA-256 digest' })
  sha256?: string;
}

/**
 * Phase 25: request signed URLs for the next batch of multipart parts.
 *
 * Parts are signed in batches rather than all at once because a 5 GB file at 64 MB
 * parts is ~80 URLs, and every one of them would expire on the same 15-minute clock —
 * so a slow connection would find its later URLs dead. Batching re-signs as the upload
 * progresses, which is also what makes resuming after an interruption work.
 */
export class SignPartsDto {
  @IsUUID()
  fileId!: string;

  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  // S3/R2 allow at most 10,000 parts per object.
  @Max(10_000, { each: true })
  partNumbers!: number[];
}

/** One finished part, as reported back by the client after its PUT succeeded. */
export class CompletedPartDto {
  @IsInt()
  @Min(1)
  @Max(10_000)
  partNumber!: number;

  /** ETag from the part's PUT response; R2 rejects the assembly if any is wrong. */
  @IsString()
  etag!: string;
}

/** Phase 25: assemble the parts into the final object. */
export class CompleteMultipartDto {
  @IsUUID()
  fileId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompletedPartDto)
  parts!: CompletedPartDto[];
}

export class InitUploadDto {
  @IsString()
  title!: string; // route title (route is created in draft at init)

  @IsOptional()
  @IsString()
  description?: string;

  // Phase 20: every route must belong to a test centre, so this is now required.
  @IsUUID()
  testCentreId!: string;

  @IsOptional()
  @IsString()
  clockSource?: string; // 'gps' | 'camera_gps' | 'file_mtime'

  @IsOptional()
  @IsString()
  agreementVersion?: string; // contributor footage-licensing agreement accepted

  // ---------------- Phase 24: recording provenance ----------------

  @IsOptional()
  @IsEnum(GpsSource)
  gpsSource?: GpsSource;

  /**
   * UC2: the app-recorded journey this footage belongs to. Required when
   * `gpsSource = app_journey` — that journey is the only place the GPS exists, so
   * without it there is nothing to synchronise the video against.
   */
  @ValidateIf((o) => o.gpsSource === GpsSource.app_journey)
  @IsUUID()
  journeyId?: string;

  /**
   * The R1 this drive claims to replicate. Phase 24 decision: dashcam uploads are
   * conformance-checked, so recorded GPS never becomes published geometry until it
   * has been matched against R1.
   */
  @IsOptional()
  @IsUUID()
  referenceRouteId?: string;

  /**
   * Correction for a dashcam with a wrong clock (unset after battery loss, wrong
   * timezone, missing DST). Added to every clip's detected start time. Signed.
   */
  @IsOptional()
  @IsInt()
  cameraClockOffsetMs?: number;

  /**
   * Set by the review screen once the instructor has seen the detected clip order,
   * the gap report and the duration reconciliation. Stored so a confirmed timeline
   * can be told apart from a blind submit when triaging a bad route later.
   */
  @IsOptional()
  @IsBoolean()
  timelineReviewed?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeclaredFileDto)
  files!: DeclaredFileDto[];
}
