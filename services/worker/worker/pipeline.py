"""
Pipeline orchestrator. Runs the ordered stages for one upload and writes the result
onto the linked route.

Phase 24 reshaped the front of this pipeline around one principle: **put everything on
one absolute clock before doing anything else.** The stages now run

    ingest → probe → clip_sort → gap/overlap → gps_merge → reconcile
           → merge/transcode → front_rear_reconcile → audio_sync → sync_engine
           → conformance (R1) → track_points → …existing quality/publish stages

and the first six exist purely to establish, defensibly, when each frame and each GPS
fix happened. Everything after that is downstream of getting the clock right — if the
clock is wrong, a perfectly transcoded video shows the learner a marker in the wrong
place, which is worse than not publishing at all.

Each stage is wrapped so a single failure flags the upload for human review rather
than crashing the worker. When FFmpeg or raw files are unavailable, media stages
degrade to "skipped" and the pipeline still completes the GPS/quality path.
"""
import logging
import math
import os
import shutil
import tempfile

import httpx

from . import (audio_sync, clip_timeline, conformance, dashcam_formats, db,
               ffmpeg_ops, fingerprint, gps_ingest, gps_validation, media,
               navigation, quality_score, reconcile, storage, sync_engine,
               video_validation)
from .config import config

log = logging.getLogger("pipeline")

