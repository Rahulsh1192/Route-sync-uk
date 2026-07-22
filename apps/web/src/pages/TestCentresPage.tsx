import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { TestCentre } from '../api/types';
import { useAuth } from '../auth/AuthContext';

export function TestCentresPage() {
  const nav = useNavigate();
  const { isStaff } = useAuth();
  const [centres, setCentres] = useState<TestCentre[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<number>();

  useEffect(() => {
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => {
      setError(null);
      api
        .listTestCentres(q)
        .then(setCentres)
        .catch((e) => setError((e as Error).message));
    }, 250);
    return () => window.clearTimeout(debounce.current);
  }, [q]);

  return (
    <>
      <div className="row" style={{ marginBottom: 4 }}>
        <h1 className="page" style={{ margin: 0 }}>Test centres</h1>
        <div className="spacer" />
        {isStaff && (
          <button className="btn auto" onClick={() => nav('/test-centres/new')}>
            + New centre
          </button>
        )}
      </div>
      <p className="muted" style={{ marginTop: 4 }}>
        Browse UK driving-test centres and the routes filmed at each one.
      </p>

      <div className="toolbar">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, town or postcode…"
          aria-label="Search test centres"
        />
      </div>

      {error && <div className="error">{error}</div>}

      {error ? null : !centres ? (
        <div className="center"><div className="spinner" /></div>
      ) : centres.length === 0 ? (
        <div className="empty">
          <div style={{ fontSize: 48 }}>🏫</div>
          <p>{q.trim() ? 'No test centres match your search.' : 'No test centres yet.'}</p>
        </div>
      ) : (
        <div className="tc-list">
          {centres.map((c) => (
            <div key={c.id} className="card tc-card" onClick={() => nav(`/test-centres/${c.id}`)}>
              <h3 className="tc-name">{c.name}</h3>
              <div className="tc-meta">
                {[c.town, c.postcode].filter(Boolean).join(' · ') || '—'}
              </div>
              <div className="tc-count">
                <span className="pill accent">
                  {c.routeCount ?? 0} {c.routeCount === 1 ? 'route' : 'routes'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
