"""Route quality score (deliverable #7): weighted 0..100 from five factors."""

WEIGHTS = {
    "gps_quality": 0.25,
    "video_quality": 0.25,
    "completeness": 0.20,
    "sync_confidence": 0.20,
    "contributor_rep": 0.10,
}


def compute(gps_quality: int, video_quality: int, completeness: int,
            sync_confidence: float, contributor_rep: int) -> dict:
    """sync_confidence is 0..1; everything else is 0..100."""
    factors = {
        "gps_quality": gps_quality,
        "video_quality": video_quality,
        "completeness": completeness,
        "sync_confidence": int(sync_confidence * 100),
        "contributor_rep": min(100, contributor_rep),
    }
    overall = round(sum(factors[k] * w for k, w in WEIGHTS.items()))
    return {"overall": overall, "factors": factors, "weights": WEIGHTS}


def completeness_from_gaps(gaps: list[dict], total_duration_s: float) -> int:
    """Completeness drops with missing footage relative to total duration."""
    missing = sum(g.get("gap_s", 0) for g in gaps)
    if total_duration_s <= 0:
        return 0
    ratio = max(0.0, 1.0 - missing / total_duration_s)
    return int(ratio * 100)