GPS_KINDS = ("gps", "gpx")


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
    fd, path = tempfile.mkstemp(suffix=".txt")
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
        gps_files = [f for f in files if f["kind"] in GPS_KINDS]
        gps_source = upload.get("gps_source") or "camera"
        clock_offset_ms = int(upload.get("camera_clock_offset_ms") or 0)

        # GPS-only upload (map_only route) — no video stages to run.
        is_map_only = len(front) == 0

        db.upsert_stage(conn, upload_id, "ingest", "done", 100, {
            "front": len(front), "rear": len(rear), "gps_files": len(gps_files),
            "gps_source": gps_source, "map_only": is_map_only,
            "camera_clock_offset_ms": clock_offset_ms,
        })

        # -------------------------------------------------------------------
        # Thresholds (DB-tunable, no redeploy)
        # -------------------------------------------------------------------
        min_overlap_pct = db.get_config_float(conn, "sync_min_overlap_pct", 95.0)
        max_clip_gap_s = db.get_config_float(conn, "sync_max_clip_gap_s", 10.0)
        max_fr_drift_s = db.get_config_float(conn, "sync_max_front_rear_drift_s", 2.0)
        min_confidence = db.get_config_float(conn, "sync_min_confidence", 70.0)
        track_hz = db.get_config_float(conn, "track_point_hz", 1.0) or 1.0

        # -------------------------------------------------------------------
        # probe + clip_sort — establish when each clip started
        # -------------------------------------------------------------------
        rules = dashcam_formats.load_rules(conn)
        timelines: dict[str, clip_timeline.Timeline] = {}
        probes: dict[str, object] = {}

        if is_map_only:
            for stage in ("probe", "clip_sort", "gap_detect", "overlap_detect", "merge",
                          "reencode", "front_rear_reconcile", "audio_sync", "sync_engine",
                          "video_validate", "ai_privacy_blur", "transcode", "preview_gen"):
                db.upsert_stage(conn, upload_id, stage, "skipped", 100,
                                {"reason": "map_only_route"})
        else:
            probes = media.probe_headers(front + rear) if media.ffmpeg_available() else {}
            db.upsert_stage(conn, upload_id, "probe",
                            "done" if probes else "skipped", 100,
                            {"probed": len(probes),
                             "reason": None if probes else "ffprobe unavailable"})

            for view, vfiles in (("front", front), ("rear", rear)):
                if not vfiles:
                    continue
                clips = _build_source_clips(conn, vfiles, view, probes, rules, clock_offset_ms)
                tl = clip_timeline.build_timeline(view, clips, max_gap_s=max_clip_gap_s)
                timelines[view] = tl

            front_tl = timelines.get("front")
            db.upsert_stage(
                conn, upload_id, "clip_sort",
                "flagged" if front_tl and not front_tl.ordering_confident else "done", 100,
                {v: tl.as_findings() for v, tl in timelines.items()},
            )
            db.upsert_stage(conn, upload_id, "gap_detect",
                            "flagged" if _has_large_gap(timelines) else "done", 100,
                            {v: tl.gaps for v, tl in timelines.items()})
            db.upsert_stage(conn, upload_id, "overlap_detect", "done", 100,
                            {v: tl.overlaps for v, tl in timelines.items()})

        # -------------------------------------------------------------------
        # gps_merge — one clean track from N files (or from the video / the app)
        # -------------------------------------------------------------------
        track: list[gps_ingest.Fix] = []
        gps_findings: dict = {}

        if gps_source == "app_journey":
            # UC2: the track lives in the journey the footage is being attached to, so
            # the conformance call reads it from there. Nothing to merge here.
            gps_findings = {"source": "app_journey",
                            "note": "GPS was recorded in the app; read from the journey"}
            db.upsert_stage(conn, upload_id, "gps_merge", "skipped", 100, gps_findings)
        elif gps_source == "embedded":
            track, gps_findings = _extract_embedded_track(front, clock_offset_ms)
            db.upsert_stage(conn, upload_id, "gps_merge",
                            "done" if track else "flagged", 100, gps_findings)
        else:
            track, gps_findings = _merge_gps_files(conn, gps_files, clock_offset_ms)
            db.upsert_stage(conn, upload_id, "gps_merge",
                            "done" if track else "flagged", 100, gps_findings)

        # -------------------------------------------------------------------
        # reconcile — does the video's wall-clock span line up with the GPS span?
        # -------------------------------------------------------------------
        recon: dict = {"verdict": "skipped"}
        front_tl = timelines.get("front")
        if track and front_tl and front_tl.start_epoch_ms is not None:
            recon = reconcile.reconcile(
                front_tl.start_epoch_ms, front_tl.end_epoch_ms,
                track[0].epoch_ms, track[-1].epoch_ms,
                min_overlap_pct=min_overlap_pct,
            )
            # A timezone-shaped mismatch is a misconfigured camera clock, not a bad
            # upload. Apply the inferred correction and re-check, so the instructor
            # isn't asked to fix something we can already see the answer to.
            suggested = recon.get("suggested_clock_offset_ms")
            if suggested:
                for tl in timelines.values():
                    _shift_timeline(tl, suggested)
                recon_after = reconcile.reconcile(
                    front_tl.start_epoch_ms, front_tl.end_epoch_ms,
                    track[0].epoch_ms, track[-1].epoch_ms,
                    min_overlap_pct=min_overlap_pct, detect_clock_error=False,
                )
                recon = {**recon, "applied_clock_offset_ms": suggested,
                         "after_correction": recon_after}
        db.upsert_stage(
            conn, upload_id, "reconcile",
            {"pass": "done", "warn": "flagged", "fail": "flagged", "skipped": "skipped"}
            .get(recon.get("verdict", "skipped"), "flagged"),
            100, recon,
        )

        # -------------------------------------------------------------------
        # merge + transcode — assembled from the timeline, in the timeline's order
        # -------------------------------------------------------------------
        merged_duration = None
        view_probe: dict[str, object] = {}
        can_merge = media.ffmpeg_available() and (front or rear) and route_id
        if can_merge:
            db.upsert_stage(conn, upload_id, "merge", "running", 0)
            files_by_id = {f["id"]: f for f in files}

            # Phase 25 encode settings — tunable from platform_config, no redeploy.
            ladder = db.get_config_json(conn, "hls_ladder", None)
            # Corrected rather than trusted: only H.264 decodes on every client we
            # support, so a stray config value is logged and overridden here instead of
            # producing footage part of the audience cannot play.
            hls_codec = ffmpeg_ops.resolve_codec(db.get_config_value(conn, "hls_codec", "h264"))
            segment_s = int(db.get_config_float(conn, "hls_segment_seconds", 6))
            thumb_at = db.get_config_float(conn, "thumbnail_at_seconds", 10.0)

            encode_report: dict[str, object] = {
                "codec": hls_codec,
                "segment_seconds": segment_s,
                "requested_ladder": [r.get("height") for r in (ladder or [])] or "default",
            }
            # Routes whose assembled footage turned out byte-identical to something we
            # already published. Recorded rather than acted on destructively: the new
            # route keeps its own metadata row (which is what the product wants) and an
            # admin can see the two share footage.
            dup_routes: dict[str, str] = {}

            for view in ("front", "rear"):
                tl = timelines.get(view)
                if not tl or not tl.entries:
                    continue
                plan = clip_timeline.media_plan(tl, files_by_id)
                built = media.build_view(
                    route_id, view, plan,
                    ladder=ladder, codec=hls_codec,
                    segment_seconds=segment_s, thumbnail_at_seconds=thumb_at,
                )
                if not built:
                    continue
                p = built["probe"]
                view_probe[view] = p
                if view == "front":
                    merged_duration = p.duration_s

                # Content-hash dedup, worker side. The API already blocks duplicates it
                # can see before the upload happens; this catches the rest — a client
                # that sent no hash, or clips that only become byte-identical once
                # concatenated. We point the new row at the object we already hold and
                # skip storing a second copy of footage that is kept forever.
                existing = db.find_video_by_sha256(conn, built.get("sha256"))
                origin = "upload"
                storage_key = built["merged_key"]
                manifest_key = built["hls_key"]
                variants = built.get("variants")
                if existing and existing["route_id"] != route_id:
                    dup_routes[view] = str(existing["route_id"])
                    storage_key = existing["storage_key"]
                    manifest_key = existing["manifest_key"]
                    variants = existing.get("variants") or variants
                    origin = "dedup"
                    log.info(
                        "upload %s %s view is byte-identical to route %s — reusing its objects",
                        upload_id, view, existing["route_id"],
                    )
                    # Remove the copy this run just uploaded; the canonical object stays.
                    # Safe because the keys differ by route id, so this can only ever
                    # delete the redundant copy we created moments ago.
                    for redundant in (built["merged_key"], built["hls_key"]):
                        if redundant not in (storage_key, manifest_key):
                            try:
                                storage.delete(redundant)
                            except Exception as e:  # noqa: BLE001
                                log.warning("could not remove duplicate %s: %s", redundant, e)

                db.write_route_video(
                    conn, route_id, view, "hls",
                    storage_key=storage_key, manifest_key=manifest_key,
                    codec=p.codec, width=p.width, height=p.height, fps=p.fps,
                    duration_s=p.duration_s, sync_offset_ms=0,
                    sha256=built.get("sha256"), variants=variants,
                    bytes_=built.get("bytes"), object_origin=origin,
                )
                if built.get("thumbnail_key"):
                    db.write_route_preview(
                        conn, route_id, built["thumbnail_key"],
                        thumbnail_small_key=built.get("thumbnail_small_key"),
                        captured_at_ms=built.get("thumbnail_at_ms"),
                    )
                # Report the ladder actually produced, which may be shorter than the one
                # requested: rungs above the source resolution are dropped rather than
                # upscaled, so this is the honest record of what a learner can receive.
                encode_report[view] = {
                    "source_height": p.height,
                    "variants": [v["height"] for v in (built.get("variants") or [])],
                    "sha256": (built.get("sha256") or "")[:12] or None,
                    "master_bytes": built.get("bytes"),
                    "duplicate_of_route": dup_routes.get(view),
                }

            for s in ("merge", "reencode", "preview_gen"):
                db.upsert_stage(conn, upload_id, s, "done", 100)
            db.upsert_stage(conn, upload_id, "transcode", "done", 100, encode_report)
        elif not is_map_only:
            reason = "ffmpeg unavailable" if not media.ffmpeg_available() else "no video clips"
            for s in ("merge", "reencode", "transcode", "preview_gen"):
                db.upsert_stage(conn, upload_id, s, "skipped", 100, {"reason": reason})

        # -------------------------------------------------------------------
        # front/rear checks
        # -------------------------------------------------------------------
        if not is_map_only:
            fr = reconcile.reconcile_front_rear(
                timelines["front"].total_video_ms if "front" in timelines else 0,
                timelines["rear"].total_video_ms if "rear" in timelines else 0,
                max_drift_s=max_fr_drift_s,
            )
            db.upsert_stage(conn, upload_id, "front_rear_reconcile",
                            "flagged" if fr["drift_exceeds_threshold"] else "done", 100, fr)

            rear_sync = _align_rear(timelines, files, route_id, conn)
            db.upsert_stage(conn, upload_id, "audio_sync",
                            "flagged" if rear_sync.get("needs_review") else "done",
                            100, rear_sync)

        # -------------------------------------------------------------------
        # sync_engine — how the video clock relates to the GPS clock
        # -------------------------------------------------------------------
        sync = _resolve_video_gps_sync(gps_source, timelines, track, recon, gps_findings)
        db.upsert_stage(conn, upload_id, "sync_engine",
                        "flagged" if sync.get("needs_review") else "done", 100, sync)
        db.update_upload_sync(conn, upload_id, sync.get("offset_ms"),
                              int(sync.get("confidence") or 0))

        # -------------------------------------------------------------------
        # GPS validation (quality score input) — unchanged semantics
        # -------------------------------------------------------------------
        gpx_text = None
        gps_quality_findings = {"gps_quality": 50, "note": "no GPS track"}
        legacy_gpx = next((f for f in gps_files
                           if (f["original_name"] or "").lower().endswith(".gpx")), None)
        if legacy_gpx:
            try:
                gpx_text = _download_text(legacy_gpx["storage_key"])
                gps_quality_findings = gps_validation.validate_gpx(gpx_text)
                db.write_route_gpx(conn, route_id, legacy_gpx["storage_key"],
                                   gps_quality_findings.get("point_count", 0),
                                   gps_quality_findings.get("gps_quality", 0))
            except Exception as e:  # noqa: BLE001
                gps_quality_findings = {"gps_quality": 0, "error": str(e)}
        elif track:
            # No GPX to validate, but we have a merged track — score it from the merge
            # findings so the quality score isn't penalised for a format choice.
            gps_quality_findings = _quality_from_merge(gps_findings)
        db.upsert_stage(conn, upload_id, "gps_validate",
                        "flagged" if gps_quality_findings.get("gps_quality", 0) < 40 else "done",
                        100, gps_quality_findings)

        # -------------------------------------------------------------------
        # conformance (R1) + track points — the moving map's data
        # -------------------------------------------------------------------
        analysis = None
        conf_findings: dict = {"skipped": "no reference route linked"}
        needs_r1 = bool(upload.get("reference_route_id")) or gps_source == "app_journey"
        if needs_r1 and route_id:
            try:
                fixes = (gps_ingest.to_relative_fixes(track, track[0].epoch_ms)
                         if track else None)
                analysis = conformance.analyse_upload(
                    upload_id, fixes,
                    video_source="dual" if rear else "dashcam",
                )
                conf_findings = {
                    "verdict": analysis.get("verdict"),
                    "coveragePct": analysis.get("coveragePct"),
                    "maxDeviationM": analysis.get("maxDeviationM"),
                    "deviationCount": analysis.get("deviationCount"),
                    "rejectReason": analysis.get("rejectReason"),
                    "keptSegments": len(analysis.get("segments") or []),
                }
            except conformance.ConformanceError as e:
                conf_findings = {"error": str(e)}
        db.upsert_stage(
            conn, upload_id, "conformance",
            "done" if (analysis and analysis.get("verdict") == "verified")
            else ("flagged" if analysis else "skipped"),
            100, conf_findings,
        )

        track_findings = {"points": 0}
        if analysis and route_id:
            points = _build_track_points(
                analysis, track, timelines.get("front"), gps_source, sync, track_hz
            )
            db.write_track_points(conn, route_id, points)
            track_findings = {
                "points": len(points),
                "source": "R1-snapped conformance timeline",
                "dropped_in_gaps": len(analysis.get("timeline") or []) - len(points),
            }
        db.upsert_stage(conn, upload_id, "track_points",
                        "done" if track_findings["points"] else "skipped", 100,
                        track_findings)

        # Persist the clip→wall-clock mapping (playback + admin forensics).
        if route_id and timelines:
            rows: list[tuple] = []
            for tl in timelines.values():
                rows.extend(clip_timeline.rows_for_db(route_id, tl))
            db.write_clip_timeline(conn, route_id, rows)

        # -------------------------------------------------------------------
        # remaining stages (unchanged behaviour)
        # -------------------------------------------------------------------
        vid_findings = {"video_quality": 70, "note": "no merged video"}
        if view_probe.get("front"):
            vid_findings = _video_findings(view_probe["front"])
        db.upsert_stage(conn, upload_id, "video_validate",
                        "flagged" if vid_findings["video_quality"] < 40 else "done",
                        100, vid_findings)

        db.upsert_stage(conn, upload_id, "ai_privacy_blur",
                        "done" if config.ENABLE_AI_BLUR else "skipped", 100,
                        {"enabled": config.ENABLE_AI_BLUR})

        dup = None
        if gpx_text:
            fp = fingerprint.fingerprint_gpx(gpx_text)
            dup = fingerprint.is_duplicate(conn, fp)
            if not dup and route_id:
                db.write_fingerprint(conn, route_id, fp)
        db.upsert_stage(conn, upload_id, "duplicate_check",
                        "flagged" if dup else "done", 100, {"duplicate": dup})

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

        front_gaps = timelines["front"].gaps if "front" in timelines else []
        total_video_s = (timelines["front"].total_video_ms / 1000
                         if "front" in timelines else 0) or 1
        completeness = quality_score.completeness_from_gaps(front_gaps, total_video_s)
        qs = quality_score.compute(
            gps_quality=gps_quality_findings.get("gps_quality", 50),
            video_quality=vid_findings.get("video_quality", 70),
            completeness=completeness,
            sync_confidence=int(sync.get("confidence") or 0),
            contributor_rep=50,
        )
        db.upsert_stage(conn, upload_id, "quality_score", "done", 100, qs)

        # -------------------------------------------------------------------
        # finalise
        # -------------------------------------------------------------------
        if route_id:
            db.write_quality_score(conn, route_id, qs)
            db.update_route_summary(
                conn, route_id,
                distance_m=gps_findings.get("distance_m")
                or gps_quality_findings.get("distance_m"),
                duration_s=int(merged_duration) if merged_duration
                else gps_quality_findings.get("duration_s"),
                quality_score=qs["overall"],
                sync_confidence=int(sync.get("confidence") or 0),
            )
            final_status = _final_status(
                is_map_only, analysis, recon, sync, min_confidence
            )
            db.set_route_status(conn, route_id, final_status)
            if is_map_only:
                conn.execute("UPDATE routes SET has_video = FALSE WHERE id = %s", (route_id,))

        db.upsert_stage(conn, upload_id, "ready", "done", 100, {
            "instructions": len(nav["instructions"]),
            "junctions": nav["junction_count"],
            "roundabouts": nav["roundabout_count"],
            "track_points": track_findings["points"],
            "sync_confidence": sync.get("confidence"),
        })
        db.set_upload_status(conn, upload_id, "completed")
        _report(upload_id, "completed")
        log.info("upload %s processed (quality=%s, route=%s, track=%s points)",
                 upload_id, qs["overall"], route_id, track_findings["points"])

    except Exception as e:  # noqa: BLE001
        log.exception("pipeline failed for %s", upload_id)
        db.set_upload_status(conn, upload_id, "failed", str(e))
        if route_id:
            db.set_route_status(conn, route_id, "flagged")
        _report(upload_id, "failed", str(e))
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# stage helpers
# ---------------------------------------------------------------------------

