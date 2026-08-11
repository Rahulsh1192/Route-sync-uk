import { useCallback, useEffect, useState } from 'react';
import { api, PendingInstructor } from '../api';
import { formatInstantDate } from '../../lib/datetime';

/** Matches the console's nav-badge poll, so the list and the badge never disagree for long. */
const REFRESH_MS = 60_000;

export function Instructors() {
  const [pending, setPending] = useState<PendingInstructor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * `background` distinguishes the interval refresh from the first load: showing the
   * "Loading…" placeholder every minute would blank the table under a moderator who is
   * reading it.
   */
  const load = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    try {
      setPending(await api.pendingInstructors());
      setError(null);
    } catch (e) {
      // A failed background poll must not replace a list that is on screen and still valid.
      if (!background) setError((e as Error).message);
    } finally {
      if (!background) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(timer);
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
            <th scope="col">Badge expiry</th>
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
                {/* Flagged rather than shown raw: an expired badge must not be approved,
                    and submissions predating Phase 26 carry no expiry at all — which is
                    itself something the moderator needs to see, not a blank cell. */}
                {p.adi_expiry ? (
                  <>
                    {formatInstantDate(p.adi_expiry)}
                    {p.adiExpired && <span className="pill bad" style={{ marginLeft: 6 }}>expired</span>}
                  </>
                ) : (
                  <span className="pill warn">not supplied</span>
                )}
              </td>
              <td>
                <EvidenceCell
                  verificationId={p.id}
                  hasFile={p.hasEvidenceFile}
                  url={p.evidence_url}
                  onError={setError}
                />
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

/**
 * The evidence column: an uploaded badge photo, a link the applicant supplied, or neither.
 *
 * An uploaded photo needs a signed URL, fetched only when the moderator asks to see it. The
 * alternative — signing a URL for every row when the table loads — would put a live link to
 * every applicant's identity document into a page that may sit open for an hour, and would
 * sign links for rows nobody looks at.
 */
function EvidenceCell({
  verificationId,
  hasFile,
  url,
  onError,
}: {
  verificationId: string;
  hasFile: boolean;
  url: string | null;
  onError: (message: string) => void;
}) {
  const [opening, setOpening] = useState(false);

  async function openFile() {
    setOpening(true);
    try {
      const { url: signed } = await api.instructorEvidenceUrl(verificationId);
      window.open(signed, '_blank', 'noopener,noreferrer');
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="actions">
      {hasFile && (
        <button className="btn-sm" onClick={openFile} disabled={opening}>
          {opening ? 'Opening…' : '📷 Photo'}
        </button>
      )}
      {url && (
        <a href={url} target="_blank" rel="noreferrer">
          Link ↗
        </a>
      )}
      {!hasFile && !url && <span className="meta">—</span>}
    </div>
  );
}
