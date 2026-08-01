/**
 * Client-side clip inspection for the upload review step (Phase 24).
 *
 * This is a PREVIEW, not the source of truth. The worker re-derives everything
 * server-side from the actual media, because a browser can be lied to and a filename
 * can be renamed. What this buys is the thing that matters most to the instructor:
 * seeing the detected order, the gaps and the duration reconciliation *before*
 * uploading twenty minutes of video, rather than discovering a problem afterwards.
 *
 * The filename conventions mirror `services/worker/worker/dashcam_formats.py`. They are
 * duplicated deliberately — the alternative is a round trip per file before the upload
 * even starts, and the two only need to agree closely enough for the preview to be
 * honest. Where they disagree, the server wins and the review screen said "detected".
 */

export interface ClipNameInfo {
  brand: string | null;
  startEpochMs: number | null;
  view: 'front' | 'rear' | null;
  seq: number | null;
}

interface Rule {
  brand: string;
  re: RegExp;
  viewMap?: Record<string, 'front' | 'rear'>;
  century?: number;
}

/** First match wins, so brand rules must precede the loose generic fallbacks. */
const RULES: Rule[] = [
  {
    brand: 'viofo',
    re: /(?<Y>\d{4})_(?<m>\d{2})(?<d>\d{2})_(?<H>\d{2})(?<M>\d{2})(?<S>\d{2})(?:_(?<seq>\d+))?_?(?<view>[FRI])?/i,
    viewMap: { F: 'front', R: 'rear', I: 'rear' },
  },
  {
    brand: 'blackvue',
    re: /(?<Y>\d{4})(?<m>\d{2})(?<d>\d{2})_(?<H>\d{2})(?<M>\d{2})(?<S>\d{2})_(?<view>[NEP][FR])/i,
    viewMap: { NF: 'front', EF: 'front', PF: 'front', NR: 'rear', ER: 'rear', PR: 'rear' },
  },
  {
    brand: 'vantrue',
    re: /(?<Y>\d{4})(?<m>\d{2})(?<d>\d{2})_(?<H>\d{2})(?<M>\d{2})(?<S>\d{2})_(?<seq>\d{3,4})(?<view>[FRAB])?/i,
    viewMap: { F: 'front', A: 'front', R: 'rear', B: 'rear' },
  },
  {
    brand: '70mai',
    re: /NO(?<Y>\d{4})(?<m>\d{2})(?<d>\d{2})-(?<H>\d{2})(?<M>\d{2})(?<S>\d{2})(?:-(?<seq>\d+))?/i,
  },
  {
    brand: 'nextbase',
    re: /(?:FILE)?(?<Y>\d{2})(?<m>\d{2})(?<d>\d{2})[-_](?<H>\d{2})(?<M>\d{2})(?<S>\d{2})(?:[-_](?<seq>\d+))?(?:[-_]?(?<view>[FR]))?/i,
    viewMap: { F: 'front', R: 'rear' },
    century: 2000,
  },
  {
    brand: 'generic',
    re: /(?<Y>\d{4})[-_.](?<m>\d{2})[-_.](?<d>\d{2})[ _T](?<H>\d{2})[-_.:](?<M>\d{2})[-_.:](?<S>\d{2})/,
  },
  {
    brand: 'generic',
    re: /(?<Y>\d{4})(?<m>\d{2})(?<d>\d{2})\D{0,3}(?<H>\d{2})(?<M>\d{2})(?<S>\d{2})/,
  },
];

/**
 * Read a start time / camera / sequence out of a filename.
 *
 * Timestamps are interpreted in the BROWSER's local timezone, which for a UK instructor
 * uploading UK footage matches the camera's own local clock. The server interprets them
 * in a configured zone and reconciles any whole-hour discrepancy against the GPS, so a
 * mismatch here shows up as a warning rather than silently shifting the timeline.
 */
export function parseClipName(filename: string): ClipNameInfo {
  for (const rule of RULES) {
    const m = rule.re.exec(filename);
    if (!m?.groups) continue;
    const g = m.groups;
    if (!g.Y || !g.m || !g.d || !g.H || !g.M || !g.S) continue;

    let year = Number(g.Y);
    if (year < 100) year += rule.century ?? 2000;
    const month = Number(g.m);
    const day = Number(g.d);
    const hour = Number(g.H);
    const min = Number(g.M);
    const sec = Number(g.S);

    // An impossible date means we matched a serial number, not a timestamp.
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || min > 59 || sec > 59) {
      continue;
    }
    const dt = new Date(year, month - 1, day, hour, min, sec);
    if (Number.isNaN(dt.getTime())) continue;

    const rawView = (g.view ?? '').toUpperCase();
    return {
      brand: rule.brand,
      startEpochMs: dt.getTime(),
      view: (rule.viewMap?.[rawView] as 'front' | 'rear' | undefined) ?? null,
      seq: g.seq ? Number(g.seq) : null,
    };
  }
  return { brand: null, startEpochMs: null, view: null, seq: null };
}

