import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, putToPresigned, DeclaredFile } from '../../api/client';
import { TestCentre } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';

type Phase = 'form' | 'uploading' | 'finalising';

export function UploadPage() {
  const nav = useNavigate();
  const { isStaff } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [testCentreId, setTestCentreId] = useState('');
  const [centres, setCentres] = useState<TestCentre[]>([]);
  const [front, setFront] = useState<File[]>([]);
  const [rear, setRear] = useState<File[]>([]);
  const [gpx, setGpx] = useState<File | null>(null);
  const [agree, setAgree] = useState(false);

  const [phase, setPhase] = useState<Phase>('form');
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  // Every route must belong to a test centre (Phase 20), so load the list to pick from.
  useEffect(() => {
    api.listTestCentres().then(setCentres).catch(() => setCentres([]));
  }, []);

  const canSubmit =
    title.trim().length > 1 &&
    testCentreId !== '' &&
    gpx !== null &&
    front.length > 0 &&
    agree &&
    phase === 'form';

  async function submit() {
    setError(null);
    // ordered list: front clips, rear clips, then gpx — must match target order
    const ordered: { kind: DeclaredFile['kind']; file: File }[] = [
      ...front.map((f) => ({ kind: 'front' as const, file: f })),
      ...rear.map((f) => ({ kind: 'rear' as const, file: f })),
      { kind: 'gpx' as const, file: gpx! },
    ];
    const declared: DeclaredFile[] = ordered.map(({ kind, file }) => ({
      kind,
      originalName: file.name,
      contentType: file.type || (kind === 'gpx' ? 'application/gpx+xml' : 'video/mp4'),
      bytes: file.size,
    }));

    try {
      await api.acceptAgreement(); // idempotent; enforced server-side on init
      setPhase('uploading');
      const { uploadId, targets } = await api.initUpload({
        title: title.trim(),
        description: description.trim() || undefined,
        testCentreId,
        clockSource: 'file_mtime',
        files: declared,
      });

      // upload each file to its presigned URL (sequential keeps mobile connections sane)
      for (let i = 0; i < ordered.length; i++) {
        const { file } = ordered[i];
        const target = targets[i];
        await putToPresigned(target.uploadUrl, file, (pct) =>
          setProgress((p) => ({ ...p, [`${i}`]: pct })),
        );
      }

      setPhase('finalising');
      await api.completeUpload(uploadId);
      nav(`/contribute/uploads/${uploadId}`);
    } catch (e) {
      setError((e as Error).message);
      setPhase('form');
    }
  }

  // Uploading routes is instructor/admin only — normal users are read-only.
  if (!isStaff) {
    return (
      <>
        <button className="btn secondary auto" onClick={() => nav('/contribute')} style={{ marginBottom: 16 }}>
          ← Back
        </button>
        <h1 className="page">Upload a route</h1>
        <div className="card">
          <p>Uploading routes is available to <strong>verified instructors</strong>. Apply with your
            DVSA ADI number and, once an admin approves you, you'll be able to upload.</p>
          <button className="btn" onClick={() => nav('/contribute/instructor')} style={{ marginTop: 8 }}>
            🎓 Become an Instructor
          </button>
        </div>
      </>
    );
  }

  if (phase !== 'form') {
    const items = [...front, ...rear, gpx].filter(Boolean) as File[];
    return (
      <>
        <h1 className="page">Uploading…</h1>
        <div className="card">
          {items.map((f, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13 }}>{f.name}</span>
                <span className="muted" style={{ fontSize: 13 }}>{progress[`${i}`] ?? 0}%</span>
              </div>
              <div style={{ height: 6, background: 'var(--bg-2)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progress[`${i}`] ?? 0}%`, background: 'var(--accent)' }} />
              </div>
            </div>
          ))}
          <div className="muted" style={{ marginTop: 12 }}>
            {phase === 'finalising' ? 'Finalising & queuing for processing…' : 'Uploading securely…'}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <button className="btn secondary auto" onClick={() => nav('/contribute')} style={{ marginBottom: 16 }}>
        ← Back
      </button>
      <h1 className="page">Upload a route</h1>
      {error && <div className="error">{error}</div>}

      <div className="card">
        <label>Route title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Mill Hill morning route" />
        <label>Test centre *</label>
        <select value={testCentreId} onChange={(e) => setTestCentreId(e.target.value)}>
          <option value="">Select the test centre this route belongs to…</option>
          {centres.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.town ? ` — ${c.town}` : ''}
            </option>
          ))}
        </select>
        <label>Description (optional)</label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <FilePicker
        label="Front dashcam clips"
        hint="One or more clips, in order. Required."
        accept="video/*"
        multiple
        onChange={setFront}
        files={front}
      />
      <FilePicker
        label="Rear dashcam clips (optional)"
        hint="One or more clips, in order."
        accept="video/*"
        multiple
        onChange={setRear}
        files={rear}
      />
      <FilePicker
        label="GPX track"
        hint="The GPS track for this drive. Required."
        accept=".gpx,application/gpx+xml"
        onChange={(fs) => setGpx(fs[0] ?? null)}
        files={gpx ? [gpx] : []}
      />

      <div className="card">
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
            style={{ width: 'auto', margin: '4px 0 0' }}
          />
          <span style={{ fontSize: 13 }}>
            I own this footage and accept the contributor footage agreement. Faces and number
            plates will be automatically blurred before publishing.
          </span>
        </label>
      </div>

      <button className="btn" disabled={!canSubmit} onClick={submit}>
        Upload &amp; process
      </button>
    </>
  );
}

function FilePicker({
  label,
  hint,
  accept,
  multiple,
  files,
  onChange,
}: {
  label: string;
  hint: string;
  accept: string;
  multiple?: boolean;
  files: File[];
  onChange: (files: File[]) => void;
}) {
  return (
    <div className="card">
      <div style={{ fontWeight: 600 }}>{label}</div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{hint}</div>
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(e) => onChange(Array.from(e.target.files ?? []))}
      />
      {files.length > 0 && (
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          {files.map((f) => f.name).join(', ')}
        </div>
      )}
    </div>
  );
}
