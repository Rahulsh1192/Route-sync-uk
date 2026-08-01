"""
Standalone verification of the Phase 25 R2/video logic that needs no ffmpeg, no DB and
no network: ABR ladder selection, master-playlist generation, and content hashing.

The property that matters most here is that the ladder is never allowed to exceed the
source resolution. Upscaling is the classic ABR mistake: it produces a rendition that is
bigger than the source, no better to watch, and preferred by exactly the fast
connections that could have had the real thing — so it costs storage, bandwidth and
quality at once.

Run: python test_r2_video.py
"""
import hashlib
import os
import tempfile

from worker import ffmpeg_ops

PASS, FAIL = 0, 0


def check(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok   {label}")
    else:
        FAIL += 1
        print(f"  FAIL {label} {detail}")


# ---------------------------------------------------------------------------
# 1. Ladder selection
# ---------------------------------------------------------------------------
def test_ladder():
    print("\n[1] ABR ladder selection")
    full = ffmpeg_ops.DEFAULT_LADDER

    l1080 = ffmpeg_ops.select_ladder(full, 1080)
    check("1080p source keeps all four rungs", [r["height"] for r in l1080] == [1080, 720, 480, 360],
          f"got {[r['height'] for r in l1080]}")

    l720 = ffmpeg_ops.select_ladder(full, 720)
    check("720p source drops the 1080 rung", [r["height"] for r in l720] == [720, 480, 360],
          f"got {[r['height'] for r in l720]}")

    l480 = ffmpeg_ops.select_ladder(full, 480)
    check("480p source keeps only 480 and below", [r["height"] for r in l480] == [480, 360],
          f"got {[r['height'] for r in l480]}")

    # A 1440p dashcam (they exist) should still use the top rung, not be excluded.
    l1440 = ffmpeg_ops.select_ladder(full, 1440)
    check("above-ladder source still gets the full ladder",
          [r["height"] for r in l1440] == [1080, 720, 480, 360],
          f"got {[r['height'] for r in l1440]}")

    # Below every rung: emit one rendition at the source height rather than nothing.
    l240 = ffmpeg_ops.select_ladder(full, 240)
    check("sub-ladder source yields one rendition at its own height",
          len(l240) == 1 and l240[0]["height"] == 240, f"got {l240}")
    check("sub-ladder rendition uses the lowest bitrate",
          l240[0]["bitrateKbps"] == 800, f"got {l240[0]['bitrateKbps']}")

    # No rung may ever exceed the source — the anti-upscale invariant, stated directly.
    for src in (360, 480, 540, 720, 1080, 1440, 2160):
        sel = ffmpeg_ops.select_ladder(full, src)
        check(f"no rung exceeds a {src}p source",
              all(r["height"] <= src for r in sel), f"got {[r['height'] for r in sel]}")


# ---------------------------------------------------------------------------
# 2. Master playlist
# ---------------------------------------------------------------------------
def test_master_playlist():
    print("\n[2] master playlist")
    variants = [
        {"height": 360, "bitrateKbps": 800, "name": "v360", "codec": "h264"},
        {"height": 1080, "bitrateKbps": 5000, "name": "v1080", "codec": "h264"},
        {"height": 720, "bitrateKbps": 2800, "name": "v720", "codec": "h264"},
    ]
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "index.m3u8")
        ffmpeg_ops._write_master_playlist(path, variants)
        text = open(path, encoding="utf-8").read()

    lines = [l for l in text.splitlines() if l.strip()]
    check("starts with the HLS marker", lines[0] == "#EXTM3U", f"got {lines[0]}")
    check("declares a version", any(l.startswith("#EXT-X-VERSION") for l in lines))

    playlists = [l for l in lines if l.endswith(".m3u8")]
    check("one entry per variant", len(playlists) == 3, f"got {playlists}")
    # Highest first: players commonly start on the first listed variant, and starting
    # high then adapting down looks better than starting blurry and climbing.
    check("highest quality listed first", playlists[0] == "v1080.m3u8", f"got {playlists[0]}")
    check("lowest quality listed last", playlists[-1] == "v360.m3u8", f"got {playlists[-1]}")

    infs = [l for l in lines if l.startswith("#EXT-X-STREAM-INF")]
    check("every variant has a STREAM-INF", len(infs) == 3, f"got {len(infs)}")
    check("BANDWIDTH is declared on each", all("BANDWIDTH=" in i for i in infs))
    check("RESOLUTION is declared on each", all("RESOLUTION=" in i for i in infs))
    # Without CODECS a player cannot tell whether it can decode a rendition until it has
    # already downloaded a segment.
    check("CODECS is declared on each", all("CODECS=" in i for i in infs))
    check("h264 advertises avc1", all("avc1" in i for i in infs), f"got {infs[0]}")

    # BANDWIDTH must exceed the video bitrate: it has to cover audio and container
    # overhead, or players pick a rendition the connection can't actually sustain.
    top = next(i for i in infs if "1080" in i)
    bw = int(top.split("BANDWIDTH=")[1].split(",")[0])
    check("BANDWIDTH exceeds the raw video bitrate", bw > 5_000_000, f"got {bw}")
    check("BANDWIDTH stays plausible (not inflated)", bw < 6_500_000, f"got {bw}")
    check("resolution is 16:9 for a 1080 rung", "1920x1080" in top, f"got {top}")

    # The advertised level has to match what was encoded, per rendition. A player uses it
    # to rule a stream out before fetching it, so a blanket string across the ladder either
    # understates 1080p (a device accepts a stream it can't decode) or overstates 360p (a
    # weak device rejects the one rendition it could have played).
    low = next(i for i in infs if "360" in i)
    check("1080p advertises level 4.0", "avc1.4d4028" in top, f"got {top}")
    check("360p advertises level 3.0", "avc1.4d401e" in low, f"got {low}")
    check("720p advertises level 3.1",
          "avc1.4d401f" in next(i for i in infs if "1280x720" in i))
    check("audio codec is advertised alongside video", all("mp4a.40.2" in i for i in infs))

    # No rendition may be advertised as HEVC: hls.js cannot decode it through Media Source
    # Extensions, so it plays on Safari and nowhere else.
    check("nothing advertises hvc1", "hvc1" not in text)


