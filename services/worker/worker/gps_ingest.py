"""
Multi-file, multi-format GPS ingest (Phase 24).

A 20-minute drive comes off a dashcam as several GPS logs, and every brand writes a
different format. This module turns any number of those files into ONE track on the
absolute UTC clock:

    parse each file → tag every fix with epoch ms → merge → sort → dedupe → clean

Deliberate choices:

  * **Sorted by timestamp, not by upload order.** Upload order is not meaningful
    (browsers make no guarantee about file-input order, and users mis-select), so
    the timestamp inside the data is the only trustworthy ordering key.
  * **Overlapping ranges are deduped, not appended.** Dashcams routinely repeat the
    last few seconds at a file boundary. Appending them would push the track back in
    time mid-drive, which the matcher reads as driving backwards.
  * **Parse failures are reported per file, never silently dropped.** A missing log
    changes the coverage verdict, so the pipeline needs to know a file yielded
    nothing rather than quietly proceeding with a shorter track.
  * **No timestamp means the fix is discarded.** The whole design rests on a shared
    clock; a fix we can't place on it is worse than no fix at all.
"""
from __future__ import annotations

import csv
import io
import logging
import math
import re
import subprocess
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from xml.etree import ElementTree

log = logging.getLogger("gps_ingest")

KNOTS_TO_MPS = 0.514444
# Above this the "movement" is a GPS glitch, not a car (~270 km/h).
TELEPORT_SPEED_MPS = 75.0
# Two fixes closer together than this in time are treated as the same instant, which
# is how we collapse the repeated tail of an overlapping log file.
DEDUPE_WINDOW_MS = 400


@dataclass
class Fix:
    """One GPS observation on the absolute UTC clock."""
    epoch_ms: int
    lat: float
    lng: float
    speed_mps: float | None = None
    accuracy_m: float | None = None


@dataclass
class ParsedFile:
    """Per-file ingest outcome, surfaced to the review UI and the admin queue."""
    name: str
    fmt: str
    fixes: list[Fix]
    error: str | None = None

    @property
    def count(self) -> int:
        return len(self.fixes)


# ---------------------------------------------------------------------------
# Format parsers
# ---------------------------------------------------------------------------

def parse_gpx(text: str) -> list[Fix]:
    """GPX 1.0/1.1 track points. Namespace-agnostic (brands vary in what they emit)."""
    fixes: list[Fix] = []
    root = ElementTree.fromstring(text.encode("utf-8", errors="ignore"))

    def local(tag: str) -> str:
        return tag.rsplit("}", 1)[-1]

    for el in root.iter():
        if local(el.tag) not in ("trkpt", "wpt", "rtept"):
            continue
        try:
            lat = float(el.attrib["lat"])
            lng = float(el.attrib["lon"])
        except (KeyError, ValueError):
            continue

        t_ms: int | None = None
        speed: float | None = None
        for child in el:
            name = local(child.tag)
            if name == "time" and child.text:
                t_ms = _iso_to_epoch_ms(child.text.strip())
            elif name == "speed" and child.text:
                speed = _to_float(child.text)
            elif name == "extensions":
                # Garmin/others nest speed inside <extensions>
                for sub in child.iter():
                    if local(sub.tag).endswith("speed") and sub.text:
                        speed = _to_float(sub.text)
        if t_ms is None:
            continue
        fixes.append(Fix(epoch_ms=t_ms, lat=lat, lng=lng, speed_mps=speed))
    return fixes


_RMC = re.compile(r"^\$[A-Z]{2}RMC,")
_GGA = re.compile(r"^\$[A-Z]{2}GGA,")


