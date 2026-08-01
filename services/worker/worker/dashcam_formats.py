"""
Dashcam filename + GPS-log format registry (Phase 24).

A dashcam splits a drive into short clips and names them by timestamp, but every
brand spells that timestamp differently. Rather than hard-code a parser per brand,
each convention is expressed declaratively as a regex with named groups, and the
list is merged with an admin-editable registry from `platform_config`
(`dashcam_format_registry`). Supporting a new model is then a config edit, not a
release — which matters because we don't know in advance what our instructors own.

Ordering matters: the first rule that matches wins, so specific brand rules are
listed before the loose generic fallbacks.

Why the filename is the primary source of truth for clip start time:
  * filenames survive copying; mtime does not (copying to a laptop, a USB stick or
    cloud storage frequently rewrites it),
  * container `creation_time` is often absent on cheap cameras, and
  * upload order is whatever the browser felt like.
So we try filename → container metadata → mtime, and record which one we used in
`upload_files.start_source` so the review screen can be honest about the evidence.

Timezone: dashcam filenames carry LOCAL camera time with no zone marker. We
interpret them in `DASHCAM_LOCAL_TZ` (default Europe/London, the product's market).
A camera set to UTC therefore reads an hour off during BST — which the
reconciliation stage detects as a whole-hour discrepancy and corrects, rather than
us guessing here.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone, tzinfo
from zoneinfo import ZoneInfo

log = logging.getLogger("dashcam_formats")

# Resolved timezones, keyed by name. Populated by `_safe_zone`.
_ZONE_CACHE: dict[str, tzinfo] = {}

# Named groups a rule may capture. Y/m/d/H/M/S build the timestamp; `view` selects
# a camera via `view_map`; `seq` is the camera's own clip counter (a tiebreak when
# two clips share a start second).
_TIME_GROUPS = ("Y", "m", "d", "H", "M", "S")


@dataclass
class FilenameRule:
    brand: str
    pattern: str
    view_map: dict[str, str] = field(default_factory=dict)
    # Two-digit years: dashcams are a 2010s-onward product, so "22" means 2022.
    century: int = 2000
    _compiled: re.Pattern | None = None

    def compiled(self) -> re.Pattern:
        if self._compiled is None:
            self._compiled = re.compile(self.pattern, re.IGNORECASE)
        return self._compiled


# ---------------------------------------------------------------------------
# Built-in conventions for the models most likely to turn up in the UK market.
# ---------------------------------------------------------------------------
BUILTIN_RULES: list[FilenameRule] = [
    # Viofo A119/A129/A139 — 2026_0722_082530_F.MP4 (F front, R rear, I interior)
    FilenameRule(
        brand="viofo",
        pattern=r"(?P<Y>\d{4})_(?P<m>\d{2})(?P<d>\d{2})_(?P<H>\d{2})(?P<M>\d{2})(?P<S>\d{2})"
                r"(?:_(?P<seq>\d+))?_?(?P<view>[FRI])?\b",
        view_map={"F": "front", "R": "rear", "I": "rear"},
    ),
    # BlackVue / Thinkware — 20260722_082530_NF.mp4
    # N=normal, E=event, P=parking recording; F=front, R=rear.
    FilenameRule(
        brand="blackvue",
        pattern=r"(?P<Y>\d{4})(?P<m>\d{2})(?P<d>\d{2})_(?P<H>\d{2})(?P<M>\d{2})(?P<S>\d{2})"
                r"_(?P<view>[NEP][FR])",
        view_map={"NF": "front", "EF": "front", "PF": "front",
                  "NR": "rear", "ER": "rear", "PR": "rear"},
    ),
    # Vantrue — 20260722_082530_0001F.MP4
    FilenameRule(
        brand="vantrue",
        pattern=r"(?P<Y>\d{4})(?P<m>\d{2})(?P<d>\d{2})_(?P<H>\d{2})(?P<M>\d{2})(?P<S>\d{2})"
                r"_(?P<seq>\d{3,4})(?P<view>[FRAB])?",
        view_map={"F": "front", "A": "front", "R": "rear", "B": "rear"},
    ),
    # 70mai — NO20260722-082530-000123.MP4
    FilenameRule(
        brand="70mai",
        pattern=r"NO(?P<Y>\d{4})(?P<m>\d{2})(?P<d>\d{2})-(?P<H>\d{2})(?P<M>\d{2})(?P<S>\d{2})"
                r"(?:-(?P<seq>\d+))?",
    ),
    # Nextbase — FILE260722-082530.MP4 / 260722_082530_0001.MP4 (2-digit year)
    FilenameRule(
        brand="nextbase",
        pattern=r"(?:FILE)?(?P<Y>\d{2})(?P<m>\d{2})(?P<d>\d{2})[-_](?P<H>\d{2})(?P<M>\d{2})(?P<S>\d{2})"
                r"(?:[-_](?P<seq>\d+))?(?:[-_]?(?P<view>[FR]))?",
        view_map={"F": "front", "R": "rear"},
    ),
    # Generic "2026-07-22 08-25-30" / "2026-07-22_08.25.30" exports
    FilenameRule(
        brand="generic_dtm",
        pattern=r"(?P<Y>\d{4})[-_.](?P<m>\d{2})[-_.](?P<d>\d{2})[ _T]"
                r"(?P<H>\d{2})[-_.:](?P<M>\d{2})[-_.:](?P<S>\d{2})",
    ),
    # Loosest fallback: any 8-digit date followed by a 6-digit time anywhere in the
    # name. Deliberately last — it would otherwise swallow the brand rules above and
    # throw away their view/seq information.
    FilenameRule(
        brand="generic_compact",
        pattern=r"(?P<Y>\d{4})(?P<m>\d{2})(?P<d>\d{2})\D{0,3}(?P<H>\d{2})(?P<M>\d{2})(?P<S>\d{2})",
    ),
]

# GPS sidecar log extensions we can parse, mapped to the parser family that handles
# them. Binary proprietary formats (e.g. Thinkware .3gf) are intentionally absent:
# we'd rather flag "unsupported GPS log" than half-decode one and publish a bad
# timeline. Extendable at runtime via `dashcam_gps_extensions` in platform_config.
BUILTIN_GPS_EXTENSIONS: dict[str, str] = {
    ".gpx": "gpx",
    ".nmea": "nmea",
    ".gps": "nmea",     # BlackVue / Thinkware sidecars are NMEA text
    ".log": "nmea",     # often NMEA; the parser sniffs and falls back to CSV
    ".txt": "nmea",
    ".csv": "csv",
    ".tsv": "csv",
    ".kml": "kml",
}


@dataclass
class ClipName:
    """What we could work out about a clip from its filename alone."""
    brand: str | None
    start_epoch_ms: int | None
    view: str | None
    seq: int | None

    @property
    def matched(self) -> bool:
        return self.start_epoch_ms is not None


def load_rules(conn=None, local_tz: str | None = None) -> list[FilenameRule]:
    """
    Built-in rules plus any admin-defined ones from `platform_config`.

    Config entries are prepended so an operator can override a built-in rule for a
    brand that ships a variant firmware. A malformed registry is logged and ignored
    rather than raised: losing custom rules degrades ingest to the defaults, while
    throwing here would stop every upload in the queue.
    """
    custom: list[FilenameRule] = []
    if conn is not None:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT value FROM platform_config WHERE key = 'dashcam_format_registry'"
                )
                row = cur.fetchone()
            raw = json.loads(row[0]) if row and row[0] else []
            for entry in raw:
                try:
                    rule = FilenameRule(
                        brand=str(entry["brand"]),
                        pattern=str(entry["pattern"]),
                        view_map={str(k): str(v) for k, v in (entry.get("view_map") or {}).items()},
                        century=int(entry.get("century", 2000)),
                    )
                    rule.compiled()  # fail fast on a bad regex, before ingest uses it
                    custom.append(rule)
                except (KeyError, TypeError, ValueError, re.error) as e:
                    log.warning("ignoring bad dashcam registry entry %r: %s", entry, e)
        except Exception as e:  # noqa: BLE001 — config is an optimisation, not a dependency
            log.warning("could not read dashcam_format_registry: %s", e)

    return custom + BUILTIN_RULES


def gps_extensions(conn=None) -> dict[str, str]:
    """Supported GPS sidecar extensions, extendable via platform_config."""
    exts = dict(BUILTIN_GPS_EXTENSIONS)
    if conn is not None:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT value FROM platform_config WHERE key = 'dashcam_gps_extensions'"
                )
                row = cur.fetchone()
            if row and row[0]:
                for ext, family in json.loads(row[0]).items():
                    ext = ext if ext.startswith(".") else f".{ext}"
                    exts[ext.lower()] = str(family)
        except Exception as e:  # noqa: BLE001
            log.warning("could not read dashcam_gps_extensions: %s", e)
    return exts


def parse_clip_name(
    filename: str,
    rules: list[FilenameRule] | None = None,
    local_tz: str = "Europe/London",
) -> ClipName:
    """
    Extract start time / camera / sequence from a clip filename.

    Returns a `ClipName` with `start_epoch_ms=None` when nothing matched — the
    caller then falls back to container metadata or mtime. We never invent a
    timestamp here; a fabricated one would silently misplace the clip on the
    timeline, which is worse than admitting we don't know.
    """
    rules = rules or BUILTIN_RULES
    tz = _safe_zone(local_tz)

    for rule in rules:
        m = rule.compiled().search(filename)
        if not m:
            continue
        groups = m.groupdict()
        if not all(groups.get(g) for g in _TIME_GROUPS):
            continue
        try:
            year = int(groups["Y"])
            if year < 100:  # 2-digit year conventions (Nextbase and friends)
                year += rule.century
            naive = datetime(
                year,
                int(groups["m"]),
                int(groups["d"]),
                int(groups["H"]),
                int(groups["M"]),
                int(groups["S"]),
            )
        except ValueError:
            # A plausible-looking but impossible date (e.g. month 13) means we
            # matched a serial number, not a timestamp. Keep looking.
            continue

        # Interpret the naive camera time in the market's local zone, then normalise
        # to UTC so everything downstream lives on one absolute clock.
        start_ms = int(naive.replace(tzinfo=tz).astimezone(timezone.utc).timestamp() * 1000)

        raw_view = (groups.get("view") or "").upper()
        view = rule.view_map.get(raw_view) if raw_view else None
        seq = int(groups["seq"]) if groups.get("seq") else None
        return ClipName(brand=rule.brand, start_epoch_ms=start_ms, view=view, seq=seq)

    return ClipName(brand=None, start_epoch_ms=None, view=None, seq=None)


def _safe_zone(name: str) -> tzinfo:
    """
    Resolve a zone name, degrading to UTC if the platform has no tz database.

    The fallback is `timezone.utc`, not `ZoneInfo("UTC")`: when the tz database is
    missing entirely (Windows without the `tzdata` package, some slim containers),
    every `ZoneInfo` lookup fails including "UTC" — so a fallback that itself used
    ZoneInfo would raise from inside the error handler and take the whole upload down
    over a timezone lookup.

    Resolved zones are cached because this is called once per clip filename.
    """
    if name in _ZONE_CACHE:
        return _ZONE_CACHE[name]
    try:
        zone: tzinfo = ZoneInfo(name)
    except Exception:  # noqa: BLE001 — includes ZoneInfoNotFoundError and ImportError
        log.warning("timezone %r unavailable (is the tzdata package installed?); "
                    "reading camera filenames as UTC", name)
        zone = timezone.utc
    _ZONE_CACHE[name] = zone
    return zone