def _build_source_clips(conn, vfiles, view, probes, rules, clock_offset_ms):
    """
    Turn upload rows into `SourceClip`s with the best start time we can defend.

    Evidence ladder — filename, then container metadata, then mtime:
      * the filename is written by the camera and survives copying;
      * `creation_time` is written by the camera too but is often stripped or absent;
      * mtime is whatever the last filesystem touched it decided, so it is a last
        resort and gets flagged as weak evidence in the timeline notes.

    The instructor's `declared_ordinal` overrides ordering entirely, but not the
    timestamps — a human can tell us the right ORDER without knowing the right times.
    """
    clips = []
    for f in vfiles:
        probe = probes.get(f["id"])
        duration_ms = int(round((probe.duration_s if probe else (f.get("duration_s") or 0)) * 1000))

        parsed = dashcam_formats.parse_clip_name(
            f["original_name"] or "", rules, local_tz=config.DASHCAM_LOCAL_TZ
        )
        start_ms, source, brand = None, "unknown", parsed.brand
        if parsed.start_epoch_ms is not None:
            start_ms, source = parsed.start_epoch_ms, "filename"
        elif probe is not None and getattr(probe, "creation_epoch_ms", None):
            start_ms, source = probe.creation_epoch_ms, "container"
        elif f.get("started_at"):
            # Client-probed / mtime value stored at init.
            start_ms, source = int(f["started_at"].timestamp() * 1000), "mtime"

        if start_ms is not None:
            start_ms += clock_offset_ms

        clips.append(clip_timeline.SourceClip(
            file_id=f["id"],
            name=f["original_name"] or f["storage_key"],
            view=view,
            duration_ms=duration_ms,
            start_epoch_ms=start_ms,
            start_source=source,
            brand=brand,
            seq=parsed.seq,
            declared_ordinal=f.get("declared_ordinal"),
        ))

    # Write back what we worked out, so the review screen can show its evidence.
    for i, c in enumerate(sorted(clips, key=lambda c: (c.start_epoch_ms or 0, c.name))):
        db.update_upload_file_timing(
            conn, c.file_id,
            start_epoch_ms=c.start_epoch_ms,
            end_epoch_ms=c.end_epoch_ms,
            duration_s=c.duration_ms / 1000 if c.duration_ms else None,
            start_source=c.start_source,
            brand=c.brand,
            ordinal=i,
        )
    return clips


