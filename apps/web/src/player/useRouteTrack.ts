import { useCallback, useMemo, useRef } from 'react';
import { TrackPoint } from '../api/types';

export interface TrackPosition {
  lat: number;
  lng: number;
  bearingDeg: number | null;
  speedMph: number | null;
  /** Index of the last track point at or before the requested time. */
  index: number;
  /** 0..1 progress along the route by time. */
  progress: number;
}

/**
 * Turns the route's GPS track into a position for any moment of playback (Phase 24).
 *
 * Two problems this solves, both of which look like bugs if you skip them:
 *
 * 1. **Cadence mismatch.** GPS is logged at ~1 Hz; video plays at 25–30 fps. Using the
 *    nearest point makes the marker teleport once a second — it reads as a broken map
 *    rather than a moving car. So positions are linearly interpolated between the two
 *    surrounding fixes. Over one second of driving the road is near enough straight for
 *    a straight-line interpolation to be visually exact.
 *
 * 2. **Lookup cost.** `positionMs` changes many times a second, and a route can hold
 *    thousands of points, so a linear scan per update is wasteful. Lookup is a binary
 *    search, and because playback almost always moves forward, the previous index is
 *    checked first — that makes the common case O(1) and leaves the binary search for
 *    scrubbing.
 *
 * Returns a stable `positionAt(ms)` function rather than a value, so a component can
 * decide its own update rate (e.g. throttle the map to 10 Hz) instead of being forced
 * to re-render on every `timeupdate`.
 */
export function useRouteTrack(track: TrackPoint[] | undefined) {
  const points = useMemo(() => {
    if (!track?.length) return [] as TrackPoint[];
    // Defensive: the API orders by t_ms, but a client that merges sources shouldn't be
    // able to break interpolation by handing us an unsorted array.
    return [...track].sort((a, b) => a.tMs - b.tMs);
  }, [track]);

  const lastIndexRef = useRef(0);

  const positionAt = useCallback(
    (ms: number): TrackPosition | null => {
      if (points.length === 0) return null;
      if (points.length === 1) {
        const only = points[0];
        return {
          lat: only.lat,
          lng: only.lng,
          bearingDeg: only.bearingDeg ?? null,
          speedMph: toMph(only.speedMps),
          index: 0,
          progress: 0,
        };
      }

      const first = points[0];
      const last = points[points.length - 1];

      // Before the first fix / after the last: clamp. The video may start slightly
      // before GPS lock or run past the final fix, and holding at the end of the track
      // is honest — extrapolating would invent positions the car never occupied.
      if (ms <= first.tMs) return build(points, 0, 0, 0);
      if (ms >= last.tMs) return build(points, points.length - 1, 0, 1);

      const i = findIndex(points, ms, lastIndexRef.current);
      lastIndexRef.current = i;

      const a = points[i];
      const b = points[i + 1] ?? a;
      const span = b.tMs - a.tMs;
      const frac = span > 0 ? (ms - a.tMs) / span : 0;
      const progress = (ms - first.tMs) / Math.max(1, last.tMs - first.tMs);

      return build(points, i, frac, progress);
    },
    [points],
  );

  return { points, positionAt, hasTrack: points.length > 1 };
}

/** Interpolate between `i` and `i + 1` by `frac`. */
function build(points: TrackPoint[], i: number, frac: number, progress: number): TrackPosition {
  const a = points[i];
  const b = points[i + 1] ?? a;

  return {
    lat: a.lat + (b.lat - a.lat) * frac,
    lng: a.lng + (b.lng - a.lng) * frac,
    // Bearing is NOT interpolated numerically: it wraps at 360°, so blending 350° and
    // 10° would swing the marker the long way round through south. The worker already
    // smoothed it, so holding the current segment's value is both correct and stable.
    bearingDeg: a.bearingDeg ?? b.bearingDeg ?? null,
    speedMph: toMph(a.speedMps ?? b.speedMps),
    index: i,
    progress: Math.max(0, Math.min(1, progress)),
  };
}

/**
 * Index of the last point at or before `ms`.
 *
 * Tries the cached index first (playback moves forward, so the answer is usually the
 * same segment or the next one), then falls back to a binary search for seeks.
 */
function findIndex(points: TrackPoint[], ms: number, hint: number): number {
  if (hint >= 0 && hint < points.length - 1) {
    if (points[hint].tMs <= ms && ms < points[hint + 1].tMs) return hint;
    const next = hint + 1;
    if (next < points.length - 1 && points[next].tMs <= ms && ms < points[next + 1].tMs) {
      return next;
    }
  }

  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].tMs <= ms) lo = mid;
    else hi = mid;
  }
  return lo;
}

function toMph(speedMps: number | null | undefined): number | null {
  if (speedMps == null) return null;
  return Math.round(speedMps * 2.23694);
}
