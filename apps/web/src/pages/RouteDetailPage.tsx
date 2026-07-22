import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { RouteAccess, RouteDetail, distanceLabel } from '../api/types';
import { InstructorByline } from '../components/InstructorByline';

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

  // The server decides access (per-centre Premium → one-route demo allowance).
  // We just route the user to the paywall when needed.
  function open(kind: 'watch' | 'practice') {
    if (!access) return; // still loading
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

        {(route?.town || route?.postcode) && (
          <div className="muted" style={{ fontSize: 13 }}>
            {[route?.town, route?.postcode].filter(Boolean).join(' · ')}
          </div>
        )}

        {route?.testCentre && (
          <div style={{ marginTop: 6, fontSize: 13 }}>
            🏫{' '}
            <Link to={`/test-centres/${route.testCentre.id}`}>{route.testCentre.name}</Link>
          </div>
        )}

        {route?.instructorName && (
          <div style={{ marginTop: 10 }}>
            <InstructorByline
              id={route.instructorId}
              name={route.instructorName}
              avatar={route.instructorAvatar}
              verified={route.instructorVerified}
            />
          </div>
        )}

        <div className="row" style={{ marginTop: 12 }}>
          <span className="stat">📏 {distanceLabel(route?.distanceM)}</span>
        </div>

        <p className="muted" style={{ marginTop: 12 }}>
          Watch the real drive synced to GPS, or practise it as turn-by-turn voice guidance
          with no video — just like your test.
        </p>
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
