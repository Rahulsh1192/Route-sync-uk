import { useCallback, useEffect, useState, FormEvent } from 'react';
import { api, FundSummary } from '../api';
import { formatInstantDate } from '../../lib/datetime';

function pounds(minor: string | number): string {
  return `£${(Number(minor) / 100).toFixed(2)}`;
}

export function Fund() {
  const [data, setData] = useState<FundSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // beneficiary form
  const [bName, setBName] = useState('');
  const [bDesc, setBDesc] = useState('');
  // payout form
  const [payTo, setPayTo] = useState('');
  const [payAmount, setPayAmount] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api.fundSummary());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function run<T>(fn: () => Promise<T>, msg?: string) {
    setError(null);
    setInfo(null);
    try {
      await fn();
      if (msg) setInfo(msg);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function addBeneficiary(e: FormEvent) {
    e.preventDefault();
    if (!bName.trim()) return;
    await run(() => api.addBeneficiary(bName.trim(), bDesc.trim() || undefined), 'Beneficiary added');
    setBName('');
    setBDesc('');
  }

  async function payout(e: FormEvent) {
    e.preventDefault();
    const minor = Math.round(parseFloat(payAmount) * 100);
    if (!payTo || !minor || minor < 1) {
      setError('Select a beneficiary and a valid amount');
      return;
    }
    await run(() => api.fundPayout(payTo, minor), 'Payout recorded');
    setPayAmount('');
  }

  return (
    <>
      <p className="meta" style={{ marginBottom: 'var(--space-6)' }}>
        {data
          ? `${data.allocationPct}% of net profit (after an assumed ${Math.round(data.costRatio * 100)}% cost of revenue)`
          : '10% of net profit'}{' '}
        is contributed to the Instructor Community Fund. This ledger is the transparent record
        shown publicly via <code>/api/fund/summary</code>.
      </p>

      {error && (
        <div className="error" role="alert">
          <span aria-hidden="true">⚠</span>
          {error}
        </div>
      )}
      {info && (
        <div className="info" role="status">
          <span aria-hidden="true">✓</span>
          {info}
        </div>
      )}

      <div className="grid-stats">
        <div className="stat-card">
          <div className="num">{data ? pounds(data.contributedMinor) : '—'}</div>
          <div className="label">Total Contributed</div>
        </div>
        <div className="stat-card">
          <div className="num">{data ? pounds(data.paidOutMinor) : '—'}</div>
          <div className="label">Total Paid Out</div>
        </div>
        <div className="stat-card">
          <div className="num">{data ? pounds(data.balanceMinor) : '—'}</div>
          <div className="label">Balance</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Monthly Contribution</h3>
          <button
            className="btn-primary btn-sm"
            onClick={() => run(() => api.runFundContribution(), 'Contribution run')}
          >
            Run now
          </button>
        </div>
        <p className="meta" style={{ margin: 0 }}>
          Normally automated on the 1st of each month. "Run now" records the contribution for the
          month just ended (idempotent).
        </p>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 'var(--space-4)' }}>Beneficiaries</h3>
        <form
          onSubmit={addBeneficiary}
          style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}
        >
          <input
            type="text"
            placeholder="Name"
            value={bName}
            onChange={(e) => setBName(e.target.value)}
            style={{ flex: '0 0 160px' }}
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={bDesc}
            onChange={(e) => setBDesc(e.target.value)}
            style={{ flex: 1, minWidth: 160 }}
          />
          <button className="btn-primary btn-sm" type="submit" style={{ flexShrink: 0 }}>
            Add
          </button>
        </form>

        {data && data.beneficiaries.length === 0 && (
          <p className="meta">No beneficiaries yet.</p>
        )}
        {data && data.beneficiaries.length > 0 && (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Description</th>
                </tr>
              </thead>
              <tbody>
                {data.beneficiaries.map((b) => (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 'var(--weight-medium)' }}>{b.name}</td>
                    <td className="meta">{b.description ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 'var(--space-4)' }}>Record a Payout</h3>
        <form
          onSubmit={payout}
          style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'flex-end' }}
        >
          <div className="form-group" style={{ flex: '1', minWidth: 160, marginBottom: 0 }}>
            <label className="form-label" htmlFor="payout-beneficiary">Beneficiary</label>
            <select
              id="payout-beneficiary"
              value={payTo}
              onChange={(e) => setPayTo(e.target.value)}
            >
              <option value="">Select beneficiary…</option>
              {data?.beneficiaries.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ flex: '0 0 140px', marginBottom: 0 }}>
            <label className="form-label" htmlFor="payout-amount">Amount (£)</label>
            <input
              id="payout-amount"
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
            />
          </div>
          <button className="btn-primary btn-sm" type="submit" style={{ alignSelf: 'flex-end', marginBottom: '1px' }}>
            Pay out
          </button>
        </form>
      </div>

      <h2 className="page" style={{ marginTop: 'var(--space-2)' }}>Recent Transactions</h2>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th scope="col">Type</th>
              <th scope="col">Amount</th>
              <th scope="col">Period</th>
              <th scope="col">Description</th>
              <th scope="col">Date</th>
            </tr>
          </thead>
          <tbody>
            {data?.recent.map((t, i) => (
              <tr key={i}>
                <td>
                  <span className={`pill ${t.entry_type === 'contribution' ? 'good' : 'instructor'}`}>
                    {t.entry_type}
                  </span>
                </td>
                <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 'var(--weight-medium)' }}>
                  {pounds(t.amount_minor)}
                </td>
                <td className="meta">{t.period ?? '—'}</td>
                <td className="meta">{t.description ?? '—'}</td>
                <td className="meta">{formatInstantDate(t.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
