"""Thin Postgres access for the pipeline (psycopg3)."""
import json
import logging

import psycopg
from .config import config

log = logging.getLogger("db")


def connect():
    return psycopg.connect(config.DATABASE_URL, autocommit=True)


def get_upload(conn, upload_id: str) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(
            """SELECT id, user_id, route_id, status, clock_source,
                      gps_source, journey_id, reference_route_id,
                      camera_clock_offset_ms
               FROM uploads WHERE id = %s""",
            (upload_id,),
        )
        row = cur.fetchone()
        if not row:
            return None
        cols = [c.name for c in cur.description]
        return dict(zip(cols, row))


def get_upload_files(conn, upload_id: str):
    with conn.cursor() as cur:
        cur.execute(
            """SELECT id, kind, storage_key, original_name, bytes, started_at, duration_s,
                      ordinal, declared_ordinal, start_source
               FROM upload_files WHERE upload_id = %s""",
            (upload_id,),
        )
        cols = [c.name for c in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def update_upload_file_timing(conn, file_id: str, *, start_epoch_ms: int | None,
                              end_epoch_ms: int | None, duration_s: float | None,
                              start_source: str | None, brand: str | None,
                              ordinal: int | None):
    """
    Persist what the pipeline worked out about one clip.

    Written back so the review screen and the admin queue can explain the timeline
    after the fact — "this clip was placed from its filename, that one from mtime" is
    the difference between a diagnosable route and a mystery.
    """
    with conn.cursor() as cur:
        cur.execute(
            """UPDATE upload_files
                  SET start_epoch_ms = %s,
                      end_epoch_ms   = %s,
                      duration_s     = COALESCE(%s, duration_s),
                      started_at     = COALESCE(to_timestamp(%s / 1000.0), started_at),
                      start_source   = COALESCE(%s, start_source),
                      detected_brand = COALESCE(%s, detected_brand),
                      ordinal        = COALESCE(%s, ordinal)
                WHERE id = %s""",
            (start_epoch_ms, end_epoch_ms, duration_s, start_epoch_ms,
             start_source, brand, ordinal, file_id),
        )


def update_gps_file_stats(conn, file_id: str, point_count: int, gps_format: str,
                          start_epoch_ms: int | None, end_epoch_ms: int | None):
    """Record what a GPS log actually yielded, including zero (a parse failure)."""
    with conn.cursor() as cur:
        cur.execute(
            """UPDATE upload_files
                  SET gps_point_count = %s,
                      gps_format      = %s,
                      start_epoch_ms  = %s,
                      end_epoch_ms    = %s
                WHERE id = %s""",
            (point_count, gps_format, start_epoch_ms, end_epoch_ms, file_id),
        )


def update_upload_sync(conn, upload_id: str, resolved_offset_ms: int | None,
                       sync_confidence: int | None):
    """Store the offset and confidence the pipeline settled on for this upload."""
    with conn.cursor() as cur:
        cur.execute(
            """UPDATE uploads
                  SET resolved_offset_ms = %s, sync_confidence = %s, updated_at = now()
                WHERE id = %s""",
            (resolved_offset_ms, sync_confidence, upload_id),
        )


def write_clip_timeline(conn, route_id: str, rows: list[tuple]):
    """
    Replace a route's clip→wall-clock mapping.

    Deleted and rewritten rather than upserted so a reprocessed upload can't leave
    stale rows from a previous ordering behind — a mixture of two mappings would make
    the timeline silently wrong rather than merely outdated.
    """
    with conn.cursor() as cur:
        cur.execute("DELETE FROM route_clip_timeline WHERE route_id = %s", (route_id,))
        if not rows:
            return
        cur.executemany(
            """INSERT INTO route_clip_timeline
                 (id, route_id, view, clip_seq, source_file_id, original_name,
                  video_start_ms, video_end_ms, wall_start_epoch_ms, wall_end_epoch_ms,
                  gap_before_ms)
               VALUES (gen_random_uuid(), %s, %s::camera_view, %s, %s, %s, %s, %s, %s, %s, %s)""",
            rows,
        )


def write_track_points(conn, route_id: str, points: list[dict]):
    """
    Replace a route's GPS track — the data the moving map marker reads.

    Each point is `{t_ms, lat, lng, speed_mps?, bearing_deg?, accuracy_m?, on_route,
    arc_m?}` where `t_ms` is video time. Positions are snapped onto R1 by the
    conformance engine before they get here, so what the learner sees is the reference
    route itself rather than the recording's GPS noise.
    """
    with conn.cursor() as cur:
        cur.execute("DELETE FROM route_track_points WHERE route_id = %s", (route_id,))
        if not points:
            return
        cur.executemany(
            """INSERT INTO route_track_points
                 (route_id, seq, t_ms, location, speed_mps, bearing_deg, accuracy_m,
                  on_route, arc_m)
               VALUES (%s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
                       %s, %s, %s, %s, %s)""",
            [
                (
                    route_id, i, p["t_ms"], p["lng"], p["lat"],
                    p.get("speed_mps"), p.get("bearing_deg"), p.get("accuracy_m"),
                    p.get("on_route", True), p.get("arc_m"),
                )
                for i, p in enumerate(points)
            ],
        )


def get_config_value(conn, key: str, default: str | None = None) -> str | None:
    """Read one `platform_config` value (thresholds are tunable without a redeploy)."""
    with conn.cursor() as cur:
        cur.execute("SELECT value FROM platform_config WHERE key = %s", (key,))
        row = cur.fetchone()
    return row[0] if row else default


def get_config_float(conn, key: str, default: float) -> float:
    raw = get_config_value(conn, key)
    try:
        return float(raw) if raw is not None else default
    except (TypeError, ValueError):
        return default


def get_config_json(conn, key: str, default):
    """
    Read a JSON `platform_config` value (e.g. the HLS ladder).

    A malformed value falls back to the default rather than raising: a bad config edit
    should degrade encoding to the built-in ladder, not stop every upload in the queue.
    """
    raw = get_config_value(conn, key)
    if not raw:
        return default
    try:
        return json.loads(raw)
    except (TypeError, ValueError) as e:
        log.warning("platform_config %s is not valid JSON (%s); using default", key, e)
        return default


def set_upload_status(conn, upload_id: str, status: str, error: str | None = None):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE uploads SET status = %s, error = %s, updated_at = now() WHERE id = %s",
            (status, error, upload_id),
        )


