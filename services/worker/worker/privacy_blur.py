"""
AI privacy system (deliverable #4): detect & blur faces and number plates
before publishing. Uses YOLO (Ultralytics) for detection + OpenCV for blurring.

Heavy AI deps are optional. When ENABLE_AI_BLUR is false or deps are missing,
this is a no-op pass-through that records that blurring was skipped — so the
pipeline still runs end-to-end in light local dev.
"""
import shutil
from .config import config


def blur_faces_and_plates(in_path: str, out_path: str) -> dict:
    if not config.ENABLE_AI_BLUR:
        shutil.copyfile(in_path, out_path)
        return {"blurred": False, "reason": "ENABLE_AI_BLUR=false", "detections": 0}

    try:
        import cv2  # noqa: F401
        from ultralytics import YOLO
    except ImportError:
        shutil.copyfile(in_path, out_path)
        return {"blurred": False, "reason": "AI deps not installed", "detections": 0}

    import cv2
    model = YOLO(config.YOLO_MODEL)
    cap = cv2.VideoCapture(in_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    writer = cv2.VideoWriter(out_path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))

    detections = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        # Detect; classes filtered to person/face/plate models in production.
        for r in model.predict(frame, verbose=False):
            for box in r.boxes.xyxy.cpu().numpy().astype(int):
                x1, y1, x2, y2 = box
                roi = frame[y1:y2, x1:x2]
                if roi.size:
                    frame[y1:y2, x1:x2] = cv2.GaussianBlur(roi, (51, 51), 30)
                    detections += 1
        writer.write(frame)

    cap.release()
    writer.release()
    return {"blurred": True, "detections": detections}