def _merge_gps_files(conn, gps_files, clock_offset_ms):
    """Parse and merge every uploaded GPS log into one track (UC1, `camera` source)."""
    parsed: list[gps_ingest.ParsedFile] = []
    extensions = dashcam_formats.gps_extensions(conn)

    for f in gps_files:
        name = f["original_name"] or f["storage_key"]
        ext = os.path.splitext(name)[1].lower()
        family = extensions.get(ext, "gpx")
        try:
            text = _download_text(f["storage_key"])
        except Exception as e:  # noqa: BLE001
            parsed.append(gps_ingest.ParsedFile(name=name, fmt=family, fixes=[],
                                                error=f"download failed: {e}"))
            continue
        pf = gps_ingest.parse_text(text, family, name=name)
        parsed.append(pf)
        db.update_gps_file_stats(
            conn, f["id"], pf.count, pf.fmt,
            pf.fixes[0].epoch_ms if pf.fixes else None,
            pf.fixes[-1].epoch_ms if pf.fixes else None,
        )

    track, findings = gps_ingest.merge(parsed)

    # A camera whose clock is wrong writes that same wrong clock into its GPS log, so
    # the instructor's correction applies to both. Shifting the track keeps it aligned
    # with the video rather than pulling them apart.
    if clock_offset_ms and track:
        for fx in track:
            fx.epoch_ms += clock_offset_ms
        findings["clock_offset_applied_ms"] = clock_offset_ms
        findings["start_epoch_ms"] = track[0].epoch_ms
        findings["end_epoch_ms"] = track[-1].epoch_ms

    return track, findings


