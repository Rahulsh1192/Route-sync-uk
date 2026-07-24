/**
 * Seed demo journeys so the GPS↔R1 conformance engine can be tested without real
 * recordings. Builds one reference route R1 (with a corner), synthesises four
 * GPS tracks that exercise every branch, runs the *real* engine on them, and
 * writes fully-populated reference_routes / journeys / journey_gps_points /
 * journey_segments rows.
 *
 *   Scenarios:  CLEAN → verified 100%
 *               DEVIATE+RETURN → verified (off-route frames spliced out)
 *               SKIP → rejected (coverage gap)
 *               TUNNEL → verified (GPS dropout bridged)
 *
 * Run:  cd apps/api && npx ts-node scripts/seed-journeys.ts
 * Idempotent: re-running replaces the previous demo data.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import {
  analyzeJourney,
  haversineM,
  LatLng,
  GpsFix,
  ReferenceGeometry,
} from '../src/modules/journeys/matching';

// ---- config -----------------------------------------------------------------
function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(join(__dirname, '..', '.env'), 'utf8');
  const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error('DATABASE_URL not found in env or apps/api/.env');
  return line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
}

// ---- R1 geometry (near Mill Hill: east ~1.4 km, then a left turn north) ------
const CORNERS: LatLng[] = [
  { lat: 51.6100, lng: -0.2400 }, // A
  { lat: 51.6100, lng: -0.2200 }, // corner (turn left/north)
  { lat: 51.6240, lng: -0.2200 }, // B
];

/** Densify corner waypoints to ~15 m spacing so it looks like a real GPS route. */
function densify(corners: LatLng[], stepM = 15): LatLng[] {
  const out: LatLng[] = [corners[0]];
  for (let i = 0; i < corners.length - 1; i++) {
    const a = corners[i];
    const b = corners[i + 1];
    const d = haversineM(a, b);
    const n = Math.max(1, Math.round(d / stepM));
    for (let k = 1; k <= n; k++) {
      out.push({ lat: a.lat + (b.lat - a.lat) * (k / n), lng: a.lng + (b.lng - a.lng) * (k / n) });
    }
  }
  return out;
}

const R1 = densify(CORNERS);
const geom = new ReferenceGeometry(R1);
const M_PER_DLAT = 111_320;

// ---- track synthesis --------------------------------------------------------
const SPEED = 13; // m/s (~47 km/h)
const jitter = () => (Math.random() - 0.5) * 6; // ±3 m lateral noise

/** Walk R1 from `fromArc`→`toArc` at driving speed, one fix/second, with noise. */
function follow(fromArc: number, toArc: number, startT: number, startSeq = 0): { fixes: GpsFix[]; endT: number } {
  const fixes: GpsFix[] = [];
  let t = startT;
  for (let arc = fromArc; arc <= toArc; arc += SPEED) {
    const p = geom.pointAtArc(arc);
    fixes.push({
      tMs: t,
      lat: p.lat + jitter() / M_PER_DLAT,
      lng: p.lng + jitter() / (M_PER_DLAT * Math.cos(p.lat * Math.PI / 180)),
      accuracyM: 4 + Math.random() * 3,
      speedMps: SPEED,
    });
    t += 1000;
  }
  return { fixes, endT: t };
}

function buildClean(): GpsFix[] {
  return follow(0, geom.totalLength, 0).fixes;
}

function buildDeviateReturn(): GpsFix[] {
  // Put the detour on the straight east-west leg, where "north" is perpendicular
  // to the route (a true cross-track deviation), not near the corner.
  const midArc = geom.totalLength * 0.25;
  const before = follow(0, midArc, 0);
  const p = geom.pointAtArc(midArc);
  // wander ~80 m north (clearly off-route) over several seconds, then come back
  let t = before.endT;
  const dev: GpsFix[] = [];
  // drive well off-route (up to ~120 m north) for ~160 m of travel, then return
  for (const off of [40, 70, 100, 120, 120, 100, 70, 40]) {
    dev.push({ tMs: t, lat: p.lat + off / M_PER_DLAT, lng: p.lng, accuracyM: 5, speedMps: 6 });
    t += 1000;
  }
  const after = follow(midArc, geom.totalLength, t); // resume at the SAME point
  return [...before.fixes, ...dev, ...after.fixes];
}

function buildSkip(): GpsFix[] {
  const a = follow(0, geom.totalLength * 0.4, 0);
  // jump ahead with NO time gap → teleport → coverage gap → rejected
  const b = follow(geom.totalLength * 0.7, geom.totalLength, a.endT);
  return [...a.fixes, ...b.fixes];
}

function buildTunnel(): GpsFix[] {
  const a = follow(0, geom.totalLength * 0.4, 0);
  const gapArc = geom.totalLength * 0.3; // distance driven "in the tunnel"
  const dropoutMs = (gapArc / SPEED) * 1000; // realistic time for that distance
  const b = follow(geom.totalLength * 0.7, geom.totalLength, a.endT + dropoutMs);
  return [...a.fixes, ...b.fixes];
}

