import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { InstructorStatus } from '../../api/types';

export function InstructorVerifyPage() {
  const nav = useNavigate();
  const [status, setStatus] = useState<InstructorStatus | null>(null);
  const [adi, setAdi] = useState('');
  const [expiry, setExpiry] = useState('');
  const [evidence, setEvidence] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.instructorStatus().then(setStatus).catch(() => {});
  }, []);

  async function submit() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.submitInstructor(adi.trim(), expiry, evidence.trim() || undefined);
      setMsg('Submitted — a moderator will review your ADI evidence.');
      setStatus({ instructor_status: 'pending' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const current = status?.instructor_status ?? 'none';

  return (
    <>
      <button className="btn secondary auto" onClick={() => nav('/contribute')} style={{ marginBottom: 16 }}>
        ← Back
      </button>
      <h1 className="page">Instructor verification</h1>

      <div className="card">
        <div className="row">
          <span className="muted">Current status:</span>
          <span className={`pill ${current === 'verified' ? 'green' : current === 'pending' ? 'amber' : ''}`}>
            {current}
          </span>
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          Verified ADIs receive an instructor badge, a search boost and fast-tracked route approvals.
        </p>
      </div>

      {current === 'verified' ? (
        <div className="card">✅ You are a verified instructor.</div>
      ) : current === 'pending' ? (
        <div className="card">⏳ Your verification is pending review.</div>
      ) : (
        <div className="card">
          <label>DVSA ADI number</label>
          <input value={adi} onChange={(e) => setAdi(e.target.value)} placeholder="e.g. 123456" />
          <label>Badge expiry date *</label>
          <input
            type="date"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            // A badge cannot expire in the past, and the browser enforcing that beats a
            // round-trip to be told so. The API re-checks — this is convenience, not
            // validation.
            min={new Date().toISOString().slice(0, 10)}
            required
          />
          <div className="muted" style={{ fontSize: 12, marginTop: -4 }}>
            The expiry printed on your DVSA ADI certificate. We use it to prompt you to
            re-verify before it lapses.
          </div>

          <label>Evidence URL (badge photo / certificate)</label>
          <input value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="https://…" />
          {error && <div className="error">{error}</div>}
          {msg && <div style={{ color: 'var(--green)', fontSize: 14, margin: '8px 0' }}>{msg}</div>}
          <button
            className="btn"
            disabled={busy || adi.trim().length < 3 || !expiry}
            onClick={submit}
            style={{ marginTop: 10 }}
          >
            {busy ? 'Submitting…' : 'Submit for verification'}
          </button>
        </div>
      )}
    </>
  );
}
