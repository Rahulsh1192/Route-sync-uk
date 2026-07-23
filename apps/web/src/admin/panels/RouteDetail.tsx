import { useEffect, useState } from 'react';
import { api, RouteDetail as RD } from '../api';

function stateClass(state: string): string {
  if (state === 'done') return 'good';
  if (state === 'flagged' || state === 'failed') return 'warn';
  return '';
}

export function RouteDetail({
  routeId,
  onClose,
  onModerated,
}: {
  routeId: string;
  onClose: () => void;
  onModerated: () => void;
}) {
  const [data, setData] = useState<RD | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.routeDetail(routeId).then(setData).catch((e) => setError((e as Error).message));
  }, [routeId]);

  async function moderate(decision: 'approve' | 'reject') {
    const reason = decision === 'reject' ? window.prompt('Reason for rejection:') ?? undefined : undefined;
    setBusy(true);
    try {
      await api.moderate(routeId, decision, reason);
      onModerated();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div
      className="drawer-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Route detail"
    >
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        {error && (
          <div className="error" role="alert">
            <span aria-hidden="true">⚠</span>
            {error}
          </div>
        )}

        {!data && !error && (
          <div className="empty">
            <span className="empty-icon">⏳</span>
            Loading route details…
          </div>
        )}

        {data && (
          <>
            <div className="drawer-header">
              <div>
                <h2>{data.route.title}</h2>
                <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                  <span className="pill">{data.route.status}</span>
                </div>
              </div>
              <button
                className="btn-ghost btn-sm"
                onClick={onClose}
                aria-label="Close drawer"
                style={{ flexShrink: 0 }}
              >
                ✕
              </button>
            </div>

            {data.thumbnailUrl && (
              <section>
                <img src={data.thumbnailUrl} alt={`Thumbnail for ${data.route.title}`} />
              </section>
            )}

            {data.quality && (
              <section>
                <h3>Quality Metrics</h3>
                <div className="grid-stats" style={{ marginBottom: 0 }}>
                  <div className="stat-card">
                    <div className="num">{data.quality.overall}</div>
                    <div className="label">Overall</div>
                  </div>
                  <div className="stat-card">
                    <div className="num">{data.quality.gps_quality}</div>
                    <div className="label">GPS</div>
                  </div>
                  <div className="stat-card">
                    <div className="num">{data.quality.sync_confidence}</div>
                    <div className="label">Sync</div>
                  </div>
                </div>
              </section>
            )}

            <section>
              <h3>Pipeline Stages</h3>
              {data.stages.length === 0 && (
                <p className="meta">No stage data available.</p>
              )}
              {data.stages.map((s) => (
                <div className="stage-row" key={s.stage}>
                  <span className="stage-name">{s.stage}</span>
                  <span className={`pill ${stateClass(s.state)}`}>{s.state}</span>
                </div>
              ))}
            </section>

            <section>
              <h3>Video Renditions</h3>
              {data.videos.length === 0 && (
                <p className="meta">No renditions available.</p>
              )}
              {data.videos.map((v, i) => (
                <div className="kv" key={i}>
                  <span className="k">{v.view} / {v.rendition}</span>
                  <span style={{ color: 'var(--color-text-2)' }}>
                    {v.width}×{v.height} · {Number(v.duration_s).toFixed(0)}s
                  </span>
                </div>
              ))}
            </section>

            <div className="actions" style={{ paddingTop: 'var(--space-2)' }}>
              <button
                className="btn-approve"
                disabled={busy}
                onClick={() => moderate('approve')}
              >
                Approve & publish
              </button>
              <button
                className="btn-reject"
                disabled={busy}
                onClick={() => moderate('reject')}
              >
                Reject
              </button>
              <button className="btn-ghost" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
