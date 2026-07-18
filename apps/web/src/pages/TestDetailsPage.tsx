import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { TestCentre, TestDetails } from '../api/types';

// Phase 19b: every user must share their test centre + test date before using
// any test route. Reached when the API returns TEST_DETAILS_REQUIRED, or from
// the account page. On save, returns the user to wherever they came from.
export function TestDetailsPage() {
  const nav = useNavigate();
  const { state } = useLocation() as { state: { returnTo?: string } | null };
  const returnTo = state?.returnTo ?? '/discover';

  const [existing, setExisting] = useState<TestDetails | null>(null);
  const [query, setQuery] = useState('');
  const [centres, setCentres] = useState<TestCentre[]>([]);
  const [selected, setSelected] = useState<TestCentre | null>(null);
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getTestDetails().then(setExisting).catch(() => {});
  }, []);

  // Debounced test-centre search.
  useEffect(() => {
    const t = setTimeout(() => {
      api.testCentres(query).then(setCentres).catch(() => setCentres([]));
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  const today = new Date().toISOString().slice(0, 10);

  async function save() {
    if (!selected || !date) {
      setError('Pick your test centre and enter your test date.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.saveTestDetails(selected.id, date);
      nav(returnTo, { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="page">Your test details</h1>
      <p className="muted" style={{ fontSize: 13 }}>
        Share your test centre and test date to use routes. Everyone provides these — it takes a moment.
      </p>

      {existing?.current && (
        <p className="muted" style={{ fontSize: 13 }}>
          Current: test on <strong>{existing.current.testDate}</strong>. Saving will update it (your history is kept).
        </p>
      )}

      <div className="card">
        <label style={{ fontWeight: 600, fontSize: 14 }}>Test centre</label>
        <input
         
          placeholder="Search by name, town or postcode"
          value={selected ? selected.name : query}
          onChange={(e) => {
            setSelected(null);
            setQuery(e.target.value);
          }}
          style={{ marginTop: 6 }}
        />
        {!selected && centres.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {centres.map((c) => (
              <button
                key={c.id}
                className="btn secondary auto"
                style={{ justifyContent: 'flex-start' }}
                onClick={() => setSelected(c)}
              >
                {c.name}
                {c.town ? ` — ${c.town}` : ''}
                {c.postcode ? ` (${c.postcode})` : ''}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <label style={{ fontWeight: 600, fontSize: 14 }}>Test date</label>
        <input
         
          type="date"
          min={today}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{ marginTop: 6 }}
        />
      </div>

      {error && <div className="error">{error}</div>}

      <button className="btn" disabled={busy} onClick={save} style={{ marginTop: 8 }}>
        {busy ? 'Saving…' : 'Save & continue'}
      </button>
    </>
  );
}
