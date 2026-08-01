import { useCallback, useEffect, useState } from 'react';
import { api, ReviewRoute } from '../api';
import { RouteDetail } from './RouteDetail';
import { formatInstantDate } from '../../lib/datetime';

function qualityClass(score: number | null): string {
  if (score == null) return '';
  if (score >= 70) return 'good';
  if (score >= 50) return 'warn';
  return 'bad';
}

export function ReviewQueue() {
  const [routes, setRoutes] = useState<ReviewRoute[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRoutes(await api.reviewQueue());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="empty">
        <span className="empty-icon">⏳</span>
        Loading review queue…
      </div>
    );
  }

  if (error) {
    return (
      <div className="error" role="alert">
        <span aria-hidden="true">⚠</span>
        {error}
      </div>
    );
  }

  if (routes.length === 0) {
    return (
      <div className="empty">
        <span className="empty-icon">🎉</span>
        Nothing awaiting review. All clear!
      </div>
    );
  }

  return (
    <>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Quality</th>
              <th scope="col">Sync</th>
              <th scope="col">Flags</th>
              <th scope="col">Submitted</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {routes.map((r) => {
              const sync = r.syncConfidence != null ? Math.round(Number(r.syncConfidence) * 100) : null;
              return (
                <tr key={r.id}>
                  <td style={{ fontWeight: 'var(--weight-medium)' }}>{r.title}</td>
                  <td>
                    <span className={`pill ${qualityClass(r.qualityScore)}`}>
                      {r.qualityScore ?? '—'}
                    </span>
                  </td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {sync != null ? `${sync}%` : '—'}
                  </td>
                  <td>
                    {r.isInstructor && <span className="pill instructor">Instructor</span>}
                    {(r as any).status === 'map_only' && <span className="pill warn" style={{ marginLeft: 4 }}>Map only</span>}
                  </td>
                  <td className="meta">{formatInstantDate(r.createdAt)}</td>
                  <td>
                    <button
                      className="btn-ghost btn-sm"
                      onClick={() => setSelected(r.id)}
                      aria-label={`Review ${r.title}`}
                    >
                      Review →
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected && (
        <RouteDetail routeId={selected} onClose={() => setSelected(null)} onModerated={load} />
      )}
    </>
  );
}
