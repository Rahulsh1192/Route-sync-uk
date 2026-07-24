import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  analyzeJourney,
  GpsFix,
  LatLng,
  MatchOptions,
  ReferenceGeometry,
} from './matching';

export interface CreateReferenceRouteInput {
  testCentreId?: string;
  name: string;
  startLabel?: string;
  endLabel?: string;
  points: LatLng[];
}
export type VideoSource = 'phone' | 'dashcam' | 'dual';

@Injectable()
export class JourneysService {
  private readonly logger = new Logger(JourneysService.name);
  // R1 geometry is immutable once created, so cache it for the live-check hot path.
  private geomCache = new Map<string, { points: LatLng[]; geom: ReferenceGeometry }>();

  constructor(private prisma: PrismaService) {}

  // ---- conformance thresholds (DB-tunable) ---------------------------------
  private async matchOptions(): Promise<Partial<MatchOptions>> {
    const rows = await this.prisma.$queryRaw<Array<{ key: string; value: string }>>`
      SELECT key, value FROM platform_config WHERE key LIKE 'journey_%'`;
    const m = new Map(rows.map((r) => [r.key, Number(r.value)]));
    const pick = (k: string) => (Number.isFinite(m.get(k)) ? (m.get(k) as number) : undefined);
    return {
      deviationM: pick('journey_deviation_m'),
      sustainM: pick('journey_deviation_sustain_m'),
      minCoveragePct: pick('journey_min_coverage_pct'),
      gapM: pick('journey_gap_m'),
      reentryToleranceM: pick('journey_reentry_tolerance_m'),
    };
  }

