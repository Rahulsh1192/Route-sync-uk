import { useEffect, useState } from 'react';
import { api, Report } from '../api';

export function Reports() {
  const [reports, setReports] = useState<Report[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .reports()
      .then(setReports)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="empty">
        <span className="empty-icon">⏳</span>
        Loading reports…
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

  if (reports.length === 0) {
    return (
      <div className="empty">
        <span className="empty-icon">🎉</span>
        No open reports. All clear!
      </div>
    );
  }

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th scope="col">Target</th>
            <th scope="col">Reason</th>
            <th scope="col">Status</th>
            <th scope="col">Reported</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((r) => (
            <tr key={r.id}>
              <td>
                <span style={{ fontWeight: 'var(--weight-medium)' }}>{r.target_type}</span>
                {' '}
                <code style={{ fontSize: 'var(--text-xs)' }}>{r.target_id.slice(0, 8)}…</code>
              </td>
              <td>{r.reason}</td>
              <td>
                <span className="pill warn">{r.status}</span>
              </td>
              <td className="meta">{new Date(r.created_at).toLocaleDateString('en-GB')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
