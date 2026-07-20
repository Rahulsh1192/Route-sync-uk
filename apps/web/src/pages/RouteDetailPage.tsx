import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { RouteAccess, RouteDetail } from '../api/types';

export function RouteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [access, setAccess] = useState<RouteAccess | null>(null);

  useEffect(() => {
    if (!id) return;
    api.route(id).then(setRoute).catch(() => setRoute(null));
    api.routeAccess(id).then(setAccess).catch(() => setAccess(null));
  }, [id]);

  // The server decides access (test-details gate → per-centre Premium → one-route
  // demo allowance). We just route the user to the right next step.
  function open(kind: 'watch' | 'practice') {
    if (!access) return; // still loading
    if (access.reason === 'TEST_DETAILS_REQUIRED') {
      return nav('/test-details', { state: { returnTo: `/route/${id}` } });
    }
    if (!access.allowed) {
      return nav('/paywall', {
        state: { testCentreId: access.testCentreId, centreLabel: access.centreLabel },
      });
    }
    nav(`/route/${id}/${kind}`);
  }

  return (
    <>
      <button className="btn secondary auto" onClick={() => nav(-1)} style={{ marginBottom: 16 }}>
        ← Back
      </button>
      <div className="card">
        <h1 className="page" style={{ marginTop: 0 }}>{route?.title ?? 'Route'}</h1>
        <p className="muted">
          Watch the real drive synced to GPS, or practise it as turn-by-turn voice guidance
          with no video — just like your test.
        </p>
        {access && access.reason === 'TEST_DETAILS_REQUIRED' && (
          <p className="muted" style={{ fontSize: 13 }}>
            Share your test centre and date first — it only takes a moment.
          </p>
        )}
        {access && access.reason === 'PAYWALL' && (
          <p className="muted" style={{ fontSize: 13 }}>
            Premium for <strong>{access.centreLabel || 'this test centre'}</strong> unlocks this route.
          </p>
        )}
        <button className="btn" onClick={() => open('watch')} style={{ marginTop: 8 }}>
          ▶ Watch route
        </button>
        <button className="btn secondary" onClick={() => open('practice')} style={{ marginTop: 10 }}>
          🧭 Practice route
        </button>
      </div>
    </>
  );
}
