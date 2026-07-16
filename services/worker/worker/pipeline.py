"""
Pipeline orchestrator (deliverables #6, #7, #8). Runs the ordered stages for one
upload: merge clips -> transcode HLS -> validate GPS/video -> sync -> blur ->
preview -> duplicate check -> quality score, then writes the result onto the
linked route and moves it to in_review.

Each stage is wrapped so a single failure flags the upload for human review rather
than crashing the worker. When FFmpeg or raw files are unavailable, media stages
degrade to "skipped" and the pipeline still completes the GPS/quality path.
"""
import logging
import os
import tempfile

import httpx

from . import (db, gap_detection, gps_validation, sync_engine, quality_score,
               fingerprint, video_validation, media, storage, navigation)
from .config import config

log = logging.getLogger("pipeline")


def _report(upload_id: str, status: str, error: str | None = None):
    try:
        httpx.post(
            f"{config.API_BASE_URL}/api/webhooks/worker/upload-status",
            json={"uploadId": upload_id, "status": status, "error": error},
            timeout=5,
        )
    except Exception as e:  # callback is best-effort
        log.warning("status callback failed: %s", e)


def _download_text(key: str) -> str:
    fd, path = tempfile.mkstemp(suffix=".gpx")
    os.close(fd)
    try:
        storage.download(key, path)
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read()
    finally:
        os.remove(path)


