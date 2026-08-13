import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';

/**
 * Request a password-reset link.
 *
 * The confirmation is deliberately worded as "if that address has an account, we've sent
 * a link" and is shown for *every* submission. The API gives the same answer for a known
 * and an unknown address on purpose — a page that said "no account found" would undo that
 * and turn this form into a way to test whether a given person has an account here.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.forgotPassword(email.trim());
      setSent(true);
    } catch {
      // Only reachable for a transport failure or the rate limiter — never for
      // "no such user", which the API reports as success.
      setError('Something went wrong sending that. Please try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <main className="center">
        <div className="card" style={{ maxWidth: 420, width: '100%' }}>
          <h1>Check your inbox</h1>
          <p className="muted">
            If <strong>{email.trim()}</strong> has a Test Routify account, we’ve sent a link
            to reset the password. It expires in one hour.
          </p>
          <p className="muted">
            Nothing after a few minutes? Check your spam folder, and make sure the address
            is the one you signed up with.
          </p>
          <Link className="btn" to="/login">
            Back to sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="center">
      <div className="card" style={{ maxWidth: 420, width: '100%' }}>
        <h1>Reset your password</h1>
        <p className="muted">
          Enter the address you signed up with and we’ll send you a link to choose a new
          password.
        </p>

        <form onSubmit={submit}>
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />

          {error && <p className="error">{error}</p>}

          <button className="btn" type="submit" disabled={busy || !email.trim()}>
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>

        <p className="muted">
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    </main>
  );
}
