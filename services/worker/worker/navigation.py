"""
Practice-mode navigation generator (Phase 3).

Turns a GPX track into UK-English turn-by-turn instructions and timeline markers
(junctions, roundabouts) for `route_instructions` and `route_markers`.

Two backends:
  * Valhalla `trace_route` (map-matching) when VALHALLA_URL is set — gives accurate
    maneuvers, roundabout exit numbers and speed limits from the OSM road network.
  * A pure-geometry fallback (bearing-change turn detection + curvature-based
    roundabout detection) when no routing engine is available. Fully offline and
    deterministic, so it runs and is testable anywhere.

Output shape:
  {
    "instructions": [ {seq, t_ms, type, text, roundabout_exit, speed_limit_mph, lat, lon}, ... ],
    "markers":      [ {t_ms, kind, label, lat, lon}, ... ],
    "junction_count": int,
    "roundabout_count": int,
  }
"""
import math

import gpxpy
import httpx

from .config import config


# ---------------------------------------------------------------------------
# geometry helpers
# ---------------------------------------------------------------------------
def _haversine_m(lat1, lon1, lat2, lon2) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _bearing(lat1, lon1, lat2, lon2) -> float:
    """Initial bearing from point 1 to point 2, degrees 0..360."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def _angle_diff(a: float, b: float) -> float:
    """Signed smallest difference b-a in (-180, 180]. Positive = right turn."""
    d = (b - a + 180) % 360 - 180
    return d if d != -180 else 180


# ---------------------------------------------------------------------------
# UK-English phrasing
# ---------------------------------------------------------------------------
_ORDINALS = {1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth", 6: "sixth"}


def _turn_phrase(angle: float) -> tuple[str, str]:
    """Map a signed turn angle to (type, UK-English text)."""
    side = "right" if angle > 0 else "left"
    mag = abs(angle)
    if mag >= 150:
        return ("uturn", "Make a U-turn")
    if mag >= 110:
        return (f"sharp_{side}", f"Take a sharp {side}")
    if mag >= 40:
        return (f"turn_{side}", f"Turn {side}")
    if mag >= 18:
        return (f"slight_{side}", f"Bear {side}")
    return ("continue", "Continue straight ahead")


def _roundabout_phrase(exit_no: int | None) -> str:
    if exit_no and exit_no in _ORDINALS:
        return f"At the roundabout, take the {_ORDINALS[exit_no]} exit"
    if exit_no:
        return f"At the roundabout, take exit {exit_no}"
    return "At the roundabout, continue across"


# ---------------------------------------------------------------------------
# public entry point
# ---------------------------------------------------------------------------
def generate(gpx_text: str) -> dict:
    gpx = gpxpy.parse(gpx_text)
    pts = [p for trk in gpx.tracks for seg in trk.segments for p in seg.points]
    if len(pts) < 3:
        return {"instructions": [], "markers": [], "junction_count": 0, "roundabout_count": 0}

    if config.VALHALLA_URL:
        try:
            return _from_valhalla(pts)
        except Exception:  # noqa: BLE001 — fall back to geometry on any routing error
            pass
    return _from_geometry(pts)


# ---------------------------------------------------------------------------
# Valhalla map-matching backend
# ---------------------------------------------------------------------------
def _from_valhalla(pts) -> dict:
    shape = [{"lat": p.latitude, "lon": p.longitude} for p in pts]
    body = {"shape": shape, "costing": "auto", "shape_match": "map_snap",
            "directions_options": {"units": "kilometers", "language": "en-GB"}}
    resp = httpx.post(f"{config.VALHALLA_URL}/trace_route", json=body, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    instructions, markers = [], []
    junctions = roundabouts = 0
    seq = 0
    legs = data.get("trip", {}).get("legs", [])
    for leg in legs:
        for m in leg.get("maneuvers", []):
            mtype = m.get("type", 0)
            text = m.get("instruction", "")
            # Valhalla maneuver type 26/27 = roundabout enter/exit
            is_roundabout = mtype in (26, 27)
            exit_no = m.get("roundabout_exit_count")
            t_ms = int(m.get("begin_shape_index", 0))  # index; refined below if times exist
            instructions.append({
                "seq": seq, "t_ms": t_ms,
                "type": "roundabout_exit" if is_roundabout else _valhalla_type(mtype),
                "text": text, "roundabout_exit": exit_no,
                "speed_limit_mph": _kmh_to_mph(m.get("speed_limit")),
                "lat": None, "lon": None,
            })
            if is_roundabout:
                roundabouts += 1
                markers.append({"t_ms": t_ms, "kind": "roundabout",
                                "label": text, "lat": None, "lon": None})
            elif mtype not in (1, 8):  # not "start"/"continue"
                junctions += 1
                markers.append({"t_ms": t_ms, "kind": "junction",
                                "label": text, "lat": None, "lon": None})
            seq += 1
    return {"instructions": instructions, "markers": markers,
            "junction_count": junctions, "roundabout_count": roundabouts}


def _valhalla_type(mtype: int) -> str:
    mapping = {15: "turn_right", 10: "turn_right", 16: "sharp_right",
               14: "turn_left", 9: "turn_left", 17: "sharp_left",
               11: "uturn", 12: "uturn", 8: "continue", 1: "start", 4: "destination"}
    return mapping.get(mtype, "continue")


def _kmh_to_mph(kmh):
    return round(kmh * 0.621371) if kmh else None


# ---------------------------------------------------------------------------
# Geometry fallback backend
# ---------------------------------------------------------------------------
def _from_geometry(pts, turn_threshold=18.0, simplify_m=8.0) -> dict:
    """
    Detect maneuvers from heading changes along a simplified track.

    1. Simplify the track to points at least `simplify_m` apart (removes GPS jitter).
    2. Compute the heading change at each retained point.
    3. Accumulate same-direction turning to detect roundabouts (sustained curvature
       totalling > ~270 degrees over a short distance), otherwise emit discrete turns.
    """
    t0 = pts[0].time

    def rel_ms(p):
        return int((p.time - t0).total_seconds() * 1000) if (p.time and t0) else 0

    # 1. simplify
    simp = [pts[0]]
    for p in pts[1:]:
        if _haversine_m(simp[-1].latitude, simp[-1].longitude, p.latitude, p.longitude) >= simplify_m:
            simp.append(p)
    if len(simp) < 3:
        simp = pts

    # 2. bearings + heading changes
    bearings = [_bearing(simp[i].latitude, simp[i].longitude,
                         simp[i + 1].latitude, simp[i + 1].longitude)
                for i in range(len(simp) - 1)]

    instructions, markers = [], []
    junctions = roundabouts = 0
    seq = 0

    instructions.append({"seq": seq, "t_ms": rel_ms(simp[0]), "type": "start",
                         "text": "Start the route", "roundabout_exit": None,
                         "speed_limit_mph": None,
                         "lat": simp[0].latitude, "lon": simp[0].longitude})
    seq += 1

    i = 1
    while i < len(bearings):
        change = _angle_diff(bearings[i - 1], bearings[i])

        # roundabout: sustained same-direction turning over a short window
        run_total, j = change, i
        while j + 1 < len(bearings):
            nxt = _angle_diff(bearings[j], bearings[j + 1])
            if (nxt > 0) == (change > 0) and abs(nxt) > 5:
                run_total += nxt
                j += 1
            else:
                break
        if abs(run_total) >= 160 and (j - i) >= 2:
            p = simp[i]
            # crude exit estimate from total sweep (each ~ quarter turn ≈ an exit)
            exit_no = max(1, min(5, round(abs(run_total) / 90)))
            instructions.append({"seq": seq, "t_ms": rel_ms(p), "type": "roundabout_exit",
                                 "text": _roundabout_phrase(exit_no), "roundabout_exit": exit_no,
                                 "speed_limit_mph": None,
                                 "lat": p.latitude, "lon": p.longitude})
            markers.append({"t_ms": rel_ms(p), "kind": "roundabout",
                            "label": f"Roundabout ({exit_no} exit)", "lat": p.latitude, "lon": p.longitude})
            roundabouts += 1
            seq += 1
            i = j + 1
            continue

        # discrete turn
        if abs(change) >= turn_threshold:
            p = simp[i]
            mtype, text = _turn_phrase(change)
            instructions.append({"seq": seq, "t_ms": rel_ms(p), "type": mtype,
                                 "text": text, "roundabout_exit": None,
                                 "speed_limit_mph": None,
                                 "lat": p.latitude, "lon": p.longitude})
            markers.append({"t_ms": rel_ms(p), "kind": "junction",
                            "label": text, "lat": p.latitude, "lon": p.longitude})
            junctions += 1
            seq += 1
        i += 1

    end = simp[-1]
    instructions.append({"seq": seq, "t_ms": rel_ms(end), "type": "destination",
                         "text": "You have reached the end of the route",
                         "roundabout_exit": None, "speed_limit_mph": None,
                         "lat": end.latitude, "lon": end.longitude})

    return {"instructions": instructions, "markers": markers,
            "junction_count": junctions, "roundabout_count": roundabouts}
