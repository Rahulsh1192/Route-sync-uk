import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function LoginPage() {
  const { login, register, startDemo } = useAuth();
  const nav = useNavigate();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isRegister) await register(email.trim(), password, name.trim());
      else await login(email.trim(), password);
      nav('/discover');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 380, margin: '8vh auto 0' }}>
      <h1 style={{ textAlign: 'center', fontSize: 30, marginBottom: 4 }}>
        Route<span style={{ color: 'var(--accent-2)' }}>Sync</span>
      </h1>
      <p className="muted" style={{ textAlign: 'center', marginTop: 0 }}>
        Learn UK driving-test routes
      </p>
      <form onSubmit={submit} className="card" style={{ marginTop: 24 }}>
        {isRegister && (
          <>
            <label>Display name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </>
        )}
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <div className="error">{error}</div>}
        <button className="btn" disabled={busy} type="submit" style={{ marginTop: 12 }}>
          {busy ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
        </button>
      </form>
      <button
        className="btn secondary"
        style={{ marginTop: 4 }}
        onClick={() => setIsRegister((v) => !v)}
      >
        {isRegister ? 'Have an account? Sign in' : 'New here? Create an account'}
      </button>

      <div style={{ textAlign: 'center', margin: '18px 0 8px', color: 'var(--muted)', fontSize: 13 }}>
        — or —
      </div>
      <button
        className="btn ghost"
        onClick={() => {
          startDemo();
          nav('/discover');
        }}
      >
        ✨ Explore the demo (no account)
      </button>
      <p className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 8 }}>
        Sample routes with a real video player &amp; voice guidance — no backend needed.
      </p>
    </div>
  );
}
