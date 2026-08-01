"""
Video↔GPS duration reconciliation (Phase 24).

The instructor's requirement was "the total time of video should match total GPS
coordinate times". Enforced as literal equality that would reject nearly every real
upload, because a dashcam's GPS receiver starts logging as soon as it gets a fix —
before recording begins — and usually keeps going after recording stops. A GPS log
that is *longer* than the video is the normal, healthy case.

So the test is containment, not equality: how much of the VIDEO's wall-clock span is
covered by GPS. That is the quantity that actually matters, because any video second
without a GPS fix is a second where the map marker has nothing to show.

The second job here is catching a wrong camera clock. Dashcam clocks are unset after
battery loss, set to the wrong timezone, or never adjusted for DST — and the symptom
is a video span that misses the GPS span by almost exactly a whole number of hours.
When shifting by a whole hour turns a failing overlap into a passing one, that is
overwhelmingly more likely to be a timezone error than a coincidence, so we surface
the correction (with the evidence) instead of rejecting a perfectly good recording.
"""
from __future__ import annotations

import logging

log = logging.getLogger("reconcile")

# Whole-hour offsets to test when the spans don't line up. ±14 h covers every real
# timezone, including the ones a camera bought abroad might be set to.
_CANDIDATE_HOURS = list(range(-14, 15))
# Half-hour and 45-minute zones exist (India, Nepal, parts of Australia); a camera
# set to one of those against a UK drive shows up as a fractional offset.
_CANDIDATE_FRACTIONS = (0.0, 0.5, 0.75, -0.5, -0.75)


def overlap_ms(a_start: int, a_end: int, b_start: int, b_end: int) -> int:
    """Length of the intersection of two spans (0 when they don't touch)."""
    return max(0, min(a_end, b_end) - max(a_start, b_start))


def reconcile(
    video_start_ms: int | None,
    video_end_ms: int | None,
    gps_start_ms: int | None,
    gps_end_ms: int | None,
    min_overlap_pct: float = 95.0,
    detect_clock_error: bool = True,
) -> dict:
    """
    Compare the video's wall-clock span with the GPS track's span.

    Returns a findings dict with:
      * `overlap_pct`     — share of the video covered by GPS (the pass/fail number)
      * `verdict`         — 'pass' | 'warn' | 'fail'
      * `suggested_clock_offset_ms` — a whole/fractional-hour correction that would
        fix a failing overlap, when one exists
      * the raw spans, so the review screen can show the instructor real numbers
        rather than a verdict they have to take on trust

    A `warn` (rather than `fail`) is returned when GPS covers most but not all of the
    video: the route is still usable, the uncovered tail just has no marker. Only a
    genuinely unmatched pair fails.
    """
    if None in (video_start_ms, video_end_ms, gps_start_ms, gps_end_ms):
        return {
            "verdict": "fail",
            "reason": "missing video or GPS timing information",
            "overlap_pct": 0.0,
        }

    video_ms = max(0, video_end_ms - video_start_ms)
    gps_ms = max(0, gps_end_ms - gps_start_ms)
    if video_ms == 0:
        return {"verdict": "fail", "reason": "video span is zero", "overlap_pct": 0.0}
    if gps_ms == 0:
        return {"verdict": "fail", "reason": "GPS span is zero", "overlap_pct": 0.0}

    ov = overlap_ms(video_start_ms, video_end_ms, gps_start_ms, gps_end_ms)
    pct = 100.0 * ov / video_ms

    findings = {
        "video_span_s": round(video_ms / 1000, 1),
        "gps_span_s": round(gps_ms / 1000, 1),
        "overlap_s": round(ov / 1000, 1),
        "overlap_pct": round(pct, 2),
        "video_start_epoch_ms": video_start_ms,
        "video_end_epoch_ms": video_end_ms,
        "gps_start_epoch_ms": gps_start_ms,
        "gps_end_epoch_ms": gps_end_ms,
        # Positive = GPS started logging before recording began (the usual case).
        "gps_lead_in_s": round((video_start_ms - gps_start_ms) / 1000, 1),
        "gps_lead_out_s": round((gps_end_ms - video_end_ms) / 1000, 1),
        "min_overlap_pct": min_overlap_pct,
    }

    if pct >= min_overlap_pct:
        findings["verdict"] = "pass"
        return findings

    # Below threshold — try to explain it before condemning the upload.
    if detect_clock_error:
        suggestion = _detect_clock_offset(
            video_start_ms, video_end_ms, gps_start_ms, gps_end_ms, min_overlap_pct
        )
        if suggestion:
            findings.update(suggestion)
            findings["verdict"] = "warn"
            findings["reason"] = (
                f"video and GPS are offset by about {suggestion['suggested_clock_offset_hours']} h — "
                "the camera clock looks set to the wrong timezone"
            )
            return findings

    if ov == 0:
        findings["verdict"] = "fail"
        findings["reason"] = (
            "the video and the GPS track do not overlap at all — they are probably "
            "from different drives"
        )
    elif pct >= min_overlap_pct * 0.6:
        findings["verdict"] = "warn"
        findings["reason"] = (
            f"GPS covers only {pct:.1f}% of the video; the uncovered part will have no "
            "map position"
        )
    else:
        findings["verdict"] = "fail"
        findings["reason"] = f"GPS covers only {pct:.1f}% of the video"
    return findings


