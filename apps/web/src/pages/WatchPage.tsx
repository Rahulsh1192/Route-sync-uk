import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { PlaybackManifest, RouteDetail } from '../api/types';
import { useMasterTimeline } from '../player/useMasterTimeline';
import { useRouteTrack } from '../player/useRouteTrack';
import { useSmoothClock } from '../player/useSmoothClock';
import { useWatchTime } from '../player/useWatchTime';
import { InstructorByline } from '../components/InstructorByline';
import { RouteMap } from '../map/RouteMap';

/**
 * `all` shows front + rear + map together in one container — the layout the recording
 * workflow is designed around, since the whole point of syncing three sources is being
 * able to watch them at once. The single-source modes remain for a small screen or for
 * concentrating on one view.
 */
type ViewMode = 'all' | 'front' | 'rear' | 'split' | 'map';

const SKIP_MS = 10_000;

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function WatchPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [manifest, setManifest] = useState<PlaybackManifest | null>(null);
  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>('all');
  const [follow, setFollow] = useState(true);

  useEffect(() => {
    api.playback(id!).then(setManifest).catch((e) => {
      // Deep-linked here without access: route detail runs the per-centre paywall flow.
      if (e instanceof ApiError && e.status === 403) {
        nav(`/route/${id}`);
      } else setError((e as Error).message);
    });
    // Instructor info powers the "book a lesson" prompt (the instructor's payoff
    // for contributing routes is this marketing exposure → bookings).
    api.route(id!).then(setRoute).catch(() => {});
  }, [id, nav]);

  const t = useMasterTimeline(manifest);
  // Report watch-time to the rev-share engine while the video is playing.
  useWatchTime(id, 'playback', t.playing);

  const { points, positionAt, hasTrack } = useRouteTrack(manifest?.track);
  // `timeupdate` fires ~4×/s, which makes a marker hop rather than drive. This fills in
  // between those events so the marker moves continuously.
  const clockMs = useSmoothClock(t.positionMs, t.playing, t.rate, t.durationMs);
  const trackPos = useMemo(() => positionAt(clockMs), [positionAt, clockMs]);

  const hasRear = !!manifest?.streams.some((s) => s.view === 'rear');
  const showMap = hasTrack && (mode === 'all' || mode === 'map');

  if (error) return <div className="error">{error}</div>;
  if (!manifest) return <div className="center"><div className="spinner" /></div>;

  const marker = t.markerAt(t.positionMs);

  return (
    <>
      <button className="btn secondary auto" onClick={() => nav(-1)} style={{ marginBottom: 14 }}>
        ← Back
      </button>

      <div className="player-wrap">
        <div
          className={
            mode === 'all' ? 'player-stage player-all' :
            mode === 'split' ? 'player-stage player-split' : 'player-stage'
          }
        >
          {/* Both video elements stay mounted so the master clock stays wired to them;
              visibility is CSS only. Unmounting the hidden one would tear down its HLS
              instance and force a re-buffer every time the view changed. */}
          <video
            ref={t.attachFront}
            playsInline
            className="pane pane-front"
            style={{ display: mode === 'rear' || mode === 'map' ? 'none' : 'block' }}
          />
          <video
            ref={t.attachRear}
            playsInline
            muted
            className="pane pane-rear"
            style={{
              display:
                mode === 'rear' || mode === 'split' || (mode === 'all' && hasRear)
                  ? 'block'
                  : 'none',
            }}
          />
          {showMap && (
            <div className="pane pane-map">
              <RouteMap
                track={points}
                position={trackPos}
                follow={follow}
                travelledTo={trackPos?.index ?? null}
                height="100%"
              />
            </div>
          )}
        </div>

        <div className="hud">
          <span>{fmt(t.positionMs)}</span>
          {trackPos?.speedMph != null && (
            <span className="muted" title="Speed at this point of the recording">
              {trackPos.speedMph} mph
            </span>
          )}
          <div className="spacer" />
          {marker && (
            <span className="marker">
              {marker.kind === 'roundabout' ? '🔄' : '↱'} {marker.label ?? marker.kind}
            </span>
          )}
          <div className="spacer" />
          <span className="muted">{fmt(t.durationMs)}</span>
        </div>

        <input
          className="scrub"
          type="range"
          min={0}
          max={Math.max(1, t.durationMs)}
          value={Math.min(t.positionMs, t.durationMs)}
          onChange={(e) => t.seekTo(Number(e.target.value))}
          aria-label="Seek"
        />

        <div className="player-controls">
          <button
            className="btn ghost auto"
            onClick={() => t.seekTo(t.positionMs - SKIP_MS)}
            title="Back 10 seconds"
            aria-label="Back 10 seconds"
          >
            ⏪ 10s
          </button>
          <button className="btn auto" onClick={t.togglePlay}>
            {t.playing ? '⏸ Pause' : '▶ Play'}
          </button>
          <button
            className="btn ghost auto"
            onClick={() => t.seekTo(t.positionMs + SKIP_MS)}
            title="Forward 10 seconds"
            aria-label="Forward 10 seconds"
          >
            10s ⏩
          </button>
          <button
            className="btn ghost auto"
            onClick={() => t.changeRate(t.rate === 1 ? 0.5 : 1)}
            title="Slow motion"
          >
            {t.rate === 1 ? '0.5×' : '1×'}
          </button>
          <div className="spacer" />
          {hasTrack && (
            <label className="follow-toggle" title="Keep the map centred on the marker">
              <input
                type="checkbox"
                checked={follow}
                onChange={(e) => setFollow(e.target.checked)}
              />
              Follow
            </label>
          )}
        </div>
      </div>

      <div className="view-btns">
        {(['all', 'front', 'rear', 'split', 'map'] as ViewMode[]).map((m) => {
          // Don't offer views the route can't render — a "Map" button that opens an
          // empty grey box on a pre-Phase-24 route is worse than no button.
          if (m === 'map' && !hasTrack) return null;
          if (m === 'rear' && !hasRear) return null;
          if (m === 'all' && !hasTrack && !hasRear) return null;
          return (
            <button
              key={m}
              className={mode === m ? 'btn auto' : 'btn ghost auto'}
              onClick={() => setMode(m)}
            >
              {m === 'all' ? 'All' : m[0].toUpperCase() + m.slice(1)}
            </button>
          );
        })}
      </div>

      {!hasTrack && (
        <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          This route was processed before synced map playback, so it has no map track yet.
        </p>
      )}

      {route?.instructorName && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            RECORDED BY
          </div>
          <div className="row" style={{ alignItems: 'center' }}>
            <InstructorByline
              id={route.instructorId}
              name={route.instructorName}
              avatar={route.instructorAvatar}
              verified={route.instructorVerified}
            />
            <div className="spacer" />
            {route.instructorId && (
              <button
                className="btn auto"
                onClick={() => nav(`/instructors/${route.instructorId}`)}
              >
                📅 Book a lesson
              </button>
            )}
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 10, marginBottom: 0 }}>
            Preparing at this test centre? Book a lesson with the instructor who filmed
            this exact route.
          </p>
        </div>
      )}
    </>
  );
}
