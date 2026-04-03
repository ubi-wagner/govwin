"""
Media upload, listing, and serving endpoints.

Files are stored on the Railway persistent volume.
Metadata is indexed in cms_media for association with posts.
"""
import logging
import uuid

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import FileResponse

from ..models.database import get_pool
from ..models.events import emit_event
from ..models.schemas import MediaOut, MediaUpdate
from ..storage.volume import (
    store_image, store_document, delete_file, get_abs_path,
    get_storage_stats, ensure_dirs, ALLOWED_IMAGE_TYPES, ALLOWED_DOCUMENT_TYPES,
)

logger = logging.getLogger('cms.media')
router = APIRouter()


@router.on_event('startup')
async def startup():
    ensure_dirs()


@router.post('/upload', status_code=201)
async def upload_media(
    file: UploadFile = File(...),
    post_id: str | None = Form(None),
    usage: str = Form('attachment'),
    alt_text: str | None = Form(None),
    caption: str | None = Form(None),
    uploaded_by: str | None = Form(None),
):
    """
    Upload a media file (image or document).

    Associates with a post if post_id is provided.
    Returns the media metadata including storage path.
    """
    if not file.content_type:
        raise HTTPException(400, 'Content-Type header is required')

    content = await file.read()
    if not content:
        raise HTTPException(400, 'Empty file')

    try:
        # Determine type and store
        if file.content_type in ALLOWED_IMAGE_TYPES:
            result = await store_image(content, file.content_type, file.filename)
        elif file.content_type in ALLOWED_DOCUMENT_TYPES:
            result = await store_document(content, file.content_type, file.filename)
        else:
            raise HTTPException(
                400,
                f'Unsupported file type: {file.content_type}. '
                f'Allowed images: {", ".join(ALLOWED_IMAGE_TYPES.keys())}. '
                f'Allowed documents: {", ".join(ALLOWED_DOCUMENT_TYPES.keys())}.'
            )
    except ValueError as e:
        raise HTTPException(400, str(e))

    # Record metadata in database
    pool = get_pool()
    try:
        row = await pool.fetchrow(
            """
            INSERT INTO cms_media (id, filename, storage_path, content_type, size_bytes, alt_text, caption, post_id, usage, uploaded_by)
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::uuid, $9, $10)
            RETURNING *
            """,
            uuid.UUID(result['id']),
            file.filename or 'unnamed',
            result['path'],
            file.content_type,
            result['size'],
            alt_text,
            caption,
            uuid.UUID(post_id) if post_id else None,
            usage,
            uploaded_by,
        )

        # If this is a featured image, update the post
        if usage == 'featured_image' and post_id:
            await pool.execute(
                'UPDATE cms_posts SET featured_image_id = $1::uuid, featured_image_url = $2, updated_at = NOW() WHERE id = $3::uuid',
                uuid.UUID(result['id']),
                f'/api/media/file/{result["path"]}',
                uuid.UUID(post_id),
            )

        await emit_event(
            'content_pipeline.media.uploaded',
            entity_type='media',
            entity_id=result['id'],
            user_id=uploaded_by,
            diff_summary=f'Media uploaded: {file.filename} ({file.content_type}, {result["size"]} bytes)',
            payload={'post_id': post_id, 'usage': usage, 'path': result['path']},
        )

        return {'data': dict(row)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[POST /upload] DB error: {e}')
        # Clean up stored file on DB failure
        await delete_file(result['path'])
        raise HTTPException(500, 'Failed to record media metadata')


@router.get('/list')
async def list_media(
    post_id: str | None = Query(None),
    usage: str | None = Query(None),
    content_type: str | None = Query(None),
    limit: int = Query(50, le=200),
):
    """List media files with optional filters."""
    pool = get_pool()
    try:
        conditions = []
        params = []
        idx = 1

        if post_id:
            conditions.append(f'post_id = ${idx}::uuid')
            params.append(post_id)
            idx += 1
        if usage:
            conditions.append(f'usage = ${idx}')
            params.append(usage)
            idx += 1
        if content_type:
            conditions.append(f'content_type LIKE ${idx}')
            params.append(f'{content_type}%')
            idx += 1

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ''
        params.append(limit)

        rows = await pool.fetch(
            f'SELECT * FROM cms_media {where} ORDER BY created_at DESC LIMIT ${idx}',
            *params,
        )
        return {'data': [dict(r) for r in rows]}
    except Exception as e:
        logger.error(f'[GET /list] Error: {e}')
        raise HTTPException(500, 'Failed to list media')


@router.get('/file/{path:path}')
async def serve_file(path: str):
    """Serve a media file by its storage path."""
    try:
        abs_path = get_abs_path(path)
        if not abs_path.exists():
            raise HTTPException(404, 'File not found')
        return FileResponse(
            abs_path,
            media_type=None,  # Let FastAPI auto-detect
            filename=abs_path.name,
        )
    except ValueError:
        raise HTTPException(400, 'Invalid path')
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[GET /file/{path}] Error: {e}')
        raise HTTPException(500, 'Failed to serve file')


@router.patch('/{media_id}')
async def update_media(media_id: str, body: MediaUpdate):
    """Update media metadata (alt text, caption, post association)."""
    pool = get_pool()
    try:
        updates = {}
        if body.alt_text is not None: updates['alt_text'] = body.alt_text
        if body.caption is not None: updates['caption'] = body.caption
        if body.post_id is not None: updates['post_id'] = body.post_id
        if body.usage is not None: updates['usage'] = body.usage

        if not updates:
            row = await pool.fetchrow('SELECT * FROM cms_media WHERE id = $1::uuid', uuid.UUID(media_id))
            if not row:
                raise HTTPException(404, 'Media not found')
            return {'data': dict(row)}

        set_parts = []
        params = [uuid.UUID(media_id)]
        idx = 2
        for col, val in updates.items():
            if col == 'post_id' and val:
                set_parts.append(f'{col} = ${idx}::uuid')
            else:
                set_parts.append(f'{col} = ${idx}')
            params.append(val)
            idx += 1

        row = await pool.fetchrow(
            f"UPDATE cms_media SET {', '.join(set_parts)} WHERE id = $1::uuid RETURNING *",
            *params,
        )
        if not row:
            raise HTTPException(404, 'Media not found')
        return {'data': dict(row)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[PATCH /{media_id}] Error: {e}')
        raise HTTPException(500, 'Failed to update media')


@router.delete('/{media_id}')
async def delete_media(media_id: str):
    """Delete a media file and its metadata."""
    pool = get_pool()
    try:
        row = await pool.fetchrow('SELECT * FROM cms_media WHERE id = $1::uuid', uuid.UUID(media_id))
        if not row:
            raise HTTPException(404, 'Media not found')

        # Delete from storage
        await delete_file(row['storage_path'])

        # Remove from database
        await pool.execute('DELETE FROM cms_media WHERE id = $1::uuid', uuid.UUID(media_id))

        # Clear featured_image_id if this was a featured image
        if row['post_id']:
            await pool.execute(
                'UPDATE cms_posts SET featured_image_id = NULL, featured_image_url = NULL WHERE featured_image_id = $1::uuid',
                uuid.UUID(media_id),
            )

        await emit_event(
            'content_pipeline.media.deleted',
            entity_type='media',
            entity_id=media_id,
            diff_summary=f'Media deleted: {row["filename"]}',
        )

        return {'message': 'Deleted'}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[DELETE /{media_id}] Error: {e}')
        raise HTTPException(500, 'Failed to delete media')


@router.get('/stats')
async def storage_stats():
    """Get storage usage statistics."""
    try:
        return {'data': get_storage_stats()}
    except Exception as e:
        logger.error(f'[GET /stats] Error: {e}')
        raise HTTPException(500, 'Failed to get storage stats')
