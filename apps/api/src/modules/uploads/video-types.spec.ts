import { SUPPORTED_VIDEO_EXTENSIONS, resolveVideoType } from './video-types';

describe('resolveVideoType', () => {
  it('trusts the extension over a browser MIME type that contradicts it', () => {
    // The bug this exists for: `File.type` is read from the OS registry by extension, not
    // from the bytes, so a machine with a clobbered mapping reports a perfectly good .mp4
    // as something else entirely — and the upload was refused before it began.
    expect(resolveVideoType('dashcam-front.mp4', 'video/webm')).toBe('video/mp4');
    expect(resolveVideoType('clip.mov', 'application/octet-stream')).toBe('video/quicktime');
  });

  it('accepts the formats the transcoder can decode, not just the original three', () => {
    expect(resolveVideoType('clip.webm', 'video/webm')).toBe('video/webm');
    expect(resolveVideoType('clip.avi', 'video/x-msvideo')).toBe('video/x-msvideo');
    expect(resolveVideoType('clip.mkv', 'video/x-matroska')).toBe('video/x-matroska');
    expect(resolveVideoType('clip.m4v', '')).toBe('video/mp4');
    expect(resolveVideoType('clip.3gp', '')).toBe('video/3gpp');
    expect(resolveVideoType('clip.ts', '')).toBe('video/mp2t');
  });

  it('ignores case and surrounding whitespace in the extension', () => {
    expect(resolveVideoType('DASHCAM.MP4', '')).toBe('video/mp4');
    expect(resolveVideoType('  clip.MkV  ', '')).toBe('video/x-matroska');
  });

  it('falls back to the declared type when the name carries no usable extension', () => {
    // Android share sheets and some dashcam apps hand over a name with no extension.
    expect(resolveVideoType('clip', 'video/mp4')).toBe('video/mp4');
    expect(resolveVideoType('', 'video/quicktime')).toBe('video/quicktime');
  });

  it('normalises MIME aliases and codec parameters to one canonical type', () => {
    // Browsers and cameras spell the same container several ways; the pipeline should see
    // one value so nothing downstream has to know the synonyms.
    expect(resolveVideoType('clip', 'video/avi')).toBe('video/x-msvideo');
    expect(resolveVideoType('clip', 'video/msvideo')).toBe('video/x-msvideo');
    expect(resolveVideoType('clip', 'video/x-m4v')).toBe('video/mp4');
    expect(resolveVideoType('clip', 'VIDEO/MP4')).toBe('video/mp4');
    expect(resolveVideoType('clip', 'video/mp4; codecs="avc1.640028"')).toBe('video/mp4');
  });

  it('rejects what the transcoder cannot use', () => {
    expect(resolveVideoType('notes.txt', 'text/plain')).toBeNull();
    expect(resolveVideoType('photo.jpg', 'image/jpeg')).toBeNull();
    expect(resolveVideoType('clip', '')).toBeNull();
    expect(resolveVideoType('archive.zip', 'application/zip')).toBeNull();
  });

  it('publishes the extension list the file picker advertises', () => {
    // The picker and this gate must agree, or the UI invites a file it will then refuse
    // after the user has selected, analysed and submitted it.
    expect(SUPPORTED_VIDEO_EXTENSIONS).toContain('.mp4');
    expect(SUPPORTED_VIDEO_EXTENSIONS).toContain('.webm');
    expect(SUPPORTED_VIDEO_EXTENSIONS.every((e) => e.startsWith('.'))).toBe(true);
  });
});
