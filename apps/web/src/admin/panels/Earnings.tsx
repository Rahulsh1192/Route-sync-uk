import { useCallback, useEffect, useState } from 'react';
import { api, RevshareRun, RevshareRunDetail, RevshareInstructor } from '../api';

function pounds(minor: number): string {
  return `£${(Number(minor) / 100).toFixed(2)}`;
}
function mins(seconds: number): string {
  return `${Math.round(Number(seconds) / 60).toLocaleString()} min`;
}

/**
 * Instructor rev-share — read-only shadow reporting (Phase 21). The instructor
 * share is 0% at launch, so every accrual is £0 and all revenue stays with the
 * platform; this panel shows the watch-time attribution the engine WOULD pay so
 * the split can be validated before a real share is switched on.
 */
export function Earnings() {
  const [runs, setRuns] = useState<RevshareRun[] | null>(null);
  const [instructors, setInstructors] = useState<RevshareInstructor[] | null>(null);
  const [detail, setDetail] = useState<RevshareRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, i] = await Promise.all([api.revshareRuns(), api.revshareInstructors()]);
      setRuns(r);
      setInstructors(i);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function runNow() {
    setError(null);
    setInfo(null);
    try {
      const res = await api.runRevshare();
      setInfo(res.skipped ? `Run for ${res.period} already exists.` : `Run computed for ${res.period}.`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function openDetail(period: string) {
    setError(null);
    try {
      setDetail(await api.revshareRunDetail(period));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const currentPct = detail?.run.config?.instructorPct;

  return (
    <>
      <p className="meta" style={{ marginBottom: 'var(--space-6)' }}>
        The instructor share is <strong>0% at launch</strong> — instructors contribute routes as a
        social-welfare act and are rewarded by marketing exposure (their profile is shown while
        learners watch, driving bookings). This engine runs monthly in <strong>shadow mode</strong>:
        it records watch-time and computes what each instructor <em>would</em> earn, so a real share
        can be enabled later via the <code>revshare_instructor_pct</code> config alone.
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

      <div className="card">
        <div className="card-head">
          <h3>Monthly attribution run</h3>
          <button className="btn-primary btn-sm" onClick={runNow}>
            Run now
          </button>
        </div>
        <p className="meta" style={{ margin: 0 }}>
          Normally automated on the 1st. "Run now" computes the previous month (idempotent).
        </p>
      </div>

      <h2 className="page" style={{ marginTop: 'var(--space-2)' }}>Runs</h2>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">Gross</th>
              <th scope="col">Instructor pool</th>
              <th scope="col">Platform</th>
              <th scope="col">Status</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {runs?.length === 0 && (
              <tr><td colSpan={6} className="meta">No runs yet — click "Run now" to compute one.</td></tr>
            )}
            {runs?.map((r) => (
              <tr key={r.period}>
                <td style={{ fontWeight: 'var(--weight-medium)' }}>{r.period}</td>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{pounds(r.grossMinor)}</td>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{pounds(r.poolMinor)}</td>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{pounds(r.platformMinor)}</td>
                <td><span className="pill good">{r.status}</span></td>
                <td>
                  <button className="btn-ghost btn-sm" onClick={() => openDetail(r.period)}>
                    View lines
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="card">
          <div className="card-head">
            <h3>
              {detail.run.period} — watch-time attribution
              {currentPct != null && <span className="meta"> · share {currentPct}%</span>}
            </h3>
            <button className="btn-ghost btn-sm" onClick={() => setDetail(null)}>Close</button>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th scope="col">Instructor</th>
                  <th scope="col">Test centre</th>
                  <th scope="col">Watch-time</th>
                  <th scope="col">Share</th>
                  <th scope="col">Would earn</th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.length === 0 && (
                  <tr><td colSpan={5} className="meta">No qualifying watch-time this period.</td></tr>
                )}
                {detail.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.instructorName ?? l.instructorId.slice(0, 8)}</td>
                    <td className="meta">{l.testCentreName ?? '—'}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{mins(l.watchSeconds)}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{Number(l.sharePct).toFixed(1)}%</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 'var(--weight-medium)' }}>
                      {pounds(l.amountMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <h2 className="page">Instructor balances</h2>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th scope="col">Instructor</th>
              <th scope="col">Accrued</th>
              <th scope="col">Paid</th>
              <th scope="col">Balance</th>
            </tr>
          </thead>
          <tbody>
            {instructors?.length === 0 && (
              <tr><td colSpan={4} className="meta">No accruals yet (share is 0% at launch).</td></tr>
            )}
            {instructors?.map((it) => (
              <tr key={it.instructorId}>
                <td>{it.instructorName ?? it.instructorId.slice(0, 8)}</td>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{pounds(it.accruedMinor)}</td>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{pounds(it.paidMinor)}</td>
                <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 'var(--weight-medium)' }}>
                  {pounds(it.balanceMinor)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
