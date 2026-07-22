import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { TestCentreDetail } from '../api/types';
import { RouteCard } from '../components/RouteCard';
import { useAuth } from '../auth/AuthContext';

export function TestCentreDetailPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { isStaff } = useAuth();
  const [data, setData] = useState<TestCentreDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.testCentre(id).then(setData).catch((e) => setError((e as Error).message));
  }, [id]);

  async function remove() {
    if (!id || !data) return;
    if (!window.confirm(`Delete "${data.centre.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteTestCentre(id);
      nav('/test-centres');
    } catch (e) {
      setError((e as Error).message);
      setDeleting(false);
    }
  }

  if (error) return <div className="error">{error}</div>;
  if (!data) return <div className="center"><div className="spinner" /></div>;

  const { centre, routes } = data;

  return (
    <>
      <button className="btn secondary auto" onClick={() => nav('/test-centres')} style={{ marginBottom: 16 }}>
        ← All test centres
      </button>

      <div className="row">
        <h1 className="page" style={{ margin: 0 }}>{centre.name}</h1>
        <div className="spacer" />
        {isStaff && (
          <>
            <button className="btn secondary auto" onClick={() => nav(`/test-centres/${centre.id}/edit`)}>
              Edit
            </button>
            <button className="btn secondary auto" onClick={remove} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </>
        )}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        {centre.address && <div style={{ marginBottom: 6 }}>{centre.address}</div>}
        <div className="muted">
          {[centre.town, centre.region, centre.postcode].filter(Boolean).join(' · ') || '—'}
        </div>
        {centre.description && (
          <p style={{ marginBottom: 0, marginTop: 10 }}>{centre.description}</p>
        )}
      </div>

      <h2 style={{ fontSize: 18, margin: '20px 0 12px' }}>
        Routes at this centre ({routes.length})
      </h2>
      {routes.length === 0 ? (
        <div className="empty">
          <p>No published routes for this centre yet.</p>
        </div>
      ) : (
        <div className="grid">
          {routes.map((r) => (
            <RouteCard key={r.id} route={r} />
          ))}
        </div>
      )}
    </>
  );
}