def parse_nmea(text: str) -> list[Fix]:
    """
    NMEA 0183 sentence logs (BlackVue/Thinkware `.gps`, generic `.nmea`/`.log`).

    RMC is the workhorse: it carries date, time, position and speed together. GGA has
    no date, so a GGA-only log is anchored to the most recent date seen in an RMC —
    and skipped entirely until one appears, because guessing the day from the file's
    mtime would place the whole track on the wrong date.
    """
    fixes: list[Fix] = []
    current_date: datetime | None = None

    for raw in text.splitlines():
        line = raw.strip()
        if not line.startswith("$"):
            continue
        # Tolerate the checksum being absent or wrong; consumer cameras emit both.
        body = line.split("*", 1)[0]
        parts = body.split(",")

        if _RMC.match(body) and len(parts) >= 10:
            if parts[2] != "A":  # not a valid fix
                continue
            t = _nmea_time(parts[1])
            d = _nmea_date(parts[9])
            if t is None or d is None:
                continue
            current_date = d
            lat = _nmea_coord(parts[3], parts[4])
            lng = _nmea_coord(parts[5], parts[6])
            if lat is None or lng is None:
                continue
            speed_knots = _to_float(parts[7])
            fixes.append(Fix(
                epoch_ms=_combine(d, t),
                lat=lat,
                lng=lng,
                speed_mps=speed_knots * KNOTS_TO_MPS if speed_knots is not None else None,
            ))

        elif _GGA.match(body) and len(parts) >= 10 and current_date is not None:
            t = _nmea_time(parts[1])
            if t is None or parts[6] in ("", "0"):  # fix quality 0 = no fix
                continue
            lat = _nmea_coord(parts[2], parts[3])
            lng = _nmea_coord(parts[4], parts[5])
            if lat is None or lng is None:
                continue
            hdop = _to_float(parts[8])
            fixes.append(Fix(
                epoch_ms=_combine(current_date, t),
                lat=lat,
                lng=lng,
                # HDOP is a dimensionless dilution factor, not metres; ~5 m per unit
                # is the usual rule of thumb for consumer receivers.
                accuracy_m=hdop * 5.0 if hdop is not None else None,
            ))

    return fixes


# Header aliases seen in the wild across camera exports and phone loggers.
_CSV_LAT = ("lat", "latitude", "gpslatitude", "y")
_CSV_LNG = ("lon", "lng", "long", "longitude", "gpslongitude", "x")
_CSV_TIME = ("time", "timestamp", "datetime", "date_time", "utc", "gpsdatetime", "date")
_CSV_SPEED = ("speed", "speed_mps", "speed_kmh", "speed_mph", "gpsspeed", "velocity")


def parse_csv(text: str) -> list[Fix]:
    """
    Delimited exports. Column names are matched by alias rather than position, and
    the delimiter is sniffed, because there is no standard here at all.
    """
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel

    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    if not reader.fieldnames:
        return []

    norm = {(f or "").strip().lower().replace(" ", "").replace("_", ""): f
            for f in reader.fieldnames}

    def col(aliases: tuple[str, ...]) -> str | None:
        for a in aliases:
            if a in norm:
                return norm[a]
        # substring match as a last resort ("gps_latitude_deg")
        for key, original in norm.items():
            if any(a in key for a in aliases):
                return original
        return None

    c_lat, c_lng, c_time = col(_CSV_LAT), col(_CSV_LNG), col(_CSV_TIME)
    if not (c_lat and c_lng and c_time):
        return []
    c_speed = col(_CSV_SPEED)
    speed_unit = _speed_unit(c_speed)

    fixes: list[Fix] = []
    for row in reader:
        lat, lng = _to_float(row.get(c_lat)), _to_float(row.get(c_lng))
        t_ms = _flexible_time(row.get(c_time))
        if lat is None or lng is None or t_ms is None:
            continue
        speed = _to_float(row.get(c_speed)) if c_speed else None
        if speed is not None:
            speed *= speed_unit
        fixes.append(Fix(epoch_ms=t_ms, lat=lat, lng=lng, speed_mps=speed))
    return fixes


def parse_kml(text: str) -> list[Fix]:
    """
    KML `gx:Track` (paired `<when>` / `<gx:coord>`) and, failing that, a plain
    `<coordinates>` blob. The latter has no timestamps, so it yields nothing — a
    geometry-only KML can't be placed on the clock and is reported as unusable.
    """
    root = ElementTree.fromstring(text.encode("utf-8", errors="ignore"))

    def local(tag: str) -> str:
        return tag.rsplit("}", 1)[-1]

    whens: list[int] = []
    coords: list[tuple[float, float]] = []
    for el in root.iter():
        name = local(el.tag)
        if name == "when" and el.text:
            t = _iso_to_epoch_ms(el.text.strip())
            if t is not None:
                whens.append(t)
        elif name == "coord" and el.text:
            bits = el.text.split()
            if len(bits) >= 2:
                lng, lat = _to_float(bits[0]), _to_float(bits[1])
                if lat is not None and lng is not None:
                    coords.append((lat, lng))

    return [Fix(epoch_ms=t, lat=c[0], lng=c[1]) for t, c in zip(whens, coords)]