def _detect_clock_offset(
    video_start_ms: int,
    video_end_ms: int,
    gps_start_ms: int,
    gps_end_ms: int,
    min_overlap_pct: float,
) -> dict | None:
    """
    Find a timezone-shaped shift of the video's clock that makes the spans line up.

    Only whole/half/three-quarter-hour candidates are tested. That restriction is the
    safeguard: an arbitrary best-fit offset would "fix" any mismatched pair of files,
    including footage from two completely different drives. A timezone-shaped offset,
    by contrast, corresponds to a real and extremely common misconfiguration.
    """
    video_ms = video_end_ms - video_start_ms
    if video_ms <= 0:
        return None

    best: tuple[float, float] | None = None  # (overlap_pct, offset_hours)
    for hours in _CANDIDATE_HOURS:
        for frac in _CANDIDATE_FRACTIONS:
            offset_h = hours + frac
            if offset_h == 0:
                continue
            shift = int(offset_h * 3_600_000)
            ov = overlap_ms(
                video_start_ms + shift, video_end_ms + shift, gps_start_ms, gps_end_ms
            )
            pct = 100.0 * ov / video_ms
            if best is None or pct > best[0]:
                best = (pct, offset_h)

    if best and best[0] >= min_overlap_pct:
        pct, offset_h = best
        log.info("inferred camera clock offset of %+.2f h (overlap %.1f%%)", offset_h, pct)
        return {
            "suggested_clock_offset_ms": int(offset_h * 3_600_000),
            "suggested_clock_offset_hours": round(offset_h, 2),
            "overlap_pct_after_correction": round(pct, 2),
        }
    return None


def reconcile_front_rear(
    front_total_ms: int,
    rear_total_ms: int,
    max_drift_s: float = 2.0,
) -> dict:
    """
    Sanity-check the two cameras against each other.

    Front and rear film the same drive, so their durations should agree closely. A big
    disagreement means one camera missed clips (or the instructor uploaded a rear set
    from a different drive) — worth flagging, not worth blocking, because the front
    view alone still makes a usable route.
    """
    if front_total_ms == 0 or rear_total_ms == 0:
        return {
            "front_s": round(front_total_ms / 1000, 1),
            "rear_s": round(rear_total_ms / 1000, 1),
            "drift_s": 0.0,
            "drift_exceeds_threshold": False,
            "note": "only one camera view was uploaded",
        }
    drift_s = abs(front_total_ms - rear_total_ms) / 1000.0
    return {
        "front_s": round(front_total_ms / 1000, 1),
        "rear_s": round(rear_total_ms / 1000, 1),
        "drift_s": round(drift_s, 2),
        "drift_exceeds_threshold": drift_s > max_drift_s,
        "max_drift_s": max_drift_s,
    }
