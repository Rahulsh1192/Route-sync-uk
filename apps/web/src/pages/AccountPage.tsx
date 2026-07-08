import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { Entitlements } from '../api/types';
import { useAuth } from '../auth/AuthContext';

export function AccountPage() {
  const { logout } = useAuth();
  const nav = useNavigate();
  const [ent, setEnt] = useState<Entitlements | null>(null);

  useEffect(() => {
    api.me().then(setEnt).catch(() => {});
  }, []);

  const premium = ent?.entitlements.multiView ?? false;

  return (
    <>
      <h1 className="page">Account</h1>
      <div className="card">
        <div className="row">
          <span style={{ fontSize: 22 }}>{premium ? '⭐' : '👤'}</span>
          <div>
            <div style={{ fontWeight: 700 }}>
              {ent == null ? 'Loading…' : premium ? `Premium (${ent.plan})` : 'Free plan'}
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              {premium ? 'All features unlocked' : '1 sample route'}
            </div>
          </div>
          <div className="spacer" />
          {!premium && (
            <button className="btn auto" onClick={() => nav('/paywall')}>
              Upgrade
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <strong>Contribute a route</strong>
        <p className="muted" style={{ fontSize: 14 }}>
          Recording front + rear dashcam clips and a GPX track? Upload them, track processing,
          and earn credits &amp; badges.
        </p>
        <button className="btn secondary" onClick={() => nav('/contribute')}>
          Open contributor tools
        </button>
      </div>

      <button className="btn secondary" onClick={logout}>
        Sign out
      </button>
    </>
  );
}
