/**
 * What a file should be *declared* as when uploading, decided from the filename first.
 *
 * ## Why not just use `file.type`
 *
 * `File.type` is not read from the file's contents. On Windows the browser looks the
 * extension up in the registry's `Content Type` entry, and any application that registers
 * itself as a video handler can overwrite it — so a valid `.mp4` can be reported as
 * `video/webm`, and the upload was refused before a byte moved. The extension is the thing
 * the contributor actually chose, so it wins whenever we recognise it.
 *
 * ## Why one function serves both the declaration and the PUT
 *
 * The API signs the presigned upload URL over the `contentType` we declare, and object
 * storage rejects a PUT whose `Content-Type` header differs from the signed one. Declaring
 * with one rule and uploading with another therefore fails at the storage layer with an
 * opaque signature error. Both sides call this, so they cannot disagree.
 *
 * Kept in step with `apps/api/src/modules/uploads/video-types.ts`, which is the source of
 * truth and validates whatever we send. This copy exists only so the file picker and the
 * PUT header can be decided without a round trip.
 */

const EXTENSION_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  ts: 'video/mp2t',
  m2ts: 'video/mp2t',
  mts: 'video/mp2t',
  '3gp': 'video/3gpp',
};

const TYPE_ALIASES: Record<string, string> = {
  'video/avi': 'video/x-msvideo',
  'video/msvideo': 'video/x-msvideo',
  'video/x-msvideo': 'video/x-msvideo',
  'video/x-m4v': 'video/mp4',
  'video/mp4': 'video/mp4',
  'video/quicktime': 'video/quicktime',
  'video/x-matroska': 'video/x-matroska',
  'video/webm': 'video/webm',
  'video/mpeg': 'video/mpeg',
  'video/mp2t': 'video/mp2t',
  'video/3gpp': 'video/3gpp',
};

/**
 * `accept` for the video file pickers, built from the same table the API validates
 * against. Listing extensions rather than `video/*` is deliberate: `video/*` matches on
 * the same unreliable `File.type`, so it both hides files we accept and offers files we
 * do not.
 */
export const VIDEO_ACCEPT = Object.keys(EXTENSION_TYPES)
  .map((e) => `.${e}`)
  .join(',');

/** Human-readable form of the same list, for error and helper text. */
export const VIDEO_FORMATS_LABEL = 'MP4, MOV, MKV, WebM, AVI, MPEG, TS and 3GP';

function extensionOf(name: string): string {
  const lower = name.trim().toLowerCase();
  const dot = lower.lastIndexOf('.');
  return dot <= 0 ? '' : lower.slice(dot + 1);
}

/** The canonical video type for a file, or `null` if it is not a video we support. */
export function resolveVideoType(name: string, declared: string): string | null {
  const byExtension = EXTENSION_TYPES[extensionOf(name)];
  if (byExtension) return byExtension;
  const stripped = (declared || '').split(';')[0].trim().toLowerCase();
  return TYPE_ALIASES[stripped] ?? null;
}

/**
 * The `Content-Type` to declare to the API *and* send on the PUT.
 *
 * Non-video files (GPS logs) keep their declared type, falling back to
 * `application/octet-stream` — unchanged behaviour, now applied in one place instead of
 * two that could disagree.
 */
export function uploadContentType(file: File): string {
  return resolveVideoType(file.name, file.type) || file.type || 'application/octet-stream';
}