def extract_embedded(video_path: str) -> list[Fix]:
    """
    Pull GPS out of a video file's data stream (the `embedded` GPS source).

    Many GPS dashcams mux telemetry into the MP4 (GoPro GPMF, Novatek/Viofo
    subtitle-style tracks, Garmin). This is the ideal case: the position and the
    frames come off one device with one clock, so alignment is exact by construction
    instead of correlated.

    Strategy is best-effort and non-fatal — exiftool first (widest format coverage),
    then any text-ish data stream ffmpeg can demux, parsed as NMEA. If neither
    yields fixes the caller falls back to sidecar logs or app-recorded GPS.
    """
    fixes = _extract_via_exiftool(video_path)
    if fixes:
        return fixes
    return _extract_via_ffmpeg(video_path)


def _extract_via_exiftool(video_path: str) -> list[Fix]:
    try:
        out = subprocess.run(
            ["exiftool", "-ee", "-n", "-T",
             "-GPSDateTime", "-GPSLatitude", "-GPSLongitude", "-GPSSpeed", video_path],
            capture_output=True, text=True, timeout=300, check=False,
        )
    except (FileNotFoundError, subprocess.SubprocessError) as e:
        log.info("exiftool unavailable for embedded GPS (%s)", e)
        return []

    fixes: list[Fix] = []
    for line in out.stdout.splitlines():
        cells = [c.strip() for c in line.split("\t")]
        if len(cells) < 3:
            continue
        t_ms = _flexible_time(cells[0])
        lat, lng = _to_float(cells[1]), _to_float(cells[2])
        if t_ms is None or lat is None or lng is None:
            continue
        # exiftool reports GPSSpeed in km/h with -n for most dashcam formats.
        speed = _to_float(cells[3]) if len(cells) > 3 else None
        fixes.append(Fix(epoch_ms=t_ms, lat=lat, lng=lng,
                         speed_mps=speed / 3.6 if speed is not None else None))
    if fixes:
        log.info("extracted %d embedded fixes via exiftool", len(fixes))
    return fixes


def _extract_via_ffmpeg(video_path: str) -> list[Fix]:
    try:
        out = subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-i", video_path,
             "-map", "0:d?", "-f", "data", "-"],
            capture_output=True, timeout=300, check=False,
        )
    except (FileNotFoundError, subprocess.SubprocessError) as e:
        log.info("ffmpeg data-stream extraction unavailable (%s)", e)
        return []

    text = out.stdout.decode("utf-8", errors="ignore")
    if "RMC" not in text and "GGA" not in text:
        return []
    fixes = parse_nmea(text)
    if fixes:
        log.info("extracted %d embedded fixes from the data stream", len(fixes))
    return fixes


PARSERS = {
    "gpx": parse_gpx,
    "nmea": parse_nmea,
    "csv": parse_csv,
    "kml": parse_kml,
}


def parse_text(text: str, family: str, name: str = "") -> ParsedFile:
    """
    Parse one log, retrying with the other families when the declared one yields
    nothing. Extensions lie constantly here (`.log` holding CSV, `.txt` holding GPX),
    and sniffing costs microseconds compared with re-uploading a 20-minute drive.
    """
    order = [family] + [f for f in ("gpx", "nmea", "csv", "kml") if f != family]
    last_error: str | None = None

    for fam in order:
        parser = PARSERS.get(fam)
        if not parser:
            continue
        try:
            fixes = parser(text)
        except Exception as e:  # noqa: BLE001 — a malformed file is data, not a bug
            last_error = f"{fam}: {e}"
            continue
        if fixes:
            return ParsedFile(name=name, fmt=fam, fixes=fixes)

    return ParsedFile(name=name, fmt=family, fixes=[],
                      error=last_error or "no usable GPS fixes found")


# ---------------------------------------------------------------------------
# Merge
# ---------------------------------------------------------------------------

