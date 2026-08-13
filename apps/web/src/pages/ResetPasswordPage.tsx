import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';

/** Matches the API's `@MinLength(8)` on both registration and reset. */
const MIN_PASSWORD = 8;

/**
 * Where a password-reset email lands (`APP_BASE_URL/reset-password?token=…`).
 *
 * Unlike the verification page this does *not* redeem the token on mount — the token is
 * single-use, and spending it just for arriving would leave the user with a spent link
 * and no new password. It is submitted together with the new password, once.
 */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const mismatch = confirm.length > 0 && password !== confirm;
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const canSubmit =
    !busy && token !== '' && password.length >= MIN_PASSWORD && password === confirm;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err: unknown) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'That link is invalid or has expired.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <main className="center">
        <div className="card" style={{ maxWidth: 420, width: '100%' }}>
          <h1>That link is incomplete</h1>
          <p className="muted">
            The address is missing its token. Copy the whole link from the email, or request
            a new one.
          </p>
          <Link className="btn" to="/forgot-password">
            Request a new link
          </Link>
        </div>
      </main>
    );
  }

  if (done) {
    return (
      <main className="center">
        <div className="card" style={{ maxWidth: 420, width: '100%' }}>
          <h1>Password changed</h1>
          {/* Say this explicitly: the reset revokes every existing session, so anyone
              already signed in on another device is about to be logged out. If we don't
              explain it, that reads as a bug. */}
          <p className="muted">
            You’ve been signed out everywhere else, so any other device will need the new
            password.
          </p>
          <button className="btn" onClick={() => nav('/login')}>
            Sign in
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="center">
      <div className="card" style={{ maxWidth: 420, width: '100%' }}>
        <h1>Choose a new password</h1>

        <form onSubmit={submit}>
          <label htmlFor="password">New password</label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {tooShort && (
            <p className="error">Use at least {MIN_PASSWORD} characters.</p>
          )}

          <label htmlFor="confirm">Confirm new password</label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {mismatch && <p className="error">Those two don’t match.</p>}

          {error && (
            <>
              <p className="error">{error}</p>
              <p className="muted">
                <Link to="/forgot-password">Request a new link</Link>
              </p>
            </>
          )}

          <button className="btn" type="submit" disabled={!canSubmit}>
            {busy ? 'Saving…' : 'Save new password'}
          </button>
        </form>
      </div>
    </main>
  );
}
