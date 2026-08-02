import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { Entitlements } from '../api/types';

/**
 * Where Stripe Checkout sends the browser back to (CHECKOUT_SUCCESS_URL /
 * CHECKOUT_CANCEL_URL).
 *
 * The success case has a race worth understanding. Stripe redirects the browser the moment
 * payment is authorised, but the entitlement is granted by the *webhook* — a separate
 * request from Stripe's servers to our API, which typically lands a second or two later,
 * and occasionally longer. So a page that simply read the subscription state on mount
 * would usually tell a paying customer they aren't Premium. That is the worst possible
 * moment to show a wrong answer.
 *
 * So this polls until the entitlement appears, and if it hasn't within the window, says
 * "payment received, still activating" rather than anything that sounds like failure.
 * Payment is never in doubt at this point — Stripe would not have redirected here
 * otherwise — so the copy never implies it might be.
 */

/** Total wait before falling back to the "still activating" message. */
const MAX_ATTEMPTS = 10;
const INTERVAL_MS = 1500;

function isPremium(ent: Entitlements | null): boolean {
  if (!ent) return false;
  // Any centre unlocked, or a legacy universal grant, counts as active.
  const centres = ent.premiumTestCentreIds;
  if (centres && centres.length > 0) return true;
  return ent.entitlements.multiView;
}

export function BillingSuccessPage() {
  const nav = useNavigate();
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [settled, setSettled] = useState(false);
  // Held in a ref as well as state so the polling effect can read the current value
  // without listing it as a dependency and restarting the timer on every tick.
  const settledRef = useRef(false);

  const check = useCallback(async () => {
    try {
      const next = await api.me();
      setEnt(next);
      if (isPremium(next)) {
        settledRef.current = true;
        setSettled(true);
      }
    } catch {
      // A failed poll is not a failed payment — just try again on the next tick.
    }
  }, []);

  useEffect(() => {
    void check();
    const id = setInterval(() => {
      if (settledRef.current) return clearInterval(id);
      setAttempts((n) => {
        if (n + 1 >= MAX_ATTEMPTS) clearInterval(id);
        return n + 1;
      });
      void check();
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, [check]);

  const stillWaiting = !settled && attempts < MAX_ATTEMPTS;
  const centreCount = ent?.premiumTestCentreIds?.filter((c) => c !== null).length ?? 0;

  return (
    <>
      <h1 className="page">{settled ? 'You’re all set' : 'Payment received'}</h1>

      <div className="card">
        {settled ? (
          <>
            <div className="row">
              <span style={{ fontSize: 28 }}>✅</span>
              <div>
                <div style={{ fontWeight: 700 }}>Premium is active</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {ent?.plan === 'premium_yearly' ? 'Yearly plan' : 'Monthly plan'}
                  {centreCount > 0
                    ? ` · ${centreCount} test centre${centreCount === 1 ? '' : 's'} unlocked`
                    : ''}
                </div>
              </div>
            </div>
            <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
              A receipt is on its way from Stripe. You can cancel anytime from your account.
            </p>
          </>
        ) : stillWaiting ? (
          <>
            <div className="row">
              <div className="spinner" />
              <div>
                <div style={{ fontWeight: 700 }}>Activating your subscription…</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  Your payment went through. We’re just waiting for Stripe to confirm it.
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* The window elapsed without the webhook landing. Deliberately not framed as
                an error: the money was taken, so the only honest message is that it is
                taking longer than usual, plus a way to re-check. */}
            <div className="row">
              <span style={{ fontSize: 28 }}>⏳</span>
              <div>
                <div style={{ fontWeight: 700 }}>Taking longer than usual</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  Your payment was successful — activation just hasn’t come through yet.
                  It usually completes within a minute or two.
                </div>
              </div>
            </div>
            <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
              You have not been charged twice, and there’s nothing to pay again. If it still
              hasn’t activated shortly, contact support with your Stripe receipt and we’ll
              sort it out.
            </p>
            <button
              className="btn"
              style={{ marginTop: 10 }}
              onClick={() => {
                setAttempts(0);
                void check();
              }}
            >
              Check again
            </button>
          </>
        )}
      </div>

      <button className="btn" onClick={() => nav('/test-centres')} style={{ marginTop: 4 }}>
        {settled ? 'Start watching routes' : 'Go to test centres'}
      </button>
      <button className="btn secondary" onClick={() => nav('/account')} style={{ marginTop: 8 }}>
        View my account
      </button>
    </>
  );
}

/**
 * Checkout was abandoned. Nothing was charged — Stripe only takes payment on completion,
 * so the single most useful thing this page can do is say so plainly, then make it easy to
 * either try again or carry on browsing.
 */
export function BillingCancelPage() {
  const nav = useNavigate();

  return (
    <>
      <h1 className="page">Checkout cancelled</h1>

      <div className="card">
        <div className="row">
          <span style={{ fontSize: 28 }}>🛒</span>
          <div>
            <div style={{ fontWeight: 700 }}>No payment was taken</div>
            <div className="muted" style={{ fontSize: 13 }}>
              You closed the payment page before finishing, so nothing was charged and
              nothing has changed on your account.
            </div>
          </div>
        </div>
      </div>

      {/* Which centre they were unlocking was passed to the paywall through router state,
          which does not survive the round trip to Stripe and back — so this sends them to
          the test-centre list to pick it again rather than to a paywall with no centre. */}
      <button className="btn" onClick={() => nav('/test-centres')}>
        Choose a test centre
      </button>
      <button className="btn secondary" onClick={() => nav('/paywall')} style={{ marginTop: 8 }}>
        See Premium plans again
      </button>

      <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
        You can still browse routes and book a lesson without Premium — booking an
        instructor never requires a subscription.
      </p>
    </>
  );
}