def merge(parsed: list[ParsedFile]) -> tuple[list[Fix], dict]:
    """
    Combine per-file fixes into one clean, strictly increasing track.

    Returns the track plus a findings dict for the review screen: which files
    contributed, how many duplicates collapsed, and how many implausible points were
    dropped. The counts matter — "we merged 5 logs into 1,204 fixes and threw away 3"
    is reviewable, while a bare track is not.
    """
    all_fixes: list[Fix] = []
    for p in parsed:
        all_fixes.extend(p.fixes)

    if not all_fixes:
        return [], {
            "files": [_file_report(p) for p in parsed],
            "point_count": 0,
            "error": "no GPS fixes could be parsed from any file",
        }

    all_fixes.sort(key=lambda f: f.epoch_ms)

    merged: list[Fix] = []
    duplicates = 0
    teleports_dropped = 0

    for fix in all_fixes:
        if not _plausible(fix):
            teleports_dropped += 1
            continue
        if merged:
            prev = merged[-1]
            if fix.epoch_ms - prev.epoch_ms < DEDUPE_WINDOW_MS:
                # Same instant from an overlapping file: keep whichever fix claims
                # the better accuracy, so a boundary repeat can only improve the
                # track rather than duplicate or degrade it.
                duplicates += 1
                if _better(fix, prev):
                    merged[-1] = fix
                continue
            # Reject a jump no car could make. Checked against the kept track (not the
            # raw list) so one wild outlier can't drag the rest of the drive out.
            dt_s = (fix.epoch_ms - prev.epoch_ms) / 1000.0
            if dt_s > 0:
                v = _haversine_m(prev.lat, prev.lng, fix.lat, fix.lng) / dt_s
                if v > TELEPORT_SPEED_MPS and dt_s < 30:
                    teleports_dropped += 1
                    continue
        merged.append(fix)

    span_ms = merged[-1].epoch_ms - merged[0].epoch_ms if len(merged) > 1 else 0
    distance_m = sum(
        _haversine_m(a.lat, a.lng, b.lat, b.lng) for a, b in zip(merged, merged[1:])
    )

    findings = {
        "files": [_file_report(p) for p in parsed],
        "point_count": len(merged),
        "duplicates_collapsed": duplicates,
        "implausible_dropped": teleports_dropped,
        "start_epoch_ms": merged[0].epoch_ms if merged else None,
        "end_epoch_ms": merged[-1].epoch_ms if merged else None,
        "span_s": round(span_ms / 1000.0, 1),
        "distance_m": round(distance_m),
        "sample_hz": round(len(merged) / (span_ms / 1000.0), 2) if span_ms > 0 else None,
        # Files that parsed to nothing are the most common cause of a short track, so
        # they are called out separately rather than left for someone to spot.
        "failed_files": [p.name for p in parsed if p.count == 0],
    }
    return merged, findings


def to_relative_fixes(track: list[Fix], origin_epoch_ms: int | None = None) -> list[dict]:
    """
    Convert absolute fixes to the `{tMs, lat, lng, ...}` shape the conformance API
    expects, where `tMs` is milliseconds from the track's own start.

    The absolute clock is what makes cross-source alignment possible, but the
    matching engine and the players both work in relative time — so the conversion
    happens exactly once, here, at the boundary between the two.
    """
    if not track:
        return []
    origin = origin_epoch_ms if origin_epoch_ms is not None else track[0].epoch_ms
    out: list[dict] = []
    for f in track:
        t = f.epoch_ms - origin
        if t < 0:
            continue  # predates the video window; not part of this route
        fix: dict = {"tMs": t, "lat": f.lat, "lng": f.lng}
        if f.speed_mps is not None:
            fix["speedMps"] = round(f.speed_mps, 2)
        if f.accuracy_m is not None:
            fix["accuracyM"] = round(f.accuracy_m, 1)
        out.append(fix)
    return out


def speed_series(track: list[Fix], hz: float = 1.0) -> list[float]:
    """
    Resample the track's speed to a fixed cadence for cross-correlation against the
    video's apparent motion (the dashcam-clock alignment in `sync_engine`).

    Speed is derived from position rather than trusting the reported value: not every
    format includes speed, and correlation needs one consistently-derived signal
    rather than a mix of measured and computed values.
    """
    if len(track) < 2:
        return []
    step_ms = int(1000 / hz)
    start, end = track[0].epoch_ms, track[-1].epoch_ms
    series: list[float] = []
    i = 0
    for t in range(start, end + 1, step_ms):
        while i + 2 < len(track) and track[i + 1].epoch_ms < t:
            i += 1
        a, b = track[i], track[i + 1]
        dt = (b.epoch_ms - a.epoch_ms) / 1000.0
        series.append(_haversine_m(a.lat, a.lng, b.lat, b.lng) / dt if dt > 0 else 0.0)
    return series


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _file_report(p: ParsedFile) -> dict:
    return {
        "name": p.name,
        "format": p.fmt,
        "points": p.count,
        "start_epoch_ms": p.fixes[0].epoch_ms if p.fixes else None,
        "end_epoch_ms": p.fixes[-1].epoch_ms if p.fixes else None,
        **({"error": p.error} if p.error else {}),
    }


