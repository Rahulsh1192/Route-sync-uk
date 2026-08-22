import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, DeclaredFile, GpsSource } from '../../api/client';
import { sha256File, uploadFileForTarget } from '../../upload/directUpload';
import { VIDEO_ACCEPT, VIDEO_FORMATS_LABEL, uploadContentType } from '../../upload/videoTypes';
import { RecordedJourney, ReferenceRoute, TestCentre } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import {
  AnalysedClip,
  analyseClips,
  buildPreview,
  fmtClock,
  fmtDuration,
  moveClip,
} from '../../upload/clipAnalysis';

/**
 * Dashcam upload wizard (Phase 24).
 *
 * Four steps, in this order for a reason:
 *
 *   1. Recording  — how the GPS was captured decides everything downstream, so it's
 *                   asked first rather than inferred from what files turn up.
 *   2. Files      — several front clips, several rear clips, several GPS logs.
 *   3. Review     — the detected clip order, the gaps between clips, and the video↔GPS
 *                   duration reconciliation, all confirmable before a byte is uploaded.
 *   4. Upload     — per-file progress, then the pipeline.
 *
 * Step 3 is the one that earns its keep. Twenty minutes of dashcam footage is a slow
 * upload and a slow transcode; discovering afterwards that clip 3 was out of order, or
 * that the GPS log is from a different drive, wastes both. Confirming the timeline first
 * turns a re-upload into a click.
 */

type Step = 1 | 2 | 3 | 4;
// 'hashing' is a distinct phase because on a multi-GB file it takes long enough that a
// generic "uploading…" spinner would look stuck while nothing appeared to transfer.
type Phase = 'form' | 'hashing' | 'uploading' | 'finalising';

const GPS_SOURCE_LABEL: Record<GpsSource, string> = {
  camera: 'My dashcam recorded GPS to separate log files',
  embedded: 'GPS is embedded inside the video files',
  app_journey: 'I recorded the GPS in the Test Routify app',
};

const GPS_SOURCE_HINT: Record<GpsSource, string> = {
  camera:
    'Most GPS dashcams write .gpx / .nmea / .gps / .csv logs alongside the video. Upload them all — we merge them in timestamp order.',
  embedded:
    'Some cameras mux GPS into the MP4 itself. This is the most accurate option: the position and the frames share one clock, so sync is exact.',
  app_journey:
    'For a dashcam with no GPS. Pick the drive you recorded in the app and we align the footage to it.',
};

