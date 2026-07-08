"""Worker configuration loaded from environment."""
import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
    DATABASE_URL = os.getenv("DATABASE_URL", "")
    API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:3000")

    S3_ENDPOINT = os.getenv("S3_ENDPOINT", "http://localhost:9000")
    S3_REGION = os.getenv("S3_REGION", "auto")
    S3_BUCKET = os.getenv("S3_BUCKET", "routesync-media")
    S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "routesync")
    S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "routesync123")

    ENABLE_AI_BLUR = os.getenv("ENABLE_AI_BLUR", "false").lower() == "true"
    ENABLE_WHISPER = os.getenv("ENABLE_WHISPER", "false").lower() == "true"
    YOLO_MODEL = os.getenv("YOLO_MODEL", "yolov8n.pt")

    # Routing engine for turn-by-turn instructions (self-hosted Valhalla / GraphHopper).
    # When unset, the worker falls back to a geometry-based instruction generator.
    VALHALLA_URL = os.getenv("VALHALLA_URL", "")

    MEDIA_JOBS_KEY = "media:jobs"


config = Config()