def _plausible(f: Fix) -> bool:
    if not (-90 <= f.lat <= 90) or not (-180 <= f.lng <= 180):
        return False
    # (0, 0) is the classic "no fix yet" sentinel, not a position in the Atlantic.
    if abs(f.lat) < 1e-6 and abs(f.lng) < 1e-6:
        return False
    # Reject dates outside the plausible life of a dashcam recording: a camera with a
    # dead clock reports 1970 or 2000-01-01, which would stretch the timeline wildly.
    return 1_262_304_000_000 < f.epoch_ms < 4_102_444_800_000  # 2010-01-01 .. 2100


def _better(a: Fix, b: Fix) -> bool:
    """Prefer the fix with known (and smaller) accuracy; ties keep the incumbent."""
    if a.accuracy_m is None:
        return False
    if b.accuracy_m is None:
        return True
    return a.accuracy_m < b.accuracy_m


def _speed_unit(col: str | None) -> float:
    """Multiplier converting a CSV speed column into m/s, guessed from its name."""
    if not col:
        return 1.0
    c = col.lower()
    if "kmh" in c or "km/h" in c or "kph" in c:
        return 1 / 3.6
    if "mph" in c:
        return 0.44704
    if "knot" in c:
        return KNOTS_TO_MPS
    return 1.0


def _to_float(v) -> float | None:
    if v is None:
        return None
    try:
        return float(str(v).strip())
    except (TypeError, ValueError):
        return None


def _iso_to_epoch_ms(text: str) -> int | None:
    s = text.strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return _flexible_time(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


_TIME_FORMATS = (
    "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y/%m/%d %H:%M:%S",
    "%Y:%m:%d %H:%M:%S", "%d/%m/%Y %H:%M:%S", "%m/%d/%Y %H:%M:%S",
    "%Y-%m-%d %H:%M:%S.%f", "%Y%m%d%H%M%S",
)


def _flexible_time(value) -> int | None:
    """
    Best-effort timestamp parse for CSV/exiftool output: epoch numbers, ISO strings,
    and the assorted dotted/slashed layouts different tools emit.
    """
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None

    # Bare numbers are epoch seconds or milliseconds; the magnitude tells us which.
    if re.fullmatch(r"\d{9,14}(\.\d+)?", s):
        n = float(s)
        return int(n if n > 1e11 else n * 1000)

    cleaned = s.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(cleaned)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    except ValueError:
        pass

    # Strip a trailing zone suffix the strptime formats below don't cover.
    base = re.sub(r"\s*(?:[+-]\d{2}:?\d{2}|UTC|GMT)$", "", s).strip()
    for fmt in _TIME_FORMATS:
        try:
            return int(datetime.strptime(base, fmt).replace(tzinfo=timezone.utc).timestamp() * 1000)
        except ValueError:
            continue
    return None


def _nmea_time(field: str) -> timedelta | None:
    """`hhmmss.sss` → time of day."""
    if not field or len(field) < 6:
        return None
    try:
        return timedelta(
            hours=int(field[0:2]),
            minutes=int(field[2:4]),
            seconds=float(field[4:]),
        )
    except ValueError:
        return None


def _nmea_date(field: str) -> datetime | None:
    """`ddmmyy` → date at midnight UTC."""
    if not field or len(field) != 6:
        return None
    try:
        return datetime(2000 + int(field[4:6]), int(field[2:4]), int(field[0:2]),
                        tzinfo=timezone.utc)
    except ValueError:
        return None


def _combine(date: datetime, time_of_day: timedelta) -> int:
    return int((date + time_of_day).timestamp() * 1000)


def _nmea_coord(value: str, hemisphere: str) -> float | None:
    """NMEA `ddmm.mmmm` / `dddmm.mmmm` + hemisphere → signed decimal degrees."""
    if not value or "." not in value:
        return None
    try:
        dot = value.index(".")
        deg = int(value[: dot - 2])
        minutes = float(value[dot - 2:])
    except (ValueError, IndexError):
        return None
    dec = deg + minutes / 60.0
    if hemisphere.upper() in ("S", "W"):
        dec = -dec
    return dec


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))
