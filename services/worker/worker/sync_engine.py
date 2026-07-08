"""
Sync engine (deliverable #6): align video timeline with GPX timeline.

Strategy:
  1. Coarse align via clip-start timestamps onto the GPS master clock.
  2. Fine align via cross-correlation of a video "motion energy" signal against
     the GPX-derived speed signal — the lag at peak correlation is the offset.
  3. Compute a confidence score from the sharpness of the correlation peak,
     GPS quality and gap count.

The motion-energy extraction uses frame differencing (numpy); a production build
would use optical flow. AI/video deps are optional, so this falls back to a
timestamp-only alignment when they are unavailable.
"""
import numpy as np


def _normalised_xcorr(a: np.ndarray, b: np.ndarray):
    a = (a - a.mean()) / (a.std() + 1e-9)
    b = (b - b.mean()) / (b.std() + 1e-9)
    corr = np.correlate(a, b, mode="full")
    lag = int(np.argmax(corr)) - (len(b) - 1)
    peak = float(corr.max() / (len(b)))
    return lag, peak


def align(motion_signal: list[float] | None,
          speed_signal: list[float] | None,
          coarse_offset_ms: int = 0,
          gps_quality: int = 100,
          gap_count: int = 0):
    """
    Return per-stream offset (ms) and a 0..1 sync confidence.
    If signals are missing, fall back to the coarse timestamp offset.
    """
    if not motion_signal or not speed_signal:
        confidence = max(0.0, min(1.0, (gps_quality / 100) - 0.1 * gap_count))
        return {
            "offset_ms": coarse_offset_ms,
            "sync_confidence": round(confidence * 0.6, 3),  # lower: no fine align
            "method": "timestamp_only",
        }

    n = min(len(motion_signal), len(speed_signal))
    m = np.array(motion_signal[:n], dtype=float)
    s = np.array(speed_signal[:n], dtype=float)
    lag, peak = _normalised_xcorr(m, s)

    # assume both signals sampled at 1 Hz here; lag in samples => seconds => ms
    fine_offset_ms = coarse_offset_ms + lag * 1000

    peak_conf = max(0.0, min(1.0, peak))          # correlation strength
    gps_conf = gps_quality / 100
    gap_penalty = min(0.3, 0.05 * gap_count)
    confidence = max(0.0, min(1.0, 0.6 * peak_conf + 0.4 * gps_conf - gap_penalty))

    return {
        "offset_ms": int(fine_offset_ms),
        "sync_confidence": round(confidence, 3),
        "correlation_peak": round(peak, 3),
        "method": "motion_correlation",
    }
