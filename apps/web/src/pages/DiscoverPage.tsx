import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { RouteSummary } from '../api/types';
import { RouteCard } from '../components/RouteCard';

export function DiscoverPage() {
  const [routes, setRoutes] = useState<RouteSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listRoutes()
      .then((r) => setRoutes(r.items))
      .catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!routes) return <div className="center"><div className="spinner" /></div>;
  if (routes.length === 0)
    return (
      <div className="empty">
        <div style={{ fontSize: 48 }}>🗺️</div>
        <p>No routes near you yet.</p>
        <p className="muted">New routes are added regularly — check back soon.</p>
      </div>
    );

  return (
    <>
      <h1 className="page">Discover routes</h1>
      <div className="grid">
        {routes.map((r) => (
          <RouteCard key={r.id} route={r} />
        ))}
      </div>
    </>
  );
}
