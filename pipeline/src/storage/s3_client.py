"""Shared S3 client for the pipeline workers.

boto3 auto-reads AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
AWS_DEFAULT_REGION, and AWS_ENDPOINT_URL from the environment — no
explicit configuration code is needed here beyond reading the bucket
name.

Application code should go through the higher-level helpers in this
module (put_object, get_object, ping_s3) rather than constructing
boto3 commands directly, so tenant-isolation and error-logging
conventions stay in one place.

See docs/DECISIONS.md D002 and docs/STORAGE_LAYOUT.md.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

logger = logging.getLogger(__name__)

BUCKET = os.environ.get("AWS_S3_BUCKET_NAME", "rfp-pipeline-local")

_s3_client: Optional[Any] = None


def get_s3_client() -> Any:
    """Lazy boto3 S3 client singleton.

    boto3 is imported lazily so that modules importing from
    ``src.storage`` can still be collected by pytest even when boto3
    is not installed in the test environment.
    """
    global _s3_client
    if _s3_client is None:
        import boto3  # type: ignore[import-not-found]

        _s3_client = boto3.client("s3")
    return _s3_client


def put_object(
    *,
    key: str,
    body: bytes,
    content_type: Optional[str] = None,
    cache_control: Optional[str] = None,
    metadata: Optional[dict[str, str]] = None,
) -> None:
    extra: dict[str, Any] = {}
    if content_type is not None:
        extra["ContentType"] = content_type
    if cache_control is not None:
        extra["CacheControl"] = cache_control
    if metadata is not None:
        extra["Metadata"] = metadata
    try:
        get_s3_client().put_object(Bucket=BUCKET, Key=key, Body=body, **extra)
    except Exception as e:
        logger.error("[s3.put_object] failed key=%s err=%s", key, e)
        raise RuntimeError("storage put failed") from e


def get_object_bytes(key: str) -> Optional[bytes]:
    try:
        res = get_s3_client().get_object(Bucket=BUCKET, Key=key)
    except Exception as e:
        name = getattr(e, "__class__", type(e)).__name__
        # boto3 raises ClientError with error codes; NoSuchKey is 404
        err = getattr(e, "response", {}).get("Error", {}) if hasattr(e, "response") else {}
        code = err.get("Code") if isinstance(err, dict) else None
        if name == "NoSuchKey" or code in ("NoSuchKey", "404", "NotFound"):
            return None
        logger.error("[s3.get_object_bytes] failed key=%s err=%s", key, e)
        raise RuntimeError("storage get failed") from e
    body = res.get("Body")
    if body is None:
        return None
    return body.read()


def object_exists(key: str) -> bool:
    try:
        get_s3_client().head_object(Bucket=BUCKET, Key=key)
        return True
    except Exception as e:
        err = getattr(e, "response", {}).get("Error", {}) if hasattr(e, "response") else {}
        code = err.get("Code") if isinstance(err, dict) else None
        if code in ("NoSuchKey", "404", "NotFound"):
            return False
        logger.error("[s3.object_exists] failed key=%s err=%s", key, e)
        raise RuntimeError("storage head failed") from e


def delete_object(key: str) -> None:
    try:
        get_s3_client().delete_object(Bucket=BUCKET, Key=key)
    except Exception as e:
        logger.error("[s3.delete_object] failed key=%s err=%s", key, e)
        raise RuntimeError("storage delete failed") from e


def ping_s3() -> dict[str, Any]:
    """Health check — verifies the bucket is reachable via HeadBucket."""
    try:
        get_s3_client().head_bucket(Bucket=BUCKET)
        return {"ok": True, "bucket": BUCKET}
    except Exception as e:
        return {"ok": False, "error": str(e)}
