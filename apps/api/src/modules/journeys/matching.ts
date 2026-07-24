/**
 * GPS ↔ R1 conformance engine (pure, no framework deps — unit-testable).
 *
 * Given the examiner's reference route R1 (a polyline) and an instructor's
 * recorded GPS track, it map-matches every fix onto R1 (monotonic arc-length,
 * so loops and parallel roads don't snap backwards), flags deviations
 * (cross-track distance sustained beyond a threshold), splices out the off-route
 * spans, computes R1 coverage, and produces the player timeline (video-time →
 * arc-length → the lat/lng ON R1). We publish R1's geometry; the recorded drive
 * is only the bridge that tells us where along R1 each moment of video sits.
 */

export interface LatLng {
  lat: number;
  lng: number;
}
export interface GpsFix extends LatLng {
  tMs: number; // ms from journey start (app clock)
  accuracyM?: number;
  speedMps?: number;
}

export interface MatchOptions {
  deviationM: number; // cross-track distance that counts as off-route
  sustainM: number; // off-route travel before it's a *real* deviation (not GPS noise)
  gapM: number; // an uncovered R1 stretch this long counts as a coverage gap
  reentryToleranceM: number; // re-entry arc must be within this of the exit arc
  minCoveragePct: number; // R1 coverage required to auto-pass
  searchWindowM: number; // how far ahead of the last match to look (default 200)
  backToleranceM: number; // small backward jitter allowed (default 25)
}

export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  deviationM: 30,
  sustainM: 50,
  gapM: 75,
  reentryToleranceM: 35,
  minCoveragePct: 98,
  searchWindowM: 200,
  backToleranceM: 25,
};

export interface MatchedFix extends GpsFix {
  arcM: number; // arc-length along R1 of the nearest point
  crossTrackM: number; // perpendicular distance to R1
  onRoute: boolean;
}
export interface KeptSegment {
  startTMs: number;
  endTMs: number;
  startArcM: number;
  endArcM: number;
}
export interface Deviation {
  startTMs: number;
  endTMs: number;
  maxCrossTrackM: number;
  travelledM: number;
  reentrySeamless: boolean; // true = rejoined R1 at the same point (clean splice)
}
export interface CoverageGap {
  fromArcM: number;
  toArcM: number;
}
export interface TimelineSample {
  tMs: number;
  arcM: number;
  lat: number; // snapped ONTO R1
  lng: number;
}
export interface JourneyAnalysis {
  fixes: MatchedFix[];
  keptSegments: KeptSegment[];
  deviations: Deviation[];
  gaps: CoverageGap[];
  timeline: TimelineSample[];
  totalLengthM: number;
  coveredM: number;
  coveragePct: number;
  maxDeviationM: number;
  deviationCount: number;
  syncConfidence: number;
  verdict: 'verified' | 'rejected';
  rejectReason: string | null;
}

const EARTH_R = 6_371_008.8; // mean Earth radius (m)
const D2R = Math.PI / 180;

/** Great-circle distance in metres. */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * D2R;
  const dLng = (b.lng - a.lng) * D2R;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

interface Seg {
  startArc: number;
  len: number;
  a: LatLng;
  b: LatLng;
}

/**
 * Reference route R1: an arc-length-parameterised polyline with a local planar
 * projection for fast, accurate point-to-segment maths at city scale.
 */
export class ReferenceGeometry {
  readonly segments: Seg[] = [];
  readonly totalLength: number;
  private readonly lat0: number;
  private readonly mPerLat: number;
  private readonly mPerLng: number;

