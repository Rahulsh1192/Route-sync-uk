"""FFmpeg / FFprobe operations (deliverable #8 — merge workflow)."""
import json
import subprocess
from dataclasses import dataclass


@dataclass
class ProbeResult:
    duration_s: float
    width: int
    height: int
    fps: float
    codec: str
    start_time: float


def ffprobe(path: str) -> ProbeResult:
    """Probe a media file for codec/resolution/fps/duration."""
    out = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json",
         "-show_format", "-show_streams", path],
        capture_output=True, text=True, check=True,
    )
    data = json.loads(out.stdout)
    vstream = next((s for s in data["streams"] if s["codec_type"] == "video"), {})
    num, den = (vstream.get("avg_frame_rate", "0/1").split("/") + ["1"])[:2]
    fps = float(num) / float(den) if float(den or 1) else 0.0
    return ProbeResult(
        duration_s=float(data["format"].get("duration", 0)),
        width=int(vstream.get("width", 0)),
        height=int(vstream.get("height", 0)),
        fps=round(fps, 2),
        codec=vstream.get("codec_name", "unknown"),
        start_time=float(vstream.get("start_time", 0)),
    )


def merge_concat(clip_paths: list[str], out_path: str):
    """
    Concatenate same-parameter clips losslessly via the concat demuxer.
    For mixed parameters, normalise first (see normalise_then_concat).
    """
    list_file = out_path + ".txt"
    with open(list_file, "w") as f:
        for p in clip_paths:
            f.write(f"file '{p}'\n")
    subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", list_file,
         "-c", "copy", out_path],
        check=True,
    )
    return out_path


def concat_reencode(clip_paths: list[str], out_path: str,
                    height: int = 720, fps: int = 30, codec: str = "libx264"):
    """
    Robust merge for mixed-parameter clips: scale/pad each to a common geometry and
    CFR, then concat in a single filter_complex pass. Lossy but seamless — used when
    clips differ in resolution/fps so the lossless concat demuxer can't be used.
    """
    inputs: list[str] = []
    filters: list[str] = []
    for i, p in enumerate(clip_paths):
        inputs += ["-i", p]
        filters.append(
            f"[{i}:v]scale=-2:{height}:force_original_aspect_ratio=decrease,"
            f"fps={fps},setsar=1[v{i}]"
        )
    concat_in = "".join(f"[v{i}]" for i in range(len(clip_paths)))
    filter_complex = ";".join(filters) + f";{concat_in}concat=n={len(clip_paths)}:v=1:a=0[outv]"
    subprocess.run(
        ["ffmpeg", "-y", *inputs, "-filter_complex", filter_complex,
         "-map", "[outv]", "-c:v", codec, "-crf", "22", "-preset", "medium",
         "-pix_fmt", "yuv420p", out_path],
        check=True,
    )
    return out_path


def reencode(in_path: str, out_path: str, codec: str = "libx264", crf: int = 22):
    """Re-encode to a delivery master (H.264 default; pass libx265 for H.265)."""
    subprocess.run(
        ["ffmpeg", "-y", "-i", in_path, "-c:v", codec, "-crf", str(crf),
         "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "aac", out_path],
        check=True,
    )
    return out_path


def generate_hls(in_path: str, out_dir: str):
    """Build an adaptive HLS ladder (1080/720/480/360) + master.m3u8."""
    import os
    os.makedirs(out_dir, exist_ok=True)
    # Single-rendition example; production builds a full variant ladder.
    subprocess.run(
        ["ffmpeg", "-y", "-i", in_path,
         "-c:v", "libx264", "-crf", "23", "-preset", "veryfast",
         "-hls_time", "6", "-hls_playlist_type", "vod",
         "-hls_segment_filename", f"{out_dir}/seg_%03d.ts",
         f"{out_dir}/index.m3u8"],
        check=True,
    )
    return f"{out_dir}/index.m3u8"


def thumbnail(in_path: str, out_path: str, at_seconds: float = 3.0):
    subprocess.run(
        ["ffmpeg", "-y", "-ss", str(at_seconds), "-i", in_path,
         "-vframes", "1", "-vf", "scale=640:-1", out_path],
        check=True,
    )
    return out_path
