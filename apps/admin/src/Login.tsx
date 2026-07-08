import { useState, FormEvent } from 'react';
import { api, setToken } from './api';

export function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { accessToken } = await api.login(email, password);
      setToken(accessToken);
      onLogin();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card" role="main">
        <div className="login-logo">
          <div className="login-logo-mark" aria-hidden="true">R</div>
        </div>
        <h1>RouteSync Admin</h1>
        <p className="subtitle">Sign in to the admin console</p>

        {error && (
          <div className="error" role="alert">
            <span aria-hidden="true">⚠</span>
            {error}
          </div>
        )}

        <form onSubmit={submit} noValidate>
          <div className="form-group">
            <label className="form-label" htmlFor="login-email">Email</label>
            <input
              id="login-email"
              type="email"
              placeholder="admin@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
              required
              disabled={busy}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              disabled={busy}
            />
          </div>

          <button
            className="btn-primary"
            type="submit"
            disabled={busy}
            style={{ width: '100%', padding: 'var(--space-3)', marginTop: 'var(--space-2)' }}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 'var(--space-5)', fontSize: 'var(--text-xs)', color: 'var(--color-text-3)' }}>
          Moderator or admin accounts only
        </p>
      </div>
    </div>
  );
}
