"""
Clip ordering and the video↔wall-clock mapping (Phase 24).

This module exists because of one physical fact: **a dashcam drops time between
clips.** It closes one file and opens the next, and 0.5–2 s of the drive is simply
never recorded. Concatenate five clips from a 20-minute drive and the resulting
video is several seconds SHORTER than the elapsed real time it spans.

That matters because the map marker is driven by GPS, which runs on wall-clock time,
while the video runs on video time. Treat them as the same quantity and the marker
falls further behind with every clip boundary — the error accumulates, so it is
smallest at the start (where nobody notices) and largest at the end (where the
learner is watching a roundabout that already happened).

`build_timeline` therefore produces an explicit per-clip mapping between the two
clocks, and `video_ms_to_wall` / `wall_ms_to_video` are the only sanctioned way to
cross between them. Nothing downstream should do arithmetic on raw video time and
expect a wall-clock answer.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

log = logging.getLogger("clip_timeline")

# A boundary gap longer than this isn't camera latency any more — it's a hole in the
# recording (card full, camera restarted, clips from two different drives). Reported
# so an admin can reject rather than silently stitching unrelated footage together.
DEFAULT_MAX_GAP_S = 10.0


@dataclass
class SourceClip:
    """One uploaded video file with everything needed to place it on the timeline."""
    file_id: str
    name: str
    view: str                       # 'front' | 'rear'
    duration_ms: int
    start_epoch_ms: int | None      # after clock correction; None = unknown
    start_source: str               # 'filename' | 'container' | 'mtime' | 'user' | 'unknown'
    brand: str | None = None
    seq: int | None = None          # camera's own clip counter, if the name had one
    declared_ordinal: int | None = None   # instructor's confirmed order (wins)

    @property
    def end_epoch_ms(self) -> int | None:
        if self.start_epoch_ms is None:
            return None
        return self.start_epoch_ms + self.duration_ms


@dataclass
class TimelineEntry:
    """Where one clip sits in the concatenated output AND in real time."""
    clip_seq: int
    file_id: str
    name: str
    video_start_ms: int
    video_end_ms: int
    wall_start_epoch_ms: int
    wall_end_epoch_ms: int
    gap_before_ms: int
    # Seconds to cut from the FRONT of this clip before concatenating, when it
    # overlaps the previous one. The media step must honour this, otherwise the
    # mapping would describe a video that doesn't exist.
    trim_start_ms: int = 0


@dataclass
class Timeline:
    view: str
    entries: list[TimelineEntry] = field(default_factory=list)
    total_video_ms: int = 0
    total_wall_ms: int = 0
    dropped_ms: int = 0                     # real time with no frames
    gaps: list[dict] = field(default_factory=list)
    overlaps: list[dict] = field(default_factory=list)
    ordering_confident: bool = True
    notes: list[str] = field(default_factory=list)

    @property
    def start_epoch_ms(self) -> int | None:
        return self.entries[0].wall_start_epoch_ms if self.entries else None

    @property
    def end_epoch_ms(self) -> int | None:
        return self.entries[-1].wall_end_epoch_ms if self.entries else None

    def as_findings(self) -> dict:
        """Compact summary for `upload_stages.findings` / the review screen."""
        return {
            "view": self.view,
            "clips": len(self.entries),
            "total_video_s": round(self.total_video_ms / 1000, 1),
            "total_wall_s": round(self.total_wall_ms / 1000, 1),
            "dropped_between_clips_s": round(self.dropped_ms / 1000, 2),
            "gaps": self.gaps,
            "overlaps": self.overlaps,
            "ordering_confident": self.ordering_confident,
            "order": [e.name for e in self.entries],
            "notes": self.notes,
        }


def order_clips(clips: list[SourceClip]) -> tuple[list[SourceClip], bool, list[str]]:
    """
    Put clips in recording order and say how much we trust the result.

    Precedence, strongest evidence first:
      1. `declared_ordinal` — a human looked at the detected order and confirmed or
         corrected it on the review screen. Nothing beats that.
      2. `start_epoch_ms` — the timestamp inside the filename or container.
      3. The camera's own `seq` counter, then the filename alphabetically — which is
         usually right, since these names are designed to sort chronologically.

    Returns `(ordered, confident, notes)`. `confident` is False when we had to fall
    back to name ordering for any clip, which is the signal the pipeline uses to ask
    the instructor to confirm rather than publishing on a guess.
    """
    notes: list[str] = []

    declared = [c for c in clips if c.declared_ordinal is not None]
    if declared and len(declared) == len(clips):
        notes.append("order confirmed by the instructor")
        return sorted(clips, key=lambda c: c.declared_ordinal or 0), True, notes

    timed = [c for c in clips if c.start_epoch_ms is not None]
    if len(timed) == len(clips) and clips:
        ordered = sorted(clips, key=lambda c: (c.start_epoch_ms or 0, c.seq or 0, c.name))
        weak = [c.name for c in clips if c.start_source == "mtime"]
        if weak:
            # mtime is the weakest evidence we accept: copying a file to a laptop or a
            # USB stick rewrites it on many systems, which can reorder a whole drive.
            notes.append(
                f"{len(weak)} clip(s) ordered by file modification time, which copying can change"
            )
            return ordered, False, notes
        return ordered, True, notes

    # Mixed or missing timestamps: fall back to the camera's counter, then the name.
    notes.append(
        f"{len(clips) - len(timed)} clip(s) had no readable timestamp — ordered by name"
    )
    ordered = sorted(
        clips,
        key=lambda c: (
            c.start_epoch_ms if c.start_epoch_ms is not None else float("inf"),
            c.seq if c.seq is not None else float("inf"),
            c.name,
        ),
    )
    return ordered, False, notes


def build_timeline(
    view: str,
    clips: list[SourceClip],
    max_gap_s: float = DEFAULT_MAX_GAP_S,
) -> Timeline:
    """
    Lay ordered clips out on both clocks.

    Video positions are cumulative durations (no padding inserted — the concatenated
    file really is gap-free). Wall-clock positions come from each clip's own start
    time, so the gaps live in the mapping rather than in the media. That's the whole
    point: we keep the video tight and the arithmetic honest, instead of the reverse.

    Overlapping clips (the camera repeating a second at a boundary, or the same clip
    uploaded twice) are trimmed from the front so wall time stays monotonic. Trimming
    the newer clip rather than the older one keeps the earliest recorded frames, which
    are the ones the GPS track was matched against.
    """
    tl = Timeline(view=view)
    ordered, confident, notes = order_clips(clips)
    tl.ordering_confident = confident
    tl.notes = list(notes)

    if not ordered:
        return tl

    # If nothing has a wall-clock time we can still emit a video-only timeline; the
    # reconciliation stage will refuse to publish it, but the clips remain playable.
    if all(c.start_epoch_ms is None for c in ordered):
        tl.notes.append("no clip had a usable start time — wall-clock mapping unavailable")
        cursor = 0
        for i, c in enumerate(ordered):
            tl.entries.append(TimelineEntry(
                clip_seq=i, file_id=c.file_id, name=c.name,
                video_start_ms=cursor, video_end_ms=cursor + c.duration_ms,
                wall_start_epoch_ms=cursor, wall_end_epoch_ms=cursor + c.duration_ms,
                gap_before_ms=0,
            ))
            cursor += c.duration_ms
        tl.total_video_ms = cursor
        tl.total_wall_ms = cursor
        return tl

    # Anchor unknown starts to the running wall clock so one unreadable filename in
    # the middle of a good set doesn't discard the rest of the timeline.
    video_cursor = 0
    prev_wall_end: int | None = None
    clip_seq = 0

    for c in ordered:
        start = c.start_epoch_ms
        if start is None:
            start = prev_wall_end if prev_wall_end is not None else 0
            tl.notes.append(f"{c.name}: start time assumed to follow the previous clip")

        gap = 0
        trim = 0
        duration = c.duration_ms

        if prev_wall_end is not None:
            delta = start - prev_wall_end
            if delta < 0:
                # Overlap: cut the front of this clip so wall time stays monotonic.
                # Trimming the LATER clip keeps the earliest recorded frames, which are
                # the ones the GPS track was matched against. A clip wholly inside the
                # previous one is a duplicate upload and is dropped.
                overlap_ms = -delta
                tl.overlaps.append({
                    "clip": c.name,
                    "overlap_s": round(overlap_ms / 1000, 2),
                    "action": "trimmed" if overlap_ms < duration else "dropped",
                })
                if overlap_ms >= duration:
                    continue
                trim = overlap_ms
                duration -= overlap_ms
                start = prev_wall_end
            elif delta > 0:
                gap = delta
                tl.dropped_ms += delta
                tl.gaps.append({
                    "before_clip": c.name,
                    "gap_s": round(delta / 1000, 2),
                    # A long gap is a hole in the recording (card full, camera
                    # restarted, clips from two drives), not inter-file latency.
                    "large": delta > max_gap_s * 1000,
                })

        tl.entries.append(TimelineEntry(
            clip_seq=clip_seq,
            file_id=c.file_id,
            name=c.name,
            video_start_ms=video_cursor,
            video_end_ms=video_cursor + duration,
            wall_start_epoch_ms=start,
            wall_end_epoch_ms=start + duration,
            gap_before_ms=gap,
            trim_start_ms=trim,
        ))
        clip_seq += 1
        video_cursor += duration
        prev_wall_end = start + duration

    tl.total_video_ms = video_cursor
    if tl.entries:
        tl.total_wall_ms = tl.entries[-1].wall_end_epoch_ms - tl.entries[0].wall_start_epoch_ms
    return tl


def video_ms_to_wall(tl: Timeline, video_ms: int) -> int | None:
    """
    Position in the concatenated video → absolute wall-clock ms.

    Positions beyond the final clip clamp to its end rather than extrapolating: past
    the last frame we genuinely don't know what time it is, and inventing a value
    would put the marker somewhere the footage never went.
    """
    if not tl.entries:
        return None
    for e in tl.entries:
        if e.video_start_ms <= video_ms < e.video_end_ms:
            return e.wall_start_epoch_ms + (video_ms - e.video_start_ms)
    last = tl.entries[-1]
    if video_ms >= last.video_end_ms:
        return last.wall_end_epoch_ms
    return tl.entries[0].wall_start_epoch_ms


def wall_ms_to_video(tl: Timeline, epoch_ms: int) -> int | None:
    """
    Absolute wall-clock ms → position in the concatenated video.

    Returns None for an instant that fell in a gap between clips: that moment of the
    drive was never filmed, so there is no frame to seek to. Callers building the
    track deliberately skip those points instead of snapping them to a neighbouring
    clip, which would show the wrong footage for that position.
    """
    if not tl.entries:
        return None
    for e in tl.entries:
        if e.wall_start_epoch_ms <= epoch_ms < e.wall_end_epoch_ms:
            return e.video_start_ms + (epoch_ms - e.wall_start_epoch_ms)
    return None


def media_plan(tl: Timeline, files_by_id: dict[str, dict]) -> list[dict]:
    """
    The concat plan the media step must follow: the same clips, in the same order,
    with the same trims the timeline assumes.

    Keeping this derived from the timeline (rather than re-sorting in the media layer)
    is what guarantees the mapping describes the video we actually build. If the two
    ever disagree, every timestamp downstream is wrong.
    """
    plan: list[dict] = []
    for e in tl.entries:
        f = files_by_id.get(e.file_id)
        if not f:
            log.warning("timeline references unknown file %s", e.file_id)
            continue
        plan.append({
            "file": f,
            "trim_start_ms": e.trim_start_ms,
            "expected_duration_ms": e.video_end_ms - e.video_start_ms,
        })
    return plan


def rows_for_db(route_id: str, tl: Timeline) -> list[tuple]:
    """`route_clip_timeline` rows, in the column order `db.write_clip_timeline` uses."""
    return [
        (
            route_id, tl.view, e.clip_seq, e.file_id, e.name,
            e.video_start_ms, e.video_end_ms,
            e.wall_start_epoch_ms, e.wall_end_epoch_ms, e.gap_before_ms,
        )
        for e in tl.entries
    ]
