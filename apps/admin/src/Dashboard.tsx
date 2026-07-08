import { useEffect, useState } from 'react';
import { api, Analytics, setToken } from './api';
import { ReviewQueue } from './panels/ReviewQueue';
import { Users } from './panels/Users';
import { Instructors } from './panels/Instructors';
import { Revenue } from './panels/Revenue';
import { Fund } from './panels/Fund';
import { Reports } from './panels/Reports';

type View = 'queue' | 'users' | 'instructors' | 'revenue' | 'fund' | 'reports';

const NAV: { id: View; label: string; icon: string }[] = [
  { id: 'queue',       label: 'Review Queue',     icon: '⏳' },
  { id: 'users',       label: 'Users',             icon: '👥' },
  { id: 'instructors', label: 'Instructors',       icon: '🎓' },
  { id: 'revenue',     label: 'Revenue',           icon: '💰' },
  { id: 'fund',        label: 'Community Fund',    icon: '🏦' },
  { id: 'reports',     label: 'Reports',           icon: '🚩' },
];

export function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [view, setView] = useState<View>('queue');
  const [stats, setStats] = useState<Analytics | null>(null);

  useEffect(() => {
    api.analytics().then(setStats).catch(() => {});
  }, [view]);

  function signOut() {
    setToken(null);
    onLogout();
  }

  const currentLabel = NAV.find((n) => n.id === view)?.label ?? '';

  return (
    <div className="shell">
      <aside className="sidebar" role="navigation" aria-label="Main navigation">
        <div className="brand">
          <div className="brand-icon" aria-hidden="true">R</div>
          <div>
            <div className="brand-name">RouteSync</div>
            <div className="brand-sub">Admin Console</div>
          </div>
        </div>

        <div className="nav-section-label">Navigation</div>

        {NAV.map((n) => (
          <div
            key={n.id}
            className={`nav-item${view === n.id ? ' active' : ''}`}
            onClick={() => setView(n.id)}
            role="button"
            tabIndex={0}
            aria-current={view === n.id ? 'page' : undefined}
            onKeyDown={(e) => e.key === 'Enter' && setView(n.id)}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span aria-hidden="true" style={{ fontSize: '0.875rem' }}>{n.icon}</span>
              {n.label}
            </span>
            {n.id === 'queue' && stats && stats.pendingReview > 0 && (
              <span className="count" aria-label={`${stats.pendingReview} pending`}>
                {stats.pendingReview}
              </span>
            )}
          </div>
        ))}

        <div className="nav-spacer" />
        <div className="nav-divider" />

        <div
          className="nav-item"
          onClick={signOut}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && signOut()}
          aria-label="Sign out"
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span aria-hidden="true" style={{ fontSize: '0.875rem' }}>↩</span>
            Sign out
          </span>
        </div>
      </aside>

      <main className="main" id="main-content">
        <header className="topbar" role="banner">
          <div className="topbar-left">
            <h1>{currentLabel}</h1>
          </div>
          <div className="stats" role="region" aria-label="Key metrics">
            {stats && (
              <>
                <div className="stat">
                  <div className="num">{stats.users.toLocaleString()}</div>
                  <div className="label">Users</div>
                </div>
                <div className="stat">
                  <div className="num">{stats.publishedRoutes.toLocaleString()}</div>
                  <div className="label">Published</div>
                </div>
                <div className="stat">
                  <div className="num">{stats.premiumSubscribers.toLocaleString()}</div>
                  <div className="label">Premium</div>
                </div>
              </>
            )}
          </div>
        </header>

        <div className="container">
          {view === 'queue' && <ReviewQueue />}
          {view === 'users' && <Users />}
          {view === 'instructors' && <Instructors />}
          {view === 'revenue' && <Revenue />}
          {view === 'fund' && <Fund />}
          {view === 'reports' && <Reports />}
        </div>
      </main>
    </div>
  );
}
