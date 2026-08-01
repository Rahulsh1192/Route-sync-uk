import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  UploadPartCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Metadata from a HEAD — enough to verify an upload without downloading it. */
export interface ObjectMetadata {
  key: string;
  size: number;
  contentType?: string;
  etag?: string;
  lastModified?: Date;
  /** Checksum recorded at upload time, when the client supplied one. */
  sha256?: string;
}

/** One part of a multipart upload, as handed to the client for a direct PUT. */
export interface MultipartPartTarget {
  partNumber: number;
  uploadUrl: string;
}

/** Asset classes with different public-delivery rules (see `publicUrl`). */
export type AssetClass = 'thumbnail' | 'hls' | 'master';

/**
 * The only asset classes this service will ever hand out an unsigned public URL for.
 *
 * Hard-coded rather than configured. `CDN_PUBLIC_ASSETS` already validates the same set
 * at startup, so this is the second of two independent gates: video cannot be published
 * to a public origin by an env-var change, a bad default, or a caller passing the wrong
 * asset class. Route footage sits behind a per-test-centre paywall and a public URL has
 * neither an expiry nor an identity attached, so there is no configuration in which
 * publishing it is correct.
 */
const PUBLIC_ASSET_CLASSES: readonly AssetClass[] = ['thumbnail'];