  constructor(private readonly points: LatLng[]) {
    if (points.length < 2) throw new Error('Reference route needs at least 2 points');
    this.lat0 = points[0].lat;
    // metres-per-degree at this latitude (equirectangular — exact enough < 100 km)
    this.mPerLat = 111_132.92 - 559.82 * Math.cos(2 * this.lat0 * D2R);
    this.mPerLng = 111_412.84 * Math.cos(this.lat0 * D2R);
    let arc = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const len = haversineM(a, b);
      if (len === 0) continue; // skip duplicate points
      this.segments.push({ startArc: arc, len, a, b });
      arc += len;
    }
    this.totalLength = arc;
    if (this.segments.length === 0) throw new Error('Reference route has zero length');
  }

  private xy(p: LatLng): [number, number] {
    return [(p.lng - this.points[0].lng) * this.mPerLng, (p.lat - this.lat0) * this.mPerLat];
  }

  /** LatLng at a given arc-length along R1 (clamped to the route). */
  pointAtArc(arc: number): LatLng {
    const a = Math.max(0, Math.min(arc, this.totalLength));
    // binary search for the segment containing `a`
    let lo = 0;
    let hi = this.segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.segments[mid].startArc <= a) lo = mid;
      else hi = mid - 1;
    }
    const s = this.segments[lo];
    const t = s.len === 0 ? 0 : (a - s.startArc) / s.len;
    return { lat: s.a.lat + (s.b.lat - s.a.lat) * t, lng: s.a.lng + (s.b.lng - s.a.lng) * t };
  }

  private segIndexAtArc(arc: number): number {
    let lo = 0;
    let hi = this.segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.segments[mid].startArc <= arc) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /**
   * Nearest point on R1 to `fix`, searching forward from `minArc` within a
   * window (monotonic — so an out-and-back or crossing road can't snap the match
   * backwards). Returns arc-length + perpendicular (cross-track) distance.
   */
  match(fix: LatLng, minArc: number, windowM: number, backToleranceM: number) {
    const [px, py] = this.xy(fix);
    const from = Math.max(0, minArc - backToleranceM);
    const to = Math.min(this.totalLength, minArc + windowM);
    let best = { arcM: minArc, crossTrackM: Infinity };
    for (let i = this.segIndexAtArc(from); i < this.segments.length; i++) {
      const s = this.segments[i];
      if (s.startArc > to) break;
      const [ax, ay] = this.xy(s.a);
      const [bx, by] = this.xy(s.b);
      const dx = bx - ax;
      const dy = by - ay;
      const l2 = dx * dx + dy * dy;
      let t = l2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / l2;
      t = Math.max(0, Math.min(1, t));
      const cx = ax + t * dx;
      const cy = ay + t * dy;
      const dist = Math.hypot(px - cx, py - cy);
      if (dist < best.crossTrackM) {
        best = { arcM: s.startArc + t * s.len, crossTrackM: dist };
      }
    }
    return best;
  }
}

/** Merge sorted [from,to] arc intervals; returns covered length + gaps. */
function coverageFromIntervals(
  intervals: Array<[number, number]>,
  total: number,
  gapM: number,
): { coveredM: number; gaps: CoverageGap[] } {
  if (intervals.length === 0) return { coveredM: 0, gaps: [{ fromArcM: 0, toArcM: total }] };
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [sorted[0].slice() as [number, number]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i][0] <= last[1] + gapM) {
      last[1] = Math.max(last[1], sorted[i][1]);
    } else {
      merged.push(sorted[i].slice() as [number, number]);
    }
  }
  let coveredM = 0;
  for (const [a, b] of merged) coveredM += b - a;
  const gaps: CoverageGap[] = [];
  // internal gaps between covered runs
  for (let i = 0; i < merged.length - 1; i++) {
    const g = merged[i + 1][0] - merged[i][1];
    if (g > gapM) gaps.push({ fromArcM: merged[i][1], toArcM: merged[i + 1][0] });
  }
  return { coveredM, gaps };
}

/**
 * Full conformance analysis of a recorded GPS track against R1.
 * Pure and deterministic — the same track always yields the same verdict.
 */
