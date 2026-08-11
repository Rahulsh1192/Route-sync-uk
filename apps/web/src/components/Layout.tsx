import { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

interface Tab {
  to: string;
  label: string;
  ico: string;
}

/**
 * Navigation is role-dependent (Phase 27).
 *
 * "Contribute" used to be shown to everyone, which put uploading routes and managing test
 * centres in front of learners who cannot do either — every one of those pages ends in
 * "this is for verified instructors". A learner's equivalent action is booking a lesson, so
 * that is what occupies the slot for them; the route into becoming an instructor stays on
 * the Account page, where someone looking for it will go.
 */
const learnerTabs: Tab[] = [
  { to: '/test-centres',        label: 'Test Centres',   ico: '🏫' },
  { to: '/discover',            label: 'Discover',       ico: '🧭' },
  { to: '/instructors/find',    label: 'Book a Lesson',  ico: '🚗' },
  { to: '/account',             label: 'Account',        ico: '👤' },
];

const staffTabs: Tab[] = [
  { to: '/test-centres', label: 'Test Centres', ico: '🏫' },
  { to: '/discover',     label: 'Discover',     ico: '🧭' },
  { to: '/contribute',   label: 'Contribute',   ico: '⬆️' },
  { to: '/account',      label: 'Account',      ico: '👤' },
];

const learnerDesktopNav: Tab[] = [
  { to: '/test-centres',     label: 'Test Centres',           ico: '' },
  { to: '/discover',         label: 'Discover Routes',        ico: '' },
  { to: '/instructors/find', label: 'Book a Driving Instructor', ico: '' },
  { to: '/bookings',         label: 'My Bookings',            ico: '' },
  { to: '/account',          label: 'Account',                ico: '' },
];

const staffDesktopNav: Tab[] = [
  { to: '/test-centres',     label: 'Test Centres',    ico: '' },
  { to: '/discover',         label: 'Discover Routes', ico: '' },
  { to: '/instructors/me',   label: 'My Lessons',      ico: '' },
  { to: '/contribute',       label: 'Contribute',      ico: '' },
  { to: '/account',          label: 'Account',         ico: '' },
];

export function Layout({ children }: { children: ReactNode }) {
  const { demoMode, isStaff } = useAuth();
  const bottomTabs = isStaff ? staffTabs : learnerTabs;
  const desktopNav = isStaff ? staffDesktopNav : learnerDesktopNav;

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
