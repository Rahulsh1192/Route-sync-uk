"""
Media path orchestration for the upload->playback slice.

Downloads raw clips for one camera view, merges them, builds an HLS rendition and
a thumbnail, and uploads the results to object storage. Returns the storage keys
and probed metadata the pipeline writes into route_videos / route_previews.

FFmpeg/FFprobe are required at runtime. The pipeline guards calls into here so a
missing binary degrades a stage to "skipped" rather than crashing the worker.
"""
import logging
import os
import shutil
import tempfile

from . import ffmpeg_ops, storage

log = logging.getLogger("media")


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def probe_headers(files: list[dict]) -> dict[str, ffmpeg_ops.ProbeResult]:
    """
    Probe every clip's duration and creation time WITHOUT downloading it.

    ffprobe reads a presigned URL over HTTP and only fetches the bytes it needs, so a
    set of half-gigabyte dashcam clips is inspected in seconds. This runs before the
    timeline is built, because clip durations are exactly what the ordering and
    gap analysis depend on — and we'd rather find out a file is unreadable now than
    after paying to download it.

    Returns a map of `upload_files.id` → probe result, omitting files that failed.
    """
    out: dict[str, ffmpeg_ops.ProbeResult] = {}
    for f in files:
        try:
            url = storage.presign_get(f["storage_key"])
            out[f["id"]] = ffmpeg_ops.ffprobe(url)
        except Exception as e:  # noqa: BLE001 — one bad clip must not stop the upload
            log.warning("could not probe %s: %s", f.get("original_name"), e)
    return out


def _prepare_clips(plan: list[dict], work_dir: str) -> list[str]:
    """
    Download the planned clips in the planned order, applying any front trim.

    The order comes from the timeline, never from a re-sort here: the timeline is what
    every downstream timestamp is computed against, so the media must be assembled to
    match it exactly rather than to whatever this layer would have guessed.
    """
    paths: list[str] = []
    for i, item in enumerate(plan):
        f = item["file"]
        ext = os.path.splitext(f["storage_key"])[1] or ".mp4"
        local = os.path.join(work_dir, f"clip_{i}{ext}")
        storage.download(f["storage_key"], local)

        trim_ms = int(item.get("trim_start_ms") or 0)
        if trim_ms > 0:
            trimmed = os.path.join(work_dir, f"clip_{i}_trim.mp4")
            ffmpeg_ops.trim_start(local, trimmed, trim_ms)
            os.remove(local)
            local = trimmed
        paths.append(local)
    return paths


def audio_envelope_for(plan: list[dict], work_dir: str, hz: int = 100) -> list[float]:
    """
    Loudness envelope across a view's clips, concatenated in timeline order.

    Used for front↔rear audio alignment. Built from the same plan as the video so the
    envelope's time base matches the merged output's, which is the only way the
    resulting offset means anything.
    """
    envelope: list[float] = []
    for i, item in enumerate(plan):
        f = item["file"]
        local = os.path.join(work_dir, f"aud_{i}.mp4")
        try:
            storage.download(f["storage_key"], local)
            envelope.extend(ffmpeg_ops.audio_envelope(local, hz=hz))
        except Exception as e:  # noqa: BLE001
            log.info("no audio from %s: %s", f.get("original_name"), e)
        finally:
            if os.path.exists(local):
                os.remove(local)
    return envelope


