import { useEffect, useState } from 'react';
import { api, Revenue as Rev } from '../api';

export function Revenue() {
  const [rev, setRev] = useState<Rev | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.revenue().then(setRev).catch((e) => setError((e as Error).message));
  }, []);

  if (error) {
    return (
      <div className="error" role="alert">
        <span aria-hidden="true">⚠</span>
        {error}
      </div>
    );
  }

  if (!rev) {
    return (
      <div className="empty">
        <span className="empty-icon">⏳</span>
        Loading revenue data…
      </div>
    );
  }

  return (
    <>
      <div className="grid-stats">
        <div className="stat-card">
          <div className="num">{rev.mrrFormatted}</div>
          <div className="label">Estimated MRR</div>
        </div>
        <div className="stat-card">
          <div className="num">{rev.activeMonthly.toLocaleString()}</div>
          <div className="label">Monthly subscribers (£4.99)</div>
        </div>
        <div className="stat-card">
          <div className="num">{rev.activeYearly.toLocaleString()}</div>
          <div className="label">Yearly subscribers (£29.99)</div>
        </div>
      </div>

      <h2 className="page">Subscriptions by Plan &amp; Status</h2>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th scope="col">Plan</th>
              <th scope="col">Status</th>
              <th scope="col">Count</th>
            </tr>
          </thead>
          <tbody>
            {rev.breakdown.map((b, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 'var(--weight-medium)' }}>{b.plan}</td>
                <td>
                  <span className={`pill ${b.status === 'active' ? 'good' : 'warn'}`}>
                    {b.status}
                  </span>
                </td>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{b._count._all}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="meta" style={{ marginTop: 'var(--space-4)' }}>
        Figures derive from the local subscriptions table. Authoritative revenue comes from
        Stripe + RevenueCat once their webhooks are wired (Phase 7).
      </p>
    </>
  );
}