export function UploadPage() {
  const nav = useNavigate();
  const { isStaff } = useAuth();

  const [step, setStep] = useState<Step>(1);
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState<string | null>(null);

  // --- step 1: recording setup
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [testCentreId, setTestCentreId] = useState('');
  const [centres, setCentres] = useState<TestCentre[]>([]);
  const [gpsSource, setGpsSource] = useState<GpsSource>('camera');
  const [referenceRouteId, setReferenceRouteId] = useState('');
  const [refRoutes, setRefRoutes] = useState<ReferenceRoute[]>([]);
  const [journeyId, setJourneyId] = useState('');
  const [journeys, setJourneys] = useState<RecordedJourney[]>([]);

  // --- step 2: files
  const [frontFiles, setFrontFiles] = useState<File[]>([]);
  const [rearFiles, setRearFiles] = useState<File[]>([]);
  const [gpsFiles, setGpsFiles] = useState<File[]>([]);

  // --- step 3: review
  const [frontClips, setFrontClips] = useState<AnalysedClip[]>([]);
  const [rearClips, setRearClips] = useState<AnalysedClip[]>([]);
  const [analysing, setAnalysing] = useState(false);
  const [clockOffsetHours, setClockOffsetHours] = useState(0);
  const [agree, setAgree] = useState(false);

  // --- step 4: upload
  const [progress, setProgress] = useState<Record<string, number>>({});
  // Hashing progress is tracked separately from transfer progress so one bar can't jump
  // backwards when the phase changes from hashing to uploading.
  const [hashProgress, setHashProgress] = useState<Record<string, number>>({});
  /** Files that were already held server-side and so were never transferred. */
  const [deduped, setDeduped] = useState<string[]>([]);

  useEffect(() => {
    api.listTestCentres().then(setCentres).catch(() => setCentres([]));
    api.myJourneys().then(setJourneys).catch(() => setJourneys([]));
  }, []);

  // R1s are scoped to the chosen centre — an instructor should only be offered the
  // reference routes that could plausibly match the drive they filmed.
  useEffect(() => {
    if (!testCentreId) {
      setRefRoutes([]);
      return;
    }
    api
      .listReferenceRoutes(testCentreId)
      .then(setRefRoutes)
      .catch(() => setRefRoutes([]));
    setReferenceRouteId('');
  }, [testCentreId]);

  const frontPreview = useMemo(() => buildPreview(frontClips), [frontClips]);
  const rearPreview = useMemo(() => buildPreview(rearClips), [rearClips]);

  const selectedJourney = journeys.find((j) => j.id === journeyId) ?? null;

  /**
   * Duration reconciliation, previewed client-side for UC2 where we know the GPS span
   * from the recorded journey. For the camera/embedded sources the GPS timing only
   * becomes known once the logs are parsed server-side, so the server reports it.
   */
  const reconciliation = useMemo(() => {
    if (gpsSource !== 'app_journey' || !selectedJourney?.durationMs) return null;
    const videoMs = frontPreview.totalWallMs;
    if (!videoMs) return null;
    const gpsMs = selectedJourney.durationMs;
    const pct = Math.min(100, Math.round((Math.min(videoMs, gpsMs) / videoMs) * 100));
    return { videoMs, gpsMs, pct, ok: pct >= 95 };
  }, [gpsSource, selectedJourney, frontPreview.totalWallMs]);

  const step1Valid =
    title.trim().length > 1 &&
    testCentreId !== '' &&
    (gpsSource !== 'app_journey' || journeyId !== '');

  const step2Valid =
    frontFiles.length > 0 && (gpsSource !== 'camera' || gpsFiles.length > 0);

  async function goToReview() {
    setAnalysing(true);
    setError(null);
    try {
      const [f, r] = await Promise.all([analyseClips(frontFiles), analyseClips(rearFiles)]);
      setFrontClips(buildPreview(f).clips);
      setRearClips(buildPreview(r).clips);
      setStep(3);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAnalysing(false);
    }
  }

  async function submit() {
    setError(null);

    // The declared order here IS the confirmed order — the reviewer either accepted the
    // detected sequence or corrected it, and `declaredOrdinal` carries that decision to
    // the worker so it doesn't re-guess from metadata.
    const ordered: { kind: DeclaredFile['kind']; file: File; ordinal: number; clip?: AnalysedClip }[] = [
      ...frontClips.map((c, i) => ({ kind: 'front' as const, file: c.file, ordinal: i, clip: c })),
      ...rearClips.map((c, i) => ({ kind: 'rear' as const, file: c.file, ordinal: i, clip: c })),
      ...gpsFiles.map((file, i) => ({ kind: 'gps' as const, file, ordinal: i })),
    ];

    const declared: DeclaredFile[] = ordered.map(({ kind, file, ordinal, clip }) => ({
      kind,
      originalName: file.name,
      // Decided from the extension first, because `file.type` is looked up from an OS
      // table keyed on that extension and is routinely wrong. The PUT sends this same
      // value — the presigned URL is signed over it.
      contentType: uploadContentType(file),
      bytes: file.size,
      declaredOrdinal: ordinal,
      ...(clip
        ? {
            clientStartEpochMs: clip.startEpochMs,
            clientDurationMs: clip.durationMs || undefined,
          }
        : {}),
    }));

    let startedUploadId: string | null = null;
    try {
      await api.acceptAgreement(); // idempotent; enforced server-side on init
      setPhase('hashing');
      setStep(4);

      // Phase 25: hash every file BEFORE asking for upload URLs. The point of the hash
      // is to let the server say "we already hold these bytes" and skip the transfer, so
      // it has to be computed first — hashing after uploading would save nothing. It
      // costs one local read of each file, which is cheap next to sending several GB.
      for (let i = 0; i < ordered.length; i++) {
        const digest = await sha256File(ordered[i].file, (pct) =>
          setHashProgress((p) => ({ ...p, [`${i}`]: pct })),
        );
        declared[i].sha256 = digest;
      }

      setPhase('uploading');

      const { uploadId, targets } = await api.initUpload({
        title: title.trim(),
        description: description.trim() || undefined,
        testCentreId,
        gpsSource,
        journeyId: gpsSource === 'app_journey' ? journeyId : undefined,
        referenceRouteId: referenceRouteId || undefined,
        cameraClockOffsetMs: Math.round(clockOffsetHours * 3_600_000),
        clockSource: gpsSource === 'embedded' ? 'camera_gps' : 'gps',
        timelineReviewed: true,
        files: declared,
      });
      startedUploadId = uploadId;

      // Files go one at a time, but a large file's own parts go in parallel inside
      // `uploadFileForTarget`. That combination keeps the progress list meaningful while
      // still saturating the uplink on the clips big enough to need it.
      const saved: string[] = [];
      for (let i = 0; i < ordered.length; i++) {
        const result = await uploadFileForTarget(uploadId, targets[i], ordered[i].file, (p) =>
          setProgress((prev) => ({ ...prev, [`${i}`]: p.pct })),
        );
        if (result.deduplicated) {
          saved.push(ordered[i].file.name);
          setProgress((prev) => ({ ...prev, [`${i}`]: 100 }));
        }
      }
      setDeduped(saved);

      setPhase('finalising');
      await api.completeUpload(uploadId);
      nav(`/contribute/uploads/${uploadId}`);
    } catch (e) {
      setError((e as Error).message);
      setPhase('form');
      setStep(3);
      // Release whatever already reached the bucket rather than leaving it for the
      // nightly orphan sweep. Best-effort: a failed cleanup must not mask the real error
      // the user needs to see.
      if (startedUploadId) {
        try {
          await api.abortUpload(startedUploadId);
        } catch {
          /* the nightly sweep will catch it */
        }
      }
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

  return (
    <>
      <button
        className="btn secondary auto"
        onClick={() => (step === 1 || step === 4 ? nav('/contribute') : setStep((step - 1) as Step))}
        style={{ marginBottom: 16 }}
        disabled={phase !== 'form'}
      >
        ← Back
      </button>

      <h1 className="page">Upload a route</h1>
      <StepBar step={step} />
      {error && <div className="error">{error}</div>}

      {/* ---------------- Step 1: recording setup ---------------- */}
      {step === 1 && (
        <>
          <div className="card">
            <label>Route title *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Mill Hill morning route"
            />
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

          <div className="card">
            <div style={{ fontWeight: 600, marginBottom: 4 }}>How was the GPS recorded? *</div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
              This decides how we line the video up with the map.
            </div>
            {(Object.keys(GPS_SOURCE_LABEL) as GpsSource[]).map((src) => (
              <label key={src} className="radio-row">
                <input
                  type="radio"
                  name="gpsSource"
                  checked={gpsSource === src}
                  onChange={() => setGpsSource(src)}
                />
                <span>
                  <strong>{GPS_SOURCE_LABEL[src]}</strong>
                  <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                    {GPS_SOURCE_HINT[src]}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {gpsSource === 'app_journey' && (
            <div className="card">
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Which recorded drive? *</div>
              {journeys.length === 0 ? (
                // Previously this told the instructor to "record one in the app first" with
                // no way to do that anywhere — there was no recorder. Now it links to one.
                <>
                  <p className="muted" style={{ fontSize: 13, margin: '0 0 8px' }}>
                    You have no recorded drives yet. Record the GPS while you drive the route,
                    then come back and attach the footage to it.
                  </p>
                  <button
                    type="button"
                    className="btn secondary auto"
                    onClick={() => nav('/contribute/record')}
                  >
                    📍 Record a drive
                  </button>
                </>
              ) : (
                <select value={journeyId} onChange={(e) => setJourneyId(e.target.value)}>
                  <option value="">Select the drive this footage belongs to…</option>
                  {journeys.map((j) => (
                    <option key={j.id} value={j.id} disabled={!j.attachable}>
                      {fmtClock(j.startedAtEpochMs ?? Date.parse(j.startedAt))}
                      {j.referenceRouteName ? ` · ${j.referenceRouteName}` : ''}
                      {j.durationMs ? ` · ${fmtDuration(j.durationMs)}` : ''}
                      {!j.attachable
                        ? j.uploadId
                          ? ' — video already attached'
                          : ' — no GPS track'
                        : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          <div className="card">
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              Reference route (R1){gpsSource === 'app_journey' ? '' : ' *'}
            </div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              We check your drive against the examiner's canonical route: the GPS has to
              match it before the video can be published.
            </div>
            {!testCentreId ? (
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                Choose a test centre first.
              </p>
            ) : refRoutes.length === 0 ? (
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                No reference routes exist for this centre yet.
              </p>
            ) : (
              <select
                value={referenceRouteId}
                onChange={(e) => setReferenceRouteId(e.target.value)}
              >
                <option value="">
                  {gpsSource === 'app_journey'
                    ? 'Use the one from the recorded drive'
                    : 'Select the route you drove…'}
                </option>
                {refRoutes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.lengthM ? ` — ${(r.lengthM / 1609.34).toFixed(1)} miles` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          <button className="btn" disabled={!step1Valid} onClick={() => setStep(2)}>
            Next: choose files
          </button>
        </>
      )}

      {/* ---------------- Step 2: files ---------------- */}
      {step === 2 && (
        <>
          <FilePicker
            label="Front camera clips *"
            hint={`All the clips from this drive. Order doesn't matter — we read the time from each file. ${VIDEO_FORMATS_LABEL}.`}
            // Extensions, not `video/*`: that wildcard matches on the same unreliable
            // `File.type`, so it both hid files we accept and offered files we reject.
            accept={VIDEO_ACCEPT}
            multiple
            files={frontFiles}
            onChange={setFrontFiles}
          />
          <FilePicker
            label="Rear camera clips (optional)"
            hint="If your camera records both views. We align the rear to the front by its audio."
            accept={VIDEO_ACCEPT}
            multiple
            files={rearFiles}
            onChange={setRearFiles}
          />
          {/* Always shown, not just for `camera`. It used to appear only after the "my
              dashcam wrote separate log files" radio was chosen at step 1, which made GPX
              and KML upload look absent — it was reported from testing as "no option to
              upload GPX/KML files" when the option existed but was conditionally hidden.
              Required for `camera`, accepted as a bonus for the other two: a GPS log is
              never unwelcome, and someone who has one should not have to go back a step and
              change an unrelated answer to attach it. */}
          <FilePicker
            label={`GPS log files${gpsSource === 'camera' ? ' *' : ' (optional)'}`}
            hint={
              gpsSource === 'camera'
                ? 'Every log for this drive: .gpx, .nmea, .gps, .log, .csv or .kml. Several files is normal — we merge them.'
                : gpsSource === 'embedded'
                  ? "Not needed — we'll read positions from the video itself. Attach .gpx / .kml logs anyway if you have them and we'll use them to cross-check."
                  : "Not needed — we'll use the drive you recorded in the app. Attach .gpx / .kml logs anyway if you also have them."
            }
            accept=".gpx,.nmea,.gps,.log,.csv,.tsv,.kml,application/gpx+xml,application/vnd.google-earth.kml+xml,text/plain,text/csv"
            multiple
            files={gpsFiles}
            onChange={setGpsFiles}
          />

          <button className="btn" disabled={!step2Valid || analysing} onClick={goToReview}>
            {analysing ? 'Reading clip details…' : 'Next: review the timeline'}
          </button>
        </>
      )}

      {/* ---------------- Step 3: review ---------------- */}
      {step === 3 && (
        <>
          <ClipReview
            title="Front camera"
            preview={frontPreview}
            onMove={(from, to) => setFrontClips((c) => moveClip(c, from, to))}
          />
          {rearClips.length > 0 && (
            <ClipReview
              title="Rear camera"
              preview={rearPreview}
              onMove={(from, to) => setRearClips((c) => moveClip(c, from, to))}
            />
          )}

          {gpsFiles.length > 0 && (
            <div className="card">
              <div style={{ fontWeight: 600, marginBottom: 6 }}>
                GPS logs ({gpsFiles.length})
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                {gpsFiles.map((f) => f.name).join(', ')}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                These are merged in timestamp order and de-duplicated where they overlap.
                We'll report the exact coverage once they're parsed.
              </div>
            </div>
          )}

          {reconciliation && (
            <div className="card">
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Video vs GPS</div>
              <div className="row" style={{ gap: 20 }}>
                <Stat label="Video spans" value={fmtDuration(reconciliation.videoMs)} />
                <Stat label="GPS spans" value={fmtDuration(reconciliation.gpsMs)} />
                <Stat
                  label="Covered"
                  value={`${reconciliation.pct}%`}
                  tone={reconciliation.ok ? 'good' : 'warn'}
                />
              </div>
              {!reconciliation.ok && (
                <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
                  Part of the video has no GPS behind it, so the map marker will stop
                  there. Check you picked the right drive.
                </p>
              )}
            </div>
          )}

          <div className="card">
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Camera clock correction</div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              Only needed if your camera's clock is set to the wrong timezone or was never
              set. Leave at 0 — we detect whole-hour errors automatically and correct them.
            </div>
            <select
              value={clockOffsetHours}
              onChange={(e) => setClockOffsetHours(Number(e.target.value))}
            >
              {[-3, -2, -1, 0, 1, 2, 3].map((h) => (
                <option key={h} value={h}>
                  {h === 0 ? 'No correction' : `${h > 0 ? '+' : ''}${h} hour${Math.abs(h) === 1 ? '' : 's'}`}
                </option>
              ))}
            </select>
          </div>

          <div className="card">
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
                style={{ width: 'auto', margin: '4px 0 0' }}
              />
              <span style={{ fontSize: 13 }}>
                I own this footage, the clip order above is correct, and I accept the
                contributor footage agreement. Faces and number plates will be
                automatically blurred before publishing.
              </span>
            </label>
          </div>

          <button className="btn" disabled={!agree} onClick={submit}>
            Upload &amp; process
          </button>
        </>
      )}

      {/* ---------------- Step 4: upload ---------------- */}
      {step === 4 && (
        <div className="card">
          {[...frontClips.map((c) => c.file), ...rearClips.map((c) => c.file), ...gpsFiles].map(
            (f, i) => {
              // During hashing the bar tracks the hash; afterwards it tracks the
              // transfer. Two separate counters, so the bar never jumps backwards when
              // the phase changes.
              const isHashing = phase === 'hashing';
              const pct = isHashing ? (hashProgress[`${i}`] ?? 0) : (progress[`${i}`] ?? 0);
              const skipped = deduped.includes(f.name);
              return (
                <div key={`${f.name}-${i}`} style={{ marginBottom: 10 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13 }}>{f.name}</span>
                    <span className="muted" style={{ fontSize: 13 }}>
                      {skipped ? 'already stored — skipped' : `${pct}%`}
                    </span>
                  </div>
                  <div style={{ height: 6, background: 'var(--bg-2)', borderRadius: 4, overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${skipped ? 100 : pct}%`,
                        background: skipped ? 'var(--ok, #2e9e5b)' : 'var(--accent)',
                      }}
                    />
                  </div>
                </div>
              );
            },
          )}
          <div className="muted" style={{ marginTop: 12 }}>
            {phase === 'hashing' && 'Checking your files against what we already have…'}
            {phase === 'uploading' && 'Uploading securely…'}
            {phase === 'finalising' && 'Finalising & queuing for processing…'}
          </div>
          {deduped.length > 0 && (
            <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
              {deduped.length} file(s) were already in storage, so they didn&apos;t need
              uploading again.
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function StepBar({ step }: { step: Step }) {
  const labels = ['Recording', 'Files', 'Review', 'Upload'];
  return (
    <div className="step-bar">
      {labels.map((label, i) => (
        <div key={label} className={`step ${step === i + 1 ? 'active' : ''} ${step > i + 1 ? 'done' : ''}`}>
          <span className="step-num">{step > i + 1 ? '✓' : i + 1}</span>
          {label}
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>{label}</div>
      <div
        style={{
          fontWeight: 700,
          color: tone === 'warn' ? 'var(--amber)' : tone === 'good' ? 'var(--green)' : undefined,
        }}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * The detected-order panel: what we think the recording looked like, with the evidence
 * for each clip and a way to correct it. Showing *why* a clip was placed where it was
 * ("from filename" vs "from file date") is what lets an instructor decide whether to
 * trust the order or fix it.
 */
function ClipReview({
  title,
  preview,
  onMove,
}: {
  title: string;
  preview: ReturnType<typeof buildPreview>;
  onMove: (from: number, to: number) => void;
}) {
  if (preview.clips.length === 0) return null;

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 8 }}>
        <div style={{ fontWeight: 600 }}>
          {title} — {preview.clips.length} clip{preview.clips.length === 1 ? '' : 's'}
        </div>
        <div className="spacer" />
        <span className={`pill ${preview.confident ? 'green' : 'amber'}`}>
          {preview.confident ? 'Order detected from filenames' : 'Please check the order'}
        </span>
      </div>

      <div className="row" style={{ gap: 20, marginBottom: 10 }}>
        <Stat label="Video length" value={fmtDuration(preview.totalVideoMs)} />
        <Stat label="Real time spanned" value={fmtDuration(preview.totalWallMs)} />
        <Stat
          label="Dropped between clips"
          value={preview.droppedMs ? fmtDuration(preview.droppedMs) : 'none'}
          tone={preview.gaps.some((g) => g.large) ? 'warn' : undefined}
        />
      </div>

      <ol className="clip-list">
        {preview.clips.map((c, i) => {
          const gap = preview.gaps.find((g) => g.afterIndex === i - 1);
          return (
            <li key={`${c.name}-${i}`}>
              {gap && (
                <div className={`clip-gap ${gap.large ? 'large' : ''}`}>
                  {gap.large ? '⚠ ' : ''}
                  {fmtDuration(gap.gapMs)} of the drive is missing here
                  {gap.large ? ' — is a clip missing?' : ''}
                </div>
              )}
              <div className="clip-row">
                <span className="clip-index">{i + 1}</span>
                <span className="clip-name">
                  {c.name}
                  <span className="muted" style={{ display: 'block', fontSize: 11 }}>
                    {fmtClock(c.startEpochMs)} · {c.durationMs ? fmtDuration(c.durationMs) : 'duration unknown'}
                    {' · '}
                    {c.startSource === 'filename'
                      ? `time from filename${c.brand ? ` (${c.brand})` : ''}`
                      : 'time from file date — please verify'}
                  </span>
                </span>
                <span className="clip-actions">
                  <button
                    className="btn ghost auto"
                    onClick={() => onMove(i, i - 1)}
                    disabled={i === 0}
                    aria-label={`Move ${c.name} earlier`}
                  >
                    ↑
                  </button>
                  <button
                    className="btn ghost auto"
                    onClick={() => onMove(i, i + 1)}
                    disabled={i === preview.clips.length - 1}
                    aria-label={`Move ${c.name} later`}
                  >
                    ↓
                  </button>
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      {preview.overlaps > 0 && (
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          {preview.overlaps} clip{preview.overlaps === 1 ? '' : 's'} overlap in time. We'll
          trim the repeated part so the timeline stays continuous.
        </p>
      )}
      {preview.anyUnknownDuration && (
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          Your browser couldn't read the length of every clip. That's fine — we measure it
          properly during processing.
        </p>
      )}
    </div>
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
  const totalMb = files.reduce((s, f) => s + f.size, 0) / 1024 / 1024;
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
          {files.length} file{files.length === 1 ? '' : 's'} ·{' '}
          {totalMb > 1024 ? `${(totalMb / 1024).toFixed(1)} GB` : `${totalMb.toFixed(0)} MB`}
        </div>
      )}
    </div>
  );
}
