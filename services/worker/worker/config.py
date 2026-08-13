"""Worker configuration loaded from environment."""
import os
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

from dotenv import load_dotenv

load_dotenv()

# Query parameters Prisma understands but libpq does not. The API and the worker are
# meant to share one DATABASE_URL — the docs say to copy it straight across from the
# hosting dashboard — but Prisma's connection string carries options libpq has never
# heard of, and libpq rejects an unknown parameter outright rather than ignoring it.
# `?schema=public` is the common one and it fails with "invalid URI query parameter",
# which reads like a malformed URL rather than a dialect mismatch.
#
# Dropping `schema` is safe here: the worker's queries are unqualified and resolve
# through the default search_path, which is `public` anyway.
_PRISMA_ONLY_PARAMS = {"schema", "pgbouncer", "connection_limit", "pool_timeout"}

# libpq accepts only: disable, allow, prefer, require, verify-ca, verify-full. Other
# ecosystems spell the "encrypt, but don't check the certificate" mode differently, and
# those spellings travel in connection strings copied between tools. libpq rejects an
# unknown value outright, so translate rather than pass through.
#
# `require` is the honest equivalent: TLS is mandatory, the certificate is not verified.
# It is what these aliases already mean elsewhere, so this changes no security property.
_SSLMODE_ALIASES = {
    "no-verify": "require",
    "no_verify": "require",
    "required": "require",
    "verify_ca": "verify-ca",
    "verify_full": "verify-full",
}


def _libpq_safe(url: str) -> str:
    """Make a connection string psycopg can use, given one written for another tool.

    The API and the worker share a single DATABASE_URL by design, but the API is Prisma
    (its own URL dialect) and the worker is psycopg (raw libpq). The mismatches surface
    as errors that read like a broken URL — "invalid URI query parameter", "invalid
    sslmode value" — rather than as a dialect problem, so they are worth absorbing here
    instead of asking every operator to keep two nearly-identical URLs in step.
    """
    if not url:
        return url
    parts = urlsplit(url)
    if not parts.query:
        return url
    kept = []
    for k, v in parse_qsl(parts.query, keep_blank_values=True):
        if k in _PRISMA_ONLY_PARAMS:
            continue
        if k == "sslmode":
            v = _SSLMODE_ALIASES.get(v.strip().lower(), v)
        kept.append((k, v))
    return urlunsplit(parts._replace(query=urlencode(kept)))


# R2 buckets created with a data-residency jurisdiction live on their own hostname, and
# they are invisible from the standard one — ListBuckets comes back empty and every
# bucket 404s, exactly as if the account were empty. Since the credentials are still
# accepted, the failure looks like a wrong bucket name or the wrong account rather than
# a wrong endpoint, which is a long way to travel for a missing infix.
_R2_JURISDICTION_INFIX = {"": "", "default": "", "eu": ".eu", "fedramp": ".fedramp"}


def _r2_endpoint(account_id: str, jurisdiction: str) -> str:
    infix = _R2_JURISDICTION_INFIX.get(jurisdiction.strip().lower())
    if infix is None:
        raise ValueError(
            f"R2_JURISDICTION={jurisdiction!r} is not one of "
            f"{sorted(k for k in _R2_JURISDICTION_INFIX if k)}"
        )
    return f"https://{account_id}{infix}.r2.cloudflarestorage.com"


class Config:
    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
    DATABASE_URL = _libpq_safe(os.getenv("DATABASE_URL", ""))
    API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:3000")

    # Object storage. Cloudflare R2 is S3-compatible, so the same boto3 client serves
    # both R2 and MinIO (local dev). `R2_*` is the preferred spelling and falls back to
    # the `S3_*` names this project has always used, so existing deployments and
    # docker-compose keep working unchanged.
    #
    # R2_* wins when both are set, matching the API (see applyR2Aliases). Hosting
    # blueprints ship placeholder S3_* values so a service can boot before storage is
    # configured; if those placeholders took precedence, adding real R2 credentials would
    # appear to work and change nothing — and the worker would end up writing to a
    # different bucket than the API reads from.
    S3_ENDPOINT = (
        _r2_endpoint(os.getenv("R2_ACCOUNT_ID", ""), os.getenv("R2_JURISDICTION", ""))
        if os.getenv("R2_ACCOUNT_ID")
        else os.getenv("S3_ENDPOINT") or "http://localhost:9000"
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

    # How long each blocking pop waits before the loop goes round again.
    #
    # This is a *billing* setting, not a latency one. BRPOP blocks on the Redis server, so
    # a job pushed mid-wait is delivered the instant it arrives — the timeout only decides
    # how long an *empty* wait lasts, and that entire wait costs one command. Hosted Redis
    # is priced per command, so a short timeout means the worker pays to ask "anything
    # yet?" over and over while nothing is happening: at 5s that is ~518,000 commands a
    # month completely idle, enough to exhaust a typical free allowance before a single
    # upload. At 30s it is ~86,000, with no meaningful change to how fast jobs start.
    #
    # Raising it further has diminishing returns and slows down noticing a dropped
    # connection, since that is only detected when the call returns.
    MEDIA_POLL_TIMEOUT_S = int(os.getenv("MEDIA_POLL_TIMEOUT_S", "30"))


config = Config()
