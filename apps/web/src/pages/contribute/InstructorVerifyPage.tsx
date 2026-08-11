import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { InstructorStatus } from '../../api/types';

/** Mirrors the allow-list the API enforces on badge evidence. */
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];
const MAX_BYTES = 15 * 1024 * 1024;

type EvidenceState =
  | { phase: 'none' }
  | { phase: 'uploading'; name: string; pct: number }
  | { phase: 'ready'; name: string; key: string; previewUrl: string | null }
  | { phase: 'error'; name: string; message: string };

export function InstructorVerifyPage() {
  const nav = useNavigate();
  const [status, setStatus] = useState<InstructorStatus | null>(null);
  const [adi, setAdi] = useState('');
  const [expiry, setExpiry] = useState('');
  const [evidence, setEvidence] = useState('');
  const [photo, setPhoto] = useState<EvidenceState>({ phase: 'none' });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Two inputs over one, because the `capture` attribute is what makes a phone open the
  // camera instead of the file browser — the same input cannot offer both, and a learner
  // photographing their badge and one picking a saved scan are both normal.
  const libraryInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.instructorStatus().then(setStatus).catch(() => {});
  }, []);

  // Object URLs are leaked memory until revoked, and this one lives as long as the preview.
  useEffect(() => {
    const url = photo.phase === 'ready' ? photo.previewUrl : null;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [photo]);

  async function pickFile(file: File | undefined) {
    if (!file) return;
    setError(null);

    // Both checks are enforced server-side too; done here so the answer is instant and no
    // bytes are wasted on an upload that will be refused.
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setPhoto({
        phase: 'error',
        name: file.name,
        message: `${file.type || 'That file type'} isn't accepted — use a JPEG, PNG, WebP, HEIC or PDF.`,
      });
      return;
    }
    if (file.size > MAX_BYTES) {
      setPhoto({
        phase: 'error',
        name: file.name,
        message: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — please keep it under 15 MB.`,
      });
      return;
    }

    setPhoto({ phase: 'uploading', name: file.name, pct: 0 });
    try {
      const { key, uploadUrl, contentType } = await api.badgeEvidenceUpload(file.type, file.size);
      await putWithProgress(uploadUrl, file, contentType, (pct) =>
        setPhoto((p) => (p.phase === 'uploading' ? { ...p, pct } : p)),
      );
      setPhoto({
        phase: 'ready',
        name: file.name,
        key,
        // A PDF has no useful inline preview here, so only images get one.
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      });
    } catch (e) {
      setPhoto({ phase: 'error', name: file.name, message: (e as Error).message });
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.submitInstructor(
        adi.trim(),
        expiry,
        evidence.trim() || undefined,
        photo.phase === 'ready' ? photo.key : undefined,
      );
      setMsg('Submitted — a moderator will review your ADI evidence.');
      setStatus({ instructor_status: 'pending' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const current = status?.instructor_status ?? 'none';
  const uploadBusy = photo.phase === 'uploading';

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

          <label style={{ marginTop: 14 }}>Photo of your badge or certificate</label>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            Take a photo now, or choose one you already have. Stored privately and seen only
            by the moderator reviewing your application.
          </div>

          {/* Hidden inputs driven by the two buttons below — a bare file input cannot be
              labelled clearly enough to explain which one opens the camera. */}
          <input
            ref={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              pickFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <input
            ref={libraryInput}
            type="file"
            accept={ACCEPTED_TYPES.join(',')}
            hidden
            onChange={(e) => {
              pickFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />

          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn secondary auto"
              disabled={uploadBusy}
              onClick={() => cameraInput.current?.click()}
            >
              📷 Take a photo
            </button>
            <button
              type="button"
              className="btn secondary auto"
              disabled={uploadBusy}
              onClick={() => libraryInput.current?.click()}
            >
              🖼️ Choose a file
            </button>
          </div>

          <EvidencePreview state={photo} onClear={() => setPhoto({ phase: 'none' })} />

          <details style={{ marginTop: 14 }}>
            <summary className="muted" style={{ fontSize: 13, cursor: 'pointer' }}>
              Or link to it instead
            </summary>
            <label style={{ marginTop: 8 }}>Evidence URL</label>
            <input
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              placeholder="https://…"
            />
            <div className="muted" style={{ fontSize: 12 }}>
              Only needed if your certificate is already hosted somewhere we can reach.
            </div>
          </details>

          {error && <div className="error">{error}</div>}
          {msg && <div style={{ color: 'var(--green)', fontSize: 14, margin: '8px 0' }}>{msg}</div>}
          <button
            className="btn"
            disabled={busy || uploadBusy || adi.trim().length < 3 || !expiry}
            onClick={submit}
            style={{ marginTop: 10 }}
          >
            {busy ? 'Submitting…' : uploadBusy ? 'Waiting for the photo…' : 'Submit for verification'}
          </button>
        </div>
      )}
    </>
  );
}

function EvidencePreview({ state, onClear }: { state: EvidenceState; onClear: () => void }) {
  if (state.phase === 'none') return null;

  if (state.phase === 'uploading') {
    return (
      <div style={{ marginTop: 10 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13 }}>{state.name}</span>
          <span className="muted" style={{ fontSize: 13 }}>{state.pct}%</span>
        </div>
        <div style={{ height: 6, background: 'var(--bg-2)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${state.pct}%`, background: 'var(--accent)' }} />
        </div>
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div className="error" style={{ marginTop: 10 }}>
        {state.message}
      </div>
    );
  }

  return (
    <div className="row" style={{ marginTop: 10, gap: 10, alignItems: 'center' }}>
      {state.previewUrl ? (
        <img
          src={state.previewUrl}
          alt="Your badge photo, ready to submit"
          style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8 }}
        />
      ) : (
        <span style={{ fontSize: 28 }}>📄</span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}>{state.name}</div>
        <div className="muted" style={{ fontSize: 12, color: 'var(--green)' }}>✓ Attached</div>
      </div>
      <button type="button" className="btn ghost auto" onClick={onClear}>
        Remove
      </button>
    </div>
  );
}

/**
 * PUT a file to a presigned URL, reporting progress.
 *
 * XMLHttpRequest rather than fetch: fetch still has no upload-progress event, and a badge
 * photo taken on a phone over a weak connection is exactly where a stalled-looking button
 * makes someone give up and press it again.
 */
function putWithProgress(
  url: string,
  file: File,
  contentType: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    // Must match the type the URL was signed for, or the storage service rejects it.
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status}). Please try again.`));
    xhr.onerror = () => reject(new Error('Upload failed — check your connection and try again.'));
    xhr.send(file);
  });
}
