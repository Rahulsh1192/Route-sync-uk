import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DiscoverPage } from './pages/DiscoverPage';
import { SearchPage } from './pages/SearchPage';
import { RouteDetailPage } from './pages/RouteDetailPage';
import { AccountPage } from './pages/AccountPage';
import { PaywallPage } from './pages/PaywallPage';
import { ContributePage } from './pages/contribute/ContributePage';
import { UploadPage } from './pages/contribute/UploadPage';
import { UploadStatusPage } from './pages/contribute/UploadStatusPage';
import { InstructorVerifyPage } from './pages/contribute/InstructorVerifyPage';

// Code-split the heavy media pages (hls.js + leaflet) out of the initial bundle
// so first paint on mobile stays light.
const WatchPage = lazy(() => import('./pages/WatchPage').then((m) => ({ default: m.WatchPage })));
const PracticePage = lazy(() =>
  import('./pages/PracticePage').then((m) => ({ default: m.PracticePage })),
);

const Loading = () => (
  <div className="center">
    <div className="spinner" />
  </div>
);

/** Wraps protected pages: redirects to /login when unauthenticated. */
function Protected({ children }: { children: React.ReactNode }) {
  const { authed } = useAuth();
  if (!authed) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export function App() {
  const { authed } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={authed ? <Navigate to="/discover" replace /> : <LoginPage />} />

      <Route path="/discover" element={<Protected><DiscoverPage /></Protected>} />
      <Route path="/search" element={<Protected><SearchPage /></Protected>} />
      <Route path="/account" element={<Protected><AccountPage /></Protected>} />
      <Route path="/paywall" element={<Protected><PaywallPage /></Protected>} />
      <Route path="/contribute" element={<Protected><ContributePage /></Protected>} />
      <Route path="/contribute/upload" element={<Protected><UploadPage /></Protected>} />
      <Route path="/contribute/uploads/:id" element={<Protected><UploadStatusPage /></Protected>} />
      <Route path="/contribute/instructor" element={<Protected><InstructorVerifyPage /></Protected>} />
      <Route path="/route/:id" element={<Protected><RouteDetailPage /></Protected>} />

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

      <Route path="*" element={<Navigate to={authed ? '/discover' : '/login'} replace />} />
    </Routes>
  );
}
