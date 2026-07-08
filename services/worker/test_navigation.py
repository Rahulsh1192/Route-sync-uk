"""
Verifies the practice-mode navigation generator (geometry fallback) on a synthetic
GPX route containing a straight, a right turn, a left turn and a roundabout.

Run: python test_navigation.py
"""
import math
from datetime import datetime, timedelta, timezone

from worker import navigation

LAT0, LON0 = 51.4545, -2.5879  # Bristol
M_PER_DEG_LAT = 111_320.0


def _mpd_lon(lat):
    return 111_320.0 * math.cos(math.radians(lat))


def build_gpx():
    """Hand-craft a path: north, turn east (right), turn north (left), then a loop."""
    pts = []  # (lat, lon)
    lat, lon = LAT0, LON0
    t = datetime(2026, 6, 1, 9, 0, 0, tzinfo=timezone.utc)
    times = []

    def add(lat_, lon_):
        pts.append((lat_, lon_))
        times.append(None)

    add(lat, lon)
    step = 12.0  # metres between points

    # 1) head north ~120 m
    for _ in range(10):
        lat += step / M_PER_DEG_LAT
        add(lat, lon)
    # 2) RIGHT turn -> head east ~120 m
    for _ in range(10):
        lon += step / _mpd_lon(lat)
        add(lat, lon)
    # 3) LEFT turn -> head north ~120 m
    for _ in range(10):
        lat += step / M_PER_DEG_LAT
        add(lat, lon)
    # 4) roundabout: full clockwise loop (~360 deg) of small radius
    cx, cy = lon + (15 / _mpd_lon(lat)), lat
    r_lat = 15 / M_PER_DEG_LAT
    for k in range(1, 13):
        ang = math.radians(k * 30)
        add(cy + r_lat * math.cos(ang), cx + (15 / _mpd_lon(lat)) * math.sin(ang))
    # 5) exit north
    for _ in range(6):
        lat = pts[-1][0] + step / M_PER_DEG_LAT
        add(lat, pts[-1][1])

    # assign 1 Hz timestamps
    trkpts = []
    for i, (la, lo) in enumerate(pts):
        tt = (t + timedelta(seconds=i)).isoformat()
        trkpts.append(f'<trkpt lat="{la:.7f}" lon="{lo:.7f}"><time>{tt}</time></trkpt>')
    return ('<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>'
            + "".join(trkpts) + "</trkseg></trk></gpx>")


def main():
    nav = navigation.generate(build_gpx())
    types = [i["type"] for i in nav["instructions"]]
    print("instruction count:", len(nav["instructions"]))
    print("junctions:", nav["junction_count"], "roundabouts:", nav["roundabout_count"])
    for ins in nav["instructions"]:
        print(f"  [{ins['t_ms']:>6} ms] {ins['type']:<16} {ins['text']}"
              + (f" (exit {ins['roundabout_exit']})" if ins["roundabout_exit"] else ""))

    assert types[0] == "start"
    assert types[-1] == "destination"
    assert any(t.endswith("right") for t in types), "should detect a right turn"
    assert any(t.endswith("left") for t in types), "should detect a left turn"
    assert nav["roundabout_count"] >= 1, "should detect the roundabout"
    assert any(i["text"].startswith("At the roundabout") for i in nav["instructions"])
    assert len(nav["markers"]) == nav["junction_count"] + nav["roundabout_count"]

    print("\nALL CHECKS PASSED — practice-mode navigation generation verified.")


if __name__ == "__main__":
    main()
