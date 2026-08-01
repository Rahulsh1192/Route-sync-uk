import { useCallback, useEffect, useState } from 'react';
import { api, AdminReferenceRoute, AdminTestCentre } from '../api';

/**
 * Reference routes (R1) — the examiner's canonical route for a test centre.
 *
 * Why this panel exists: every contributed dashcam drive is conformance-checked against an
 * R1 before it can be published, and the upload form makes selecting one mandatory. The
 * API to create them (`POST /reference-routes`) already existed but nothing in the web or
 * mobile app called it, so a centre with no R1 silently blocked every upload for it with
 * "No reference routes exist for this centre yet" and no way forward.
 *
 * Routes are created from a GPX file — the format every dashcam, phone app and Garmin
 * exports, and the one an examiner's own recorded drive will already be in.
 */

/** Cap on points sent to the API. */
const MAX_POINTS = 2000;

interface Parsed {
  points: Array<{ lat: number; lng: number }>;
  originalCount: number;
  fileName: string;
}

/**
 * Extract a track from GPX using the browser's own XML parser.
 *
 * No library: GPX's track structure is three nested elements, and the shapes that vary
 * between exporters (`trkpt` for a recorded track, `rtept` for a planned route, `wpt` for
 * loose waypoints) are cheaper to handle here than to configure in a parser. Falls through
 * them in order of trustworthiness.
 */
function parseGpx(xml: string): Array<{ lat: number; lng: number }> {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('That file is not valid XML');

  for (const tag of ['trkpt', 'rtept', 'wpt']) {
    const nodes = Array.from(doc.getElementsByTagName(tag));
    if (nodes.length < 2) continue;
    const points = nodes
      .map((n) => ({
        lat: Number(n.getAttribute('lat')),
        lng: Number(n.getAttribute('lon')),
      }))
      // A GPX with one unparseable point is common; one that yields nothing usable is not
      // recoverable, and that is caught by the length check below.
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
                     && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180);
    if (points.length >= 2) return points;
  }
  throw new Error('No track points found — the file needs <trkpt>, <rtept> or <wpt> elements');
}

/**
 * Reduce a track to at most `MAX_POINTS`, keeping the first and last.
 *
 * A 20-minute drive recorded at 1 Hz is ~1,200 points, but a dashcam logging at 10 Hz
 * gives 12,000 — a payload big enough to be refused, and far more detail than map-matching
 * needs. An even stride preserves the shape; dropping the tail would change where the
 * route ends, so the last point is always kept.
 */
function downsample(points: Array<{ lat: number; lng: number }>): Array<{ lat: number; lng: number }> {
  if (points.length <= MAX_POINTS) return points;
  const stride = Math.ceil(points.length / MAX_POINTS);
  const out = points.filter((_, i) => i % stride === 0);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/** Straight-line length of the track, as a sanity check before submitting. */
function trackLengthKm(points: Array<{ lat: number; lng: number }>): number {
  let m = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const midLat = (((a.lat + b.lat) / 2) * Math.PI) / 180;
    const x = dLng * Math.cos(midLat);
    m += 6_371_000 * Math.sqrt(dLat * dLat + x * x);
  }
  return m / 1000;
}

