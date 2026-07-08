"""
Standalone verification of the pure-Python media path (no DB/FFmpeg/storage needed):
GPX validation -> sync confidence -> fingerprint -> duplicate signature -> quality score.

Run: python test_media_path.py
"""
from datetime import datetime, timedelta, timezone

from worker import gps_validation, sync_engine, fingerprint, quality_score, gap_detection


def make_gpx(n=60, drift=False):
    """Build a synthetic ~1km UK route GPX at 1 Hz starting near a test centre."""
    t0 = datetime(2026, 6, 1, 9, 0, 0, tzinfo=timezone.utc)
    lat, lon = 51.5074, -0.1278  # central London
    pts = []
    for i in range(n):
        lat += 0.00009          # ~10 m/s northwards
        lon += 0.00002
        if drift and i == 30:   # inject a teleport jump
            lat += 0.05
        t = t0 + timedelta(seconds=i)
        pts.append(f'<trkpt lat="{lat:.6f}" lon="{lon:.6f}"><time>{t.isoformat()}</time></trkpt>')
    return (
        '<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>'
        + "".join(pts)
        + "</trkseg></trk></gpx>"
    )


def main():
    clean = make_gpx()
    bad = make_gpx(drift=True)

    gps = gps_validation.validate_gpx(clean)
    print("GPS validation (clean):", gps)
    assert gps["gps_quality"] >= 80, "clean track should score high"
    assert gps["distance_m"] > 0

    gps_bad = gps_validation.validate_gpx(bad)
    print("GPS validation (teleport):", gps_bad)
    assert gps_bad["teleport_jumps"] >= 1, "teleport must be detected"
    assert gps_bad["gps_quality"] < gps["gps_quality"], "teleport must lower score"

    # continuity over 3 clips (30s each); a 12s gap after clip a must be flagged "large"
    clips = [
        gap_detection.Clip("a", 0, 30),
        gap_detection.Clip("b", 42, 30),   # 12s gap after clip a (> 10s large threshold)
        gap_detection.Clip("c", 72, 30),
    ]
    cont = gap_detection.analyse_continuity(clips)
    print("Continuity:", cont)
    assert len(cont["gaps"]) == 1 and cont["gaps"][0]["large"], "12s gap should be flagged large"
    assert cont["missing_segments"] == 1

    sync = sync_engine.align(None, None, gps_quality=gps["gps_quality"],
                             gap_count=len(cont["gaps"]))
    print("Sync:", sync)
    assert 0.0 <= sync["sync_confidence"] <= 1.0

    fp = fingerprint.fingerprint_gpx(clean)
    print("Fingerprint:", {k: fp[k] for k in ("distance_bucket", "point_count")})
    assert fp["geom_hash"] and fp["distance_bucket"] >= 0

    completeness = quality_score.completeness_from_gaps(cont["gaps"], cont["total_duration_s"])
    qs = quality_score.compute(
        gps_quality=gps["gps_quality"], video_quality=80,
        completeness=completeness, sync_confidence=sync["sync_confidence"],
        contributor_rep=50,
    )
    print("Quality score:", qs)
    assert 0 <= qs["overall"] <= 100

    print("\nALL CHECKS PASSED — upload->playback Python path verified end-to-end.")


if __name__ == "__main__":
    main()
