"""
R1 conformance client (Phase 24).

The matching engine — what counts as on-route, where a deviation starts, which spans
survive splicing — lives in TypeScript in the API (`journeys/matching.ts`) and is
already used by the in-app recording flow. Porting it to Python for the upload path
would create two implementations of the same rules, and they would drift: a threshold
tweak or a bug fix would land in one and not the other, and the same drive would pass
in the app and fail on upload.

So the worker posts its merged track to the API and consumes the verdict. The cost is
one internal HTTP call per upload; the benefit is that "does this drive match R1"
has exactly one answer everywhere in the system.

Authentication is the shared worker secret (`WORKER_SHARED_SECRET`), matching the
`WorkerSecretGuard` on the API side.
"""
from __future__ import annotations

import logging

import httpx

from .config import config

log = logging.getLogger("conformance")


class ConformanceError(RuntimeError):
    """Raised when the API could not analyse the track (bad request or unreachable)."""


def analyse_upload(
    upload_id: str,
    fixes: list[dict] | None = None,
    video_source: str = "dashcam",
    timeout_s: float = 120.0,
) -> dict:
    """
    Run R1 conformance for an upload and return the full analysis.

    `fixes` is the merged track in `{tMs, lat, lng, speedMps?, accuracyM?}` form (UC1).
    Omit it for UC2, where the API reads the app-recorded track out of the journey the
    footage is being attached to.

    The response carries `verdict`, `coveragePct`, the kept `segments` and the snapped
    `timeline` — the timeline being what becomes `route_track_points`, and therefore
    what drives the moving map marker.

    The timeout is generous because a 20-minute drive at 1 Hz is ~1,200 fixes matched
    against a full R1 polyline; failing early here would mean re-running the whole
    media pipeline to retry.
    """
    if not config.WORKER_SHARED_SECRET:
        raise ConformanceError(
            "WORKER_SHARED_SECRET is not set — the worker cannot call the conformance API"
        )

    payload: dict = {"uploadId": upload_id, "videoSource": video_source}
    if fixes:
        payload["fixes"] = fixes

    url = f"{config.API_BASE_URL}/api/internal/journeys/analyse-upload"
    try:
        res = httpx.post(
            url,
            json=payload,
            headers={"x-worker-secret": config.WORKER_SHARED_SECRET},
            timeout=timeout_s,
        )
    except httpx.HTTPError as e:
        raise ConformanceError(f"conformance API unreachable: {e}") from e

    if res.status_code >= 400:
        # Surface the API's own message: it explains *why* (no R1 linked, track too
        # short, journey already used) far better than a status code would.
        detail = _detail(res)
        raise ConformanceError(f"conformance failed ({res.status_code}): {detail}")

    data = res.json()
    log.info(
        "upload %s conformance: %s — coverage %.1f%%, %d kept segments",
        upload_id,
        data.get("verdict"),
        float(data.get("coveragePct") or 0),
        len(data.get("segments") or []),
    )
    return data


def _detail(res: httpx.Response) -> str:
    try:
        body = res.json()
    except ValueError:
        return res.text[:300]
    if isinstance(body, dict):
        return str(body.get("title") or body.get("message") or body)[:300]
    return str(body)[:300]