# ---------------------------------------------------------------------------
# 2b. Codec is forced to the universally-playable one
# ---------------------------------------------------------------------------
def test_codec_is_universal():
    print("\n[2b] codec compatibility")
    # A config value asking for HEVC must be overridden, not honoured: the resulting
    # footage would be unplayable for every Chrome, Firefox and Android user, and the
    # failure would only surface at playback.
    check("h265 request is downgraded", ffmpeg_ops.resolve_codec("h265") == "h264")
    check("unknown codec is downgraded", ffmpeg_ops.resolve_codec("av1") == "h264")
    check("empty config falls back to h264", ffmpeg_ops.resolve_codec(None) == "h264")
    check("h264 passes through", ffmpeg_ops.resolve_codec("h264") == "h264")
    check("only h264 is encodable", list(ffmpeg_ops.CODECS) == ["h264"],
          f"got {list(ffmpeg_ops.CODECS)}")
    # Main profile, not high: it's what older Android hardware decoders accept.
    check("main profile", ffmpeg_ops.CODECS["h264"]["profile"] == "main")

    check("level rises with resolution", ffmpeg_ops.h264_level(1080)[0] == "4.0")
    check("level caps for oversized input", ffmpeg_ops.h264_level(4320)[0] == "5.1")


# ---------------------------------------------------------------------------
# 3. Content hashing (deduplication's foundation)
# ---------------------------------------------------------------------------
def test_hashing():
    print("\n[3] SHA-256 content hashing")
    payload = b"routesync-dashcam-footage" * 5000  # ~125 KB
    expected = hashlib.sha256(payload).hexdigest()

    with tempfile.TemporaryDirectory() as d:
        a = os.path.join(d, "a.mp4")
        b = os.path.join(d, "b.mp4")
        c = os.path.join(d, "c.mp4")
        with open(a, "wb") as f:
            f.write(payload)
        with open(b, "wb") as f:
            f.write(payload)          # identical bytes, different name
        with open(c, "wb") as f:
            f.write(payload + b"x")   # one byte different

        ha = ffmpeg_ops.sha256_file(a)
        hb = ffmpeg_ops.sha256_file(b)
        hc = ffmpeg_ops.sha256_file(c)

        check("hash matches hashlib", ha == expected, f"got {ha}")
        check("identical bytes hash identically (a dedup hit)", ha == hb)
        check("a one-byte difference changes the hash (no false dedup)", ha != hc)
        check("digest is 64 lowercase hex chars",
              len(ha) == 64 and ha == ha.lower() and all(ch in "0123456789abcdef" for ch in ha))

        # Chunk size must not affect the result — the pipeline reads multi-GB files in
        # blocks precisely so they never land in memory, and that must be transparent.
        small_chunks = ffmpeg_ops.sha256_file(a, chunk_bytes=97)
        check("chunk size does not change the digest", small_chunks == expected,
              f"got {small_chunks}")


# ---------------------------------------------------------------------------
# 4. Thumbnail sizing contract
# ---------------------------------------------------------------------------
def test_thumbnail_sizes():
    print("\n[4] thumbnail sizes")
    sizes = ffmpeg_ops.THUMBNAIL_SIZES
    check("large is 640x360", sizes["large"] == (640, 360), f"got {sizes.get('large')}")
    check("small is 320x180", sizes["small"] == (320, 180), f"got {sizes.get('small')}")
    check("both are 16:9", all(round(w / h, 3) == round(16 / 9, 3) for w, h in sizes.values()))


if __name__ == "__main__":
    test_ladder()
    test_master_playlist()
    test_codec_is_universal()
    test_hashing()
    test_thumbnail_sizes()
    print(f"\n{PASS} passed, {FAIL} failed")
    raise SystemExit(1 if FAIL else 0)
