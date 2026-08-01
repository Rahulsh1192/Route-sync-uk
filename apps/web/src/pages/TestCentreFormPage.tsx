import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { TestCentreInput } from '../api/types';
import { useAuth } from '../auth/AuthContext';

const EMPTY: TestCentreInput = {
  name: '',
  postcode: '',
  town: '',
  region: '',
  address: '',
  description: '',
};

export function TestCentreFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { isStaff } = useAuth();
  const [form, setForm] = useState<TestCentreInput>(EMPTY);
  const [loading, setLoading] = useState(mode === 'edit');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookupState, setLookupState] = useState<'idle' | 'busy' | 'ok' | 'error'>('idle');
  const [lookupNote, setLookupNote] = useState<string | null>(null);

  useEffect(() => {
    if (mode === 'edit' && id) {
      api
        .testCentre(id)
        .then(({ centre }) =>
          setForm({
            name: centre.name,
            postcode: centre.postcode ?? '',
            town: centre.town ?? '',
            region: centre.region ?? '',
            address: centre.address ?? '',
            description: centre.description ?? '',
          }),
        )
        .catch((e) => setError((e as Error).message))
        .finally(() => setLoading(false));
    }
  }, [mode, id]);

  function set<K extends keyof TestCentreInput>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  /**
   * Resolve the postcode and fill in town / region.
   *
   * Runs on blur rather than on every keystroke: a postcode is only meaningful once it's
   * complete, and one request per character would be both useless and rude to a free
   * third-party service.
   *
   * Anything already typed is left alone — a centre's local name ("Mill Hill") is usually
   * not the administrative district the lookup returns ("Barnet"), so the admin's own
   * wording wins and the lookup only fills blanks.
   */
  async function lookup() {
    const pc = form.postcode.trim();
    if (!pc) return;
    setLookupState('busy');
    setLookupNote(null);
    try {
      const found = await api.lookupPostcode(pc);
      setForm((f) => ({
        ...f,
        postcode: found.postcode,
        town: f.town.trim() || found.town || '',
        region: f.region.trim() || found.region || '',
      }));
      setLookupState('ok');
      setLookupNote(
        found.approximate
          ? `Located ${found.postcode} approximately — that's a postcode district, so the pin is its centre. Enter the full postcode for an exact location.`
          : `Located ${found.postcode}${found.town ? ` · ${found.town}` : ''}`,
      );
    } catch (e) {
      setLookupState('error');
      setLookupNote((e as Error).message);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Lat/lng are auto-derived from the postcode server-side (postcodes.io).
      const saved =
        mode === 'create'
          ? await api.createTestCentre(form)
          : await api.updateTestCentre(id!, form);
      nav(`/test-centres/${saved.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!isStaff) return <div className="error">Only instructors and admins can manage test centres.</div>;
  if (loading) return <div className="center"><div className="spinner" /></div>;

  return (
    <>
      <button className="btn secondary auto" onClick={() => nav(-1)} style={{ marginBottom: 16 }}>
        ← Cancel
      </button>
      <h1 className="page">{mode === 'create' ? 'New test centre' : 'Edit test centre'}</h1>

      <form onSubmit={submit} className="card">
        <label>Name *</label>
        <input value={form.name} onChange={(e) => set('name', e.target.value)} required />

        <label>Postcode * (locates the centre and fills in the town and region)</label>
        <input
          value={form.postcode}
          onChange={(e) => set('postcode', e.target.value)}
          onBlur={lookup}
          placeholder="e.g. NW7 1RB"
          required
        />
        {lookupState === 'busy' && (
          <div className="muted" style={{ fontSize: 12, marginTop: -6 }}>Looking up postcode…</div>
        )}
        {lookupNote && (
          <div
            className={lookupState === 'error' ? 'error' : 'muted'}
            style={{ fontSize: 12, marginTop: lookupState === 'error' ? 6 : -6 }}
          >
            {lookupNote}
          </div>
        )}

        <label>City / Town *</label>
        <input
          value={form.town}
          onChange={(e) => set('town', e.target.value)}
          placeholder="Filled in from the postcode — edit if the local name differs"
          required
        />

        <label>Region *</label>
        <input
          value={form.region}
          onChange={(e) => set('region', e.target.value)}
          required
        />

        <label>Address</label>
        <input value={form.address} onChange={(e) => set('address', e.target.value)} />

        <label>Description</label>
        <textarea
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          rows={4}
        />

        {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}

        <button className="btn" type="submit" disabled={busy} style={{ marginTop: 12 }}>
          {busy ? 'Saving…' : mode === 'create' ? 'Create centre' : 'Save changes'}
        </button>
      </form>
    </>
  );
}