  // ---- reference routes (R1) -----------------------------------------------
  async createReferenceRoute(userId: string, input: CreateReferenceRouteInput) {
    if (!input.points || input.points.length < 2) {
      throw new BadRequestException('A reference route needs at least 2 GPS points');
    }
    for (const p of input.points) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) {
        throw new BadRequestException('Reference route contains an invalid coordinate');
      }
    }
    // WKT is built from validated finite numbers only (no user strings interpolated).
    const wkt = `LINESTRING(${input.points.map((p) => `${p.lng} ${p.lat}`).join(',')})`;
    const rows = await this.prisma.$queryRaw<any[]>`
      INSERT INTO reference_routes
        (test_centre_id, name, start_label, end_label, created_by, geom, length_m, point_count)
      VALUES (
        ${input.testCentreId ?? null}::uuid, ${input.name},
        ${input.startLabel ?? null}, ${input.endLabel ?? null}, ${userId}::uuid,
        ST_GeogFromText(${wkt}),
        ST_Length(ST_GeogFromText(${wkt})),
        ${input.points.length}
      )
      RETURNING id, name, start_label AS "startLabel", end_label AS "endLabel",
                test_centre_id AS "testCentreId", length_m AS "lengthM", point_count AS "pointCount"`;
    return rows[0];
  }

  listReferenceRoutes(testCentreId?: string) {
    return this.prisma.$queryRaw`
      SELECT id, name, start_label AS "startLabel", end_label AS "endLabel",
             test_centre_id AS "testCentreId", length_m AS "lengthM", point_count AS "pointCount",
             created_at AS "createdAt"
      FROM reference_routes
      WHERE (${testCentreId ?? null}::uuid IS NULL OR test_centre_id = ${testCentreId ?? null}::uuid)
      ORDER BY created_at DESC`;
  }

  /** Full R1 incl. its polyline (so the app can draw it + live-match against it). */
  async getReferenceRoute(id: string) {
    const { points, meta } = await this.loadReference(id);
    return { ...meta, points };
  }

  private async loadReference(id: string): Promise<{ points: LatLng[]; geom: ReferenceGeometry; meta: any }> {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT id, name, start_label AS "startLabel", end_label AS "endLabel",
             test_centre_id AS "testCentreId", length_m AS "lengthM", point_count AS "pointCount",
             ST_AsGeoJSON(geom::geometry) AS gj
      FROM reference_routes WHERE id = ${id}::uuid`;
    if (!rows.length) throw new NotFoundException('Reference route not found');
    const { gj, ...meta } = rows[0];
    const coords: [number, number][] = JSON.parse(gj).coordinates; // [lng, lat]
    const points: LatLng[] = coords.map(([lng, lat]) => ({ lat, lng }));
    const cached = this.geomCache.get(id);
    const geom = cached?.geom ?? new ReferenceGeometry(points);
    if (!cached) this.geomCache.set(id, { points, geom });
    return { points, geom, meta };
  }

  // ---- journey lifecycle ---------------------------------------------------
  async startJourney(userId: string, referenceRouteId: string, videoSource: VideoSource) {
    const { points, meta } = await this.loadReference(referenceRouteId); // 404s if missing
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO journeys (reference_route_id, instructor_id, video_source, status)
      VALUES (${referenceRouteId}::uuid, ${userId}::uuid, ${videoSource}, 'recording')
      RETURNING id`;
    return {
      journeyId: rows[0].id,
      videoSource,
      referenceRoute: { ...meta, points },
    };
  }

  /**
   * Real-time deviation check for a single fix during recording. Returns whether
   * the instructor is on R1 and the arc-length to feed the next call, so the app
   * can warn the moment they drift off route (before a bad upload happens).
   */
  async liveCheck(
    userId: string,
    journeyId: string,
    fix: LatLng,
    lastArcM = 0,
  ) {
    const j = await this.ownedJourney(userId, journeyId);
    const { geom } = await this.loadReference(j.reference_route_id);
    const opt = await this.matchOptions();
    const devM = opt.deviationM ?? 30;
    const m = geom.match(fix, lastArcM, 200, 25);
    const onRoute = m.crossTrackM <= devM;
    return {
      onRoute,
      crossTrackM: Math.round(m.crossTrackM * 10) / 10,
      arcM: Math.round(m.arcM * 10) / 10,
      progressPct: geom.totalLength > 0 ? Math.round((m.arcM / geom.totalLength) * 100) : 0,
      message: onRoute
        ? 'On route'
        : `Off route by ${Math.round(m.crossTrackM)} m — rejoin R1 to keep recording`,
    };
  }

  /**
   * Submit the recorded GPS track. Runs the full conformance analysis, persists
   * the matched track + kept (spliced) segments, and returns the verdict +
   * coverage report the app and admin see. Video (phone or dashcam) is handled
   * downstream by the worker using these segments; `videoSource` only records
   * which sync path that will take.
   */
  async submitJourney(
    userId: string,
    journeyId: string,
    fixes: GpsFix[],
    videoSource?: VideoSource,
  ) {
    const j = await this.ownedJourney(userId, journeyId);
    if (!fixes || fixes.length < 2) throw new BadRequestException('Journey has too few GPS points');
    if (fixes.length > 200_000) throw new BadRequestException('GPS track is too large');

    const { points } = await this.loadReference(j.reference_route_id);
    const opt = await this.matchOptions();
    const a = analyzeJourney(points, fixes, opt);

    // Persist the matched track (append-only truth) in one bulk insert.
    const gpsRows = a.fixes.map((f, seq) => ({
      seq,
      t_ms: Math.round(f.tMs),
      lat: f.lat,
      lng: f.lng,
      accuracy_m: f.accuracyM ?? null,
      speed_mps: f.speedMps ?? null,
      matched_arc_m: f.arcM,
      cross_track_m: f.crossTrackM,
      on_route: f.onRoute,
    }));
    await this.prisma.$executeRaw`DELETE FROM journey_gps_points WHERE journey_id = ${journeyId}::uuid`;
    await this.prisma.$executeRaw`
      INSERT INTO journey_gps_points
        (journey_id, seq, t_ms, lat, lng, accuracy_m, speed_mps, matched_arc_m, cross_track_m, on_route)
      SELECT ${journeyId}::uuid, x.seq, x.t_ms, x.lat, x.lng, x.accuracy_m, x.speed_mps,
             x.matched_arc_m, x.cross_track_m, x.on_route
      FROM json_to_recordset(${JSON.stringify(gpsRows)}::json) AS x(
        seq int, t_ms bigint, lat double precision, lng double precision,
        accuracy_m real, speed_mps real, matched_arc_m double precision,
        cross_track_m real, on_route boolean)`;

    // Persist the kept (spliced) on-route segments → the player timeline source.
    const segRows = a.keptSegments.map((s, seq) => ({
      seq,
      start_t_ms: Math.round(s.startTMs),
      end_t_ms: Math.round(s.endTMs),
      start_arc_m: s.startArcM,
      end_arc_m: s.endArcM,
    }));
    await this.prisma.$executeRaw`DELETE FROM journey_segments WHERE journey_id = ${journeyId}::uuid`;
    if (segRows.length) {
      await this.prisma.$executeRaw`
        INSERT INTO journey_segments (journey_id, seq, start_t_ms, end_t_ms, start_arc_m, end_arc_m)
        SELECT ${journeyId}::uuid, x.seq, x.start_t_ms, x.end_t_ms, x.start_arc_m, x.end_arc_m
        FROM json_to_recordset(${JSON.stringify(segRows)}::json) AS x(
          seq int, start_t_ms bigint, end_t_ms bigint,
          start_arc_m double precision, end_arc_m double precision)`;
    }

    await this.prisma.$executeRaw`
      UPDATE journeys SET
        status = 'submitted',
        submitted_at = now(),
        video_source = ${videoSource ?? j.video_source},
        coverage_pct = ${a.coveragePct},
        max_deviation_m = ${a.maxDeviationM},
        deviation_count = ${a.deviationCount},
        sync_confidence = ${a.syncConfidence},
        verdict = ${a.verdict},
        reject_reason = ${a.rejectReason}
      WHERE id = ${journeyId}::uuid`;

    this.logger.log(
      `Journey ${journeyId}: ${a.verdict} — coverage ${a.coveragePct.toFixed(1)}%, ` +
        `maxDev ${a.maxDeviationM.toFixed(1)}m, ${a.deviationCount} deviations, conf ${a.syncConfidence}`,
    );

    return {
      journeyId,
      verdict: a.verdict,
      rejectReason: a.rejectReason,
      coveragePct: Math.round(a.coveragePct * 10) / 10,
      totalLengthM: Math.round(a.totalLengthM),
      coveredM: Math.round(a.coveredM),
      maxDeviationM: Math.round(a.maxDeviationM * 10) / 10,
      deviationCount: a.deviationCount,
      syncConfidence: a.syncConfidence,
      gaps: a.gaps.map((g) => ({ fromM: Math.round(g.fromArcM), toM: Math.round(g.toArcM) })),
      deviations: a.deviations.map((d) => ({
        startTMs: d.startTMs,
        endTMs: d.endTMs,
        maxCrossTrackM: Math.round(d.maxCrossTrackM),
        travelledM: Math.round(d.travelledM),
        reentrySeamless: d.reentrySeamless,
      })),
      keptSegments: a.keptSegments.length,
      timelineSamples: a.timeline.length,
    };
  }

  async getJourney(userId: string, role: string, journeyId: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT id, reference_route_id AS "referenceRouteId", instructor_id AS "instructorId",
             video_source AS "videoSource", status, verdict, reject_reason AS "rejectReason",
             coverage_pct AS "coveragePct", max_deviation_m AS "maxDeviationM",
             deviation_count AS "deviationCount", sync_confidence AS "syncConfidence",
             started_at AS "startedAt", submitted_at AS "submittedAt"
      FROM journeys WHERE id = ${journeyId}::uuid`;
    if (!rows.length) throw new NotFoundException('Journey not found');
    const j = rows[0];
    const isStaff = role === 'admin' || role === 'moderator';
    if (j.instructorId !== userId && !isStaff) throw new ForbiddenException('Not your journey');
    const segments = await this.prisma.$queryRaw`
      SELECT seq, start_t_ms::float8 AS "startTMs", end_t_ms::float8 AS "endTMs",
             start_arc_m AS "startArcM", end_arc_m AS "endArcM"
      FROM journey_segments WHERE journey_id = ${journeyId}::uuid ORDER BY seq`;
    return { ...j, segments };
  }

  private async ownedJourney(userId: string, journeyId: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT id, reference_route_id, instructor_id, video_source, status
      FROM journeys WHERE id = ${journeyId}::uuid`;
    if (!rows.length) throw new NotFoundException('Journey not found');
    if (rows[0].instructor_id !== userId) throw new ForbiddenException('Not your journey');
    return rows[0];
  }
}
