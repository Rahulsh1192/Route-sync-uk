"""FFmpeg / FFprobe operations (deliverable #8 — merge workflow)."""
import json
import logging
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone

log = logging.getLogger("ffmpeg_ops")


@dataclass
class ProbeResult:
    duration_s: float
    width: int
    height: int
    fps: float
    codec: str
    start_time: float
    # Phase 24: the container's own recording timestamp, when it has one. Second-best
    # evidence for when a clip started, after the filename.
    creation_epoch_ms: int | None = None
    has_audio: bool = False


def ffprobe(path: str) -> ProbeResult:
    """
    Probe a media file for codec/resolution/fps/duration/creation time.

    `path` may be a local file or an HTTP(S) URL — probing a presigned URL reads only
    the header, which is how the review stage inspects dashcam clips without pulling
    hundreds of megabytes per file.
    """
    out = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json",
         "-show_format", "-show_streams", path],
        capture_output=True, text=True, check=True,
    )
    data = json.loads(out.stdout)
    streams = data.get("streams", [])
    vstream = next((s for s in streams if s["codec_type"] == "video"), {})
    num, den = (vstream.get("avg_frame_rate", "0/1").split("/") + ["1"])[:2]
    fps = float(num) / float(den) if float(den or 1) else 0.0

    return ProbeResult(
        duration_s=float(data.get("format", {}).get("duration", 0) or 0),
        width=int(vstream.get("width", 0)),
        height=int(vstream.get("height", 0)),
        fps=round(fps, 2),
        codec=vstream.get("codec_name", "unknown"),
        start_time=float(vstream.get("start_time", 0) or 0),
        creation_epoch_ms=_creation_epoch_ms(data, vstream),
        has_audio=any(s.get("codec_type") == "audio" for s in streams),
    )


def _creation_epoch_ms(data: dict, vstream: dict) -> int | None:
    """
    Pull `creation_time` from the container or video-stream tags.

    Written by most cameras but not all (and stripped by some editing tools), so a
    None here is normal rather than an error — the caller falls back to mtime.
    """
    for tags in (data.get("format", {}).get("tags", {}), vstream.get("tags", {})):
        raw = (tags or {}).get("creation_time")
        if not raw:
            continue
        try:
            dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        except ValueError:
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    return None


def trim_start(in_path: str, out_path: str, start_ms: int) -> str:
    """
    Drop the first `start_ms` of a clip, used when it overlaps the previous one.

    Re-encodes rather than stream-copying: a stream copy can only cut at a keyframe,
    so it would silently cut somewhere other than asked and put every later timestamp
    out by up to a GOP. An accurate cut matters more here than the encode cost,
    because this offset propagates into every marker position downstream.
    """
    subprocess.run(
        ["ffmpeg", "-y", "-ss", f"{start_ms / 1000:.3f}", "-i", in_path,
         "-c:v", "libx264", "-crf", "20", "-preset", "veryfast",
         "-pix_fmt", "yuv420p", "-c:a", "aac", out_path],
        check=True,
    )
    return out_path


def audio_envelope(path: str, hz: int = 100) -> list[float]:
    """
    Coarse loudness envelope of a clip's audio, for front↔rear alignment.

    Both cameras hear the same cabin: the same door thud, the same indicator tick, the
    same engine note. Cross-correlating these envelopes recovers the offset between
    the two recordings even when their clocks disagree.

    Returns an empty list when the file has no audio track (or ffmpeg is unavailable),
    which is the signal to fall back to timestamp-based alignment.
    """
    try:
        out = subprocess.run(
            ["ffmpeg", "-v", "quiet", "-i", path,
             "-map", "0:a:0", "-ac", "1", "-ar", str(hz),
             "-f", "u8", "-acodec", "pcm_u8", "-"],
            capture_output=True, timeout=900, check=False,
        )
    except (FileNotFoundError, subprocess.SubprocessError):
        return []
    if not out.stdout:
        return []
    # Resampling to `hz` makes each output sample an average over its window, so the
    # deviation from the 128 midpoint is a usable stand-in for loudness.
    return [abs(b - 128) / 128.0 for b in out.stdout]


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


# Default ABR ladder. Bitrates are tuned for dashcam content: a forward road view is
# mostly high-detail motion (foliage, tarmac texture, oncoming traffic), which is far
# less compressible than the talking-head footage generic presets assume.
DEFAULT_LADDER = [
    {"height": 1080, "bitrateKbps": 5000},
    {"height": 720, "bitrateKbps": 2800},
    {"height": 480, "bitrateKbps": 1400},
    {"height": 360, "bitrateKbps": 800},
]

# Codec settings. H.264/AVC main profile only, and that is a decision rather than a
# default: it is the one codec that decodes everywhere our players run. hls.js cannot
# decode HEVC through Media Source Extensions on Chrome or Firefox, so an H.265 ladder
# would save ~35% storage and lose playback for most of the audience. Main profile (not
# high) because it is what older Android hardware decoders accept.
#
# H.265 is deliberately absent rather than merely non-default, so a config change cannot
# produce a library of footage that a majority of users cannot watch. Re-add an entry here
# only alongside an H.264 ladder to fall back to, never instead of one.
UNIVERSAL_CODEC = "h264"

