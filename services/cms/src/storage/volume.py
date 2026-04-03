"""
Media storage module — Railway persistent volume.

Stores media files on the Railway volume at CMS_STORAGE_ROOT (default: /data/cms).
All files are organized by type and date for easy management.

Directory structure:
  /data/cms/
    media/
      images/           ← featured images, inline images
        {YYYY-MM}/
          {uuid}.{ext}
      documents/         ← PDFs, attachments
        {YYYY-MM}/
          {uuid}.{ext}
    exports/             ← generated exports, reports
    temp/                ← temporary upload staging
"""
import os
import uuid
import shutil
import logging
from datetime import datetime
from pathlib import Path

logger = logging.getLogger('cms.storage')

STORAGE_ROOT = Path(os.getenv('CMS_STORAGE_ROOT', '/data/cms'))

ALLOWED_IMAGE_TYPES = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
}

ALLOWED_DOCUMENT_TYPES = {
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'text/plain': '.txt',
    'text/markdown': '.md',
}

MAX_IMAGE_SIZE = 10 * 1024 * 1024    # 10MB
MAX_DOCUMENT_SIZE = 50 * 1024 * 1024  # 50MB


def ensure_dirs() -> None:
    """Create storage directories if they don't exist."""
    for subdir in ['media/images', 'media/documents', 'exports', 'temp']:
        (STORAGE_ROOT / subdir).mkdir(parents=True, exist_ok=True)
    logger.info(f'Storage directories ensured at {STORAGE_ROOT}')


def _month_partition() -> str:
    """Get current YYYY-MM partition string."""
    return datetime.utcnow().strftime('%Y-%m')


async def store_image(content: bytes, content_type: str, original_filename: str | None = None) -> dict:
    """
    Store an image file. Returns metadata dict with path and URL info.

    Raises ValueError for invalid content type or size.
    """
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise ValueError(f'Unsupported image type: {content_type}. Allowed: {", ".join(ALLOWED_IMAGE_TYPES.keys())}')
    if len(content) > MAX_IMAGE_SIZE:
        raise ValueError(f'Image too large: {len(content)} bytes. Max: {MAX_IMAGE_SIZE} bytes')

    ext = ALLOWED_IMAGE_TYPES[content_type]
    file_id = str(uuid.uuid4())
    partition = _month_partition()
    rel_path = f'media/images/{partition}/{file_id}{ext}'
    abs_path = STORAGE_ROOT / rel_path

    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_bytes(content)

    logger.info(f'Stored image: {rel_path} ({len(content)} bytes)')

    return {
        'id': file_id,
        'path': rel_path,
        'abs_path': str(abs_path),
        'content_type': content_type,
        'size': len(content),
        'original_filename': original_filename,
    }


async def store_document(content: bytes, content_type: str, original_filename: str | None = None) -> dict:
    """Store a document file. Returns metadata dict."""
    if content_type not in ALLOWED_DOCUMENT_TYPES:
        raise ValueError(f'Unsupported document type: {content_type}. Allowed: {", ".join(ALLOWED_DOCUMENT_TYPES.keys())}')
    if len(content) > MAX_DOCUMENT_SIZE:
        raise ValueError(f'Document too large: {len(content)} bytes. Max: {MAX_DOCUMENT_SIZE} bytes')

    ext = ALLOWED_DOCUMENT_TYPES[content_type]
    file_id = str(uuid.uuid4())
    partition = _month_partition()
    rel_path = f'media/documents/{partition}/{file_id}{ext}'
    abs_path = STORAGE_ROOT / rel_path

    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_bytes(content)

    logger.info(f'Stored document: {rel_path} ({len(content)} bytes)')

    return {
        'id': file_id,
        'path': rel_path,
        'abs_path': str(abs_path),
        'content_type': content_type,
        'size': len(content),
        'original_filename': original_filename,
    }


async def delete_file(rel_path: str) -> bool:
    """Delete a file by relative path. Returns True if deleted."""
    abs_path = STORAGE_ROOT / rel_path
    if abs_path.exists():
        abs_path.unlink()
        logger.info(f'Deleted file: {rel_path}')
        return True
    logger.warning(f'File not found for deletion: {rel_path}')
    return False


def get_abs_path(rel_path: str) -> Path:
    """Resolve a relative storage path to absolute. Validates it's within STORAGE_ROOT."""
    abs_path = (STORAGE_ROOT / rel_path).resolve()
    if not str(abs_path).startswith(str(STORAGE_ROOT.resolve())):
        raise ValueError('Path traversal attempt detected')
    return abs_path


def get_storage_stats() -> dict:
    """Get storage usage statistics."""
    total_size = 0
    file_count = 0
    for path in STORAGE_ROOT.rglob('*'):
        if path.is_file():
            total_size += path.stat().st_size
            file_count += 1
    return {
        'root': str(STORAGE_ROOT),
        'total_files': file_count,
        'total_size_bytes': total_size,
        'total_size_mb': round(total_size / (1024 * 1024), 2),
    }
