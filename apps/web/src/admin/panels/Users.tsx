import { useCallback, useEffect, useState } from 'react';
import { api, AdminUser } from '../api';

const ROLES = ['user', 'contributor', 'instructor', 'moderator', 'admin'];

export function Users() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (query: string) => {
    try {
      setUsers(await api.users(query || undefined));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load('');
  }, [load]);

  async function changeRole(id: string, role: string) {
    try {
      await api.updateUser(id, { role });
      await load(q);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function toggleSuspend(u: AdminUser) {
    try {
      await api.updateUser(u.id, { isSuspended: !u.isSuspended });
      await load(q);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <div className="toolbar">
        <div className="search-wrap">
          <svg className="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            type="search"
            placeholder="Search by name, email or phone…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load(q)}
            aria-label="Search users"
          />
        </div>
        <button className="btn-primary btn-sm" onClick={() => load(q)}>
          Search
        </button>
      </div>

      {error && (
        <div className="error" role="alert">
          <span aria-hidden="true">⚠</span>
          {error}
        </div>
      )}

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Contact</th>
              <th scope="col">Role</th>
              <th scope="col">Status</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td style={{ fontWeight: 'var(--weight-medium)' }}>{u.displayName}</td>
                <td className="meta">{u.email ?? '—'}</td>
                <td className="meta">
                  {u.phone ? (
                    // tel: link so a staff member on a laptop with a softphone, or on a
                    // tablet, can dial straight from the table.
                    <a href={`tel:${u.phone.replace(/\s+/g, '')}`}>{u.phone}</a>
                  ) : (
                    '—'
                  )}
                  {u.emergencyContactPhone && (
                    <div style={{ fontSize: 11, opacity: 0.75 }}>
                      ICE: {u.emergencyContactName ?? 'contact'} ·{' '}
                      <a href={`tel:${u.emergencyContactPhone.replace(/\s+/g, '')}`}>
                        {u.emergencyContactPhone}
                      </a>
                    </div>
                  )}
                </td>
                <td>
                  <select
                    value={u.role}
                    onChange={(e) => changeRole(u.id, e.target.value)}
                    aria-label={`Role for ${u.displayName}`}
                    style={{ width: 'auto' }}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </td>
                <td>
                  {u.isSuspended
                    ? <span className="pill warn">Suspended</span>
                    : <span className="pill good">Active</span>
                  }
                </td>
                <td>
                  <button
                    className="btn-ghost btn-sm"
                    onClick={() => toggleSuspend(u)}
                    aria-label={`${u.isSuspended ? 'Reinstate' : 'Suspend'} ${u.displayName}`}
                  >
                    {u.isSuspended ? 'Reinstate' : 'Suspend'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
