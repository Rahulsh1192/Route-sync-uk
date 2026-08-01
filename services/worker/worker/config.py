"""Worker configuration loaded from environment."""
import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
    DATABASE_URL = os.getenv("DATABASE_URL", "")
    API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:3000")

    # Object storage. Cloudflare R2 is S3-compatible, so the same boto3 client serves
    # both R2 and MinIO (local dev). `R2_*` is the preferred spelling and falls back to
    # the `S3_*` names this project has always used, so existing deployments and
    # docker-compose keep working unchanged.
    S3_ENDPOINT = os.getenv("S3_ENDPOINT") or (
        f"https://{os.getenv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com"
        if os.getenv("R2_ACCOUNT_ID")
        else "http://localhost:9000"
    )
    S3_REGION = os.getenv("S3_REGION", "auto")
    S3_BUCKET = os.getenv("R2_BUCKET") or os.getenv("S3_BUCKET", "routesync-media")
    S3_ACCESS_KEY = os.getenv("R2_ACCESS_KEY") or os.getenv("S3_ACCESS_KEY", "routesync")
    S3_SECRET_KEY = os.getenv("R2_SECRET_KEY") or os.getenv("S3_SECRET_KEY", "routesync123")

    # Public CDN origin. Unset means every asset is served through a signed URL, which is
    # the safe default for paid footage; see the API's R2_PUBLIC_URL note.
    R2_PUBLIC_URL = os.getenv("R2_PUBLIC_URL", "")

    ENABLE_AI_BLUR = os.getenv("ENABLE_AI_BLUR", "false").lower() == "true"
    ENABLE_WHISPER = os.getenv("ENABLE_WHISPER", "false").lower() == "true"
    YOLO_MODEL = os.getenv("YOLO_MODEL", "yolov8n.pt")

    # Routing engine for turn-by-turn instructions (self-hosted Valhalla / GraphHopper).
    # When unset, the worker falls back to a geometry-based instruction generator.
    VALHALLA_URL = os.getenv("VALHALLA_URL", "")

    # Phase 24 — shared secret for the internal conformance API. The worker has no
    # user session, so this is how it authenticates to `/internal/*`.
    WORKER_SHARED_SECRET = os.getenv("WORKER_SHARED_SECRET", "")

    # Timezone dashcam filenames are interpreted in. Camera filenames carry local time
    # with no zone marker, so this has to be declared somewhere; the UK is the market.
    # A camera actually set to another zone shows up as a whole-hour discrepancy in
    # reconciliation and is corrected there.
    DASHCAM_LOCAL_TZ = os.getenv("DASHCAM_LOCAL_TZ", "Europe/London")

    MEDIA_JOBS_KEY = "media:jobs"


config = Config()
