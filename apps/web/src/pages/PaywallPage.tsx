import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';

const features = [
  'Unlimited routes for the chosen test centre',
  'Practice mode with UK voice guidance',
  'Multi-view playback (front, rear, split, map)',
  'AI-generated learning summaries',
  'Offline downloads (mobile app)',
  'Verified instructor routes',
];

const bookingNote = 'Booking an instructor does not require Premium — anyone can book a lesson.';

interface PaywallState {
  testCentreId?: string | null;
  centreLabel?: string;
}

export function PaywallPage() {
  const nav = useNavigate();
  const { state } = useLocation() as { state: PaywallState | null };
  const testCentreId = state?.testCentreId ?? undefined;
  const centreLabel = state?.centreLabel;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function checkout(plan: 'premium_monthly' | 'premium_yearly') {
    setBusy(plan);
    setError(null);
    try {
      // Premium is purchased per test centre; unlock the one the user came from.
      const { url } = await api.checkout(plan, testCentreId ?? undefined);
      // Stripe Checkout (web). Redirect the browser to the hosted payment page.
      window.location.href = url;
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <>
      <button className="btn secondary auto" onClick={() => nav(-1)} style={{ marginBottom: 16 }}>
        ← Back
      </button>
      <h1 className="page">
        {centreLabel ? `Unlock ${centreLabel}` : 'RouteSync Premium'}
      </h1>
      <p className="muted" style={{ fontSize: 13, marginBottom: 4 }}>
        Premium is purchased per test centre and is not switchable —
        {centreLabel ? ` this unlocks ${centreLabel}.` : ' you unlock one test centre per subscription.'}
      </p>
      <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>{bookingNote}</p>
      <div className="card">
        {features.map((f) => (
          <div key={f} className="row" style={{ padding: '6px 0' }}>
            <span style={{ color: 'var(--green)' }}>✓</span>
            <span>{f}</span>
          </div>
        ))}
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card">
        <div className="row">
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>Monthly</div>
            <div className="muted">£4.99 / month</div>
          </div>
          <div className="spacer" />
          <button
            className="btn auto"
            disabled={busy !== null}
            onClick={() => checkout('premium_monthly')}
          >
            {busy === 'premium_monthly' ? '…' : 'Choose'}
          </button>
        </div>
      </div>

      <div className="card" style={{ borderColor: 'var(--accent)' }}>
        <div className="row">
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>
              Yearly <span className="pill accent">Best value</span>
            </div>
            <div className="muted">£39.99 / year — save 33%</div>
          </div>
          <div className="spacer" />
          <button
            className="btn auto"
            disabled={busy !== null}
            onClick={() => checkout('premium_yearly')}
          >
            {busy === 'premium_yearly' ? '…' : 'Choose'}
          </button>
        </div>
      </div>

      <p className="muted" style={{ fontSize: 13 }}>
        Payment is processed securely by Stripe. Cancel anytime from your account.
      </p>
    </>
  );
}
