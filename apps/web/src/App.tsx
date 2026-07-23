import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DiscoverPage } from './pages/DiscoverPage';
import { RouteDetailPage } from './pages/RouteDetailPage';
import { AccountPage } from './pages/AccountPage';
import { PaywallPage } from './pages/PaywallPage';
import { ContributePage } from './pages/contribute/ContributePage';
import { UploadPage } from './pages/contribute/UploadPage';
import { UploadStatusPage } from './pages/contribute/UploadStatusPage';
import { InstructorVerifyPage } from './pages/contribute/InstructorVerifyPage';
import { InstructorProfilePage } from './pages/InstructorProfilePage';
import { BookingsPage } from './pages/BookingsPage';
import { ProgressPage } from './pages/ProgressPage';
import { TestCentresPage } from './pages/TestCentresPage';
import { TestCentreDetailPage } from './pages/TestCentreDetailPage';
import { TestCentreFormPage } from './pages/TestCentreFormPage';

// Code-split the heavy media pages (hls.js + leaflet) and the admin console
// (staff-only) out of the learner bundle.
const WatchPage = lazy(() => import('./pages/WatchPage').then((m) => ({ default: m.WatchPage })));
const PracticePage = lazy(() =>
  import('./pages/PracticePage').then((m) => ({ default: m.PracticePage })),
);
const AdminApp = lazy(() => import('./admin/AdminApp').then((m) => ({ default: m.AdminApp })));

const Loading = () => (
  <div className="center">
    <div className="spinner" />
  </div>
);

const isAdminRole = (role?: string | null) => role === 'admin' || role === 'moderator';

/** Wraps protected learner pages: redirects to /login when unauthenticated. */
function Protected({ children }: { children: React.ReactNode }) {
  const { authed } = useAuth();
  if (!authed) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

/** Admin console: authed + admin/moderator only, rendered without the learner shell. */
function AdminProtected({ children }: { children: React.ReactNode }) {
  const { authed, user } = useAuth();
  if (!authed) return <Navigate to="/login" replace />;
  if (!user) return <Loading />; // wait for role before deciding
  if (!isAdminRole(user.role)) return <Navigate to="/test-centres" replace />;
  return <>{children}</>;
}

/** Post-login landing: admins → console, everyone else → Test Centres. */
function RoleLanding() {
  const { authed, user } = useAuth();
  if (!authed) return <Navigate to="/login" replace />;
  if (!user) return <Loading />;
  return <Navigate to={isAdminRole(user.role) ? '/admin' : '/test-centres'} replace />;
}

export function App() {
  const { authed } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={authed ? <Navigate to="/" replace /> : <LoginPage />} />

      {/* role-based landing */}
      <Route path="/" element={<RoleLanding />} />

      {/* Admin console (staff only, no learner shell, lazy-loaded) */}
      <Route
        path="/admin"
        element={
          <AdminProtected>
            <Suspense fallback={<Loading />}>
              <AdminApp />
            </Suspense>
          </AdminProtected>
        }
      />

      {/* Test centres */}
      <Route path="/test-centres" element={<Protected><TestCentresPage /></Protected>} />
      <Route path="/test-centres/new" element={<Protected><TestCentreFormPage mode="create" /></Protected>} />
      <Route path="/test-centres/:id" element={<Protected><TestCentreDetailPage /></Protected>} />
      <Route path="/test-centres/:id/edit" element={<Protected><TestCentreFormPage mode="edit" /></Protected>} />

      <Route path="/discover" element={<Protected><DiscoverPage /></Protected>} />
      <Route path="/account" element={<Protected><AccountPage /></Protected>} />
      <Route path="/paywall" element={<Protected><PaywallPage /></Protected>} />
      <Route path="/contribute" element={<Protected><ContributePage /></Protected>} />
      <Route path="/contribute/upload" element={<Protected><UploadPage /></Protected>} />
      <Route path="/contribute/uploads/:id" element={<Protected><UploadStatusPage /></Protected>} />
      <Route path="/contribute/instructor" element={<Protected><InstructorVerifyPage /></Protected>} />
      <Route path="/route/:id" element={<Protected><RouteDetailPage /></Protected>} />
      <Route path="/instructors/:id" element={<Protected><InstructorProfilePage /></Protected>} />
      <Route path="/bookings" element={<Protected><BookingsPage /></Protected>} />
      <Route path="/account/progress" element={<Protected><ProgressPage /></Protected>} />

      {/* full-screen experiences — lazy-loaded (heavy media libs) */}
      <Route
        path="/route/:id/watch"
        element={
          <Protected>
            <Suspense fallback={<Loading />}>
              <WatchPage />
            </Suspense>
          </Protected>
        }
      />
      <Route
        path="/route/:id/practice"
        element={
          <Protected>
            <Suspense fallback={<Loading />}>
              <PracticePage />
            </Suspense>
          </Protected>
        }
      />

      {/* Legacy paths → their new homes */}
      <Route path="/search" element={<Navigate to="/discover" replace />} />
      <Route path="/instructors" element={<Navigate to="/" replace />} />
      <Route path="/test-details" element={<Navigate to="/" replace />} />

      <Route path="*" element={<Navigate to={authed ? '/' : '/login'} replace />} />
    </Routes>
  );
}