/**
 * S3-compatible object storage. Works against MinIO locally and Cloudflare R2 /
 * AWS S3 in production by only changing env. Media is never public by default —
 * access is via short-lived signed URLs (download protection, streaming only).
 *
 * Multipart support exists because route footage runs to several GB: a single PUT has
 * no resume and no parallelism, so one dropped connection costs the entire upload. The
 * API still never handles the bytes — it only signs each part.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly ttl: number;
  private readonly uploadTtl: number;
  private readonly publicBase?: string;
  private readonly publicAssets: AssetClass[];

  constructor(private config: ConfigService) {
    this.bucket = this.config.get<string>('S3_BUCKET')!;
    this.ttl = this.config.get<number>('SIGNED_URL_TTL')!;
    this.uploadTtl = this.config.get<number>('UPLOAD_SIGNED_URL_TTL') ?? 900;
    this.publicBase = this.config.get<string>('R2_PUBLIC_URL')?.replace(/\/+$/, '');

    // Intersect the configured list with the hard-coded one instead of trusting it. The
    // config layer already rejects anything else at startup; if that check is ever
    // loosened or bypassed, this still holds.
    const configured = this.config.get<string[]>('CDN_PUBLIC_ASSETS') ?? ['thumbnail'];
    this.publicAssets = PUBLIC_ASSET_CLASSES.filter((c) => configured.includes(c));
    const dropped = configured.filter((c) => !this.publicAssets.includes(c as AssetClass));
    if (dropped.length) {
      this.logger.error(
        `Ignoring CDN_PUBLIC_ASSETS=${dropped.join(',')}: only ` +
          `${PUBLIC_ASSET_CLASSES.join(', ')} may be served publicly. Video stays signed.`,
      );
    }
    this.s3 = new S3Client({
      endpoint: this.config.get<string>('S3_ENDPOINT'),
      region: this.config.get<string>('S3_REGION'),
      forcePathStyle: this.config.get<boolean>('S3_FORCE_PATH_STYLE'),
      credentials: {
        accessKeyId: this.config.get<string>('S3_ACCESS_KEY')!,
        secretAccessKey: this.config.get<string>('S3_SECRET_KEY')!,
      },
    });
  }

  /**
   * Presigned PUT for direct-to-storage upload (browser/app → R2, bypassing API).
   *
   * Uses the shorter upload TTL: a signed PUT is a write capability, so it lives only
   * as long as the upload needs it. When `sha256` is supplied it is bound into the
   * signature as object metadata, which makes the checksum tamper-evident rather than
   * a claim the client asks us to take on trust.
   */
  presignUpload(key: string, contentType: string, sha256?: string): Promise<string> {
    return getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ...(sha256 ? { Metadata: { sha256 } } : {}),
      }),
      { expiresIn: this.uploadTtl },
    );
  }

  /** Short-lived signed GET for streaming/playback. */
  presignDownload(key: string, ttlSeconds?: number): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: ttlSeconds ?? this.ttl,
    });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Server-side PUT. Only for small artifacts the API legitimately owns (a rewritten
   * manifest, a placeholder). Video never goes through here — that would make the API
   * the upload bottleneck this whole design exists to avoid.
   */
  async upload(
    key: string,
    body: Buffer | Uint8Array | string,
    contentType = 'application/octet-stream',
  ): Promise<string> {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
    return key;
  }

  /**
   * Read a small text object (an HLS playlist), or null when it isn't there.
   *
   * Capped hard at `maxBytes`. The cap is the point: this is the one read path where the
   * API holds an object's bytes, so it must be impossible to aim at a video. A playlist is
   * a couple of kilobytes; anything larger is either not a playlist or not something the
   * API should be buffering, and either way the caller gets an error rather than the
   * server quietly allocating a gigabyte.
   */
  async getText(key: string, maxBytes = 512 * 1024): Promise<string | null> {
    try {
      const res = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          // Ask for one byte past the limit so an oversized object is detectable without
          // transferring the rest of it.
          Range: `bytes=0-${maxBytes}`,
        }),
      );
      const body = await res.Body?.transformToString();
      if (body === undefined) return null;
      if (Buffer.byteLength(body) > maxBytes) {
        throw new Error(`Object ${key} exceeds the ${maxBytes}-byte text limit`);
      }
      return body;
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === 'NoSuchKey' || name === 'NotFound') return null;
      throw e;
    }
  }

  /** Full object metadata (size/type/etag), or null when the object isn't there. */
  async objectMetadata(key: string): Promise<ObjectMetadata | null> {
    try {
      const head = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        key,
        size: Number(head.ContentLength ?? 0),
        contentType: head.ContentType,
        etag: head.ETag?.replace(/"/g, ''),
        lastModified: head.LastModified,
        sha256: head.Metadata?.sha256,
      };
    } catch {
      return null;
    }
  }

  /**
   * Delete a single object.
   *
   * Callers must prove the object is unreferenced first — this class deliberately knows
   * nothing about the database. Videos are permanent by product rule, so the only
   * sanctioned caller is orphan cleanup.
   */
  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    this.logger.log(`Deleted object ${key}`);
  }

  /** Batch delete (1000 keys per call, the S3/R2 API limit). Returns the count removed. */
  async deleteMany(keys: string[]): Promise<number> {
    if (!keys.length) return 0;
    let deleted = 0;
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      const res = await this.s3.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      deleted += batch.length - (res.Errors?.length ?? 0);
      for (const err of res.Errors ?? []) {
        this.logger.warn(`Could not delete ${err.Key}: ${err.Message}`);
      }
    }
    return deleted;
  }

  /** List objects under a prefix — used to sweep an abandoned upload's folder. */
  async list(prefix: string, maxKeys = 1000): Promise<ObjectMetadata[]> {
    const out: ObjectMetadata[] = [];
    let token: string | undefined;
    do {
      const res = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
          MaxKeys: Math.min(1000, maxKeys - out.length),
        }),
      );
      for (const o of res.Contents ?? []) {
        if (!o.Key) continue;
        out.push({
          key: o.Key,
          size: Number(o.Size ?? 0),
          etag: o.ETag?.replace(/"/g, ''),
          lastModified: o.LastModified,
        });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token && out.length < maxKeys);
    return out;
  }

  // ---- multipart (large files: parallel parts + resume) ---------------------

  /** Begin a multipart upload; returns the id the client sends back with each part. */
  async createMultipartUpload(key: string, contentType: string): Promise<string> {
    const res = await this.s3.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    if (!res.UploadId) throw new Error(`Storage did not return an UploadId for ${key}`);
    return res.UploadId;
  }

  /**
   * Sign a batch of parts so the client can PUT them in parallel.
   *
   * Signed per part rather than one URL for the whole object, because that is precisely
   * what makes a multi-GB upload resumable: a failed part is retried on its own instead
   * of restarting the transfer.
   */
  async presignParts(
    key: string,
    uploadId: string,
    partNumbers: number[],
  ): Promise<MultipartPartTarget[]> {
    return Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        uploadUrl: await getSignedUrl(
          this.s3,
          new UploadPartCommand({
            Bucket: this.bucket,
            Key: key,
            UploadId: uploadId,
            PartNumber: partNumber,
          }),
          { expiresIn: this.uploadTtl },
        ),
      })),
    );
  }

  /**
   * Finish a multipart upload.
   *
   * Parts are sorted by number here rather than trusting the order the client reported
   * them in — parallel uploads complete out of order by definition, and an unsorted
   * part list assembles a corrupt object.
   */
  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>,
  ): Promise<void> {
    await this.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: [...parts]
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
        },
      }),
    );
  }

  /**
   * Abandon a multipart upload and release its parts.
   *
   * Worth calling on every failure path: incomplete parts are billed but do not appear
   * in a normal object listing, which makes them the classic source of storage cost
   * nobody can account for.
   */
  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    try {
      await this.s3.send(
        new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }),
      );
    } catch (e) {
      // Already aborted or completed is fine — this runs on cleanup paths.
      this.logger.warn(`Abort multipart failed for ${key}: ${(e as Error).message}`);
    }
  }

  // ---- CDN -----------------------------------------------------------------

  /**
   * Public CDN URL for an object, or null when public delivery isn't allowed for it.
   *
   * Three gates: the class must be in `PUBLIC_ASSET_CLASSES`, it must also be enabled in
   * `CDN_PUBLIC_ASSETS`, and a public origin must be configured. `assetClass` defaults to
   * `master` so a caller that forgets to pass one gets the safe answer (null) rather than
   * accidentally publishing.
   */
  publicUrl(key: string, assetClass: AssetClass = 'master'): string | null {
    if (!PUBLIC_ASSET_CLASSES.includes(assetClass)) return null;
    if (!this.publicBase) return null;
    if (!this.publicAssets.includes(assetClass)) return null;
    return `${this.publicBase}/${key.replace(/^\/+/, '')}`;
  }

  /** Whether an asset class is CDN-served, so callers can skip signing entirely. */
  isPublic(assetClass: AssetClass): boolean {
    return !!this.publicUrl('probe', assetClass);
  }

  /**
   * CDN URL when permitted, otherwise a signed URL — the single call for consumers.
   *
   * Absolute URLs pass through untouched, preserving the existing behaviour where a
   * seeded public test stream can be stored directly in `route_videos`.
   */
  async resolveUrl(
    key: string,
    assetClass: AssetClass = 'master',
    ttlSeconds?: number,
  ): Promise<string> {
    if (/^https?:\/\//.test(key)) return key;
    return this.publicUrl(key, assetClass) ?? this.presignDownload(key, ttlSeconds);
  }
}
