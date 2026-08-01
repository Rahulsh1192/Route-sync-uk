"""
Standalone verification of the Phase 24 dashcam sync path (no DB/FFmpeg/storage/numpy):
filename conventions -> GPS parsing (GPX/NMEA/CSV) -> merge -> clip timeline -> reconcile.

The central property under test is the anti-drift one: with a dashcam that drops time
between clips, position in the concatenated video must still map to the correct real
time. A naive implementation passes every other test here and fails that one — and the
symptom in production is a map marker that is right at the start of a route and
seconds wrong by the end.

Run: python test_dashcam_sync.py
"""
from datetime import datetime, timedelta, timezone

from worker import clip_timeline, dashcam_formats, gps_ingest, reconcile

PASS, FAIL = 0, 0


def check(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok   {label}")
    else:
        FAIL += 1
        print(f"  FAIL {label} {detail}")


def epoch_ms(y, mo, d, h, mi, s) -> int:
    return int(datetime(y, mo, d, h, mi, s, tzinfo=timezone.utc).timestamp() * 1000)


def _has_tzdata() -> bool:
    """Whether this environment can resolve named timezones at all."""
    try:
        from zoneinfo import ZoneInfo
        ZoneInfo("Europe/London")
        return True
    except Exception:  # noqa: BLE001
        return False


# ---------------------------------------------------------------------------
# 1. Filename conventions
# ---------------------------------------------------------------------------
def test_filenames():
    print("\n[1] dashcam filename conventions")
    # UTC to keep the expected values readable; the production default is Europe/London.
    def parse(name):
        return dashcam_formats.parse_clip_name(name, local_tz="UTC")

    v = parse("2026_0722_082530_F.MP4")
    check("viofo parsed", v.matched and v.brand == "viofo")
    check("viofo time", v.start_epoch_ms == epoch_ms(2026, 7, 22, 8, 25, 30),
          f"got {v.start_epoch_ms}")
    check("viofo front view", v.view == "front", f"got {v.view}")

    r = parse("2026_0722_082530_R.MP4")
    check("viofo rear view", r.view == "rear", f"got {r.view}")

    b = parse("20260722_082530_NF.mp4")
    check("blackvue parsed", b.matched and b.view == "front", f"got {b.brand}/{b.view}")

    bt = parse("20260722_082530_NR.mp4")
    check("blackvue rear", bt.view == "rear", f"got {bt.view}")

    vt = parse("20260722_082530_0001F.MP4")
    check("vantrue parsed", vt.matched and vt.seq == 1, f"got seq={vt.seq}")

    m = parse("NO20260722-082530-000123.MP4")
    check("70mai parsed", m.matched and m.brand == "70mai", f"got {m.brand}")

    n = parse("FILE260722-082530.MP4")
    check("nextbase 2-digit year", n.matched
          and n.start_epoch_ms == epoch_ms(2026, 7, 22, 8, 25, 30), f"got {n.start_epoch_ms}")

    g = parse("2026-07-22 08-25-30.mp4")
    check("generic date-time parsed", g.matched)

    # A camera with no timestamp in the name (e.g. Garmin GRMN0001.MP4) must report
    # "unknown" rather than inventing a time — the pipeline then falls back to the
    # container's creation_time.
    none = parse("GRMN0001.MP4")
    check("no-timestamp name is not guessed", not none.matched, f"got {none.start_epoch_ms}")

    # An impossible date means we matched a serial number, not a timestamp.
    bad = parse("20261332_990000_F.MP4")
    check("impossible date rejected", not bad.matched or bad.brand == "generic_compact")

    # Local-time interpretation: 08:25:30 BST is 07:25:30 UTC. Requires a tz database,
    # which Windows and slim containers lack unless the `tzdata` package is installed —
    # so this is skipped rather than failed when it's missing (the production worker
    # pins tzdata in requirements.txt precisely so this holds there).
    if _has_tzdata():
        bst = dashcam_formats.parse_clip_name("2026_0722_082530_F.MP4",
                                              local_tz="Europe/London")
        check("filename read as camera-local time",
              bst.start_epoch_ms == epoch_ms(2026, 7, 22, 7, 25, 30),
              f"got {bst.start_epoch_ms}")
    else:
        print("  skip filename read as camera-local time (no tz database — pip install tzdata)")


# ---------------------------------------------------------------------------
# 2. GPS format parsers
# ---------------------------------------------------------------------------
def make_gpx(n=10, start=None):
    t0 = start or datetime(2026, 7, 22, 8, 25, 30, tzinfo=timezone.utc)
    pts = []
    lat, lon = 52.4862, -1.8904
    for i in range(n):
        lat += 0.00009
        t = t0 + timedelta(seconds=i)
        pts.append(f'<trkpt lat="{lat:.6f}" lon="{lon:.6f}">'
                   f'<time>{t.isoformat().replace("+00:00", "Z")}</time></trkpt>')
    return ('<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>'
            + "".join(pts) + "</trkseg></trk></gpx>")


def test_parsers():
    print("\n[2] GPS format parsers")

    fixes = gps_ingest.parse_gpx(make_gpx(10))
    check("gpx point count", len(fixes) == 10, f"got {len(fixes)}")
    check("gpx first timestamp", fixes[0].epoch_ms == epoch_ms(2026, 7, 22, 8, 25, 30))

    # NMEA RMC: 5225.1720,N / 00153.4240,W around Birmingham, 22/07/26 08:25:30.
    nmea = "\n".join([
        "$GPRMC,082530.00,A,5225.1720,N,00153.4240,W,21.5,54.7,220726,,,A*6A",
        "$GPRMC,082531.00,A,5225.1820,N,00153.4200,W,22.0,54.7,220726,,,A*6B",
        "$GPGGA,082532.00,5225.1920,N,00153.4160,W,1,08,1.2,120.0,M,47.0,M,,*5C",
        "garbage line that should be ignored",
    ])
    nf = gps_ingest.parse_nmea(nmea)
    check("nmea parsed 3 fixes", len(nf) == 3, f"got {len(nf)}")
    check("nmea time", nf[0].epoch_ms == epoch_ms(2026, 7, 22, 8, 25, 30), f"got {nf[0].epoch_ms}")
    check("nmea lat converted from ddmm.mmmm",
          abs(nf[0].lat - (52 + 25.1720 / 60)) < 1e-6, f"got {nf[0].lat}")
    check("nmea west longitude is negative", nf[0].lng < 0, f"got {nf[0].lng}")
    check("nmea knots converted to m/s",
          abs(nf[0].speed_mps - 21.5 * 0.514444) < 1e-3, f"got {nf[0].speed_mps}")

    # A GGA-only log has no date and must yield nothing rather than guess the day.
    gga_only = gps_ingest.parse_nmea("$GPGGA,082532.00,5225.1920,N,00153.4160,W,1,08,1.2,120.0,M,47.0,M,,*5C")
    check("GGA without a date yields nothing", len(gga_only) == 0, f"got {len(gga_only)}")

    csv_text = (
        "Timestamp,Latitude,Longitude,Speed (km/h)\n"
        "2026-07-22 08:25:30,52.4862,-1.8904,72\n"
        "2026-07-22 08:25:31,52.4863,-1.8903,72\n"
    )
    cf = gps_ingest.parse_csv(csv_text)
    check("csv parsed", len(cf) == 2, f"got {len(cf)}")
    check("csv km/h converted to m/s", abs(cf[0].speed_mps - 20.0) < 0.01, f"got {cf[0].speed_mps}")

    # Extension lying about content: a .log holding GPX must still parse, because this
    # happens constantly with camera exports and re-uploading a drive is expensive.
    sniffed = gps_ingest.parse_text(make_gpx(5), family="nmea", name="track.log")
    check("wrong declared format is sniffed", sniffed.count == 5 and sniffed.fmt == "gpx",
          f"got {sniffed.count}/{sniffed.fmt}")


# ---------------------------------------------------------------------------
# 3. Merging several GPS files
# ---------------------------------------------------------------------------
def test_merge():
    print("\n[3] multi-file GPS merge")
    t0 = datetime(2026, 7, 22, 8, 25, 30, tzinfo=timezone.utc)

    # Second file overlaps the first by 3 s (a dashcam repeating its tail), and the
    # files are supplied in the WRONG order to prove upload order is not trusted.
    f1 = gps_ingest.ParsedFile("log2.nmea", "nmea",
                               gps_ingest.parse_gpx(make_gpx(10, t0 + timedelta(seconds=7))))
    f2 = gps_ingest.ParsedFile("log1.nmea", "nmea", gps_ingest.parse_gpx(make_gpx(10, t0)))

    track, findings = gps_ingest.merge([f1, f2])
    check("merged track is sorted", all(a.epoch_ms <= b.epoch_ms
                                       for a, b in zip(track, track[1:])))
    check("overlap deduped, not appended", len(track) == 17, f"got {len(track)} (expected 17)")
    check("duplicates counted", findings["duplicates_collapsed"] == 3,
          f"got {findings['duplicates_collapsed']}")
    check("span reported", findings["span_s"] == 16.0, f"got {findings['span_s']}")

    # A teleport (GPS glitch) must be dropped rather than stretching the track.
    glitchy = list(gps_ingest.parse_gpx(make_gpx(10)))
    glitchy.insert(5, gps_ingest.Fix(epoch_ms=glitchy[4].epoch_ms + 500,
                                     lat=53.9, lng=-1.1))
    t2, f2f = gps_ingest.merge([gps_ingest.ParsedFile("g.gpx", "gpx", glitchy)])
    check("teleport dropped", f2f["implausible_dropped"] >= 1,
          f"got {f2f['implausible_dropped']}")

    # (0,0) is a "no fix yet" sentinel, not a position off the coast of Africa.
    zeros = [gps_ingest.Fix(epoch_ms=epoch_ms(2026, 7, 22, 8, 25, 30), lat=0.0, lng=0.0)]
    t3, f3 = gps_ingest.merge([gps_ingest.ParsedFile("z.gpx", "gpx", zeros)])
    check("null island rejected", len(t3) == 0, f"got {len(t3)}")

    # A file that parsed to nothing must be named, since it changes coverage.
    empty = gps_ingest.ParsedFile("broken.gps", "nmea", [], error="no fixes")
    _, f4 = gps_ingest.merge([empty, gps_ingest.ParsedFile("ok.gpx", "gpx",
                                                           gps_ingest.parse_gpx(make_gpx(5)))])
    check("failed file is reported by name", f4["failed_files"] == ["broken.gps"],
          f"got {f4['failed_files']}")

    rel = gps_ingest.to_relative_fixes(track)
    check("relative fixes start at zero", rel[0]["tMs"] == 0, f"got {rel[0]['tMs']}")
    check("relative fixes keep order", rel[-1]["tMs"] == 16000, f"got {rel[-1]['tMs']}")


# ---------------------------------------------------------------------------
# 4. Clip timeline — the anti-drift property
# ---------------------------------------------------------------------------
def make_clips(view, count, start_epoch, clip_ms, gap_ms):
    clips = []
    t = start_epoch
    for i in range(count):
        clips.append(clip_timeline.SourceClip(
            file_id=f"{view}-{i}", name=f"2026_0722_{i:06d}_F.MP4", view=view,
            duration_ms=clip_ms, start_epoch_ms=t, start_source="filename",
        ))
        t += clip_ms + gap_ms
    return clips


def test_timeline():
    print("\n[4] clip timeline and the video<->wall clock mapping")
    start = epoch_ms(2026, 7, 22, 8, 25, 30)
    # 5 clips x 60 s with 2 s dropped between each: the real dashcam case.
    clips = make_clips("front", 5, start, 60_000, 2_000)
    tl = clip_timeline.build_timeline("front", clips)

    check("all clips placed", len(tl.entries) == 5, f"got {len(tl.entries)}")
    check("video duration excludes gaps", tl.total_video_ms == 300_000,
          f"got {tl.total_video_ms}")
    check("wall span includes gaps", tl.total_wall_ms == 308_000, f"got {tl.total_wall_ms}")
    check("dropped time measured", tl.dropped_ms == 8_000, f"got {tl.dropped_ms}")
    check("4 gaps recorded", len(tl.gaps) == 4, f"got {len(tl.gaps)}")
    check("2 s gaps are not 'large'", not any(g["large"] for g in tl.gaps))

    # THE anti-drift check. 120 s into the concatenated video is inside clip 3, which
    # began 2 gaps (4 s) after the naive assumption would put it. A timeline that
    # ignores gaps returns start+120 s here and the marker lags by 4 s.
    wall = clip_timeline.video_ms_to_wall(tl, 120_000)
    check("video 120s maps to wall +124s (gaps honoured)", wall == start + 124_000,
          f"got {(wall - start) / 1000 if wall else None}s")

    # Worst case at the end of the drive: 4 gaps = 8 s of accumulated error.
    wall_end = clip_timeline.video_ms_to_wall(tl, 299_000)
    check("drift does not accumulate at the end", wall_end == start + 307_000,
          f"got {(wall_end - start) / 1000 if wall_end else None}s")

    # Round trip.
    back = clip_timeline.wall_ms_to_video(tl, start + 124_000)
    check("wall->video round trips", back == 120_000, f"got {back}")

    # An instant inside a gap was never filmed, so there is no frame for it.
    in_gap = clip_timeline.wall_ms_to_video(tl, start + 61_000)
    check("instant in a gap has no video position", in_gap is None, f"got {in_gap}")

    # Beyond the last frame we clamp rather than extrapolate.
    check("past the end clamps to the final frame",
          clip_timeline.video_ms_to_wall(tl, 999_999) == tl.entries[-1].wall_end_epoch_ms)

    # A long gap is a hole in the recording, and must be flagged.
    big = make_clips("front", 2, start, 60_000, 45_000)
    tl_big = clip_timeline.build_timeline("front", big, max_gap_s=10)
    check("long gap flagged as large", any(g["large"] for g in tl_big.gaps))


def test_ordering():
    print("\n[5] clip ordering")
    start = epoch_ms(2026, 7, 22, 8, 25, 30)
    clips = make_clips("front", 3, start, 60_000, 1_000)
    shuffled = [clips[2], clips[0], clips[1]]

    ordered, confident, _ = clip_timeline.order_clips(shuffled)
    check("timestamps beat upload order",
          [c.file_id for c in ordered] == ["front-0", "front-1", "front-2"],
          f"got {[c.file_id for c in ordered]}")
    check("timestamp ordering is confident", confident)

    # The instructor's confirmed order outranks the detected one.
    for i, c in enumerate(shuffled):
        c.declared_ordinal = i
    ordered2, confident2, _ = clip_timeline.order_clips(shuffled)
    check("declared order wins",
          [c.file_id for c in ordered2] == ["front-2", "front-0", "front-1"],
          f"got {[c.file_id for c in ordered2]}")
    check("declared order is confident", confident2)

    # mtime is weak evidence (copying rewrites it), so flag it for confirmation.
    mtime_clips = make_clips("front", 2, start, 60_000, 1_000)
    for c in mtime_clips:
        c.declared_ordinal = None
        c.start_source = "mtime"
    _, confident3, notes = clip_timeline.order_clips(mtime_clips)
    check("mtime ordering is not trusted", not confident3)
    check("mtime weakness explained", any("modification time" in n for n in notes),
          f"got {notes}")

    # Overlapping clips: trim the later one so wall time stays monotonic.
    overlapping = make_clips("front", 2, start, 60_000, -5_000)
    for c in overlapping:
        c.declared_ordinal = None
    tl = clip_timeline.build_timeline("front", overlapping)
    check("overlap recorded", len(tl.overlaps) == 1, f"got {tl.overlaps}")
    check("overlap trimmed from the later clip",
          tl.entries[1].trim_start_ms == 5_000, f"got {tl.entries[1].trim_start_ms}")
    check("wall time stays monotonic after trim",
          tl.entries[1].wall_start_epoch_ms == tl.entries[0].wall_end_epoch_ms)
    check("video duration reflects the trim", tl.total_video_ms == 115_000,
          f"got {tl.total_video_ms}")


# ---------------------------------------------------------------------------
# 6. Reconciliation
# ---------------------------------------------------------------------------
def test_reconcile():
    print("\n[6] video/GPS reconciliation")
    v0 = epoch_ms(2026, 7, 22, 8, 25, 30)
    v1 = v0 + 300_000                       # 5 min of video

    # The normal healthy case: GPS started before recording and stopped after.
    ok = reconcile.reconcile(v0, v1, v0 - 40_000, v1 + 25_000)
    check("GPS longer than video passes", ok["verdict"] == "pass", f"got {ok}")
    check("full coverage reported", ok["overlap_pct"] == 100.0, f"got {ok['overlap_pct']}")
    check("lead-in measured", ok["gps_lead_in_s"] == 40.0, f"got {ok['gps_lead_in_s']}")

    # Equality is NOT required — this is the check the naive spec would have failed.
    exact = reconcile.reconcile(v0, v1, v0, v1)
    check("identical spans pass", exact["verdict"] == "pass")

    # GPS stops a minute early: usable, but the tail has no marker.
    short = reconcile.reconcile(v0, v1, v0, v1 - 60_000)
    check("partial GPS coverage warns", short["verdict"] == "warn", f"got {short}")
    check("partial coverage quantified", 79 < short["overlap_pct"] < 81,
          f"got {short['overlap_pct']}")

    # Camera clock an hour out (BST/UTC or a wrong timezone) — detect and correct.
    off = reconcile.reconcile(v0 + 3_600_000, v1 + 3_600_000, v0 - 30_000, v1 + 30_000)
    check("whole-hour clock error detected",
          off.get("suggested_clock_offset_hours") == -1.0,
          f"got {off.get('suggested_clock_offset_hours')}")
    check("clock error warns rather than fails", off["verdict"] == "warn", f"got {off}")

    # Two unrelated drives must fail, not be "corrected" into agreement.
    unrelated = reconcile.reconcile(v0, v1, v0 + 20 * 86_400_000, v1 + 20 * 86_400_000)
    check("different drives fail", unrelated["verdict"] == "fail", f"got {unrelated}")

    fr = reconcile.reconcile_front_rear(300_000, 299_000, max_drift_s=2)
    check("small front/rear drift accepted", not fr["drift_exceeds_threshold"])
    fr2 = reconcile.reconcile_front_rear(300_000, 240_000, max_drift_s=2)
    check("large front/rear drift flagged", fr2["drift_exceeds_threshold"])
    fr3 = reconcile.reconcile_front_rear(300_000, 0)
    check("single view is not treated as drift", not fr3["drift_exceeds_threshold"])


if __name__ == "__main__":
    test_filenames()
    test_parsers()
    test_merge()
    test_timeline()
    test_ordering()
    test_reconcile()
    print(f"\n{PASS} passed, {FAIL} failed")
    raise SystemExit(1 if FAIL else 0)
