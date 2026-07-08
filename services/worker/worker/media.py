"""
Media path orchestration for the upload->playback slice.

Downloads raw clips for one camera view, merges them, builds an HLS rendition and
a thumbnail, and uploads the results to object storage. Returns the storage keys
and probed metadata the pipeline writes into route_videos / route_previews.

FFmpeg/FFprobe are required at runtime. The pipeline guards calls into here so a
missing binary degrades a stage to "skipped" rather than crashing the worker.
"""
import os
import shutil
import tempfile

from . import ffmpeg_ops, storage


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def _download_clips(files: list[dict], work_dir: str) -> list[str]:
    """Download each clip locally, preserving the upload's sort order (ordinal)."""
    ordered = sorted(files, key=lambda f: (f.get("ordinal") or 0, f.get("started_at") or 0,
                                           f["original_name"] or ""))
    paths = []
    for i, f in enumerate(ordered):
        ext = os.path.splitext(f["storage_key"])[1] or ".mp4"
        local = os.path.join(work_dir, f"clip_{i}{ext}")
        storage.download(f["storage_key"], local)
        paths.append(local)
    return paths


def build_view(route_id: str, view: str, files: list[dict]) -> dict:
    """
    Merge + transcode one camera view. Returns:
      { merged_key, hls_key, thumbnail_key?, probe: ProbeResult }
    """
    work_dir = tempfile.mkdtemp(prefix=f"rs_{view}_")
    try:
        clips = _download_clips(files, work_dir)
        if not clips:
            return {}

        # Merge: try lossless concat first; fall back to normalising re-encode concat.
        merged = os.path.join(work_dir, f"{view}_merged.mp4")
        try:
            ffmpeg_ops.merge_concat(clips, merged)
        except Exception:
            ffmpeg_ops.concat_reencode(clips, merged)

        probe = ffmpeg_ops.ffprobe(merged)

        # Upload merged master.
        merged_key = f"routes/{route_id}/{view}/master.mp4"
        storage.upload(merged, merged_key, "video/mp4")

        # HLS rendition.
        hls_dir = os.path.join(work_dir, f"{view}_hls")
        ffmpeg_ops.generate_hls(merged, hls_dir)
        hls_key = f"routes/{route_id}/{view}/hls/index.m3u8"
        storage.upload(os.path.join(hls_dir, "index.m3u8"), hls_key, "application/vnd.apple.mpegurl")
        for seg in sorted(os.listdir(hls_dir)):
            if seg.endswith(".ts"):
                storage.upload(os.path.join(hls_dir, seg),
                               f"routes/{route_id}/{view}/hls/{seg}", "video/mp2t")

        result = {"merged_key": merged_key, "hls_key": hls_key, "probe": probe}

        # Thumbnail from the front view only.
        if view == "front":
            thumb = os.path.join(work_dir, "thumb.jpg")
            ffmpeg_ops.thumbnail(merged, thumb, at_seconds=min(3.0, probe.duration_s / 2))
            thumb_key = f"routes/{route_id}/preview/thumbnail.jpg"
            storage.upload(thumb, thumb_key, "image/jpeg")
            result["thumbnail_key"] = thumb_key

        return result
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
