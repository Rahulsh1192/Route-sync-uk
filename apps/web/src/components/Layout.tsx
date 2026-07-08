import { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const tabs = [
  { to: '/discover', label: 'Discover', ico: '🧭' },
  { to: '/search', label: 'Search', ico: '🔍' },
  { to: '/contribute', label: 'Contribute', ico: '⬆️' },
  { to: '/account', label: 'Account', ico: '👤' },
];

export function Layout({ children }: { children: ReactNode }) {
  const { demoMode } = useAuth();
  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/discover" className="brand">
          Route<span>Sync</span>
        </NavLink>
        {demoMode && <span className="pill amber" title="Sample data — backend not connected">DEMO</span>}
        <nav className="nav-desktop">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              {t.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="content">{children}</main>

      <nav className="nav-bottom">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? 'active' : '')}>
            <span className="ico">{t.ico}</span>
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
