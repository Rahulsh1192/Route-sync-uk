import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { PasswordField } from '../components/PasswordField';

export function LoginPage() {
  const { login, register, sessionInvalidated } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [iceName, setIceName] = useState('');
  const [icePhone, setIcePhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Masked address a link was just sent to. Non-null replaces the form with the panel. */
  const [sentTo, setSentTo] = useState<string | null>(null);
  /** Sign-in failed only because the address is unconfirmed — a different screen from an error. */
  const [notVerified, setNotVerified] = useState(false);
  const justVerified = params.get('verified') === '1';

  // Strip the flag once it has been read: a refresh, or a URL shared with someone else, must
  // not keep claiming that an address was just confirmed.
  useEffect(() => {
    if (justVerified) setParams({}, { replace: true });
  }, [justVerified, setParams]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotVerified(false);
    try {
      if (isRegister) {
        // Only send fields the user actually filled: the API treats an empty string as
        // "clear this", which is a meaningless instruction on a brand-new account.
        const masked = await register(email.trim(), password, name.trim(), {
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(iceName.trim() ? { emergencyContactName: iceName.trim() } : {}),
          ...(icePhone.trim() ? { emergencyContactPhone: icePhone.trim() } : {}),
        });
        // No navigation: signing up no longer produces a session. The confirmation panel
        // stands in for the form until the link in the inbox has been followed.
        setSentTo(masked);
        return;
      }
      await login(email.trim(), password);
      // Role-based landing (admins → console, everyone else → Test Centres).
      nav('/');
    } catch (err) {
      // Branch on the code, not the message: the copy will change, the code will not.
      if (err instanceof ApiError && err.code === 'email_not_verified') setNotVerified(true);
      else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Ask for another link.
   *
   * Re-posts the signup call, which is the resend path on the API: it sends a new link when
   * the address exists, is unconfirmed, and the password matches. Serves both the
   * confirmation panel and the "not verified" message, so the name is passed only when this
   * form has one.
   */
  async function resend() {
    setBusy(true);
    setError(null);
    try {
      const masked = await register(email.trim(), password, name.trim() || undefined);
      setSentTo(masked);
      setNotVerified(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="landing">
      {/* Branded hero — the background image/motif lives in CSS (.landing-hero). */}
      <section className="landing-hero" aria-hidden="true">
        <div className="landing-hero-overlay" />
        <div className="landing-hero-content">
          <img src="/icon.svg" alt="" className="landing-logo" width={72} height={72} />
          <h1 className="landing-wordmark">
            Test<span>Routify</span>
          </h1>
          <p className="landing-tagline">
            Learn the real UK driving-test routes for your test centre — watch them
            GPS-synced, then practise with turn-by-turn voice guidance.
          </p>
          <ul className="landing-points">
            <li>🎥 Real routes filmed at your test centre</li>
            <li>🗺️ Practise turn-by-turn, hands-free</li>
            <li>🎓 Verified instructor routes</li>
          </ul>
        </div>
      </section>

      {/* Auth card */}
      <section className="landing-auth">
        <div className="landing-auth-inner">
          <h2 style={{ marginTop: 0, marginBottom: 4 }}>
            {isRegister ? 'Create your account' : 'Welcome back'}
          </h2>
          <p className="muted" style={{ marginTop: 0 }}>
            {isRegister
              ? 'It only takes a moment.'
              : 'Sign in to continue to Test Routify.'}
          </p>

          {sessionInvalidated && (
            <div className="error" style={{ marginTop: 16 }}>
              You were signed out because your account was used on another device.
            </div>
          )}

          {justVerified && (
            <div className="pill good" style={{ marginTop: 16, display: 'inline-block' }}>
              Email confirmed — sign in to continue.
            </div>
          )}

          {notVerified && (
            <div className="error" style={{ marginTop: 16 }}>
              Confirm your email address to sign in. Check your inbox for the link.
              <button
                className="btn secondary"
                style={{ marginTop: 8 }}
                disabled={busy}
                onClick={resend}
              >
                {busy ? 'Sending…' : 'Send the link again'}
              </button>
            </div>
          )}

          {/* Signing up ends here, not in the app: the panel stands in for the form until the
              address is confirmed. */}
          {sentTo && (
            <div className="card" style={{ marginTop: 16 }}>
              <h3 style={{ marginTop: 0 }}>Check your inbox</h3>
              <p className="muted">
                We&apos;ve sent a verification link to <strong>{sentTo}</strong>. Open it to
                confirm your address, then sign in.
              </p>
              <p className="muted" style={{ fontSize: 13 }}>
                The link works once and expires after 24 hours. Nothing after a few minutes?
                Check your spam folder.
              </p>
              {error && <div className="error">{error}</div>}
              <button className="btn secondary" disabled={busy} onClick={resend}>
                {busy ? 'Sending…' : 'Send it again'}
              </button>
              <button
                className="btn secondary"
                style={{ marginTop: 8 }}
                onClick={() => {
                  setSentTo(null);
                  setIsRegister(false);
                  setPassword('');
                }}
              >
                Back to sign in
              </button>
            </div>
          )}

          {!sentTo && (
          <form onSubmit={submit} className="card" style={{ marginTop: 16 }}>
            {isRegister && (
              <>
                <label>Display name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} required />
              </>
            )}
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <label htmlFor="password">Password</label>
            {/* `new-password` while registering so a password manager offers to generate
                one; `current-password` on sign-in so it autofills the existing one. */}
            <PasswordField
              id="password"
              value={password}
              onChange={setPassword}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              required
            />
            {isRegister && (
              <>
                {/* Optional, and stated as such. Contact details are useful to have but
                    asking for them as a requirement at signup costs conversions, and
                    Google/Apple sign-ins can't supply a phone number anyway — so they can
                    always be added later from the account page. */}
                <label>Mobile number <span className="muted">(optional)</span></label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. 07700 900123"
                  autoComplete="tel"
                />
                <label>Emergency contact name <span className="muted">(optional)</span></label>
                <input
                  value={iceName}
                  onChange={(e) => setIceName(e.target.value)}
                  placeholder="Who should we call in an emergency?"
                />
                <label>Emergency contact number <span className="muted">(optional)</span></label>
                <input
                  type="tel"
                  value={icePhone}
                  onChange={(e) => setIcePhone(e.target.value)}
                  placeholder="e.g. 07700 900456"
                />
              </>
            )}
            {error && <div className="error">{error}</div>}
            <button className="btn" disabled={busy} type="submit" style={{ marginTop: 12 }}>
              {busy ? 'Please wait…' : isRegister ? 'Send verification link' : 'Sign in'}
            </button>
          </form>
          )}

          {/* Only on the sign-in tab: offering a password reset to someone who is part-way
              through creating an account is noise, and the address they've typed doesn't
              have an account yet by definition. */}
          {!isRegister && !sentTo && (
            <p style={{ textAlign: 'center', marginTop: 8 }}>
              <Link className="muted" style={{ fontSize: 13 }} to="/forgot-password">
                Forgotten your password?
              </Link>
            </p>
          )}

          {!sentTo && (
            <button
              className="btn secondary"
              style={{ marginTop: 4 }}
              onClick={() => setIsRegister((v) => !v)}
            >
              {isRegister ? 'Have an account? Sign in' : 'New here? Create an account'}
            </button>
          )}

          <p className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 16 }}>
            A free account is required. You can explore in demo mode (one route) before
            subscribing to your test centre.
          </p>
        </div>
      </section>
    </div>
  );
}
