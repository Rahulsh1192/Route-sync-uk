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

    await this.persistAnalysis(journeyId, a, videoSource ?? j.video_source);

    this.logger.log(
      `Journey ${journeyId}: ${a.verdict} — coverage ${a.coveragePct.toFixed(1)}%, ` +
        `maxDev ${a.maxDeviationM.toFixed(1)}m, ${a.deviationCount} deviations, conf ${a.syncConfidence}`,
    );

    return this.analysisReport(journeyId, a);
  }

  /**
   * Writes an analysis to the journey's three tables. Shared by the in-app submit
   * path (UC2) and the dashcam-upload path (UC1) so a journey's stored truth is
   * produced by exactly one piece of code regardless of how the GPS arrived.
   */
  private async persistAnalysis(
    journeyId: string,
    a: ReturnType<typeof analyzeJourney>,
    videoSource: string,
  ) {
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
        video_source = ${videoSource},
        coverage_pct = ${a.coveragePct},
        max_deviation_m = ${a.maxDeviationM},
        deviation_count = ${a.deviationCount},
        sync_confidence = ${a.syncConfidence},
        verdict = ${a.verdict},
        reject_reason = ${a.rejectReason}
      WHERE id = ${journeyId}::uuid`;
  }

  /** The conformance report shape returned to apps, admin and the worker. */
  private analysisReport(journeyId: string, a: ReturnType<typeof analyzeJourney>) {
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

  // ---- Phase 24: dashcam uploads -------------------------------------------

  /**
   * An instructor's own recorded journeys, with enough detail for the upload
   * wizard to offer the right ones when attaching dashcam footage (UC2). Journeys
   * with no GPS or with footage already attached are listed but marked
   * unattachable, so the picker can explain *why* rather than silently hiding a
   * drive the instructor remembers recording.
   */
  listInstructorJourneys(userId: string) {
    return this.prisma.$queryRaw`
      SELECT j.id,
             j.reference_route_id                       AS "referenceRouteId",
             r.name                                     AS "referenceRouteName",
             j.video_source                             AS "videoSource",
             j.status,
             j.verdict,
             j.coverage_pct                             AS "coveragePct",
             j.started_at                               AS "startedAt",
             j.started_at_epoch_ms::float8              AS "startedAtEpochMs",
             j.submitted_at                             AS "submittedAt",
             j.upload_id                                AS "uploadId",
             j.video_upload_state                       AS "videoUploadState",
             p.point_count                              AS "pointCount",
             p.duration_ms                              AS "durationMs",
             (j.upload_id IS NULL AND COALESCE(p.point_count, 0) >= 2) AS "attachable"
        FROM journeys j
        LEFT JOIN reference_routes r ON r.id = j.reference_route_id
        LEFT JOIN (
          SELECT journey_id,
                 COUNT(*)::int                          AS point_count,
                 (MAX(t_ms) - MIN(t_ms))::float8        AS duration_ms
            FROM journey_gps_points GROUP BY journey_id
        ) p ON p.journey_id = j.id
       WHERE j.instructor_id = ${userId}::uuid
       ORDER BY j.started_at DESC
       LIMIT 100`;
  }

  /**
   * Internal (worker-only): run R1 conformance for a dashcam upload.
   *
   * Phase 24 decision — uploaded dashcam GPS is conformance-checked, it does not
   * become published geometry on its own. Rather than porting the matching engine
   * into Python, the worker posts its merged track here so `matching.ts` stays the
   * single source of truth for what "on route" means.
   *
   * Handles both usecases:
   *  * UC1 — `fixes` supplied (merged from the camera's GPS logs). A journey row is
   *    created for the upload if it doesn't have one yet, then analysed.
   *  * UC2 — `fixes` omitted. The track already lives in the upload's journey from
   *    the in-app recording, so it is re-analysed to regenerate the timeline. The
   *    engine is deterministic, so this reproduces the original verdict exactly.
   *
   * Returns the snapped timeline as well as the verdict, because that timeline is
   * what the worker turns into `route_track_points` — the data the moving map
   * marker is driven from.
   */
  async analyseUploadTrack(
    uploadId: string,
    fixes?: GpsFix[],
    videoSource?: VideoSource,
  ) {
    const uploads = await this.prisma.$queryRaw<
      Array<{
        id: string;
        user_id: string;
        route_id: string | null;
        journey_id: string | null;
        reference_route_id: string | null;
      }>
    >`
      SELECT id, user_id, route_id, journey_id, reference_route_id
        FROM uploads WHERE id = ${uploadId}::uuid`;
    if (!uploads.length) throw new NotFoundException('Upload not found');
    const up = uploads[0];

    let journeyId = up.journey_id;
    let referenceRouteId = up.reference_route_id;

    // A journey created in-app already knows its R1; an upload may not have been
    // given one. Fall back to the journey's before giving up.
    if (!referenceRouteId && journeyId) {
      const rows = await this.prisma.$queryRaw<Array<{ reference_route_id: string }>>`
        SELECT reference_route_id FROM journeys WHERE id = ${journeyId}::uuid`;
      referenceRouteId = rows[0]?.reference_route_id ?? null;
    }
    if (!referenceRouteId) {
      throw new BadRequestException(
        'This upload has no reference route (R1) to be checked against',
      );
    }

    // UC2: no fixes posted — read the app-recorded track back out of the journey.
    let track = fixes;
    if (!track?.length) {
      if (!journeyId) {
        throw new BadRequestException('No GPS track supplied and no recorded journey to read');
      }
      const rows = await this.prisma.$queryRaw<
        Array<{ t_ms: number; lat: number; lng: number; accuracy_m: number | null; speed_mps: number | null }>
      >`
        SELECT t_ms::float8 AS t_ms, lat, lng, accuracy_m, speed_mps
          FROM journey_gps_points WHERE journey_id = ${journeyId}::uuid ORDER BY seq`;
      track = rows.map((r) => ({
        tMs: r.t_ms,
        lat: r.lat,
        lng: r.lng,
        accuracyM: r.accuracy_m ?? undefined,
        speedMps: r.speed_mps ?? undefined,
      }));
    }
    if (!track || track.length < 2) {
      throw new BadRequestException('GPS track has too few points to analyse');
    }
    if (track.length > 200_000) throw new BadRequestException('GPS track is too large');

    // UC1: give the upload a journey so its conformance result is stored in the
    // same place as an in-app recording's, and admin sees one consistent view.
    if (!journeyId) {
      const created = await this.prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO journeys (
          reference_route_id, instructor_id, route_id, upload_id,
          video_source, status, video_upload_state
        )
        VALUES (
          ${referenceRouteId}::uuid, ${up.user_id}::uuid, ${up.route_id}::uuid, ${uploadId}::uuid,
          ${videoSource ?? 'dashcam'}, 'recording', 'processing'
        )
        RETURNING id`;
      journeyId = created[0].id;
    }

    const { points } = await this.loadReference(referenceRouteId);
    const opt = await this.matchOptions();
    const a = analyzeJourney(points, track, opt);
    await this.persistAnalysis(journeyId, a, videoSource ?? 'dashcam');

    // Keep the journey pointed at the route the upload is building, so an admin
    // reviewing the route can pivot straight to its conformance numbers.
    await this.prisma.$executeRaw`
      UPDATE journeys
         SET upload_id = ${uploadId}::uuid,
             route_id  = COALESCE(route_id, ${up.route_id ?? null}::uuid)
       WHERE id = ${journeyId}::uuid`;

    this.logger.log(
      `Upload ${uploadId} → journey ${journeyId}: ${a.verdict} ` +
        `(coverage ${a.coveragePct.toFixed(1)}%, ${a.deviationCount} deviations)`,
    );

    return {
      ...this.analysisReport(journeyId, a),
      referenceRouteId,
      // The kept spans tell the worker which footage to keep; the timeline tells it
      // where the car was at each instant. Both are needed downstream, so both are
      // returned in full rather than as counts.
      segments: a.keptSegments.map((s) => ({
        startTMs: Math.round(s.startTMs),
        endTMs: Math.round(s.endTMs),
        startArcM: s.startArcM,
        endArcM: s.endArcM,
      })),
      timeline: a.timeline.map((t) => ({
        tMs: Math.round(t.tMs),
        lat: t.lat,
        lng: t.lng,
        arcM: t.arcM,
      })),
      matchedFixes: a.fixes.map((f) => ({
        tMs: Math.round(f.tMs),
        lat: f.lat,
        lng: f.lng,
        speedMps: f.speedMps ?? null,
        accuracyM: f.accuracyM ?? null,
        arcM: f.arcM,
        crossTrackM: f.crossTrackM,
        onRoute: f.onRoute,
      })),
    };
  }
}
