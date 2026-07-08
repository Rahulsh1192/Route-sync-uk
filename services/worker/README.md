# RouteSync Media + AI Worker (Python)

Consumes media jobs the NestJS API pushes onto a Redis list and runs the
processing pipeline (deliverables #6, #7, #8).

## Run

```bash
cp .env.example .env
pip install -r requirements.txt        # ffmpeg/ffprobe must be on PATH
python -m worker.main
```

## Pipeline stages (`worker/pipeline.py`)

```
ingest → probe → clip_sort → gap_detect → overlap_detect → merge → reencode →
front_rear_reconcile → sync_engine → gps_validate → video_validate →
ai_privacy_blur → transcode → preview_gen → duplicate_check → quality_score → ready
```

Each stage writes progress + findings to `upload_stages`; a failure flags the
upload for human review rather than crashing the worker.

## Modules

| File | Responsibility |
|---|---|
| `ffmpeg_ops.py` | ffprobe, concat merge, H.264/H.265 re-encode, HLS ladder, thumbnails |
| `gap_detection.py` | clip ordering, gap/overlap detection, front/rear reconciliation |
| `sync_engine.py` | motion↔speed cross-correlation alignment + confidence |
| `gps_validation.py` | drift / teleport / signal-loss / speed-anomaly → GPS score |
| `video_validation.py` | resolution/fps/black/frozen detection → video score |
| `privacy_blur.py` | YOLO + OpenCV face/plate blur (no-op when `ENABLE_AI_BLUR=false`) |
| `quality_score.py` | weighted 0–100 route quality |
| `fingerprint.py` | GPX geometry fingerprint + duplicate detection |

## AI dependencies

`opencv-python-headless`, `ultralytics` (YOLO) and `openai-whisper` are commented
out in `requirements.txt` for light local dev. Enable them in the worker image and
set `ENABLE_AI_BLUR=true` / `ENABLE_WHISPER=true` to activate. GPU nodes recommended
for these stages in production.
