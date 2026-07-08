"""Video validation: resolution/fps/corruption/black/frozen frames + score."""
import subprocess
from .ffmpeg_ops import ffprobe


def validate_video(path: str):
    """
    Probe + use ffmpeg's blackdetect/freezedetect filters to find defects.
    Returns findings + a 0..100 video quality score.
    """
    try:
        probe = ffprobe(path)
    except subprocess.CalledProcessError:
        return {"video_quality": 0, "corruption": True, "error": "ffprobe failed"}

    black = _run_detect(path, "blackdetect=d=0.5:pix_th=0.10", "black_start")
    frozen = _run_detect(path, "freezedetect=n=-60dB:d=1", "freeze_start")

    score = 100
    if probe.height < 720:
        score -= 20
    if probe.fps < 24:
        score -= 15
    score -= min(30, black * 5)
    score -= min(25, frozen * 5)
    score = max(0, score)

    return {
        "video_quality": score,
        "width": probe.width,
        "height": probe.height,
        "fps": probe.fps,
        "codec": probe.codec,
        "duration_s": round(probe.duration_s, 2),
        "black_frame_events": black,
        "frozen_frame_events": frozen,
        "corruption": False,
    }


def _run_detect(path: str, vf: str, marker: str) -> int:
    """Count occurrences of a detect marker in ffmpeg stderr."""
    proc = subprocess.run(
        ["ffmpeg", "-i", path, "-vf", vf, "-an", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    return proc.stderr.count(marker)