// ---- DB writes --------------------------------------------------------------
async function main() {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const u = await client.query(
      `SELECT id FROM users WHERE role IN ('instructor','admin') ORDER BY created_at LIMIT 1`,
    );
    const anyU = u.rows.length ? u.rows : (await client.query(`SELECT id FROM users LIMIT 1`)).rows;
    if (!anyU.length) throw new Error('No users in DB — run the base seed first.');
    const userId: string = anyU[0].id;
    const tc = await client.query(`SELECT id FROM test_centres ORDER BY name LIMIT 1`);
    const testCentreId: string | null = tc.rows[0]?.id ?? null;

    const name = 'DEMO — Mill Hill R1 (conformance test)';
    await client.query(`DELETE FROM reference_routes WHERE name = $1`, [name]); // cascade

    const wkt = `LINESTRING(${R1.map((p) => `${p.lng} ${p.lat}`).join(',')})`;
    const ref = await client.query(
      `INSERT INTO reference_routes (test_centre_id, name, start_label, end_label, created_by, geom, length_m, point_count)
       VALUES ($1,$2,'A: Depot','B: Test centre',$3, ST_GeogFromText($4), ST_Length(ST_GeogFromText($4)), $5)
       RETURNING id, round(length_m::numeric,0) AS length_m`,
      [testCentreId, name, userId, wkt, R1.length],
    );
    const referenceRouteId: string = ref.rows[0].id;
    console.log(`\nReference route R1: ${referenceRouteId}  (${ref.rows[0].length_m} m, ${R1.length} pts)\n`);

    const scenarios: Array<{ label: string; source: string; fixes: GpsFix[] }> = [
      { label: 'CLEAN', source: 'phone', fixes: buildClean() },
      { label: 'DEVIATE+RETURN', source: 'dashcam', fixes: buildDeviateReturn() },
      { label: 'SKIP', source: 'phone', fixes: buildSkip() },
      { label: 'TUNNEL', source: 'dual', fixes: buildTunnel() },
    ];

    console.log('scenario         verdict    coverage  maxDev  devs  segs  conf  journeyId');
    console.log('─'.repeat(92));
    for (const s of scenarios) {
      const a = analyzeJourney(R1, s.fixes);
      const j = await client.query(
        `INSERT INTO journeys (reference_route_id, instructor_id, video_source, status, submitted_at,
                               coverage_pct, max_deviation_m, deviation_count, sync_confidence, verdict, reject_reason)
         VALUES ($1,$2,$3,'submitted',now(),$4,$5,$6,$7,$8,$9) RETURNING id`,
        [referenceRouteId, userId, s.source, a.coveragePct, a.maxDeviationM, a.deviationCount,
         a.syncConfidence, a.verdict, a.rejectReason],
      );
      const journeyId: string = j.rows[0].id;

      const gpsRows = a.fixes.map((f, seq) => ({
        seq, t_ms: Math.round(f.tMs), lat: f.lat, lng: f.lng,
        accuracy_m: f.accuracyM ?? null, speed_mps: f.speedMps ?? null,
        matched_arc_m: f.arcM, cross_track_m: f.crossTrackM, on_route: f.onRoute,
      }));
      await client.query(
        `INSERT INTO journey_gps_points (journey_id, seq, t_ms, lat, lng, accuracy_m, speed_mps, matched_arc_m, cross_track_m, on_route)
         SELECT $1, x.seq, x.t_ms, x.lat, x.lng, x.accuracy_m, x.speed_mps, x.matched_arc_m, x.cross_track_m, x.on_route
         FROM json_to_recordset($2::json) AS x(seq int, t_ms bigint, lat double precision, lng double precision,
              accuracy_m real, speed_mps real, matched_arc_m double precision, cross_track_m real, on_route boolean)`,
        [journeyId, JSON.stringify(gpsRows)],
      );

      const segRows = a.keptSegments.map((seg, seq) => ({
        seq, start_t_ms: Math.round(seg.startTMs), end_t_ms: Math.round(seg.endTMs),
        start_arc_m: seg.startArcM, end_arc_m: seg.endArcM,
      }));
      if (segRows.length) {
        await client.query(
          `INSERT INTO journey_segments (journey_id, seq, start_t_ms, end_t_ms, start_arc_m, end_arc_m)
           SELECT $1, x.seq, x.start_t_ms, x.end_t_ms, x.start_arc_m, x.end_arc_m
           FROM json_to_recordset($2::json) AS x(seq int, start_t_ms bigint, end_t_ms bigint,
                start_arc_m double precision, end_arc_m double precision)`,
          [journeyId, JSON.stringify(segRows)],
        );
      }

      console.log(
        `${s.label.padEnd(16)} ${a.verdict.padEnd(10)} ${(a.coveragePct.toFixed(1) + '%').padStart(7)} ` +
          `${Math.round(a.maxDeviationM).toString().padStart(5)}m ${String(a.deviationCount).padStart(4)} ` +
          `${String(a.keptSegments.length).padStart(5)} ${String(a.syncConfidence).padStart(5)}  ${journeyId}`,
      );
    }

    console.log('\nInspect with:');
    console.log(`  SELECT status, verdict, coverage_pct, sync_confidence, reject_reason FROM journeys`);
    console.log(`    WHERE reference_route_id = '${referenceRouteId}';`);
    console.log(`  GET /api/reference-routes/${referenceRouteId}   (R1 polyline)`);
    console.log(`  GET /api/journeys/<journeyId>                    (verdict + spliced segments)\n`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
