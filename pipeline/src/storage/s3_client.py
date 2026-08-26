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
import shutil
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Railway's R2/bucket service injects the bucket name as AWS_S3_BUCKET; older config used
# AWS_S3_BUCKET_NAME. Read AWS_S3_BUCKET first, fall back to the legacy name.
BUCKET = os.environ.get("AWS_S3_BUCKET") or os.environ.get("AWS_S3_BUCKET_NAME", "rfp-pipeline-local")

_s3_client: Optional[Any] = None

# ── Local filesystem driver (dev / sandbox) ─────────────────────────────────
#
# The FRONTEND has had one of these since STORAGE-LOCAL (lib/storage/s3-client.ts): with
# STORAGE_DRIVER=local the same helpers read and write under LOCAL_STORAGE_DIR instead of talking
# to R2. The pipeline never got the counterpart, so every storage call here needed boto3 — which is
# not installed in this sandbox. The failure was quiet rather than loud: the shredder catches the
# exception and logs "S3 fetch failed … skipping", so a document simply never gets extracted and
# the run reports success having done less.
#
# Same two variables, same layout (<dir>/<bucket>/<key>), so the two services agree about where a
# key lives and a file written by one is readable by the other. Production is untouched: without
# STORAGE_DRIVER=local every function takes the boto3 path exactly as before.
LOCAL = os.environ.get("STORAGE_DRIVER") == "local"
LOCAL_DIR = os.environ.get("LOCAL_STORAGE_DIR", "/tmp/govwin-storage")


def _local_path(key: str) -> Path:
    """Resolve a key to its on-disk path, refusing anything that escapes the bucket root.

    Containment is checked with is_relative_to, NOT a string prefix: with a bucket named
    `testbucket`, the key `../testbucket-evil/x` resolves outside the root yet still starts with
    it, so a prefix test would wave through the one thing this guard exists to stop.
    """
    root = (Path(LOCAL_DIR) / BUCKET).resolve()
    target = (root / key).resolve()
    if not target.is_relative_to(root):
        raise RuntimeError(f"storage key escapes the bucket root: {key}")
    return target


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
    if LOCAL:
        # Resolved OUTSIDE the try: a refused key is a caller error with a specific message, and
        # collapsing it into the generic "storage put failed" would hide which of the two it was.
        path = _local_path(key)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(body)
            return
        except Exception as e:
            logger.error("[storage.put_object] local write failed key=%s err=%s", key, e)
            raise RuntimeError("storage put failed") from e
    try:
        get_s3_client().put_object(Bucket=BUCKET, Key=key, Body=body, **extra)
    except Exception as e:
        logger.error("[s3.put_object] failed key=%s err=%s", key, e)
        raise RuntimeError("storage put failed") from e


def get_object_bytes(key: str) -> Optional[bytes]:
    if LOCAL:
        path = _local_path(key)
        # A missing key is None on both drivers — the callers branch on that, not on an exception.
        return path.read_bytes() if path.is_file() else None
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
    if LOCAL:
        return _local_path(key).is_file()
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
    if LOCAL:
        # Deleting an absent key is a no-op on S3; keep that contract.
        _local_path(key).unlink(missing_ok=True)
        return
    try:
        get_s3_client().delete_object(Bucket=BUCKET, Key=key)
    except Exception as e:
        logger.error("[s3.delete_object] failed key=%s err=%s", key, e)
        raise RuntimeError("storage delete failed") from e


def ping_s3() -> dict[str, Any]:
    """Health check — verifies the bucket is reachable via HeadBucket."""
    if LOCAL:
        root = Path(LOCAL_DIR) / BUCKET
        try:
            root.mkdir(parents=True, exist_ok=True)
            return {"ok": True, "bucket": BUCKET, "driver": "local", "dir": str(root)}
        except Exception as e:
            return {"ok": False, "driver": "local", "error": str(e)}
    try:
        get_s3_client().head_bucket(Bucket=BUCKET)
        return {"ok": True, "bucket": BUCKET}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── Convenience helpers (text, JSON, copy) ──────────────────────────


def put_text(*, key: str, text: str, metadata: Optional[dict[str, str]] = None) -> None:
    """Write a UTF-8 text file (markdown, extracted text, etc.)."""
    put_object(
        key=key,
        body=text.encode("utf-8"),
        content_type="text/markdown; charset=utf-8",
        metadata=metadata,
    )


def put_json(*, key: str, obj: Any, metadata: Optional[dict[str, str]] = None) -> None:
    """Write a JSON file (metadata, compliance snapshot, etc.)."""
    import json as _json

    put_object(
        key=key,
        body=_json.dumps(obj, indent=2, default=str).encode("utf-8"),
        content_type="application/json; charset=utf-8",
        metadata=metadata,
    )


def copy_object(*, source_key: str, dest_key: str) -> None:
    """Server-side copy within the same bucket (no download/upload)."""
    if LOCAL:
        src, dst = _local_path(source_key), _local_path(dest_key)  # refusals surface as themselves
        try:
            if not src.is_file():
                raise FileNotFoundError(source_key)
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, dst)
            return
        except Exception as e:
            logger.error("[storage.copy_object] local copy failed src=%s dst=%s err=%s",
                         source_key, dest_key, e)
            raise RuntimeError("storage copy failed") from e
    try:
        get_s3_client().copy_object(
            Bucket=BUCKET,
            CopySource={"Bucket": BUCKET, "Key": source_key},
            Key=dest_key,
        )
    except Exception as e:
        logger.error(
            "[s3.copy_object] failed src=%s dst=%s err=%s",
            source_key, dest_key, e,
        )
        raise RuntimeError("storage copy failed") from e


def list_keys(*, prefix: str, max_keys: int = 1000) -> list[str]:
    """List object keys under a prefix (for copy-all operations)."""
    if LOCAL:
        root = (Path(LOCAL_DIR) / BUCKET).resolve()
        if not root.is_dir():
            return []
        # Keys are POSIX-style and relative to the bucket root, matching what S3 returns.
        keys = sorted(
            str(p.relative_to(root)).replace(os.sep, "/")
            for p in root.rglob("*") if p.is_file()
        )
        return [k for k in keys if k.startswith(prefix)][:max_keys]
    try:
        resp = get_s3_client().list_objects_v2(
            Bucket=BUCKET, Prefix=prefix, MaxKeys=max_keys,
        )
        return [obj["Key"] for obj in resp.get("Contents", [])]
    except Exception as e:
        logger.error("[s3.list_keys] failed prefix=%s err=%s", prefix, e)
        raise RuntimeError("storage list failed") from e