def _extract_embedded_track(front, clock_offset_ms):
    """Pull GPS out of the video files themselves (`embedded` source, UC1 best case)."""
    work = tempfile.mkdtemp(prefix="rs_embed_")
    fixes: list[gps_ingest.Fix] = []
    per_file = []
    try:
        for i, f in enumerate(front):
            local = os.path.join(work, f"v{i}.mp4")
            try:
                storage.download(f["storage_key"], local)
                got = gps_ingest.extract_embedded(local)
            except Exception as e:  # noqa: BLE001
                per_file.append({"name": f["original_name"], "points": 0, "error": str(e)})
                continue
            per_file.append({"name": f["original_name"], "points": len(got)})
            fixes.extend(got)
    finally:
        shutil.rmtree(work, ignore_errors=True)

    parsed = [gps_ingest.ParsedFile(name="embedded", fmt="embedded", fixes=fixes)]
    track, findings = gps_ingest.merge(parsed)
    findings["per_video"] = per_file
    if not track:
        findings["error"] = (
            "no GPS could be read from the video files — the camera may not embed it, "
            "or exiftool is not installed on the worker"
        )
    elif clock_offset_ms:
        for fx in track:
            fx.epoch_ms += clock_offset_ms
        findings["clock_offset_applied_ms"] = clock_offset_ms
    return track, findings


