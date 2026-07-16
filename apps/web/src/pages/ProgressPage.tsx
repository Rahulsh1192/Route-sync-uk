import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

interface Progress {
  total_routes_watched: number;
  total_practice_runs: number;
  total_watch_time_s: number;
  current_streak_days: number;
  longest_streak_days: number;
}

interface HistoryItem {
  route_id: string; title: string; town?: string; difficulty?: string;
  watch_count: number; practice_count: number; watch_pct_max: number;
  last_watched_at?: string; last_practised_at?: string;
}

function fmt(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

export function ProgressPage() {
  const nav = useNavigate();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.request<Progress>('/users/me/progress'),
      api.request<HistoryItem[]>('/users/me/history'),
    ])
      .then(([p, h]) => { setProgress(p); setHistory(h); })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (loading) return <div className="center"><div className="spinner" /></div>;

  return (
    <>
      <h1 className="page">My Progress</h1>

      {progress && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Routes watched', value: progress.total_routes_watched, icon: '👀' },
            { label: 'Practice runs', value: progress.total_practice_runs, icon: '🎧' },
            { label: 'Watch time', value: fmt(Number(progress.total_watch_time_s)), icon: '⏱' },
            { label: 'Current streak', value: `${progress.current_streak_days}d`, icon: '🔥' },
            { label: 'Best streak', value: `${progress.longest_streak_days}d`, icon: '🏆' },
          ].map((stat) => (
            <div key={stat.label} className="card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28 }}>{stat.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 22 }}>{stat.value}</div>
              <div className="muted" style={{ fontSize: 12 }}>{stat.label}</div>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Route History</h2>

      {history.length === 0 && (
        <div className="empty">
          <p>No routes watched yet. Start with <a href="/discover">Discover routes</a>.</p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {history.map((h) => (
          <div key={h.route_id} className="card" style={{ cursor: 'pointer' }} onClick={() => nav(`/route/${h.route_id}`)}>
            <div className="row">
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{h.title}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {h.town} · {h.difficulty} · {h.watch_count}× watched · {h.practice_count}× practised
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, color: Number(h.watch_pct_max) >= 90 ? 'var(--green)' : 'var(--accent)' }}>
                  {Math.round(Number(h.watch_pct_max))}% complete
                </div>
                {h.last_watched_at && (
                  <div className="muted" style={{ fontSize: 11 }}>
                    Last: {new Date(h.last_watched_at).toLocaleDateString('en-GB')}
                  </div>
                )}
              </div>
            </div>
            <div style={{ marginTop: 8, height: 4, background: 'var(--border)', borderRadius: 2 }}>
              <div style={{ width: `${Math.min(100, Number(h.watch_pct_max))}%`, height: '100%', background: 'var(--accent)', borderRadius: 2, transition: 'width 0.3s' }} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