def write_route_video(conn, route_id: str, view: str, rendition: str, storage_key: str,
                      manifest_key: str | None, codec: str | None, width: int | None,
                      height: int | None, fps: float | None, duration_s: float | None,
                      sync_offset_ms: int = 0, sha256: str | None = None,
                      variants: list[dict] | None = None, bytes_: int | None = None,
                      object_origin: str = "upload"):
    """
    Record a published stream for one camera view.

    Phase 25 adds the content hash (what deduplication matches on), the ABR variant
    ladder, and the object's byte size so storage cost is reportable without a HEAD
    against every object in the bucket.

    Rewrites the row for this (route, view) pair rather than appending: reprocessing an
    upload must replace its stream, not leave the previous manifest behind for the player
    to pick up alongside the new one.
    """
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM route_videos WHERE route_id = %s AND view = %s::camera_view",
            (route_id, view),
        )
        cur.execute(
            """INSERT INTO route_videos
               (id, route_id, view, rendition, storage_key, manifest_key, codec,
                width, height, fps, duration_s, sync_offset_ms,
                sha256, variants, bytes, object_origin)
               VALUES (gen_random_uuid(), %s, %s::camera_view, %s::video_rendition, %s, %s,
                       %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s)""",
            (route_id, view, rendition, storage_key, manifest_key, codec,
             width, height, fps, duration_s, sync_offset_ms,
             sha256, json.dumps(variants) if variants is not None else None,
             bytes_, object_origin),
        )


def find_video_by_sha256(conn, sha256: str) -> dict | None:
    """
    Find an already-published object with the same content hash.

    This is the worker-side half of deduplication. The API catches duplicates before the
    upload happens (cheapest case); this catches the ones it couldn't — a client that
    sent no hash, or footage that only becomes byte-identical after the pipeline has
    concatenated the clips.
    """
    if not sha256:
        return None
    with conn.cursor() as cur:
        cur.execute(
            """SELECT route_id, view, storage_key, manifest_key, variants
                 FROM route_videos
                WHERE sha256 = %s
                ORDER BY created_at ASC
                LIMIT 1""",
            (sha256,),
        )
        row = cur.fetchone()
        if not row:
            return None
        cols = [c.name for c in cur.description]
        return dict(zip(cols, row))


def write_route_gpx(conn, route_id: str, storage_key: str, point_count: int,
                    gps_quality: int):
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO route_gpx (id, route_id, storage_key, point_count, gps_quality)
               VALUES (gen_random_uuid(), %s, %s, %s, %s)
               ON CONFLICT (route_id) DO UPDATE
               SET storage_key = EXCLUDED.storage_key, point_count = EXCLUDED.point_count,
                   gps_quality = EXCLUDED.gps_quality""",
            (route_id, storage_key, point_count, gps_quality),
        )


def write_route_preview(conn, route_id: str, thumbnail_key: str | None,
                        map_preview_key: str | None = None,
                        thumbnail_small_key: str | None = None,
                        captured_at_ms: int | None = None):
    """
    Upsert a route's preview images.

    `COALESCE` on update so a later pass that only produces one of the images doesn't
    wipe the other — the map preview and the video thumbnails are generated by different
    stages and either can run alone.
    """
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO route_previews
                 (route_id, thumbnail_key, map_preview_key, thumbnail_small_key, captured_at_ms)
               VALUES (%s, %s, %s, %s, %s)
               ON CONFLICT (route_id) DO UPDATE
               SET thumbnail_key       = COALESCE(EXCLUDED.thumbnail_key, route_previews.thumbnail_key),
                   map_preview_key     = COALESCE(EXCLUDED.map_preview_key, route_previews.map_preview_key),
                   thumbnail_small_key = COALESCE(EXCLUDED.thumbnail_small_key, route_previews.thumbnail_small_key),
                   captured_at_ms      = COALESCE(EXCLUDED.captured_at_ms, route_previews.captured_at_ms)""",
            (route_id, thumbnail_key, map_preview_key, thumbnail_small_key, captured_at_ms),
        )


