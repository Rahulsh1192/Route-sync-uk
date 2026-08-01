"""S3/R2/MinIO object storage helpers."""
import boto3
from botocore.config import Config as BotoConfig
from .config import config

_s3 = boto3.client(
    "s3",
    endpoint_url=config.S3_ENDPOINT,
    region_name=config.S3_REGION,
    aws_access_key_id=config.S3_ACCESS_KEY,
    aws_secret_access_key=config.S3_SECRET_KEY,
    # Path style: required by MinIO, and accepted by R2 (it is the form Cloudflare's own
    # S3-API examples use). One setting that works against both keeps dev and production
    # on the same request shape.
    config=BotoConfig(s3={"addressing_style": "path"}),
)


def download(key: str, dest_path: str):
    _s3.download_file(config.S3_BUCKET, key, dest_path)


def upload(src_path: str, key: str, content_type: str = "application/octet-stream"):
    _s3.upload_file(src_path, config.S3_BUCKET, key, ExtraArgs={"ContentType": content_type})
    return key


def head(key: str) -> dict | None:
    """
    Object metadata, or None when it doesn't exist.

    Used to verify an upload actually landed and to read back the `sha256` the client
    bound into the object's metadata at upload time.
    """
    try:
        res = _s3.head_object(Bucket=config.S3_BUCKET, Key=key)
    except Exception:  # noqa: BLE001 — 404/403 both mean "not usable"
        return None
    return {
        "key": key,
        "size": int(res.get("ContentLength", 0)),
        "content_type": res.get("ContentType"),
        "etag": (res.get("ETag") or "").strip('"'),
        "last_modified": res.get("LastModified"),
        "sha256": (res.get("Metadata") or {}).get("sha256"),
    }


def delete(key: str) -> None:
    """
    Delete one object.

    Videos are permanent by product rule, so the worker only uses this for its own
    intermediate artifacts — never for a published route's media.
    """
    _s3.delete_object(Bucket=config.S3_BUCKET, Key=key)


def copy(src_key: str, dest_key: str) -> str:
    """
    Server-side copy inside the bucket.

    Deduplication reuses the existing object rather than copying it, so this is only for
    the case where an object must exist under a second key (e.g. re-pointing a route at
    an already-stored master). Server-side means the bytes never travel through the
    worker, which matters at multi-GB sizes.
    """
    _s3.copy_object(
        Bucket=config.S3_BUCKET,
        CopySource={"Bucket": config.S3_BUCKET, "Key": src_key},
        Key=dest_key,
    )
    return dest_key


def public_url(key: str) -> str | None:
    """
    CDN URL for an object, when a public origin is configured.

    Mirrors the API's rule: unset means everything is served through signed URLs, which
    is the default because route footage is paid content.
    """
    base = (config.R2_PUBLIC_URL or "").rstrip("/")
    return f"{base}/{key.lstrip('/')}" if base else None


def presign_get(key: str, expires_s: int = 3600) -> str:
    """
    Short-lived read URL for an object.

    Phase 24: lets ffprobe read a clip's header over HTTP instead of downloading the
    whole file. Dashcam clips run to hundreds of megabytes and the review stage only
    needs duration and creation time from the first few kilobytes, so this turns a
    multi-gigabyte download into a handful of range requests.
    """
    return _s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": config.S3_BUCKET, "Key": key},
        ExpiresIn=expires_s,
    )
