"""
Front↔rear alignment by audio cross-correlation (Phase 24).

Front and rear cameras film the same drive from the same cabin, so their microphones
hear the same events: the door closing, the indicator ticking, a pothole, the engine
note rising. Those shared events give us a way to align the two recordings that does
not depend on either camera's clock being right — the lag that maximises the
correlation between their loudness envelopes *is* the offset between them.

Why this is needed even though both clips have timestamps: the two cameras start
recording at slightly different moments, and a dual-camera setup with two independent
clocks can differ by several seconds. Filename timestamps get us close (within a clip
boundary); audio gets us to sub-frame.

Fallback ladder, best first:
  1. audio correlation with a clear peak  → sub-frame, method 'audio_correlation'
  2. wall-clock timestamps from the timeline → within a second, method 'timestamp'
  3. zero offset                           → method 'assumed_zero', flagged for review

We never silently claim precision we don't have: every result carries the method and a
confidence, and `route_videos.sync_offset_ms` is only trusted downstream to the extent
that confidence allows.
"""
from __future__ import annotations

import logging

import numpy as np

log = logging.getLogger("audio_sync")

# Envelope sample rate. 100 Hz gives 10 ms resolution — finer than a video frame at
# 30 fps, and cheap enough to correlate a 20-minute drive in well under a second.
ENVELOPE_HZ = 100
# Consumer dual-cam rigs start within seconds of each other; searching wider than this
# invites a spurious peak from repetitive road noise.
MAX_LAG_S = 30.0
# Below this normalised peak the "match" is indistinguishable from correlated road
# noise, so we decline it and fall back to timestamps.
MIN_PEAK = 0.25


def _normalise(x: np.ndarray) -> np.ndarray:
    x = x - x.mean()
    sd = x.std()
    return x / sd if sd > 1e-9 else x


def correlate_envelopes(
    front: list[float],
    rear: list[float],
    hz: int = ENVELOPE_HZ,
    max_lag_s: float = MAX_LAG_S,
) -> dict:
    """
    Lag (ms) that best aligns `rear` onto `front`, plus a 0..1 peak strength.

    A positive offset means the rear recording starts LATER than the front, so rear
    playback must be shifted forward to line up — the same sign convention as
    `route_videos.sync_offset_ms`.

    Correlation is computed on smoothed, mean-removed envelopes and normalised by the
    overlap length at each lag. Without that normalisation the peak drifts toward zero
    lag (where the most samples overlap) and the answer is always "roughly aligned",
    which would look plausible and be useless.
    """
    if len(front) < hz * 5 or len(rear) < hz * 5:
        return {"offset_ms": 0, "peak": 0.0, "method": "insufficient_audio"}

    f = _normalise(np.asarray(front, dtype=float))
    r = _normalise(np.asarray(rear, dtype=float))

    # Smooth over ~0.2 s: individual samples are noise, the shape of an event is signal.
    win = max(1, int(hz * 0.2))
    kernel = np.ones(win) / win
    f = np.convolve(f, kernel, mode="same")
    r = np.convolve(r, kernel, mode="same")

    max_lag = int(max_lag_s * hz)
    best_lag, best_score = 0, -np.inf

    for lag in range(-max_lag, max_lag + 1):
        if lag >= 0:
            a, b = f[lag:], r[: len(r) - lag] if lag else r
        else:
            a, b = f[: len(f) + lag], r[-lag:]
        n = min(len(a), len(b))
        # Require a substantial overlap: a handful of samples can correlate perfectly
        # by chance, and that spurious peak would beat the real one.
        if n < hz * 5:
            continue
        score = float(np.dot(a[:n], b[:n]) / n)
        if score > best_score:
            best_score, best_lag = score, lag

    if best_score == -np.inf:
        return {"offset_ms": 0, "peak": 0.0, "method": "insufficient_overlap"}

    peak = max(0.0, min(1.0, best_score))
    return {
        "offset_ms": int(round(best_lag * 1000 / hz)),
        "peak": round(peak, 3),
        "method": "audio_correlation",
    }