def write_quality_score(conn, route_id: str, qs: dict):
    f = qs["factors"]
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO route_quality_scores
               (route_id, gps_quality, video_quality, completeness, sync_confidence,
                contributor_rep, overall, details)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (route_id) DO UPDATE
               SET gps_quality = EXCLUDED.gps_quality, video_quality = EXCLUDED.video_quality,
                   completeness = EXCLUDED.completeness, sync_confidence = EXCLUDED.sync_confidence,
                   contributor_rep = EXCLUDED.contributor_rep, overall = EXCLUDED.overall,
                   details = EXCLUDED.details, computed_at = now()""",
            (route_id, f["gps_quality"], f["video_quality"], f["completeness"],
             f["sync_confidence"], f["contributor_rep"], qs["overall"], json.dumps(qs, default=str)),
        )


def update_route_summary(conn, route_id: str, distance_m: int | None, duration_s: int | None,
                         quality_score: int | None, sync_confidence: float | None):
    with conn.cursor() as cur:
        cur.execute(
            """UPDATE routes SET distance_m = %s, duration_s = %s, quality_score = %s,
               sync_confidence = %s, updated_at = now() WHERE id = %s""",
            (distance_m, duration_s, quality_score, sync_confidence, route_id),
        )


def write_instructions(conn, route_id: str, instructions: list[dict]):
    """Replace the route's practice-mode instruction set."""
    with conn.cursor() as cur:
        cur.execute("DELETE FROM route_instructions WHERE route_id = %s", (route_id,))
        for ins in instructions:
            loc = None
            if ins.get("lat") is not None and ins.get("lon") is not None:
                loc = f"SRID=4326;POINT({ins['lon']} {ins['lat']})"
            cur.execute(
                """INSERT INTO route_instructions
                   (id, route_id, seq, t_ms, type, text_ukenglish, roundabout_exit,
                    speed_limit_mph, location)
                   VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s,
                           CASE WHEN %s::text IS NULL THEN NULL ELSE ST_GeogFromText(%s::text) END)""",
                (route_id, ins["seq"], ins["t_ms"], ins["type"], ins["text"],
                 ins.get("roundabout_exit"), ins.get("speed_limit_mph"), loc, loc),
            )


def write_markers(conn, route_id: str, markers: list[dict]):
    """Replace the route's timeline markers (junctions, roundabouts)."""
    with conn.cursor() as cur:
        cur.execute("DELETE FROM route_markers WHERE route_id = %s", (route_id,))
        for mk in markers:
            loc = None
            if mk.get("lat") is not None and mk.get("lon") is not None:
                loc = f"SRID=4326;POINT({mk['lon']} {mk['lat']})"
            cur.execute(
                """INSERT INTO route_markers (id, route_id, t_ms, kind, label, location)
                   VALUES (gen_random_uuid(), %s, %s, %s, %s,
                           CASE WHEN %s::text IS NULL THEN NULL ELSE ST_GeogFromText(%s::text) END)""",
                (route_id, mk["t_ms"], mk["kind"], mk.get("label"), loc, loc),
            )


def update_route_counts(conn, route_id: str, junction_count: int, roundabout_count: int):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE routes SET junction_count = %s, roundabout_count = %s WHERE id = %s",
            (junction_count, roundabout_count, route_id),
        )


def set_route_status(conn, route_id: str, status: str):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE routes SET status = %s::route_status, updated_at = now() WHERE id = %s",
            (status, route_id),
        )


def write_fingerprint(conn, route_id: str, fp: dict):
    if not fp.get("geom_hash"):
        return
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO route_fingerprints (route_id, geom_hash, distance_bucket)
               VALUES (%s, %s, %s)
               ON CONFLICT (route_id) DO UPDATE
               SET geom_hash = EXCLUDED.geom_hash, distance_bucket = EXCLUDED.distance_bucket""",
            (route_id, fp["geom_hash"], fp["distance_bucket"]),
        )


def upsert_stage(conn, upload_id: str, stage: str, state: str,
                 progress: float = 0.0, findings: dict | None = None):
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO upload_stages (id, upload_id, stage, state, progress, findings, started_at, finished_at)
               VALUES (gen_random_uuid(), %s, %s, %s, %s, %s,
                       CASE WHEN %s = 'running' THEN now() ELSE NULL END,
                       CASE WHEN %s IN ('done','failed','flagged','skipped') THEN now() ELSE NULL END)
               ON CONFLICT (upload_id, stage) DO UPDATE
               SET state = EXCLUDED.state, progress = EXCLUDED.progress,
                   findings = EXCLUDED.findings,
                   started_at = COALESCE(upload_stages.started_at, EXCLUDED.started_at),
                   finished_at = EXCLUDED.finished_at""",
            (upload_id, stage, state, progress,
             json.dumps(findings, default=str) if findings else None, state, state),
        )
