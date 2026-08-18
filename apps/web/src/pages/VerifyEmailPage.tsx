import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';

/**
 * Where a verification email lands (`APP_BASE_URL/verify-email?token=…`).
 *
 * Public: the token in the URL *is* the credential, so requiring a session here would
 * break the common case of opening the link on a phone that isn't signed in.
 *
 * The redemption fires once, guarded by a ref rather than by an empty dependency array
 * alone. React 18's StrictMode runs effects twice in development, and the second run
 * would spend a single-use token against a request whose result is thrown away — the
 * user would then see "this link has already been used" for a link they clicked once.
 */
type State = 'working' | 'done' | 'failed';

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const token = params.get('token');
  const [state, setState] = useState<State>('working');
  const [message, setMessage] = useState('');
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    if (!token) {
      setState('failed');
      setMessage('This link is missing its token. Try copying it from the email again.');
      return;
    }

    api
      .verifyEmail(token)
      .then(() => setState('done'))
      .catch((e: unknown) => {
        setState('failed');
        setMessage(
          e instanceof Error && e.message
            ? e.message
            : 'This link is invalid or has expired.',
        );
      });
  }, [token]);

  /**
   * Send the user on to sign in once the address is confirmed.
   *
   * Delayed rather than immediate so the confirmation is actually readable, and `replace` so
   * the Back button doesn't return to a page whose single-use token has already been spent.
   * The button below does the same thing for anyone who would rather not wait.
   */
  useEffect(() => {
    if (state !== 'done') return;
    const timer = setTimeout(() => nav('/login?verified=1', { replace: true }), 3000);
    return () => clearTimeout(timer);
  }, [state, nav]);

  return (
    <main className="center">
      <div className="card" style={{ maxWidth: 420, width: '100%' }}>
        {state === 'working' && (
          <>
            <h1>Confirming your email…</h1>
            <p className="muted">One moment.</p>
          </>
        )}

        {state === 'done' && (
          <>
            <h1>Email confirmed</h1>
            <p className="muted">
              Thanks — your address is verified. Sign in to continue; we&apos;ll take you there
              in a moment.
            </p>
            <Link className="btn" to="/login?verified=1">
              Continue to sign in
            </Link>
          </>
        )}

        {state === 'failed' && (
          <>
            <h1>That link didn’t work</h1>
            <p className="muted">{message}</p>
            {/* Verification links are single-use and expire after 24 hours, and a mail
                scanner following the link first is a common cause. An unconfirmed account
                cannot sign in, so the account page is out of reach: the way to a fresh link
                is to start signing up again with the same details. */}
            <p className="muted">
              Links expire after 24 hours and can only be used once. Start creating your
              account again with the same email and password to get a fresh one.
            </p>
            <Link className="btn" to="/login">
              Go to sign in
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
