import { useEffect, useRef, useState } from 'react';

/**
 * A smooth playback clock for driving the map marker (Phase 24).
 *
 * The master timeline updates `positionMs` from the video's `timeupdate` event, which
 * browsers fire only about four times a second. That's fine for a digital readout and
 * completely inadequate for a moving marker — at 4 Hz the marker visibly hops along
 * the road instead of driving down it.
 *
 * So between `timeupdate` events this dead-reckons: it advances a local clock by the
 * real elapsed time (scaled by playback rate) and resnaps to the authoritative value
 * whenever a real one arrives. The video always wins; this only fills the gaps.
 *
 * Updates are capped at `fps` (default 20) rather than running at full animation-frame
 * rate: 20 Hz is past the point where the eye reads motion as continuous, and every
 * update re-renders the consuming component, so going faster costs battery for nothing.
 */
export function useSmoothClock(
  positionMs: number,
  playing: boolean,
  rate = 1,
  durationMs = 0,
  fps = 20,
): number {
  const [smoothMs, setSmoothMs] = useState(positionMs);

  // Kept in refs so the animation loop reads current values without being restarted —
  // re-creating the loop on every position change would defeat the whole purpose.
  const anchorRef = useRef({ positionMs, at: performance.now() });
  const rateRef = useRef(rate);
  const durationRef = useRef(durationMs);
  const smoothRef = useRef(positionMs);

  rateRef.current = rate;
  durationRef.current = durationMs;

  // Resnap to the video's own clock whenever it reports in.
  useEffect(() => {
    anchorRef.current = { positionMs, at: performance.now() };
    // A seek (or a pause) must land immediately rather than being eased into, otherwise
    // scrubbing feels laggy and the marker trails the frame on screen.
    if (!playing || Math.abs(positionMs - smoothRef.current) > 1000) {
      smoothRef.current = positionMs;
      setSmoothMs(positionMs);
    }
  }, [positionMs, playing]);

  useEffect(() => {
    if (!playing) return;

    let frame = 0;
    let lastEmit = 0;
    const minGap = 1000 / fps;

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - lastEmit < minGap) return;
      lastEmit = now;

      const { positionMs: anchor, at } = anchorRef.current;
      const projected = anchor + (now - at) * rateRef.current;
      const max = durationRef.current > 0 ? durationRef.current : Number.POSITIVE_INFINITY;
      const next = Math.max(0, Math.min(projected, max));

      smoothRef.current = next;
      setSmoothMs(next);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, fps]);

  return playing ? smoothMs : positionMs;
}
