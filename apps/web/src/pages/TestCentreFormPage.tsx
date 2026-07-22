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

        <label>Postcode * (used to locate the centre on the map)</label>
        <input
          value={form.postcode}
          onChange={(e) => set('postcode', e.target.value)}
          placeholder="e.g. NW7 1RB"
          required
        />

        <label>City / Town</label>
        <input value={form.town} onChange={(e) => set('town', e.target.value)} />

        <label>Region</label>
        <input value={form.region} onChange={(e) => set('region', e.target.value)} />

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
