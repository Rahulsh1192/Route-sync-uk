import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { Entitlements } from '../api/types';

export function RouteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [ent, setEnt] = useState<Entitlements | null>(null);

  useEffect(() => {
    api.me().then(setEnt).catch(() => setEnt(null));
  }, []);

  function open(kind: 'watch' | 'practice') {
    const isPremium = ent ? ent.entitlements.multiView : false;
    // practice is always premium; watch is allowed for sample routes even on free.
    if (kind === 'practice' && !isPremium) return nav('/paywall');
    nav(`/route/${id}/${kind}`);
  }

  return (
    <>
      <button className="btn secondary auto" onClick={() => nav(-1)} style={{ marginBottom: 16 }}>
        ← Back
      </button>
      <div className="card">
        <h1 className="page" style={{ marginTop: 0 }}>Route</h1>
        <p className="muted">
          Watch the real drive synced to GPS, or practise it as turn-by-turn voice guidance
          with no video — just like your test.
        </p>
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
