import { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { PlaybackManifest, RouteMarker } from '../api/types';

/**
 * Web master timeline (architecture §9). One `positionMs` drives both <video>
 * elements; the front stream paces and the rear is kept in lock-step, each shifted
 * by its `syncOffsetMs`. Scrubbing seeks both. View mode only changes rendering.
 *
 * Attach `attachFront` / `attachRear` as <video> ref callbacks. HLS is wired via
 * hls.js (Chrome/Firefox/Android) or native HLS (Safari/iOS).
 */
export function useMasterTimeline(manifest: PlaybackManifest | null) {
  const frontRef = useRef<HTMLVideoElement | null>(null);
  const rearRef = useRef<HTMLVideoElement | null>(null);
  const frontHls = useRef<Hls | null>(null);
  const rearHls = useRef<Hls | null>(null);

  const [positionMs, setPositionMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);

  const durationMs = (manifest?.durationS ?? 0) * 1000;
  const frontOffset = manifest?.streams.find((s) => s.view === 'front')?.syncOffsetMs ?? 0;
  const rearOffset = manifest?.streams.find((s) => s.view === 'rear')?.syncOffsetMs ?? 0;
  const RESYNC_MS = 250;

  const wire = useCallback((video: HTMLVideoElement, url: string, ref: typeof frontHls) => {
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url; // native HLS (Safari/iOS)
    } else if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hls.loadSource(url);
      hls.attachMedia(video);
      ref.current = hls;
    } else {
      video.src = url; // last resort
    }
  }, []);

  const attachFront = useCallback(
    (el: HTMLVideoElement | null) => {
      frontRef.current = el;
      const url = manifest?.streams.find((s) => s.view === 'front')?.url;
      if (el && url && !frontHls.current && el.src === '') wire(el, url, frontHls);
    },
    [manifest, wire],
  );

  const attachRear = useCallback(
    (el: HTMLVideoElement | null) => {
      rearRef.current = el;
      const url = manifest?.streams.find((s) => s.view === 'rear')?.url;
      if (el && url && !rearHls.current && el.src === '') wire(el, url, rearHls);
    },
    [manifest, wire],
  );

  // front drives the master clock; keep rear aligned
  useEffect(() => {
    const front = frontRef.current;
    if (!front) return;
    const onTime = () => {
      const master = Math.round(front.currentTime * 1000) + frontOffset;
      setPositionMs(Math.max(0, Math.min(master, durationMs)));
      const rear = rearRef.current;
      if (rear && playing) {
        const target = (master - rearOffset) / 1000;
        if (Math.abs(rear.currentTime - target) * 1000 > RESYNC_MS) {
          rear.currentTime = Math.max(0, target);
        }
      }
    };
    front.addEventListener('timeupdate', onTime);
    return () => front.removeEventListener('timeupdate', onTime);
  }, [playing, frontOffset, rearOffset, durationMs]);

  const play = useCallback(async () => {
    setPlaying(true);
    await Promise.all([frontRef.current?.play(), rearRef.current?.play()].map((p) => p?.catch(() => {})));
  }, []);

  const pause = useCallback(() => {
    setPlaying(false);
    frontRef.current?.pause();
    rearRef.current?.pause();
  }, []);

  const togglePlay = useCallback(() => (playing ? pause() : play()), [playing, pause, play]);

  const seekTo = useCallback(
    (ms: number) => {
      const m = Math.max(0, Math.min(ms, durationMs));
      setPositionMs(m);
      if (frontRef.current) frontRef.current.currentTime = Math.max(0, (m - frontOffset) / 1000);
      if (rearRef.current) rearRef.current.currentTime = Math.max(0, (m - rearOffset) / 1000);
    },
    [durationMs, frontOffset, rearOffset],
  );

  const changeRate = useCallback((r: number) => {
    setRate(r);
    if (frontRef.current) frontRef.current.playbackRate = r;
    if (rearRef.current) rearRef.current.playbackRate = r;
  }, []);

  // cleanup hls instances
  useEffect(() => {
    return () => {
      frontHls.current?.destroy();
      rearHls.current?.destroy();
    };
  }, []);

  const markerAt = useCallback(
    (ms: number): RouteMarker | null => {
      let cur: RouteMarker | null = null;
      for (const m of manifest?.markers ?? []) if (m.t_ms <= ms) cur = m;
      return cur;
    },
    [manifest],
  );

  return {
    attachFront,
    attachRear,
    positionMs,
    durationMs,
    playing,
    rate,
    togglePlay,
    seekTo,
    changeRate,
    markerAt,
  };
}