def align_front_rear(
    front_envelope: list[float],
    rear_envelope: list[float],
    front_start_epoch_ms: int | None = None,
    rear_start_epoch_ms: int | None = None,
) -> dict:
    """
    Resolve the rear stream's offset, preferring audio and falling back to clocks.

    Returns `{offset_ms, confidence (0..100), method, needs_review}`. `needs_review`
    is set when we had to assume rather than measure — the admin queue uses it to ask
    for a human check instead of publishing a guess as fact.
    """
    audio = correlate_envelopes(front_envelope, rear_envelope)

    if audio["method"] == "audio_correlation" and audio["peak"] >= MIN_PEAK:
        # Map peak strength onto a confidence band. A 0.25 peak is a weak-but-real
        # match (~60); a 0.8 peak is unambiguous (~100).
        confidence = int(min(100, 55 + audio["peak"] * 55))
        result = {**audio, "confidence": confidence, "needs_review": confidence < 70}
        log.info("front/rear aligned by audio: %+d ms (peak %.2f)",
                 audio["offset_ms"], audio["peak"])
        return result

    if front_start_epoch_ms is not None and rear_start_epoch_ms is not None:
        offset = rear_start_epoch_ms - front_start_epoch_ms
        # Timestamps are only as good as the camera clocks that wrote them, so this is
        # a moderate-confidence answer even when the arithmetic is exact.
        return {
            "offset_ms": offset,
            "peak": audio.get("peak", 0.0),
            "method": "timestamp",
            "confidence": 65,
            "needs_review": abs(offset) > 5000,
            "audio_reason": audio["method"],
        }

    return {
        "offset_ms": 0,
        "peak": 0.0,
        "method": "assumed_zero",
        "confidence": 30,
        "needs_review": True,
        "audio_reason": audio["method"],
    }


def align_video_to_gps(
    motion_or_speed_signal: list[float],
    gps_speed_signal: list[float],
    coarse_offset_ms: int = 0,
    hz: int = 1,
    max_lag_s: float = 120.0,
) -> dict:
    """
    Align a dashcam's video clock to the GPS clock by speed correlation (UC2).

    In UC2 the camera knows nothing about our app's GPS recording, so the only shared
    signal is the car's motion: GPS gives speed directly, and the video's apparent
    motion tracks it. A drive's speed profile — stops at lights, roundabout
    slowdowns, an accelerating slip road — is distinctive enough that the correlation
    peak is sharp.

    `coarse_offset_ms` is the timestamp-based starting estimate; the returned offset is
    absolute (the correction to apply to video time), not relative to it.
    """
    if len(motion_or_speed_signal) < 10 or len(gps_speed_signal) < 10:
        return {
            "offset_ms": coarse_offset_ms,
            "peak": 0.0,
            "confidence": 40,
            "method": "timestamp_only",
            "needs_review": True,
        }

    a = _normalise(np.asarray(motion_or_speed_signal, dtype=float))
    b = _normalise(np.asarray(gps_speed_signal, dtype=float))

    max_lag = int(max_lag_s * hz)
    best_lag, best_score = 0, -np.inf
    for lag in range(-max_lag, max_lag + 1):
        if lag >= 0:
            x, y = a[lag:], b[: len(b) - lag] if lag else b
        else:
            x, y = a[: len(a) + lag], b[-lag:]
        n = min(len(x), len(y))
        if n < 10:
            continue
        score = float(np.dot(x[:n], y[:n]) / n)
        if score > best_score:
            best_score, best_lag = score, lag

    if best_score == -np.inf:
        return {
            "offset_ms": coarse_offset_ms,
            "peak": 0.0,
            "confidence": 40,
            "method": "timestamp_only",
            "needs_review": True,
        }

    peak = max(0.0, min(1.0, best_score))
    offset_ms = coarse_offset_ms + int(round(best_lag * 1000 / hz))
    confidence = int(min(100, 40 + peak * 60))
    return {
        "offset_ms": offset_ms,
        "peak": round(peak, 3),
        "confidence": confidence,
        "method": "speed_correlation",
        # A dashcam alignment below this bar is exactly the case the instructor's
        # scrub-to-match confirmation exists for.
        "needs_review": confidence < 70,
    }
