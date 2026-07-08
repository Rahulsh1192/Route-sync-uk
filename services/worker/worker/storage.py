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
    config=BotoConfig(s3={"addressing_style": "path"}),  # MinIO needs path style
)


def download(key: str, dest_path: str):
    _s3.download_file(config.S3_BUCKET, key, dest_path)


def upload(src_path: str, key: str, content_type: str = "application/octet-stream"):
    _s3.upload_file(src_path, config.S3_BUCKET, key, ExtraArgs={"ContentType": content_type})
    return key