CODECS = {
    "h264": {"encoder": "libx264", "tag": None, "profile": "main"},
}

# H.264 level per rendition height, and the matching RFC 6381 codec string.
#
# These must agree with what the encoder actually produces: players read the master
# playlist's CODECS attribute to decide whether they can decode a rendition *before*
# fetching it, so advertising level 3.1 for a 1080p stream (as a single hard-coded string
# would) invites a device to accept a stream it cannot then decode. The level is pinned on
# the command line for the same reason — advertised and encoded must be the same number.
H264_LEVELS = [
    (480, "3.0", "avc1.4d401e"),
    (720, "3.1", "avc1.4d401f"),
    (1080, "4.0", "avc1.4d4028"),
    (2160, "5.1", "avc1.4d4033"),
]

AAC_LC = "mp4a.40.2"


def resolve_codec(requested: str | None) -> str:
    """
    Force the universally-playable codec, whatever was asked for.

    Deliberately not a passthrough. A codec that a browser cannot decode is not a quality
    setting, it is a broken video, and the failure shows up at playback time for the user
    rather than at encode time for us — so an unrecognised request is corrected and logged
    instead of honoured.
    """
    if requested and requested.lower() != UNIVERSAL_CODEC:
        log.warning(
            "ignoring hls_codec=%r: encoding %s, the only codec that plays on every "
            "supported client",
            requested, UNIVERSAL_CODEC,
        )
    return UNIVERSAL_CODEC


def h264_level(height: int) -> tuple[str, str]:
    """`(level, codec_string)` for a rendition height — the highest rung that covers it."""
    for max_height, level, codec_string in H264_LEVELS:
        if height <= max_height:
            return level, codec_string
    return H264_LEVELS[-1][1], H264_LEVELS[-1][2]


def select_ladder(ladder: list[dict], source_height: int) -> list[dict]:
    """
    Drop ladder rungs above the source resolution.

    Encoding a 1080p rendition from 720p footage produces a file that is *larger* than
    the source and no better to look at — and ABR would then hand it to the fastest
    connections, so it's worse on both cost and quality. When the source is below every
    rung, one rendition is emitted at the source's own height so short or low-resolution
    footage still yields a valid playlist instead of nothing.
    """
    usable = [r for r in ladder if int(r["height"]) <= source_height]
    if usable:
        return usable
    fallback_bitrate = int(min(r["bitrateKbps"] for r in ladder)) if ladder else 800
    return [{"height": source_height, "bitrateKbps": fallback_bitrate}]


def generate_hls(
    in_path: str,
    out_dir: str,
    ladder: list[dict] | None = None,
    codec: str = "h264",
    segment_seconds: int = 6,
    source_height: int | None = None,
) -> dict:
    """
    Build an adaptive-bitrate HLS ladder plus a master playlist.

    Returns `{"master": path, "variants": [{height, bitrateKbps, playlist, codec}]}`.

    Two decisions worth knowing about:

    * **The ladder is capped to the source height.** Encoding a 1080p rendition from
      720p footage produces a file that is bigger than the source and no better to look
      at, and ABR would then serve it to good connections — actively worse on both cost
      and quality. Renditions above the source are dropped.
    * **The master keeps the filename `index.m3u8`.** The existing pipeline already
      stores that path in `route_videos.manifest_key` and the players already load it,
      so keeping the name means the ladder is a drop-in upgrade: existing rows keep
      working and clients need no change to get ABR.
    """
    import os

    os.makedirs(out_dir, exist_ok=True)
    ladder = ladder or DEFAULT_LADDER
    codec = resolve_codec(codec)
    settings = CODECS[codec]

    # Never upscale. If the source height is unknown, probe rather than guess — guessing
    # wrong here either wastes storage or silently caps quality.
    if source_height is None:
        try:
            source_height = ffprobe(in_path).height or 1080
        except Exception:  # noqa: BLE001
            source_height = 1080

    usable = select_ladder(ladder, source_height)

    variants = []
    for rung in usable:
        height = int(rung["height"])
        bitrate = int(rung["bitrateKbps"])
        name = f"v{height}"
        playlist = f"{out_dir}/{name}.m3u8"
        level, codec_string = h264_level(height)

        cmd = [
            "ffmpeg", "-y", "-i", in_path,
            # -2 keeps width even (required by yuv420p) while preserving aspect ratio.
            "-vf", f"scale=-2:{height}",
            "-c:v", settings["encoder"],
            "-b:v", f"{bitrate}k",
            # Cap the peak at 1.5x with a 2x buffer: ABR switching depends on a
            # reasonably predictable bitrate, and an uncapped VBR spike on a busy
            # junction is exactly when a marginal connection would stall.
            "-maxrate", f"{int(bitrate * 1.5)}k",
            "-bufsize", f"{bitrate * 2}k",
            "-preset", "medium",
            "-profile:v", settings["profile"],
            # Pinned so the stream matches the level advertised in the master playlist.
            "-level:v", level,
            "-pix_fmt", "yuv420p",
            # Keyframe every segment so every segment boundary is switchable, and the
            # scrubbing the player does lands on a real keyframe.
            "-g", str(segment_seconds * 30),
            "-keyint_min", str(segment_seconds * 30),
            "-sc_threshold", "0",
            "-c:a", "aac", "-b:a", "128k", "-ac", "2",
            "-hls_time", str(segment_seconds),
            "-hls_playlist_type", "vod",
            "-hls_segment_filename", f"{out_dir}/{name}_%03d.ts",
        ]
        if settings["tag"]:
            # Without hvc1, Safari refuses to play HEVC in an MP4/TS container.
            cmd += ["-tag:v", settings["tag"]]
        cmd.append(playlist)

        subprocess.run(cmd, check=True)
        variants.append({
            "height": height,
            "bitrateKbps": bitrate,
            "playlist": playlist,
            "name": name,
            "codec": codec,
            "codecString": codec_string,
        })

    master = f"{out_dir}/index.m3u8"
    _write_master_playlist(master, variants)
    return {"master": master, "variants": variants}


