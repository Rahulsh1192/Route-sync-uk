import { createContext, useContext, useState, ReactNode, useCallback, useEffect } from 'react';
import { api, tokens, ApiError } from '../api/client';
import { demo } from '../api/demo';

interface AuthState {
  authed: boolean;
  demoMode: boolean;
  sessionInvalidated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  startDemo: () => void;
  logout: () => void;
}

/** Backend unreachable (not running / network / bad gateway) → fall back to demo. */
function backendUnavailable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true;
  return [0, 404, 502, 503, 504].includes(err.status);
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState<boolean>(tokens.hasSession);
  const [demoMode, setDemoMode] = useState<boolean>(demo.on);
  const [sessionInvalidated, setSessionInvalidated] = useState(false);

  // Phase 17: Listen for session-invalidated event fired by api client
  useEffect(() => {
    const handler = () => {
      setAuthed(false);
      setSessionInvalidated(true);
    };
    window.addEventListener('session-invalidated', handler);
    return () => window.removeEventListener('session-invalidated', handler);
  }, []);

  const startDemo = useCallback(() => {
    demo.enable();
    tokens.save('demo', 'demo'); // satisfies the auth gate; API calls are mocked
    setDemoMode(true);
    setAuthed(true);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      try {
        const r = await api.login(email, password);
        tokens.save(r.accessToken, r.refreshToken);
        setAuthed(true);
      } catch (err) {
        if (backendUnavailable(err)) return startDemo(); // no backend → demo
        throw err; // real auth error (e.g. wrong password) bubbles up
      }
    },
    [startDemo],
  );

  const register = useCallback(
    async (email: string, password: string, name: string) => {
      try {
        const r = await api.register(email, password, name);
        tokens.save(r.accessToken, r.refreshToken);
        setAuthed(true);
      } catch (err) {
        if (backendUnavailable(err)) return startDemo();
        throw err;
      }
    },
    [startDemo],
  );

  const logout = useCallback(() => {
    demo.disable();
    tokens.clear();
    setDemoMode(false);
    setAuthed(false);
    setSessionInvalidated(false);
  }, []);

  return (
    <AuthCtx.Provider value={{ authed, demoMode, sessionInvalidated, login, register, startDemo, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
