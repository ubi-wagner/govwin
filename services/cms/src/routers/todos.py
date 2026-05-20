"""
Admin TODOs management API routes.

CRUD for admin_todos. These live in the CMS Postgres database
(migrated from Main Postgres in CMS migration 006).
"""
import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ..models.database import get_pool
from ..models.events import emit_event

logger = logging.getLogger('cms.todos')
router = APIRouter()


def _fire_event(event_type: str, **kwargs):
    """Fire-and-forget event emission."""
    asyncio.create_task(emit_event(event_type, entity_type='todo', **kwargs))


def _get_cms_pool():
    """Get the CMS DB pool, raising 503 if unavailable."""
    try:
        return get_pool()
    except RuntimeError:
        raise HTTPException(503, 'CMS database not connected')


# ── Pydantic Models ────────────────────────────────────────────────

class TodoCreate(BaseModel):
    title: str
    description: str | None = None
    todo_type: str = 'general'
    priority: str = 'medium'
    assigned_to: str | None = None
    tenant_id: str | None = None
    related_entity_type: str | None = None
    related_entity_id: str | None = None
    due_at: datetime | None = None
    metadata: dict = {}
    created_by: str | None = None


class TodoUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None
    priority: str | None = None
    assigned_to: str | None = None
    due_at: datetime | None = None
    metadata: dict | None = None


# ── Routes ─────────────────────────────────────────────────────────

@router.get('')
async def list_todos(
    todo_type: str | None = Query(None),
    status: str | None = Query(None),
    priority: str | None = Query(None),
    assigned_to: str | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
):
    """List admin TODOs with optional filters."""
    pool = _get_cms_pool()
    try:
        conditions = []
        params = []
        idx = 1

        if todo_type:
            conditions.append(f'todo_type = ${idx}')
            params.append(todo_type)
            idx += 1
        if status:
            conditions.append(f'status = ${idx}')
            params.append(status)
            idx += 1
        if priority:
            conditions.append(f'priority = ${idx}')
            params.append(priority)
            idx += 1
        if assigned_to:
            conditions.append(f'assigned_to = ${idx}')
            params.append(uuid.UUID(assigned_to))
            idx += 1

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ''
        params.extend([limit, offset])

        rows = await pool.fetch(
            f'SELECT * FROM admin_todos {where} ORDER BY created_at DESC LIMIT ${idx} OFFSET ${idx + 1}',
            *params,
        )
        return {'data': [dict(r) for r in rows], 'count': len(rows)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[GET /todos] Error: {e}')
        raise HTTPException(500, 'Failed to fetch todos')


@router.post('', status_code=201)
async def create_todo(body: TodoCreate):
    """Create a new admin TODO."""
    pool = _get_cms_pool()
    try:
        valid_types = ('curation', 'support', 'content_review', 'campaign', 'general')
        if body.todo_type not in valid_types:
            raise HTTPException(400, f'Invalid todo_type. Must be one of: {", ".join(valid_types)}')

        valid_priorities = ('critical', 'high', 'medium', 'low')
        if body.priority not in valid_priorities:
            raise HTTPException(400, f'Invalid priority. Must be one of: {", ".join(valid_priorities)}')

        row = await pool.fetchrow(
            '''INSERT INTO admin_todos
                   (title, description, todo_type, priority, assigned_to,
                    tenant_id, related_entity_type, related_entity_id,
                    due_at, metadata, created_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
               RETURNING *''',
            body.title,
            body.description,
            body.todo_type,
            body.priority,
            uuid.UUID(body.assigned_to) if body.assigned_to else None,
            uuid.UUID(body.tenant_id) if body.tenant_id else None,
            body.related_entity_type,
            uuid.UUID(body.related_entity_id) if body.related_entity_id else None,
            body.due_at,
            json.dumps(body.metadata),
            uuid.UUID(body.created_by) if body.created_by else None,
        )

        _fire_event(
            'todo.created',
            entity_id=str(row['id']),
            diff_summary=f'TODO created: {body.title}',
            payload={'todo_type': body.todo_type, 'priority': body.priority},
        )

        return {'data': dict(row)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[POST /todos] Error: {e}')
        raise HTTPException(500, 'Failed to create todo')


@router.patch('/{todo_id}')
async def update_todo(todo_id: str, body: TodoUpdate):
    """Update a TODO (status, assignment, priority, etc.)."""
    pool = _get_cms_pool()
    try:
        existing = await pool.fetchrow(
            'SELECT id, status FROM admin_todos WHERE id = $1',
            uuid.UUID(todo_id),
        )
        if not existing:
            raise HTTPException(404, 'TODO not found')

        updates = []
        params = []
        idx = 1

        for field, value in body.model_dump(exclude_none=True).items():
            if field == 'metadata':
                updates.append(f'metadata = ${idx}::jsonb')
                params.append(json.dumps(value))
            elif field == 'assigned_to':
                updates.append(f'assigned_to = ${idx}')
                params.append(uuid.UUID(value))
            elif field == 'due_at':
                updates.append(f'due_at = ${idx}')
                params.append(value)
            else:
                updates.append(f'{field} = ${idx}')
                params.append(value)
            idx += 1

        if not updates:
            raise HTTPException(400, 'No fields to update')

        # Auto-set completed_at when status changes to done
        if body.status == 'done':
            updates.append(f'completed_at = ${idx}')
            params.append(datetime.now(timezone.utc))
            idx += 1

        updates.append(f'updated_at = ${idx}')
        params.append(datetime.now(timezone.utc))
        idx += 1

        params.append(uuid.UUID(todo_id))
        row = await pool.fetchrow(
            f"UPDATE admin_todos SET {', '.join(updates)} WHERE id = ${idx} RETURNING *",
            *params,
        )

        _fire_event(
            'todo.updated',
            entity_id=todo_id,
            diff_summary=f'TODO updated: {row["title"]}',
            payload={'status': row['status'], 'priority': row['priority']},
        )

        return {'data': dict(row)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[PATCH /todos/{{id}}] Error: {e}')
        raise HTTPException(500, 'Failed to update todo')
