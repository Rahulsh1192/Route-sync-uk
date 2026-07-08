"""
Duplicate route detection (deliverable #8): build a fingerprint from GPX
geometry and compare against existing routes to prevent duplicate uploads.
"""
import hashlib
import math
import gpxpy


def _geohash_point(lat: float, lon: float, precision: int = 6) -> str:
    """Coarse geohash so near-identical points collapse to the same cell."""
    # simple rounding-based bucketing (precision ~ decimal places)
    return f"{round(lat, precision)},{round(lon, precision)}"


def fingerprint_gpx(gpx_text: str, simplify_every: int = 10) -> dict:
    gpx = gpxpy.parse(gpx_text)
    pts = [p for trk in gpx.tracks for seg in trk.segments for p in seg.points]
    if not pts:
        return {"geom_hash": None, "distance_bucket": 0}

    # downsample then hash the sequence of geocells -> geometry signature
    sampled = pts[::simplify_every] or pts
    cells = [_geohash_point(p.latitude, p.longitude) for p in sampled]
    geom_hash = hashlib.sha256("|".join(cells).encode()).hexdigest()

    total = 0.0
    for a, b in zip(pts, pts[1:]):
        total += _haversine_m(a.latitude, a.longitude, b.latitude, b.longitude)

    return {
        "geom_hash": geom_hash,
        "distance_bucket": int(total // 250),  # 250 m buckets for prefiltering
        "distance_m": round(total),
        "point_count": len(pts),
    }


def is_duplicate(conn, fp: dict, distance_tolerance: int = 1) -> dict | None:
    """Find an existing route with the same geom hash and a near distance bucket."""
    if not fp.get("geom_hash"):
        return None
    with conn.cursor() as cur:
        cur.execute(
            """SELECT route_id FROM route_fingerprints
               WHERE geom_hash = %s
                  OR abs(distance_bucket - %s) <= %s
               LIMIT 1""",
            (fp["geom_hash"], fp["distance_bucket"], distance_tolerance),
        )
        row = cur.fetchone()
        return {"duplicate_of": str(row[0])} if row else None


def _haversine_m(lat1, lon1, lat2, lon2) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))
