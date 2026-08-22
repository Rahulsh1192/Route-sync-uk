/**
 * Which video files a contributor may upload, and how to decide what one actually is.
 *
 * ## Why this is not just a list of MIME types
 *
 * The client declares a `contentType` taken from the browser's `File.type`. That value is
 * **not** derived from the file's contents: on Windows it is read from the registry's
 * `Content Type` entry for the extension, and on other platforms from a comparable table.
 * Any application that installs itself as a video handler can rewrite that entry, so a
 * perfectly valid `.mp4` can arrive declared as something else entirely — and the upload
 * was refused before a single byte moved.
 *
 * So the extension wins when we recognise it, and the declared type is only consulted when
 * the name tells us nothing. That inverts the previous behaviour, which trusted the one
 * signal the user has least control over.
 *
 * ## This is a usability gate, not a security control
 *
 * The bytes go straight from the browser to object storage on a presigned URL — they never
 * pass through the API — so nothing here can inspect them, and a client that wants to lie
 * always can. The purpose is to catch honest mistakes early and say something useful, not
 * to prove the file is what it claims. ffmpeg in the worker is the only thing that truly
 * knows, and it reports back through the normal processing-failure path.
 */

/**
 * Canonical type per file extension.
 *
 * The list is bounded by what the worker's ffmpeg pipeline can decode and re-encode to
 * H.264 HLS, which is considerably more than the three containers this used to allow. It
 * is deliberately not "anything ffmpeg might handle": an exotic format that fails would do
 * so only after a multi-gigabyte transfer and a dead worker job, which is a far worse
 * experience than being told at the file picker.
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

/**
 * Spellings of the same container, mapped to the one this system uses.
 *
 * Cameras, browsers and phones disagree about these — `video/avi`, `video/msvideo` and
 * `video/x-msvideo` are all the same thing — and collapsing them here means nothing
 * downstream has to know the synonyms.
 */
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
 * Extensions the file picker should advertise, derived from the same table the server
 * validates against so the two cannot drift. A picker that invites more than the server
 * accepts produces a rejection after the user has already selected, analysed and submitted.
 */
export const SUPPORTED_VIDEO_EXTENSIONS: string[] = Object.keys(EXTENSION_TYPES).map(
  (e) => `.${e}`,
);

/** Every canonical type, for callers that need to check one directly. */
export const SUPPORTED_VIDEO_TYPES: string[] = [...new Set(Object.values(EXTENSION_TYPES))];

/** Lowercase extension of a filename, without the dot. Empty string when there isn't one. */
function extensionOf(originalName: string): string {
  const name = originalName.trim().toLowerCase();
  const dot = name.lastIndexOf('.');
  // `dot <= 0` also covers dotfiles, where the leading dot is not an extension marker.
  return dot <= 0 ? '' : name.slice(dot + 1);
}

/**
 * Decide what a declared file is, or `null` if it is not a video we can process.
 *
 * The extension is authoritative when recognised, because it is what the uploader actually
 * chose; the declared MIME type is a fallback for names that carry no extension, which is
 * what Android share sheets and some dashcam apps hand over.
 *
 * Returns the canonical type so callers store and sign one consistent value.
 */
export function resolveVideoType(
  originalName: string,
  declaredContentType: string | undefined,
): string | null {
  const byExtension = EXTENSION_TYPES[extensionOf(originalName)];
  if (byExtension) return byExtension;

  // Strip any parameters (`; codecs="avc1.640028"`) before matching — they describe the
  // streams inside the container, and the container is all that matters here.
  const declared = (declaredContentType ?? '').split(';')[0].trim().toLowerCase();
  return TYPE_ALIASES[declared] ?? null;
}