export interface AnalysedClip {
  file: File;
  name: string;
  brand: string | null;
  /** Where the start time came from: 'filename' is trustworthy, 'mtime' is not. */
  startSource: 'filename' | 'mtime';
  startEpochMs: number;
  durationMs: number;
  seq: number | null;
}

/**
 * Read a video's duration in the browser.
 *
 * Needed because the gap between two clips is `nextStart - (thisStart + thisDuration)`,
 * and without real durations the review screen can't show gaps at all — which is the
 * one number that tells an instructor whether their footage is continuous.
 */
export function probeDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';

    const done = (ms: number) => {
      URL.revokeObjectURL(url);
      resolve(ms);
    };
    video.onloadedmetadata = () =>
      done(Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0);
    // A codec the browser can't decode (some dashcams write exotic profiles) still
    // uploads fine — the worker probes it properly with ffprobe. Resolve 0 and let the
    // review screen say the duration is unknown rather than blocking the upload.
    video.onerror = () => done(0);
    video.src = url;
  });
}

export async function analyseClips(files: File[]): Promise<AnalysedClip[]> {
  const durations = await Promise.all(files.map(probeDuration));

  return files.map((file, i) => {
    const parsed = parseClipName(file.name);
    return {
      file,
      name: file.name,
      brand: parsed.brand,
      startSource: parsed.startEpochMs != null ? 'filename' : 'mtime',
      // `lastModified` is the fallback and is genuinely weak — copying a file to a
      // laptop or a USB stick rewrites it on many systems, which can reorder a drive.
      // It's used so a Garmin-style name still gets *an* order, and flagged in the UI.
      startEpochMs: parsed.startEpochMs ?? file.lastModified,
      durationMs: durations[i],
      seq: parsed.seq,
    };
  });
}

export interface ClipGap {
  afterIndex: number;
  gapMs: number;
  large: boolean;
}

export interface TimelinePreview {
  clips: AnalysedClip[];
  gaps: ClipGap[];
  totalVideoMs: number;
  totalWallMs: number;
  droppedMs: number;
  overlaps: number;
  /** True when every clip's time came from its filename (the trustworthy source). */
  confident: boolean;
  anyUnknownDuration: boolean;
}

const LARGE_GAP_MS = 10_000;

/**
 * Order clips and summarise the timeline the worker will build.
 *
 * Ordering is by detected start time, never by the order the files were selected: the
 * file-input order isn't guaranteed by the browser, and a user picking twelve clips will
 * sometimes get them shuffled.
 */
export function buildPreview(clips: AnalysedClip[]): TimelinePreview {
  const sorted = [...clips].sort(
    (a, b) => a.startEpochMs - b.startEpochMs || (a.seq ?? 0) - (b.seq ?? 0) || a.name.localeCompare(b.name),
  );

  const gaps: ClipGap[] = [];
  let droppedMs = 0;
  let overlaps = 0;
  let prevEnd: number | null = null;

  sorted.forEach((c, i) => {
    if (prevEnd != null) {
      const delta = c.startEpochMs - prevEnd;
      if (delta < 0) overlaps += 1;
      else if (delta > 0) {
        droppedMs += delta;
        gaps.push({ afterIndex: i - 1, gapMs: delta, large: delta > LARGE_GAP_MS });
      }
    }
    prevEnd = c.startEpochMs + c.durationMs;
  });

  const totalVideoMs = sorted.reduce((sum, c) => sum + c.durationMs, 0);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const totalWallMs =
    first && last ? last.startEpochMs + last.durationMs - first.startEpochMs : 0;

  return {
    clips: sorted,
    gaps,
    totalVideoMs,
    totalWallMs,
    droppedMs,
    overlaps,
    confident: sorted.length > 0 && sorted.every((c) => c.startSource === 'filename'),
    anyUnknownDuration: sorted.some((c) => c.durationMs === 0),
  };
}

/** Move a clip within the ordered list (drag-to-reorder / arrow buttons). */
export function moveClip<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function fmtDuration(ms: number): string {
  if (!ms) return '—';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

export function fmtClock(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
