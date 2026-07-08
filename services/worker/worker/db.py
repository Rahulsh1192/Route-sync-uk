"""Thin Postgres access for the pipeline (psycopg3)."""
import json
import psycopg
from .config import config


def connect():
    return psycopg.connect(config.DATABASE_URL, autocommit=True)


def get_upload(conn, upload_id: str) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, user_id, route_id, status, clock_source FROM uploads WHERE id = %s",
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
            """SELECT id, kind, storage_key, original_name, started_at, duration_s
               FROM upload_files WHERE upload_id = %s""",
            (upload_id,),
        )
        cols = [c.name for c in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def set_upload_status(conn, upload_id: str, status: str, error: str | None = None):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE uploads SET status = %s, error = %s, updated_at = now() WHERE id = %s",
            (status, error, upload_id),
        )


def write_route_video(conn, route_id: str, view: str, rendition: str, storage_key: str,
                      manifest_key: str | None, codec: str | None, width: int | None,
                      height: int | None, fps: float | None, duration_s: float | None,
                      sync_offset_ms: int = 0):
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO route_videos
               (id, route_id, view, rendition, storage_key, manifest_key, codec,
                width, height, fps, duration_s, sync_offset_ms)
               VALUES (gen_random_uuid(), %s, %s::camera_view, %s::video_rendition, %s, %s,
                       %s, %s, %s, %s, %s, %s)""",
            (route_id, view, rendition, storage_key, manifest_key, codec,
             width, height, fps, duration_s, sync_offset_ms),
        )


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
                        map_preview_key: str | None = None):
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO route_previews (route_id, thumbnail_key, map_preview_key)
               VALUES (%s, %s, %s)
               ON CONFLICT (route_id) DO UPDATE
               SET thumbnail_key = EXCLUDED.thumbnail_key,
                   map_preview_key = EXCLUDED.map_preview_key""",
            (route_id, thumbnail_key, map_preview_key),
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
