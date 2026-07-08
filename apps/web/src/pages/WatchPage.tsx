import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MapContainer, TileLayer } from 'react-leaflet';
import { api, ApiError } from '../api/client';
import { PlaybackManifest } from '../api/types';
import { useMasterTimeline } from '../player/useMasterTimeline';

type ViewMode = 'front' | 'rear' | 'split' | 'map';

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function WatchPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [manifest, setManifest] = useState<PlaybackManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>('front');

  useEffect(() => {
    api.playback(id!).then(setManifest).catch((e) => {
      if (e instanceof ApiError && e.status === 403) nav('/paywall');
      else setError((e as Error).message);
    });
  }, [id, nav]);

  const t = useMasterTimeline(manifest);

  if (error) return <div className="error">{error}</div>;
  if (!manifest) return <div className="center"><div className="spinner" /></div>;

  const marker = t.markerAt(t.positionMs);

  return (
    <>
      <button className="btn secondary auto" onClick={() => nav(-1)} style={{ marginBottom: 14 }}>
        ← Back
      </button>

      <div className="player-wrap">
        <div className={`player-stage ${mode === 'split' ? 'player-split' : ''}`}>
          {/* keep both video elements mounted so the clock stays wired; hide by CSS */}
          <video
            ref={t.attachFront}
            playsInline
            style={{ display: mode === 'front' || mode === 'split' ? 'block' : 'none' }}
          />
          <video
            ref={t.attachRear}
            playsInline
            muted
            style={{ display: mode === 'rear' || mode === 'split' ? 'block' : 'none' }}
          />
          {mode === 'map' && (
            <MapContainer center={[52.4862, -1.8904]} zoom={12} scrollWheelZoom={false}>
              <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
            </MapContainer>
          )}
        </div>

        <div className="hud">
          <span>{fmt(t.positionMs)}</span>
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
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 12px 12px' }}>
          <button className="btn auto" onClick={t.togglePlay}>
            {t.playing ? '⏸ Pause' : '▶ Play'}
          </button>
          <button
            className="btn ghost auto"
            onClick={() => t.changeRate(t.rate === 1 ? 0.5 : 1)}
            title="Slow motion"
          >
            {t.rate === 1 ? '0.5×' : '1×'}
          </button>
        </div>
      </div>

      <div className="seg" style={{ marginTop: 14 }}>
        {(['front', 'rear', 'split', 'map'] as ViewMode[]).map((m) => (
          <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>
            {m[0].toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>
    </>
  );
}