export function ReferenceRoutes() {
  const [centres, setCentres] = useState<AdminTestCentre[]>([]);
  const [centreId, setCentreId] = useState('');
  const [routes, setRoutes] = useState<AdminReferenceRoute[]>([]);
  const [name, setName] = useState('');
  const [startLabel, setStartLabel] = useState('');
  const [endLabel, setEndLabel] = useState('');
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.testCentres().then(setCentres).catch((e) => setError((e as Error).message));
  }, []);

  const loadRoutes = useCallback(async (id: string) => {
    if (!id) return setRoutes([]);
    try {
      setRoutes(await api.referenceRoutes(id));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    loadRoutes(centreId);
  }, [centreId, loadRoutes]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setMsg(null);
    try {
      const raw = parseGpx(await file.text());
      setParsed({ points: downsample(raw), originalCount: raw.length, fileName: file.name });
      // Pre-fill the name from the filename — usually the examiner's own label for the
      // route, and easier to correct than to type.
      if (!name) setName(file.name.replace(/\.gpx$/i, '').replace(/[_-]+/g, ' ').trim());
    } catch (e) {
      setParsed(null);
      setError((e as Error).message);
    }
  }

  async function submit() {
    if (!parsed || !centreId || name.trim().length < 2) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const created = await api.createReferenceRoute({
        testCentreId: centreId,
        name: name.trim(),
        startLabel: startLabel.trim() || undefined,
        endLabel: endLabel.trim() || undefined,
        points: parsed.points,
      });
      setMsg(
        `Created "${created.name}" — ${created.pointCount} points, ` +
          `${created.lengthM ? (created.lengthM / 1609.34).toFixed(1) : '?'} miles. ` +
          'Contributors can now select it when uploading.',
      );
      setParsed(null);
      setName('');
      setStartLabel('');
      setEndLabel('');
      await loadRoutes(centreId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const centre = centres.find((c) => c.id === centreId);

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Add a reference route (R1)</div>
        <p className="meta" style={{ marginTop: 0 }}>
          Contributed drives are checked against the R1 for their test centre before they can
          be published. A centre with no R1 cannot accept dashcam uploads at all.
        </p>

        <label htmlFor="rr-centre">Test centre *</label>
        <select id="rr-centre" value={centreId} onChange={(e) => setCentreId(e.target.value)}>
          <option value="">Select a test centre…</option>
          {centres.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.town ? ` — ${c.town}` : ''}
            </option>
          ))}
        </select>

        <label htmlFor="rr-file" style={{ marginTop: 12 }}>GPX file *</label>
        <input
          id="rr-file"
          type="file"
          accept=".gpx,application/gpx+xml,application/xml,text/xml"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        {parsed && (
          <div className="meta" style={{ marginTop: 6 }}>
            {parsed.fileName} · {parsed.points.length} points
            {parsed.originalCount !== parsed.points.length
              ? ` (thinned from ${parsed.originalCount})`
              : ''}{' '}
            · ~{trackLengthKm(parsed.points).toFixed(1)} km
          </div>
        )}

        <label htmlFor="rr-name" style={{ marginTop: 12 }}>Route name *</label>
        <input
          id="rr-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Mill Hill Route 3"
        />

        <div className="row" style={{ gap: 12, marginTop: 12 }}>
          <div style={{ flex: 1 }}>
            <label htmlFor="rr-start">Start label</label>
            <input
              id="rr-start"
              value={startLabel}
              onChange={(e) => setStartLabel(e.target.value)}
              placeholder="e.g. Test centre car park"
            />
          </div>
          <div style={{ flex: 1 }}>
            <label htmlFor="rr-end">End label</label>
            <input
              id="rr-end"
              value={endLabel}
              onChange={(e) => setEndLabel(e.target.value)}
              placeholder="e.g. Back at the centre"
            />
          </div>
        </div>

        {error && (
          <div className="error" role="alert" style={{ marginTop: 10 }}>
            <span aria-hidden="true">⚠</span>
            {error}
          </div>
        )}
        {msg && (
          <div style={{ color: 'var(--color-green)', fontSize: 13, marginTop: 10 }}>{msg}</div>
        )}

        <button
          className="btn-primary"
          style={{ marginTop: 12 }}
          disabled={busy || !parsed || !centreId || name.trim().length < 2}
          onClick={submit}
        >
          {busy ? 'Creating…' : 'Create reference route'}
        </button>
      </div>

      {centreId && (
        <>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>
            Existing routes for {centre?.name ?? 'this centre'}
          </div>
          {routes.length === 0 ? (
            <div className="empty">
              <span className="empty-icon">🗺️</span>
              No reference routes yet — uploads for this centre are blocked until one exists.
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">From → to</th>
                    <th scope="col">Length</th>
                    <th scope="col">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {routes.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 'var(--weight-medium)' }}>{r.name}</td>
                      <td className="meta">
                        {r.startLabel || '—'} → {r.endLabel || '—'}
                      </td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {r.lengthM ? `${(r.lengthM / 1609.34).toFixed(1)} mi` : '—'}
                      </td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.pointCount ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
