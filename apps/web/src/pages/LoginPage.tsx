import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function LoginPage() {
  const { login, register, sessionInvalidated } = useAuth();
  const nav = useNavigate();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [iceName, setIceName] = useState('');
  const [icePhone, setIcePhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isRegister) {
        // Only send fields the user actually filled: the API treats an empty string as
        // "clear this", which is a meaningless instruction on a brand-new account.
        await register(email.trim(), password, name.trim(), {
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(iceName.trim() ? { emergencyContactName: iceName.trim() } : {}),
          ...(icePhone.trim() ? { emergencyContactPhone: icePhone.trim() } : {}),
        });
      } else await login(email.trim(), password);
      // Role-based landing (admins → console, everyone else → Test Centres).
      nav('/');
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

          <form onSubmit={submit} className="card" style={{ marginTop: 16 }}>
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

          <p className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 16 }}>
            A free account is required. You can explore in demo mode (one route) before
            subscribing to your test centre.
          </p>
        </div>
      </section>
    </div>
  );
}