def build_view(
    route_id: str,
    view: str,
    plan: list[dict],
    ladder: list[dict] | None = None,
    codec: str = "h264",
    segment_seconds: int = 6,
    thumbnail_at_seconds: float = 10.0,
) -> dict:
    """
    Merge + transcode one camera view from a timeline-derived plan.

    `plan` items are `{file, trim_start_ms, expected_duration_ms}` as produced by
    `clip_timeline.media_plan`. Encoding parameters are passed in (rather than read from
    env here) so they stay tunable from `platform_config` without a redeploy.

    Returns:
      { merged_key, hls_key, probe, sha256, variants, bytes,
        thumbnail_key?, thumbnail_small_key?, thumbnail_at_ms? }
    """
    work_dir = tempfile.mkdtemp(prefix=f"rs_{view}_")
    try:
        clips = _prepare_clips(plan, work_dir)
        if not clips:
            return {}

        # Merge: try lossless concat first; fall back to normalising re-encode concat.
        merged = os.path.join(work_dir, f"{view}_merged.mp4")
        try:
            ffmpeg_ops.merge_concat(clips, merged)
        except Exception:
            ffmpeg_ops.concat_reencode(clips, merged)

        probe = ffmpeg_ops.ffprobe(merged)

        # Content hash of the assembled master. This is what deduplication compares:
        # identical footage re-uploaded later resolves to this same digest, so the
        # second upload can point at the object we already have instead of storing it
        # twice — and these files are kept permanently, so a duplicate costs forever.
        sha256 = ffmpeg_ops.sha256_file(merged)

        # Upload merged master.
        merged_key = f"routes/{route_id}/{view}/master.mp4"
        storage.upload(merged, merged_key, "video/mp4")

        # ---- adaptive-bitrate HLS ladder ----
        hls_dir = os.path.join(work_dir, f"{view}_hls")
        built = ffmpeg_ops.generate_hls(
            merged, hls_dir,
            ladder=ladder,
            codec=codec,
            segment_seconds=segment_seconds,
            source_height=probe.height or None,
        )

        hls_prefix = f"routes/{route_id}/{view}/hls"
        # The master playlist keeps the name `index.m3u8`, so `manifest_key` stays
        # exactly where existing rows and clients already expect it.
        hls_key = f"{hls_prefix}/index.m3u8"

        # Upload segments and variant playlists BEFORE the master. A player that fetches
        # a master referencing a playlist that isn't there yet fails hard, and with a CDN
        # in front the 404 can be cached — so ordering here is correctness, not tidiness.
        for entry in sorted(os.listdir(hls_dir)):
            path = os.path.join(hls_dir, entry)
            if entry == "index.m3u8" or not os.path.isfile(path):
                continue
            if entry.endswith(".ts"):
                storage.upload(path, f"{hls_prefix}/{entry}", "video/mp2t")
            elif entry.endswith(".m3u8"):
                storage.upload(path, f"{hls_prefix}/{entry}", "application/vnd.apple.mpegurl")

        storage.upload(built["master"], hls_key, "application/vnd.apple.mpegurl")

        variants = [
            {
                "height": v["height"],
                "bitrateKbps": v["bitrateKbps"],
                "playlistKey": f"{hls_prefix}/{v['name']}.m3u8",
                "codec": v["codec"],
            }
            for v in built["variants"]
        ]

        result = {
            "merged_key": merged_key,
            "hls_key": hls_key,
            "probe": probe,
            "sha256": sha256,
            "variants": variants,
            "bytes": os.path.getsize(merged),
        }

        # Thumbnails from the front view only — the rear view is the road behind, which
        # makes a poster image nobody can identify a route from.
        if view == "front":
            thumbs = ffmpeg_ops.thumbnails(
                merged,
                os.path.join(work_dir, "preview"),
                at_seconds=thumbnail_at_seconds,
                duration_s=probe.duration_s,
            )
            if "large" in thumbs:
                key = f"routes/{route_id}/preview/thumbnail.jpg"
                storage.upload(thumbs["large"], key, "image/jpeg")
                result["thumbnail_key"] = key
            if "small" in thumbs:
                key = f"routes/{route_id}/preview/thumbnail_small.jpg"
                storage.upload(thumbs["small"], key, "image/jpeg")
                result["thumbnail_small_key"] = key
            result["thumbnail_at_ms"] = int(thumbnail_at_seconds * 1000)

        return result
    finally:
        # Always remove the scratch directory: a merged master plus a four-rung ladder is
        # several times the source size, so a leaked temp dir fills the worker's disk
        # within a handful of jobs.
        shutil.rmtree(work_dir, ignore_errors=True)
