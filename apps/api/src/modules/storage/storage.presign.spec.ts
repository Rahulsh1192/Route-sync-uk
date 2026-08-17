/**
 * Presigned upload URLs must not carry a body checksum.
 *
 * From v3.729 the AWS SDK computes a CRC32 of the request body by default. A presigned
 * URL has no body at signing time, so what gets baked into the signed query is the CRC32
 * of *nothing* (`x-amz-checksum-crc32=AAAAAA==`). The browser then PUTs real bytes against
 * a URL that promises an empty-body checksum, and R2 rejects the request — which the web
 * app surfaces as "Upload failed — check your connection and try again", because the
 * rejection arrives without CORS headers and is therefore unreadable to the page.
 *
 * MinIO accepts these URLs, so this never fails locally. That is exactly why it needs a
 * test rather than a manual check.
 */
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

const CONFIG: Record<string, unknown> = {
  S3_BUCKET: 'test-bucket',
  S3_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
  S3_REGION: 'auto',
  S3_FORCE_PATH_STYLE: true,
  S3_ACCESS_KEY: 'test-access-key',
  S3_SECRET_KEY: 'test-secret-key',
  SIGNED_URL_TTL: 3600,
  UPLOAD_SIGNED_URL_TTL: 900,
  CDN_PUBLIC_ASSETS: ['thumbnail'],
};

function makeService(): StorageService {
  const config = { get: (key: string) => CONFIG[key] } as unknown as ConfigService;
  return new StorageService(config);
}

/** Every checksum parameter the SDK can add to a signed query. */
function checksumParams(url: string): string[] {
  return [...new URL(url).searchParams.keys()].filter(
    (k) => k.toLowerCase().startsWith('x-amz-checksum-') || k.toLowerCase() === 'x-amz-sdk-checksum-algorithm',
  );
}

describe('StorageService presigning', () => {
  it('signs a single-PUT upload URL with no checksum parameters', async () => {
    const url = await makeService().presignUpload('routes/clip.mp4', 'video/mp4');

    expect(checksumParams(url)).toEqual([]);
  });

  it('signs a single-PUT upload URL with no checksum parameters when a sha256 is bound in', async () => {
    const url = await makeService().presignUpload('routes/clip.mp4', 'video/mp4', 'a'.repeat(64));

    expect(checksumParams(url)).toEqual([]);
  });

  it('signs multipart part URLs with no checksum parameters', async () => {
    const parts = await makeService().presignParts('routes/clip.mp4', 'upload-id-1', [1, 2]);

    expect(parts).toHaveLength(2);
    for (const part of parts) expect(checksumParams(part.uploadUrl)).toEqual([]);
  });

  it('still signs the request itself', async () => {
    const url = await makeService().presignUpload('routes/clip.mp4', 'video/mp4');

    expect(new URL(url).searchParams.get('X-Amz-Signature')).toBeTruthy();
  });
});
