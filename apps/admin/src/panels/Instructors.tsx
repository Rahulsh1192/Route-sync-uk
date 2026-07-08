import { useCallback, useEffect, useState } from 'react';
import { api, PendingInstructor } from '../api';

export function Instructors() {
  const [pending, setPending] = useState<PendingInstructor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPending(await api.pendingInstructors());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(id: string, decision: 'verified' | 'rejected') {
    const notes = decision === 'rejected' ? window.prompt('Reason (optional):') ?? undefined : undefined;
    try {
      await api.verifyInstructor(id, decision, notes);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (loading) {
    return (
      <div className="empty">
        <span className="empty-icon">⏳</span>
        Loading instructor applications…
      </div>
    );
  }

  if (error) {
    return (
      <div className="error" role="alert">
        <span aria-hidden="true">⚠</span>
        {error}
      </div>
    );
  }

  if (pending.length === 0) {
    return (
      <div className="empty">
        <span className="empty-icon">✓</span>
        No pending instructor verifications.
      </div>
    );
  }

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">ADI Number</th>
            <th scope="col">Evidence</th>
            <th scope="col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {pending.map((p) => (
            <tr key={p.id}>
              <td style={{ fontWeight: 'var(--weight-medium)' }}>{p.display_name}</td>
              <td className="meta">{p.email ?? '—'}</td>
              <td>
                <code style={{ fontSize: 'var(--text-xs)' }}>{p.adi_number}</code>
              </td>
              <td>
                {p.evidence_url ? (
                  <a href={p.evidence_url} target="_blank" rel="noreferrer">
                    View ↗
                  </a>
                ) : (
                  <span className="meta">—</span>
                )}
              </td>
              <td>
                <div className="actions">
                  <button
                    className="btn-approve btn-sm"
                    onClick={() => decide(p.id, 'verified')}
                    aria-label={`Verify ${p.display_name}`}
                  >
                    Verify
                  </button>
                  <button
                    className="btn-reject btn-sm"
                    onClick={() => decide(p.id, 'rejected')}
                    aria-label={`Reject ${p.display_name}`}
                  >
                    Reject
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
