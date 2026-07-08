import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { UploadStatus } from '../../api/types';

const TERMINAL = ['completed', 'failed'];

function stageIcon(state: string): string {
  switch (state) {
    case 'done': return '✅';
    case 'running': return '⏳';
    case 'flagged': return '⚠️';
    case 'failed': return '❌';
    case 'skipped': return '⏭️';
    default: return '⬜';
  }
}

export function UploadStatusPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [status, setStatus] = useState<UploadStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const s = await api.uploadStatus(id!);
        if (stopped) return;
        setStatus(s);
        if (!TERMINAL.includes(s.upload.status)) {
          timer.current = window.setTimeout(poll, 2000);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    }
    poll();
    return () => {
      stopped = true;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [id]);

  const upStatus = status?.upload.status;

  return (
    <>
      <button className="btn secondary auto" onClick={() => nav('/contribute')} style={{ marginBottom: 16 }}>
        ← Back to Contribute
      </button>
      <h1 className="page">Processing your route</h1>

      {error && <div className="error">{error}</div>}

      <div className="card">
        <div className="row">
          <span style={{ fontWeight: 700 }}>Status:</span>
          <span className={`pill ${upStatus === 'completed' ? 'green' : upStatus === 'failed' ? 'amber' : ''}`}>
            {upStatus ?? 'loading…'}
          </span>
          {upStatus && !TERMINAL.includes(upStatus) && <span className="spinner" style={{ width: 18, height: 18 }} />}
        </div>
        {status?.upload.error && <div className="error">{status.upload.error}</div>}
        {upStatus === 'completed' && (
          <div className="muted" style={{ marginTop: 8 }}>
            Processing finished. Your route is now awaiting moderator review before it goes live.
          </div>
        )}
      </div>

      <div className="card">
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>PIPELINE</div>
        {!status && <div className="muted">Waiting for the worker to pick up the job…</div>}
        {status?.stages.length === 0 && (
          <div className="muted">Queued. Stages will appear as the worker processes them.</div>
        )}
        {status?.stages.map((s) => {
          const f = s.findings as Record<string, unknown> | null;
          return (
            <div key={s.stage} className="instr-item" style={{ opacity: 1 }}>
              <span className="ico">{stageIcon(s.state)}</span>
              <span style={{ flex: 1 }}>
                {s.stage.replace(/_/g, ' ')}
                {f && Object.keys(f).length > 0 && (
                  <span className="muted" style={{ fontSize: 11, display: 'block' }}>
                    {summarise(f)}
                  </span>
                )}
              </span>
              <span className="muted" style={{ fontSize: 12 }}>{s.state}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function summarise(f: Record<string, unknown>): string {
  return Object.entries(f)
    .filter(([, v]) => v !== null && typeof v !== 'object')
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ');
}
