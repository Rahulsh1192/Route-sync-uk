"""Clip ordering + gap/overlap detection (deliverable #7)."""
from dataclasses import dataclass


@dataclass
class Clip:
    file_id: str
    start_ts: float   # epoch seconds (from metadata)
    duration_s: float

    @property
    def end_ts(self) -> float:
        return self.start_ts + self.duration_s


def analyse_continuity(clips: list[Clip], gap_threshold_s: float = 2.0):
    """
    Sort clips by start timestamp; report gaps, overlaps and out-of-order issues.
    Returns findings consumed by the review queue and quality score.
    """
    ordered = sorted(clips, key=lambda c: c.start_ts)
    gaps, overlaps = [], []

    for prev, nxt in zip(ordered, ordered[1:]):
        delta = nxt.start_ts - prev.end_ts
        if delta > gap_threshold_s:
            gaps.append({
                "after_file": prev.file_id,
                "before_file": nxt.file_id,
                "gap_s": round(delta, 2),
                "large": delta > 10.0,
            })
        elif delta < -gap_threshold_s:
            overlaps.append({
                "file_a": prev.file_id,
                "file_b": nxt.file_id,
                "overlap_s": round(-delta, 2),
            })

    out_of_order = [c.file_id for c, o in zip(clips, ordered) if c.file_id != o.file_id]

    return {
        "ordered_file_ids": [c.file_id for c in ordered],
        "gaps": gaps,
        "overlaps": overlaps,
        "out_of_order_detected": bool(out_of_order),
        "total_duration_s": round(sum(c.duration_s for c in ordered), 2),
        "missing_segments": len([g for g in gaps if g["large"]]),
    }


def reconcile_front_rear(front: dict, rear: dict, drift_threshold_s: float = 1.0):
    """Compare front vs rear continuity; flag missing segments and timeline drift."""
    f_dur = front.get("total_duration_s", 0)
    r_dur = rear.get("total_duration_s", 0)
    drift = round(abs(f_dur - r_dur), 2)
    return {
        "front_duration_s": f_dur,
        "rear_duration_s": r_dur,
        "timeline_drift_s": drift,
        "drift_exceeds_threshold": drift > drift_threshold_s,
        "missing_rear": r_dur == 0 and f_dur > 0,
        "missing_front": f_dur == 0 and r_dur > 0,
    }
