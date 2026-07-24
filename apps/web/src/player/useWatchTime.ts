import { useEffect, useRef } from 'react';
import { api } from '../api/client';

/**
 * Tracks how long a route is actively watched/practised and reports it to the
 * server (Phase 21 rev-share data). Only counts wall-clock seconds while
 * `active` is true, flushes a heartbeat every 30s, and sends a final beacon when
 * the tab is hidden or the player unmounts. Best-effort — failures are ignored.
 */
export function useWatchTime(
  routeId: string | undefined,
  source: 'playback' | 'practice',
  active: boolean,
) {
  const activeRef = useRef(active);
  activeRef.current = active;
  const pendingRef = useRef(0); // unflushed active seconds

  useEffect(() => {
    if (!routeId) return;

    const flush = () => {
      const secs = Math.round(pendingRef.current);
      if (secs <= 0) return;
      pendingRef.current = 0;
      api.recordWatch(routeId, secs, source);
    };

    const tick = window.setInterval(() => {
      if (activeRef.current) pendingRef.current += 1;
    }, 1000);
    const heartbeat = window.setInterval(flush, 30_000);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.clearInterval(tick);
      window.clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', onVisibility);
      flush(); // final send on unmount
    };
  }, [routeId, source]);
}