def _align_rear(timelines, files, route_id, conn):
    """
    Resolve the rear stream's offset and store it on `route_videos`.

    Audio correlation is attempted first because it doesn't care whether either
    camera's clock is right; the clip timestamps are the fallback.
    """
    front_tl, rear_tl = timelines.get("front"), timelines.get("rear")
    if not front_tl or not rear_tl or not rear_tl.entries:
        return {"skipped": "single camera view"}
    if not media.ffmpeg_available():
        return {"skipped": "ffmpeg unavailable", "needs_review": True}

    files_by_id = {f["id"]: f for f in files}
    work = tempfile.mkdtemp(prefix="rs_audio_")
    try:
        f_env = media.audio_envelope_for(
            clip_timeline.media_plan(front_tl, files_by_id), work)
        r_env = media.audio_envelope_for(
            clip_timeline.media_plan(rear_tl, files_by_id), work)
    finally:
        shutil.rmtree(work, ignore_errors=True)

    result = audio_sync.align_front_rear(
        f_env, r_env, front_tl.start_epoch_ms, rear_tl.start_epoch_ms
    )
    if route_id:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE route_videos SET sync_offset_ms = %s
                    WHERE route_id = %s AND view = 'rear'::camera_view""",
                (result["offset_ms"], route_id),
            )
    return result


def _resolve_video_gps_sync(gps_source, timelines, track, recon, gps_findings):
    """
    Decide how confident we are that video time maps to GPS time, and by what offset.

    The three cases are genuinely different and are reported as such rather than being
    flattened into one number:

      * `embedded` — position and frames came off one device with one clock. Exact by
        construction; no correlation needed and none claimed.
      * `camera` (UC1) — separate GPS log from the same camera, so the clocks agree to
        within the camera's own consistency. Verified through the span overlap, which
        is what `reconcile` measured.
      * `app_journey` (UC2) — two independent clocks. Timestamps get us close; genuine
        precision needs the speed correlation, and until the video-motion signal is
        extracted this stays a flagged estimate rather than a silent guess.
    """
    front_tl = timelines.get("front")

    if gps_source == "embedded":
        return {
            "offset_ms": 0, "confidence": 100, "method": "shared_clock",
            "needs_review": False,
            "note": "GPS and video came from one device — frame-exact by construction",
        }

    if gps_source == "camera":
        verdict = recon.get("verdict")
        overlap = float(recon.get("overlap_pct") or 0)
        if verdict == "pass":
            # Confidence tracks how completely GPS covers the video; a full overlap on a
            # single camera clock is about as good as non-embedded gets.
            return {
                "offset_ms": recon.get("applied_clock_offset_ms", 0),
                "confidence": int(min(95, 70 + overlap * 0.25)),
                "method": "camera_clock",
                "needs_review": False,
                "overlap_pct": overlap,
            }
        return {
            "offset_ms": recon.get("applied_clock_offset_ms", 0),
            "confidence": int(max(30, overlap * 0.5)),
            "method": "camera_clock",
            "needs_review": True,
            "overlap_pct": overlap,
            "reason": recon.get("reason", "video and GPS spans do not agree"),
        }

    # UC2 — camera and app clocks are unrelated.
    speed_series = gps_ingest.speed_series(track) if track else []
    coarse = 0
    if front_tl and front_tl.start_epoch_ms is not None and track:
        coarse = front_tl.start_epoch_ms - track[0].epoch_ms
    result = sync_engine.align(
        None, speed_series or None,
        coarse_offset_ms=coarse,
        gps_quality=int(gps_findings.get("gps_quality", 60) or 60),
        gap_count=len(front_tl.gaps) if front_tl else 0,
    )
    confidence = int(round(float(result.get("sync_confidence", 0)) * 100))
    return {
        "offset_ms": result.get("offset_ms", coarse),
        "confidence": confidence,
        "method": result.get("method", "timestamp_only"),
        # UC2 is exactly the case the instructor's scrub-to-match confirmation exists
        # for: correlation without a video-motion signal is an estimate, and we say so.
        "needs_review": confidence < 70,
        "note": "camera and app clocks are independent — alignment is estimated",
    }


def _build_track_points(analysis, track, front_tl, gps_source, sync, track_hz):
    """
    Turn the conformance timeline into `route_track_points` on VIDEO time.

    Three conversions happen here, and the order matters:
      1. the analysis timeline is in track-relative ms → convert to absolute epoch;
      2. absolute epoch → position in the concatenated video, via the clip mapping
         (this is where inter-clip gaps are honoured);
      3. bearing is computed from consecutive kept points.

    Samples that land in a gap between clips are DROPPED rather than snapped to the
    nearest clip. That instant was never filmed, so there is no frame it belongs to —
    and placing it on a neighbouring clip would show footage from somewhere else.
    """
    timeline = analysis.get("timeline") or []
    if not timeline:
        return []

    # Origin: for UC1 the track we posted started at `track[0]`; for UC2 the API read
    # the app-recorded track, whose zero is the journey start.
    if track:
        origin_epoch = track[0].epoch_ms
    elif front_tl and front_tl.start_epoch_ms is not None:
        origin_epoch = front_tl.start_epoch_ms - int(sync.get("offset_ms") or 0)
    else:
        origin_epoch = 0

    # Thin to the configured cadence — GPS is typically 1 Hz already, but a phone
    # recorder can produce far more, and the player interpolates anyway.
    step_ms = int(1000 / track_hz) if track_hz > 0 else 1000

    points: list[dict] = []
    last_t = None
    for s in timeline:
        epoch = origin_epoch + int(s["tMs"])

        if front_tl and front_tl.entries:
            video_ms = clip_timeline.wall_ms_to_video(front_tl, epoch)
            if video_ms is None:
                continue  # fell in a gap, or outside the recorded footage
        else:
            # Map-only route: there is no video, so video time IS track time.
            video_ms = int(s["tMs"])

        if last_t is not None and video_ms - last_t < step_ms:
            continue
        last_t = video_ms

        points.append({
            "t_ms": int(video_ms),
            "lat": s["lat"],
            "lng": s["lng"],
            "arc_m": s.get("arcM"),
            "on_route": True,   # the analysis timeline only contains kept spans
            "speed_mps": None,
            "bearing_deg": None,
        })

    points.sort(key=lambda p: p["t_ms"])
    _add_bearings_and_speed(points)
    return points


def _add_bearings_and_speed(points: list[dict]):
    """
    Fill in bearing and speed from consecutive positions.

    Computed here rather than in the client because a client deriving heading from two
    1 Hz points gets wild jitter whenever the car is slow or stopped — the direction of
    a 30 cm move is meaningless. Bearing is held over short hops instead of recomputed,
    so a stationary marker keeps pointing the way it was last actually travelling.
    """
    if len(points) < 2:
        return
    last_bearing = None
    for a, b in zip(points, points[1:]):
        dt_s = (b["t_ms"] - a["t_ms"]) / 1000.0
        d_m = _haversine_m(a["lat"], a["lng"], b["lat"], b["lng"])
        if dt_s > 0:
            a["speed_mps"] = round(d_m / dt_s, 2)
        if d_m >= 2.0:  # far enough for the direction to mean something
            last_bearing = _bearing_deg(a["lat"], a["lng"], b["lat"], b["lng"])
        a["bearing_deg"] = last_bearing
    points[-1]["bearing_deg"] = last_bearing
    points[-1]["speed_mps"] = points[-2]["speed_mps"] if len(points) > 1 else 0.0


def _final_status(is_map_only, analysis, recon, sync, min_confidence):
    """
    Where the route lands after processing.

    Anything below the conformance or confidence bar goes to `flagged` rather than
    `in_review`: both queues are human-reviewed, but flagged says "we already know
    something is wrong with this", which is the difference between a queue that gets
    triaged and one that gets rubber-stamped.
    """
    if is_map_only:
        return "map_only"
    if analysis and analysis.get("verdict") == "rejected":
        return "flagged"
    if recon.get("verdict") == "fail":
        return "flagged"
    if int(sync.get("confidence") or 0) < min_confidence:
        return "flagged"
    return "in_review"


def _video_findings(probe) -> dict:
    """
    Score the merged front master from its probe.

    Resolution and frame rate are what actually limit a learner's ability to read road
    signs and judge a junction, so they carry the deductions. This is a cheap
    header-level check; `video_validation.validate_video` does the expensive
    frame-level pass (black frames, freezes) when the file is available locally.
    """
    score = 100
    if probe.height and probe.height < 720:
        score -= 30            # below 720p, signage becomes hard to read
    elif probe.height and probe.height < 1080:
        score -= 10
    if probe.fps and probe.fps < 24:
        score -= 20            # judder makes fast junctions hard to follow
    if not probe.duration_s:
        score -= 40            # unreadable duration usually means a damaged file
    return {
        "video_quality": max(0, score),
        "width": probe.width,
        "height": probe.height,
        "fps": probe.fps,
        "codec": probe.codec,
        "duration_s": round(probe.duration_s, 2) if probe.duration_s else None,
        "has_audio": probe.has_audio,
    }


def _has_large_gap(timelines) -> bool:
    return any(g.get("large") for tl in timelines.values() for g in tl.gaps)


def _shift_timeline(tl, offset_ms: int):
    """Apply an inferred clock correction to every wall-clock field in a timeline."""
    for e in tl.entries:
        e.wall_start_epoch_ms += offset_ms
        e.wall_end_epoch_ms += offset_ms


def _quality_from_merge(findings: dict) -> dict:
    """
    Derive a GPS quality score from the merge findings when there's no GPX to validate.

    Mirrors `gps_validation`'s deduction style so a route isn't scored differently just
    because its GPS arrived as NMEA rather than GPX.
    """
    score = 100
    score -= min(30, int(findings.get("implausible_dropped", 0)) * 5)
    score -= 15 * len(findings.get("failed_files") or [])
    hz = findings.get("sample_hz")
    if hz is not None and hz < 0.5:
        score -= 20  # sparser than one fix every two seconds
    return {
        "gps_quality": max(0, score),
        "point_count": findings.get("point_count", 0),
        "distance_m": findings.get("distance_m"),
        "duration_s": findings.get("span_s"),
        "derived_from": "merged_track",
    }


def _haversine_m(lat1, lon1, lat2, lon2) -> float:
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def _bearing_deg(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return round((math.degrees(math.atan2(y, x)) + 360) % 360, 1)
