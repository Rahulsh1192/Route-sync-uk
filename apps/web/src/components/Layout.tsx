import { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const bottomTabs = [
  { to: '/test-centres', label: 'Test Centres', ico: '🏫' },
  { to: '/discover',     label: 'Discover',     ico: '🧭' },
  { to: '/contribute',   label: 'Contribute',   ico: '⬆️' },
  { to: '/account',      label: 'Account',      ico: '👤' },
];

const desktopNav = [
  { to: '/test-centres', label: 'Test Centres' },
  { to: '/discover',     label: 'Discover Routes' },
  { to: '/bookings',     label: 'My Bookings' },
  { to: '/contribute',   label: 'Contribute' },
  { to: '/account',      label: 'Account' },
];

export function Layout({ children }: { children: ReactNode }) {
  const { demoMode } = useAuth();
  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/test-centres" className="brand">
          Test<span>Routify</span>
        </NavLink>
        <nav className="nav-desktop">
          {desktopNav.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
        {demoMode && (
          <span className="pill amber" title="Sample data — backend not connected">
            DEMO
          </span>
        )}
      </header>

      <main className="content">{children}</main>

      <nav className="nav-bottom">
        {bottomTabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) => (isActive ? 'active' : '')}
          >
            <span className="ico">{t.ico}</span>
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