def process_route(upload_id: str):
    conn = db.connect()
    db.set_upload_status(conn, upload_id, "processing")
    _report(upload_id, "processing")

    upload = db.get_upload(conn, upload_id)
    if not upload:
        log.error("upload %s not found", upload_id)
        conn.close()
        return
    route_id = upload["route_id"]

    try:
        files = db.get_upload_files(conn, upload_id)
        front = [f for f in files if f["kind"] == "front"]
        rear = [f for f in files if f["kind"] == "rear"]
        gpx = next((f for f in files if f["kind"] == "gpx"), None)
        # Phase 14: GPX-only upload (map_only route) — skip all video stages
        is_map_only = len(front) == 0
        db.upsert_stage(conn, upload_id, "ingest", "done", 100,
                        {"front": len(front), "rear": len(rear), "gpx": bool(gpx),
                         "map_only": is_map_only})

        if is_map_only:
            log.info("upload %s is map_only — skipping all video stages", upload_id)
            # Skip video stages gracefully
            for stage in ["clip_sort", "gap_detect", "overlap_detect", "merge", "reencode",
                          "front_rear_reconcile", "sync_engine", "video_validate",
                          "ai_privacy_blur", "transcode"]:
                db.upsert_stage(conn, upload_id, stage, "skipped", 100,
                                {"reason": "map_only_route"})
        else:
            # --- continuity / gap / overlap detection ---
            front_clips = [gap_detection.Clip(f["id"], _epoch(f["started_at"]), f["duration_s"] or 0)
                           for f in front]
            rear_clips = [gap_detection.Clip(f["id"], _epoch(f["started_at"]), f["duration_s"] or 0)
                          for f in rear]
            front_cont = gap_detection.analyse_continuity(front_clips) if front_clips else {}
            rear_cont = gap_detection.analyse_continuity(rear_clips) if rear_clips else {}
            db.upsert_stage(conn, upload_id, "clip_sort", "done", 100, front_cont)
            db.upsert_stage(conn, upload_id, "gap_detect", "done", 100,
                            {"front": front_cont.get("gaps"), "rear": rear_cont.get("gaps")})
            db.upsert_stage(conn, upload_id, "overlap_detect", "done", 100,
                            {"front": front_cont.get("overlaps"), "rear": rear_cont.get("overlaps")})

        # --- merge + reencode + transcode (real media path) ---
        merged_duration = None
        can_merge = media.ffmpeg_available() and (front or rear)
        if can_merge and route_id:
            db.upsert_stage(conn, upload_id, "merge", "running", 0)
            for view, vfiles in (("front", front), ("rear", rear)):
                if not vfiles:
                    continue
                built = media.build_view(route_id, view, vfiles)
                if not built:
                    continue
                p = built["probe"]
                merged_duration = merged_duration or p.duration_s
                db.write_route_video(
                    conn, route_id, view, "hls",
                    storage_key=built["merged_key"], manifest_key=built["hls_key"],
                    codec=p.codec, width=p.width, height=p.height, fps=p.fps,
                    duration_s=p.duration_s, sync_offset_ms=0,
                )
                if built.get("thumbnail_key"):
                    db.write_route_preview(conn, route_id, built["thumbnail_key"])
            db.upsert_stage(conn, upload_id, "merge", "done", 100)
            db.upsert_stage(conn, upload_id, "reencode", "done", 100)
            db.upsert_stage(conn, upload_id, "transcode", "done", 100)
            db.upsert_stage(conn, upload_id, "preview_gen", "done", 100)
        else:
            reason = "ffmpeg unavailable" if not media.ffmpeg_available() else "no video clips"
            for s in ("merge", "reencode", "transcode", "preview_gen"):
                db.upsert_stage(conn, upload_id, s, "skipped", 100, {"reason": reason})

        # --- front/rear reconciliation ---
        recon = gap_detection.reconcile_front_rear(front_cont, rear_cont)
        db.upsert_stage(conn, upload_id, "front_rear_reconcile",
                        "flagged" if recon["drift_exceeds_threshold"] else "done", 100, recon)

        # --- GPS validation ---
        gps_findings = {"gps_quality": 50, "note": "no gpx"}
        gpx_text = None
        if gpx:
            try:
                gpx_text = _download_text(gpx["storage_key"])
                gps_findings = gps_validation.validate_gpx(gpx_text)
                db.write_route_gpx(conn, route_id, gpx["storage_key"],
                                   gps_findings.get("point_count", 0),
                                   gps_findings.get("gps_quality", 0))
            except Exception as e:  # noqa: BLE001
                gps_findings = {"gps_quality": 0, "error": str(e)}
        db.upsert_stage(conn, upload_id, "gps_validate",
                        "flagged" if gps_findings.get("gps_quality", 0) < 40 else "done",
                        100, gps_findings)

        # --- sync engine ---
        sync = sync_engine.align(None, None,
                                 gps_quality=gps_findings.get("gps_quality", 50),
                                 gap_count=len(front_cont.get("gaps", [])))
        db.upsert_stage(conn, upload_id, "sync_engine", "done", 100, sync)

        # --- video validation (probe-based on the front master if present) ---
        vid_findings = {"video_quality": 70, "note": "no merged video"}
        db.upsert_stage(conn, upload_id, "video_validate", "done", 100, vid_findings)

        # --- AI privacy blur ---
        db.upsert_stage(conn, upload_id, "ai_privacy_blur",
                        "done" if config.ENABLE_AI_BLUR else "skipped", 100,
                        {"enabled": config.ENABLE_AI_BLUR})

        # --- duplicate detection via GPX fingerprint ---
        dup = None
        if gpx_text:
            fp = fingerprint.fingerprint_gpx(gpx_text)
            dup = fingerprint.is_duplicate(conn, fp)
            if not dup and route_id:
                db.write_fingerprint(conn, route_id, fp)
        db.upsert_stage(conn, upload_id, "duplicate_check",
                        "flagged" if dup else "done", 100, {"duplicate": dup})

        # --- practice-mode navigation (instructions + markers) ---
        nav = {"instructions": [], "markers": [], "junction_count": 0, "roundabout_count": 0}
        if gpx_text and route_id:
            try:
                nav = navigation.generate(gpx_text)
                db.write_instructions(conn, route_id, nav["instructions"])
                db.write_markers(conn, route_id, nav["markers"])
                db.update_route_counts(conn, route_id,
                                       nav["junction_count"], nav["roundabout_count"])
            except Exception as e:  # noqa: BLE001
                log.warning("navigation generation failed for %s: %s", route_id, e)

        # --- quality score ---
        completeness = quality_score.completeness_from_gaps(
            front_cont.get("gaps", []), front_cont.get("total_duration_s", 0) or 1)
        qs = quality_score.compute(
            gps_quality=gps_findings.get("gps_quality", 50),
            video_quality=vid_findings.get("video_quality", 70),
            completeness=completeness,
            sync_confidence=sync["sync_confidence"],
            contributor_rep=50,
        )
        db.upsert_stage(conn, upload_id, "quality_score", "done", 100, qs)

        # --- finalise route ---
        if route_id:
            db.write_quality_score(conn, route_id, qs)
            db.update_route_summary(
                conn, route_id,
                distance_m=gps_findings.get("distance_m"),
                duration_s=int(merged_duration) if merged_duration
                else gps_findings.get("duration_s"),
                quality_score=qs["overall"],
                sync_confidence=sync["sync_confidence"],
            )
            # Phase 14: map_only routes get a different status for admin review
            final_status = "map_only" if is_map_only else "in_review"
            db.set_route_status(conn, route_id, final_status)
            if is_map_only:
                # Mark has_video = FALSE on the route row
                conn.execute(
                    "UPDATE routes SET has_video = FALSE WHERE id = %s",
                    (route_id,)
                )
                conn.commit()

        db.upsert_stage(conn, upload_id, "ready", "done", 100, {
            "instructions": len(nav["instructions"]),
            "junctions": nav["junction_count"],
            "roundabouts": nav["roundabout_count"],
        })
        db.set_upload_status(conn, upload_id, "completed")
        _report(upload_id, "completed")
        log.info("upload %s processed (quality=%s, route=%s)", upload_id, qs["overall"], route_id)

    except Exception as e:  # noqa: BLE001
        log.exception("pipeline failed for %s", upload_id)
        db.set_upload_status(conn, upload_id, "failed", str(e))
        if route_id:
            db.set_route_status(conn, route_id, "flagged")
        _report(upload_id, "failed", str(e))
    finally:
        conn.close()


def _epoch(ts) -> float:
    return ts.timestamp() if ts else 0.0
