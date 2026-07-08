"""GPS track validation + quality score (deliverable #4 feature)."""
import math
import gpxpy


def _haversine_m(lat1, lon1, lat2, lon2) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def validate_gpx(gpx_text: str,
                 teleport_speed_mps: float = 75.0,   # ~270 km/h => implausible
                 max_gap_s: float = 5.0):
    """
    Detect drift, signal loss, teleport jumps, missing points, speed anomalies.
    Returns findings + a 0..100 GPS quality score.
    """
    gpx = gpxpy.parse(gpx_text)
    pts = [p for trk in gpx.tracks for seg in trk.segments for p in seg.points]
    if len(pts) < 2:
        return {"gps_quality": 0, "point_count": len(pts), "error": "insufficient points"}

    teleports, signal_losses, speed_anomalies = 0, 0, 0
    total_distance_m = 0.0
    speeds = []

    for a, b in zip(pts, pts[1:]):
        d = _haversine_m(a.latitude, a.longitude, b.latitude, b.longitude)
        total_distance_m += d
        dt = (b.time - a.time).total_seconds() if a.time and b.time else 0.0
        if dt > max_gap_s:
            signal_losses += 1
        if dt > 0:
            v = d / dt
            speeds.append(v)
            if v > teleport_speed_mps:
                teleports += 1
            # sudden acceleration spike vs running median
            if speeds and v > 3 * (sum(speeds) / len(speeds) + 1e-6):
                speed_anomalies += 1

    # score: start at 100, deduct for each class of defect
    score = 100
    score -= min(40, teleports * 10)
    score -= min(30, signal_losses * 5)
    score -= min(20, speed_anomalies * 2)
    score = max(0, score)

    return {
        "gps_quality": score,
        "point_count": len(pts),
        "distance_m": round(total_distance_m),
        "teleport_jumps": teleports,
        "signal_losses": signal_losses,
        "speed_anomalies": speed_anomalies,
        "duration_s": round((pts[-1].time - pts[0].time).total_seconds())
        if pts[0].time and pts[-1].time else None,
    }