export function analyzeJourney(
  referencePoints: LatLng[],
  rawFixes: GpsFix[],
  options: Partial<MatchOptions> = {},
): JourneyAnalysis {
  const opt = { ...DEFAULT_MATCH_OPTIONS, ...options };
  const ref = new ReferenceGeometry(referencePoints);
  const total = ref.totalLength;
  const MAX_SPEED_MPS = 45; // generous ceiling (~160 km/h)
  const MAX_WINDOW_M = 3000;
  const TELEPORT_SLACK_M = 40; // arc jump beyond max-speed*dt + this = a teleport/skip

  // Ignore obviously bad fixes (cold-start / poor accuracy) but keep order.
  const fixes = rawFixes
    .filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lng))
    .sort((a, b) => a.tMs - b.tMs);

  // 1) match every fix forward-only. The forward window grows with the time gap
  //    since the last fix (a GPS dropout in a tunnel can legitimately resume far
  //    ahead on R1) but stays tight for dense fixes so loops don't snap forward.
  const matched: MatchedFix[] = [];
  let anchor = 0;
  let prevTMs: number | null = null;
  for (const f of fixes) {
    const dtS = prevTMs == null ? 0 : Math.max(0, (f.tMs - prevTMs) / 1000);
    const window = Math.min(MAX_WINDOW_M, opt.searchWindowM + dtS * MAX_SPEED_MPS);
    const m = ref.match(f, anchor, window, opt.backToleranceM);
    const onRoute = m.crossTrackM <= opt.deviationM;
    if (onRoute && m.arcM > anchor) anchor = m.arcM; // advance only on-route
    matched.push({ ...f, arcM: m.arcM, crossTrackM: m.crossTrackM, onRoute });
    prevTMs = f.tMs;
  }

  // 2) reclassify short off-route blips (< sustainM travelled) as GPS noise, so
  //    a compliant drive isn't shredded by momentary jitter.
  const flags = matched.map((m) => m.onRoute);
  let i = 0;
  while (i < matched.length) {
    if (flags[i]) {
      i++;
      continue;
    }
    let j = i;
    let travelled = 0;
    while (j < matched.length && !flags[j]) {
      if (j > i) travelled += haversineM(matched[j - 1], matched[j]);
      j++;
    }
    if (travelled < opt.sustainM) for (let k = i; k < j; k++) flags[k] = true; // noise → on-route
    i = j;
  }

  // 3) kept on-route segments (contiguous runs) + real deviations (the gaps)
  const keptSegments: KeptSegment[] = [];
  const deviations: Deviation[] = [];
  i = 0;
  const pushSeg = (from: number, to: number) => {
    const arcs = matched.slice(from, to + 1).map((m) => m.arcM);
    keptSegments.push({
      startTMs: matched[from].tMs,
      endTMs: matched[to].tMs,
      startArcM: Math.min(...arcs),
      endArcM: Math.max(...arcs),
    });
  };
  while (i < matched.length) {
    if (flags[i]) {
      // Walk the on-route run, splitting it wherever the arc jumps faster than
      // physically possible: no intervening off-route fixes, but an impossible
      // leap forward = a skipped section (teleport) → forces a coverage gap. A
      // real GPS dropout (tunnel) resumes at a plausible speed → no split.
      let segStart = i;
      let j = i;
      while (j < matched.length && flags[j]) {
        if (j > i) {
          const dtS = Math.max(0.001, (matched[j].tMs - matched[j - 1].tMs) / 1000);
          const arcJump = matched[j].arcM - matched[j - 1].arcM;
          if (arcJump > MAX_SPEED_MPS * dtS + TELEPORT_SLACK_M) {
            pushSeg(segStart, j - 1);
            segStart = j;
          }
        }
        j++;
      }
      pushSeg(segStart, j - 1);
      i = j;
    } else {
      let j = i;
      let maxCt = 0;
      let travelled = 0;
      while (j < matched.length && !flags[j]) {
        maxCt = Math.max(maxCt, matched[j].crossTrackM);
        if (j > i) travelled += haversineM(matched[j - 1], matched[j]);
        j++;
      }
      const prevArc = i > 0 ? matched[i - 1].arcM : 0;
      const nextArc = j < matched.length ? matched[j].arcM : prevArc;
      deviations.push({
        startTMs: matched[i].tMs,
        endTMs: matched[j - 1].tMs,
        maxCrossTrackM: maxCt,
        travelledM: travelled,
        reentrySeamless: Math.abs(nextArc - prevArc) <= opt.reentryToleranceM,
      });
      i = j;
    }
  }

  // 4) coverage + gaps from kept arc intervals
  const intervals = keptSegments.map((s) => [s.startArcM, s.endArcM] as [number, number]);
  const { coveredM, gaps } = coverageFromIntervals(intervals, total, opt.gapM);
  const coveragePct = total > 0 ? (coveredM / total) * 100 : 0;

  // 5) player timeline: on-route fixes, snapped ONTO R1 (the clean line)
  const timeline: TimelineSample[] = matched
    .filter((_, idx) => flags[idx])
    .map((m) => {
      const p = ref.pointAtArc(m.arcM);
      return { tMs: m.tMs, arcM: m.arcM, lat: p.lat, lng: p.lng };
    });

  // 6) verdict + a simple, explainable confidence score
  const maxDeviationM = matched.reduce((mx, m) => Math.max(mx, m.crossTrackM), 0);
  const deviationCount = deviations.filter((d) => d.travelledM >= opt.sustainM).length;
  let rejectReason: string | null = null;
  if (coveragePct < opt.minCoveragePct) {
    rejectReason = `Only ${coveragePct.toFixed(1)}% of R1 was covered (need ${opt.minCoveragePct}%).`;
  } else if (gaps.length > 0) {
    const g = gaps[0];
    rejectReason = `Missing footage on R1 from ${Math.round(g.fromArcM)} m to ${Math.round(g.toArcM)} m.`;
  }
  const verdict = rejectReason ? 'rejected' : 'verified';

  let syncConfidence = 100;
  syncConfidence -= Math.min(40, Math.max(0, (opt.minCoveragePct - coveragePct)) * 4);
  syncConfidence -= gaps.length * 15;
  if (maxDeviationM > opt.deviationM * 3) syncConfidence -= 15;
  syncConfidence = Math.max(0, Math.min(100, Math.round(syncConfidence)));

  return {
    fixes: matched.map((m, idx) => ({ ...m, onRoute: flags[idx] })),
    keptSegments,
    deviations,
    gaps,
    timeline,
    totalLengthM: total,
    coveredM,
    coveragePct,
    maxDeviationM,
    deviationCount,
    syncConfidence,
    verdict,
    rejectReason,
  };
}
