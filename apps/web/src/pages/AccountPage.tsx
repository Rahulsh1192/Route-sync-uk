import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { Entitlements } from '../api/types';
import { useAuth } from '../auth/AuthContext';

export function AccountPage() {
  const { logout } = useAuth();
  const nav = useNavigate();
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    api.me().then(setEnt).catch(() => {});
    // Show install button if the browser already has the prompt ready
    setCanInstall(!!(window as any).__pwaInstall);
    const handler = () => setCanInstall(true);
    window.addEventListener('pwa-installable', handler);
    return () => window.removeEventListener('pwa-installable', handler);
  }, []);

  async function installApp() {
    const prompt = (window as any).__pwaInstall;
    if (!prompt) return;
    setInstalling(true);
    await prompt();
    setInstalling(false);
    setCanInstall(false);
  }

  const premium = ent?.entitlements.multiView ?? false;
  // Number of distinct test centres unlocked (null = a universal/legacy grant).
  const centreCount = ent?.premiumTestCentreIds?.filter((c) => c !== null).length ?? 0;
  const hasUniversal = ent?.premiumTestCentreIds?.includes(null) ?? false;

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
              {!premium
                ? 'Demo — one route total. Upgrade for unlimited routes at a test centre.'
                : hasUniversal
                ? 'All test centres unlocked'
                : `Premium for ${centreCount} test centre${centreCount === 1 ? '' : 's'}`}
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
        <div className="row">
          <span style={{ fontSize: 18 }}>📝</span>
          <div>
            <strong>Test details</strong>
            <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>
              Your test centre and date — required before using routes.
            </p>
          </div>
          <div className="spacer" />
          <button className="btn secondary auto" onClick={() => nav('/test-details')}>
            Set / update
          </button>
        </div>
      </div>

      <div className="card">
        <div className="row">
          <span style={{ fontSize: 18 }}>🏫</span>
          <div>
            <strong>Book a driving instructor</strong>
            <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>
              Find and book a verified ADI near you. No Premium subscription required.
            </p>
          </div>
          <div className="spacer" />
          <button className="btn secondary auto" onClick={() => nav('/instructors')}>
            Find instructors
          </button>
        </div>
      </div>

      <div className="card">
        <div className="row">
          <span style={{ fontSize: 18 }}>📊</span>
          <div>
            <strong>My Progress</strong>
            <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>
              Track routes watched, practice runs, and your learning streak.
            </p>
          </div>
          <div className="spacer" />
          <button className="btn secondary auto" onClick={() => nav('/account/progress')}>
            View progress
          </button>
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

      {canInstall && (
        <div className="card" style={{ borderColor: 'var(--color-accent)' }}>
          <div className="row">
            <span style={{ fontSize: 22 }}>📲</span>
            <div>
              <strong>Install RouteSync</strong>
              <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>
                Add to your home screen for offline access and a faster experience.
              </p>
            </div>
            <div className="spacer" />
            <button className="btn auto" disabled={installing} onClick={installApp}>
              {installing ? 'Installing…' : 'Install'}
            </button>
          </div>
        </div>
      )}

      <button className="btn secondary" onClick={logout} style={{ marginTop: 8 }}>
        Sign out
      </button>
    </>
  );
}