def _write_master_playlist(path: str, variants: list[dict]):
    """
    Write the master playlist that makes adaptive bitrate work.

    BANDWIDTH must include audio and container overhead, not just the video bitrate —
    players use it to decide what a connection can sustain, so understating it makes
    them pick a rendition that then stalls. CODECS is per rendition and carries the actual
    encoded level, because a player uses it to rule a rendition out *before* fetching it;
    one blanket string across the ladder would either understate 1080p or overstate 360p.
    """
    lines = ["#EXTM3U", "#EXT-X-VERSION:3"]
    # Highest first: players commonly start with the first listed variant, and starting
    # high then adapting down looks better than starting blurry and climbing.
    for v in sorted(variants, key=lambda x: x["height"], reverse=True):
        bandwidth = int((v["bitrateKbps"] + 128) * 1000 * 1.05)
        width = int(round(v["height"] * 16 / 9 / 2) * 2)
        codec_string = v.get("codecString") or h264_level(int(v["height"]))[1]
        lines.append(
            f'#EXT-X-STREAM-INF:BANDWIDTH={bandwidth},'
            f'RESOLUTION={width}x{v["height"]},CODECS="{codec_string},{AAC_LC}"'
        )
        lines.append(f'{v["name"]}.m3u8')

    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    return path


def thumbnail(in_path: str, out_path: str, at_seconds: float = 3.0):
    """Single thumbnail at a given offset (kept for existing callers)."""
    subprocess.run(
        ["ffmpeg", "-y", "-ss", str(at_seconds), "-i", in_path,
         "-vframes", "1", "-vf", "scale=640:-1", out_path],
        check=True,
    )
    return out_path


# Two sizes: the large one for the player poster and route detail, the small one for
# list/grid views. Serving a 640-wide image into a 320-wide slot is the most common
# wasted-bandwidth mistake on a listing page, and thumbnails are the asset class we
# serve from the CDN — so they are the ones worth getting right.
THUMBNAIL_SIZES = {"large": (640, 360), "small": (320, 180)}


def thumbnails(in_path: str, out_dir: str, at_seconds: float = 10.0,
               duration_s: float | None = None) -> dict[str, str]:
    """
    Capture one frame and write it at every configured size.

    Captured at ~10 s by default because the opening seconds of a driving-test route are
    typically a stationary car in the test-centre car park — a thumbnail of a parked car
    tells a learner nothing. On clips shorter than the capture point the offset falls
    back to the midpoint, so a short clip still gets a real frame rather than failing.

    Returns `{size_name: path}`, omitting any size ffmpeg could not produce.
    """
    import os

    os.makedirs(out_dir, exist_ok=True)

    seek = at_seconds
    if duration_s is not None and duration_s > 0 and at_seconds >= duration_s:
        seek = max(0.0, duration_s / 2)

    out: dict[str, str] = {}
    for name, (w, h) in THUMBNAIL_SIZES.items():
        path = os.path.join(out_dir, f"thumb_{name}.jpg")
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-ss", f"{seek:.3f}", "-i", in_path, "-vframes", "1",
                 # Fit inside the box and pad, so a non-16:9 dashcam never gets stretched
                 # faces/plates or a cropped-off road.
                 "-vf", f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
                        f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black",
                 "-q:v", "3", path],
                check=True, capture_output=True,
            )
            out[name] = path
        except subprocess.CalledProcessError:
            # One size failing shouldn't cost the other — a route with a large thumbnail
            # and no small one still renders everywhere.
            continue
    return out


def sha256_file(path: str, chunk_bytes: int = 8 * 1024 * 1024) -> str:
    """
    SHA-256 of a file, read in chunks.

    Chunked because these files run to several GB: loading one into memory to hash it
    would defeat the whole point of a pipeline that never holds a video in RAM.
    """
    import hashlib

    digest = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            block = f.read(chunk_bytes)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()
