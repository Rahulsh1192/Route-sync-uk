import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { ContributorProfile } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';

export function ContributePage() {
  const nav = useNavigate();
  const { demoMode } = useAuth();
  const [profile, setProfile] = useState<ContributorProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (demoMode) return;
    api.profile().then(setProfile).catch((e) => setError((e as Error).message));
  }, [demoMode]);

  if (demoMode) {
    return (
      <>
        <h1 className="page">Contribute</h1>
        <div className="card">
          <p>Contributor tools (uploading routes, earning credits & badges) need a real
            account. Sign out of the demo and register to start contributing.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="page">Contribute</h1>
      {error && <div className="error">{error}</div>}

      <div className="card">
        <div className="row">
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{profile?.display_name ?? '…'}</div>
            <div className="muted" style={{ fontSize: 13 }}>
              {profile?.instructor_status === 'verified' ? '✅ Verified instructor' : 'Contributor'}
            </div>
          </div>
        </div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', marginTop: 14, gap: 10 }}>
          <Stat label="Credits" value={profile?.credits} />
          <Stat label="Reputation" value={profile?.reputation} />
          <Stat label="Published" value={profile?.routes_published} />
        </div>
      </div>

      {profile && profile.badges.length > 0 && (
        <div className="card">
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>BADGES</div>
          <div className="row">
            {profile.badges.map((b) => (
              <span key={b.code} className="pill accent" title={b.description}>
                🏅 {b.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <button className="btn" onClick={() => nav('/contribute/upload')} style={{ marginBottom: 12 }}>
        ⬆️ Upload a new route
      </button>
      <button className="btn secondary" onClick={() => nav('/contribute/instructor')}>
        🎓 Become a verified instructor
      </button>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="muted" style={{ fontSize: 13 }}>
          Verified ADIs get an instructor badge, a search boost and fast-tracked approvals.
          Every published route earns credits and builds your reputation.
        </div>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value?: number }) {
  return (
    <div className="card" style={{ margin: 0, textAlign: 'center', padding: 12 }}>
      <div style={{ fontSize: 24, fontWeight: 800 }}>{value ?? '—'}</div>
      <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>{label}</div>
    </div>
  );
}
