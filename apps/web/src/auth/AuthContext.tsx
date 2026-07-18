import { createContext, useContext, useState, ReactNode, useCallback, useEffect } from 'react';
import { api, tokens } from '../api/client';
import { demo } from '../api/demo';

interface AuthState {
  authed: boolean;
  demoMode: boolean;
  sessionInvalidated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
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

  // Registration is required for all access (Phase 19a): there is no anonymous
  // demo entry, and an unreachable backend surfaces a real error rather than
  // silently dropping into demo mode.
  const login = useCallback(async (email: string, password: string) => {
    const r = await api.login(email, password);
    tokens.save(r.accessToken, r.refreshToken);
    setAuthed(true);
  }, []);

  const register = useCallback(async (email: string, password: string, name: string) => {
    const r = await api.register(email, password, name);
    tokens.save(r.accessToken, r.refreshToken);
    setAuthed(true);
  }, []);

  const logout = useCallback(() => {
    demo.disable();
    tokens.clear();
    setDemoMode(false);
    setAuthed(false);
    setSessionInvalidated(false);
  }, []);

  return (
    <AuthCtx.Provider value={{ authed, demoMode, sessionInvalidated, login, register, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
