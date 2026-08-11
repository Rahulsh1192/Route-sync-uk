import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import {
  GpsFixInput,
  JourneyReport,
  ReferenceRoute,
  TestCentre,
} from '../../api/types';
import { useAuth } from '../../auth/AuthContext';

/**
 * Record a drive's GPS in the browser (Phase 27).
 *
 * The upload wizard has always offered "I recorded the GPS in the Test Routify app" as a way
 * to sync dashcam footage with no GPS of its own — but nothing anywhere in the app could
 * record a drive. There was no `watchPosition` call in the web app or the Flutter one, so
 * that option led to "you have no recorded drives yet" and no way to get one. This is the
 * missing half.
 *
 * A journey is always recorded against a reference route (R1), because that is what the
 * conformance engine compares the drive to.
 */

/** Discard fixes this inaccurate — a 100 m-accurate point is noise on a road-level track. */
const MAX_ACCURACY_M = 50;

type Phase = 'setup' | 'recording' | 'submitting' | 'done';

export function RecordDrivePage() {
  const nav = useNavigate();
  const { isStaff } = useAuth();

  const [phase, setPhase] = useState<Phase>('setup');
  const [error, setError] = useState<string | null>(null);

  // --- setup
  const [centres, setCentres] = useState<TestCentre[]>([]);
  const [testCentreId, setTestCentreId] = useState('');
  const [refRoutes, setRefRoutes] = useState<ReferenceRoute[]>([]);
  const [referenceRouteId, setReferenceRouteId] = useState('');

  // --- recording
  const [journeyId, setJourneyId] = useState<string | null>(null);
  const [fixes, setFixes] = useState<GpsFixInput[]>([]);
  const [lastAccuracy, setLastAccuracy] = useState<number | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // --- result
  const [report, setReport] = useState<JourneyReport | null>(null);

  // Refs, not state: the geolocation callback fires outside React's render cycle and needs
  // the current values without re-subscribing the watch every time a fix arrives.
  const watchId = useRef<number | null>(null);
  const startedAt = useRef<number>(0);
  const fixesRef = useRef<GpsFixInput[]>([]);

  useEffect(() => {
    api.listTestCentres().then(setCentres).catch(() => setCentres([]));
  }, []);

  useEffect(() => {
    if (!testCentreId) {
      setRefRoutes([]);
      return;
    }
    api.listReferenceRoutes(testCentreId).then(setRefRoutes).catch(() => setRefRoutes([]));
    setReferenceRouteId('');
  }, [testCentreId]);

  const stopWatch = useCallback(() => {
    if (watchId.current != null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
  }, []);

  // A recording left running would keep the GPS on indefinitely after navigation, which on a
  // phone is a flat battery.
  useEffect(() => stopWatch, [stopWatch]);

  // Drives the elapsed-time display. Separate from the fix stream because GPS updates are
  // irregular and a clock that only ticks when a fix arrives looks broken.
  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt.current), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  async function start() {
    setError(null);
    setGpsError(null);

    if (!('geolocation' in navigator)) {
      setError('This browser cannot record GPS. Try Chrome or Safari on a phone.');
      return;
    }

    try {
      const started = await api.startJourney(referenceRouteId, 'dashcam');
      setJourneyId(started.journeyId);
      fixesRef.current = [];
      setFixes([]);
      setSkipped(0);
      startedAt.current = Date.now();
      setElapsedMs(0);
      setPhase('recording');

      watchId.current = navigator.geolocation.watchPosition(
        (pos) => {
          setGpsError(null);
          setLastAccuracy(pos.coords.accuracy ?? null);

          // A phone indoors or just woken reports 100 m+ accuracy; those points would drag
          // the track off the road and count as deviations against R1.
          if (pos.coords.accuracy != null && pos.coords.accuracy > MAX_ACCURACY_M) {
            setSkipped((n) => n + 1);
            return;
          }

          const fix: GpsFixInput = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            // Elapsed rather than wall-clock: this is what the analysis expects, and it
            // stays correct if the device clock changes mid-drive.
            tMs: Date.now() - startedAt.current,
            accuracyM: pos.coords.accuracy ?? undefined,
            speedMps: pos.coords.speed ?? undefined,
          };
          fixesRef.current = [...fixesRef.current, fix];
          setFixes(fixesRef.current);
        },
        (err) => {
          // Not fatal on its own — a tunnel or a temporary loss should not end a recording
          // that is otherwise going fine.
          setGpsError(
            err.code === err.PERMISSION_DENIED
              ? 'Location permission was denied. Allow location access to record a drive.'
              : `GPS signal problem: ${err.message}`,
          );
        },
        // The three settings that matter for a moving vehicle: the real GPS chip rather than
        // a wifi estimate, no cached positions, and a generous timeout for a cold start.
        { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function finish() {
    stopWatch();
    const recorded = fixesRef.current;

    if (recorded.length < 2) {
      setError(
        'Not enough GPS points to save this drive. Check location permission and that you ' +
          'have a signal, then try again.',
      );
      setPhase('setup');
      return;
    }

    setPhase('submitting');
    setError(null);
    try {
      const r = await api.submitJourney(journeyId!, recorded, 'dashcam');
      setReport(r);
      setPhase('done');
    } catch (e) {
      setError((e as Error).message);
      // Back to recording, not setup: the track is still in memory and re-submitting is the
      // obvious retry. Losing a completed drive to a failed request would be unforgivable.
      setPhase('recording');
    }
  }

  function discard() {
    stopWatch();
    fixesRef.current = [];
    setFixes([]);
    setJourneyId(null);
    setPhase('setup');
  }

  if (!isStaff) {
    return (
      <>
        <button className="btn secondary auto" onClick={() => nav('/contribute')} style={{ marginBottom: 16 }}>
          ← Back
        </button>
        <h1 className="page">Record a drive</h1>
        <div className="card">
          <p>Recording drives is available to <strong>verified instructors</strong>.</p>
          <button className="btn" onClick={() => nav('/contribute/instructor')}>
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
        onClick={() => nav('/contribute')}
        style={{ marginBottom: 16 }}
        disabled={phase === 'recording' || phase === 'submitting'}
      >
        ← Back
      </button>
      <h1 className="page">Record a drive</h1>

      {error && <div className="error">{error}</div>}

      {phase === 'setup' && (
        <>
          <div className="card">
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              Records your route's GPS on this device while you drive. Use it when your
              dashcam has no GPS of its own — afterwards, attach the footage to this drive in
              the upload wizard and we'll line the video up with the map.
            </p>
          </div>

          <div className="card">
            <label htmlFor="tc">Test centre *</label>
            <select id="tc" value={testCentreId} onChange={(e) => setTestCentreId(e.target.value)}>
              <option value="">Select the test centre…</option>
              {centres.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.town ? ` — ${c.town}` : ''}
                </option>
              ))}
            </select>

            <label htmlFor="r1" style={{ marginTop: 12 }}>Reference route (R1) *</label>
            {!testCentreId ? (
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>Choose a test centre first.</p>
            ) : refRoutes.length === 0 ? (
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                No reference routes exist for this centre yet. An admin adds these in the
                console — a drive is checked against one, so recording needs it.
              </p>
            ) : (
              <select
                id="r1"
                value={referenceRouteId}
                onChange={(e) => setReferenceRouteId(e.target.value)}
              >
                <option value="">Select the route you're about to drive…</option>
                {refRoutes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.lengthM ? ` — ${(r.lengthM / 1609.34).toFixed(1)} miles` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="card">
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              📍 Keep this page open and the screen awake while you drive — a browser stops
              GPS updates for a backgrounded tab. Set the phone up before you set off, never
              while driving.
            </p>
          </div>

          <button className="btn" disabled={!referenceRouteId} onClick={start}>
            ▶ Start recording
          </button>
        </>
      )}

      {(phase === 'recording' || phase === 'submitting') && (
        <>
          <div className="card" style={{ borderColor: 'var(--color-accent)' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{phase === 'submitting' ? 'Saving…' : '🔴 Recording'}</strong>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                {formatElapsed(elapsedMs)}
              </span>
            </div>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
              <Stat label="GPS points" value={String(fixes.length)} />
              <Stat
                label="Accuracy"
                value={lastAccuracy != null ? `±${Math.round(lastAccuracy)} m` : 'waiting…'}
              />
            </div>
            {skipped > 0 && (
              <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
                {skipped} inaccurate point{skipped === 1 ? '' : 's'} discarded (worse than ±
                {MAX_ACCURACY_M} m).
              </p>
            )}
            {fixes.length === 0 && !gpsError && (
              <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
                Waiting for a GPS fix. This can take a minute outdoors from cold.
              </p>
            )}
          </div>

          {gpsError && <div className="error">{gpsError}</div>}

          <button className="btn" onClick={finish} disabled={phase === 'submitting'}>
            {phase === 'submitting' ? 'Saving…' : '⏹ Finish & save drive'}
          </button>
          <button
            className="btn secondary"
            onClick={discard}
            disabled={phase === 'submitting'}
            style={{ marginTop: 8 }}
          >
            Discard
          </button>
        </>
      )}

      {phase === 'done' && report && (
        <>
          <div className="card">
            <div style={{ fontSize: 40, textAlign: 'center' }}>
              {report.verdict === 'verified' ? '✅' : report.verdict === 'rejected' ? '⚠️' : '📍'}
            </div>
            <h2 style={{ textAlign: 'center', margin: '4px 0' }}>Drive saved</h2>
            <p className="muted" style={{ textAlign: 'center', fontSize: 13 }}>
              {report.verdict === 'verified'
                ? 'This drive matches the reference route. You can attach your footage to it now.'
                : report.verdict === 'rejected'
                  ? "This drive didn't match the reference route closely enough to publish, but it's saved."
                  : 'Saved.'}
            </p>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Stat label="Verdict" value={report.verdict ?? '—'} />
              <Stat
                label="Route covered"
                value={report.coveragePct != null ? `${Math.round(report.coveragePct)}%` : '—'}
              />
              <Stat label="GPS points" value={String(fixes.length)} />
              <Stat
                label="Max deviation"
                value={report.maxDeviationM != null ? `${Math.round(report.maxDeviationM)} m` : '—'}
              />
            </div>
          </div>

          <button className="btn" onClick={() => nav('/contribute/upload')}>
            ⬆️ Attach dashcam footage to this drive
          </button>
          <button className="btn secondary" onClick={discard} style={{ marginTop: 8 }}>
            Record another drive
          </button>
        </>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ margin: 0, textAlign: 'center', padding: 10 }}>
      <div style={{ fontSize: 20, fontWeight: 800 }}>{value}</div>
      <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>{label}</div>
    </div>
  );
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
