import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { RouteSummary } from '../api/types';
import { RouteCard } from '../components/RouteCard';

export function DiscoverPage() {
  const [routes, setRoutes] = useState<RouteSummary[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<number>();

  // Global search: empty query lists everything; otherwise matches across route
  // title, instructor, test centre, town and postcode (server-side).
  useEffect(() => {
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => {
      setError(null);
      const run = q.trim()
        ? api.searchRoutes(q)
        : api.listRoutes().then((r) => r.items);
      run.then(setRoutes).catch((e) => setError((e as Error).message));
    }, 250);
    return () => window.clearTimeout(debounce.current);
  }, [q]);

  return (
    <>
      <h1 className="page">Discover routes</h1>

      <div className="toolbar">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search routes, instructors, test centres, towns or postcodes…"
          aria-label="Search routes"
        />
      </div>

      {error && <div className="error">{error}</div>}

      {error ? null : !routes ? (
        <div className="center"><div className="spinner" /></div>
      ) : routes.length === 0 ? (
        <div className="empty">
          <div style={{ fontSize: 48 }}>🗺️</div>
          <p>{q.trim() ? 'No routes match your search.' : 'No routes yet.'}</p>
          {!q.trim() && (
            <p className="muted">New routes are added regularly — check back soon.</p>
          )}
        </div>
      ) : (
        <div className="grid">
          {routes.map((r) => (
            <RouteCard key={r.id} route={r} />
          ))}
        </div>
      )}
    </>
  );
}
