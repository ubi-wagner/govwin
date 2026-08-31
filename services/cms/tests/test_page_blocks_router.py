"""Tests for the page-blocks router (Phase 2: cms_posts staging + cms_content bridge).

These lock the core guarantees of the rework:
  - the editor reads/writes cms_posts (CMS DB), never the live cms_content rows;
  - publish/approve bridge blocks into cms_content (Main DB) as the public copy,
    stripping editing bookkeeping from the published metadata;
  - delete removes the block from both stores.
"""
import datetime as dt
import json
import uuid

import pytest
from unittest.mock import patch, AsyncMock
from httpx import AsyncClient, ASGITransport

API_KEY = {'x-cms-api-key': 'test-api-key-for-pytest'}


@pytest.fixture
def mock_db():
    """Patch DB init + background workers so importing the app doesn't connect."""
    with patch('src.models.database.init_db', new_callable=AsyncMock), \
         patch('src.models.database.close_db', new_callable=AsyncMock), \
         patch('src.models.database.init_event_bridge', new_callable=AsyncMock), \
         patch('src.models.database.close_event_bridge', new_callable=AsyncMock), \
         patch('src.event_listener.start_event_listener', new_callable=AsyncMock), \
         patch('src.event_listener.stop_event_listener', new_callable=AsyncMock), \
         patch('src.workers.content_generator.generation_loop', new_callable=AsyncMock), \
         patch('src.workers.email_queue.queue_loop', new_callable=AsyncMock), \
         patch('src.workers.email_sweep.sweep_loop', new_callable=AsyncMock), \
         patch('src.workers.campaign_executor.executor_loop', new_callable=AsyncMock), \
         patch('src.workers.drip_engine.drip_loop', new_callable=AsyncMock), \
         patch('src.workers.social_poster.social_loop', new_callable=AsyncMock):
        yield


def _post_row(slug, tags, *, metadata=None, status='draft', display_order=0):
    return {
        'slug': slug, 'title': slug.title(), 'body': 'Body', 'excerpt': None,
        'tags': tags, 'metadata': metadata or {}, 'display_order': display_order,
        'author_name': None, 'featured_image_url': None, 'published_at': None,
    }


# ── Pure logic ────────────────────────────────────────────────────────────────

def test_row_to_block_shape():
    from src.routers import page_blocks
    now = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
    row = {
        'id': '00000000-0000-0000-0000-000000000001',
        'slug': 'homepage-hero', 'title': 'Hero', 'category': 'page_block',
        'body': 'Body', 'excerpt': 'Ex', 'author_name': 'jane',
        'tags': ['homepage', 'hero'], 'status': 'published', 'published_at': now,
        'featured_image_url': None, 'display_order': 2,
        'metadata': {'cta_text': 'Apply'}, 'created_at': now, 'updated_at': now,
    }
    block = page_blocks._row_to_block(row)
    assert block['contentType'] == 'page_block'
    assert block['published'] is True
    assert block['status'] == 'published'
    assert block['displayOrder'] == 2
    assert block['author'] == 'jane'
    assert block['metadata']['cta_text'] == 'Apply'


@pytest.mark.asyncio
async def test_bridge_publish_refuses_and_writes_nothing(mock_cms_pool, mock_shared_pool):
    """The bridge is retired: it must REFUSE, and must not touch either store.

    This test used to assert the opposite — that _bridge_publish flipped cms_posts to published and
    upserted each row into Main-DB cms_content. That behaviour was correct until front-facing
    content moved to `content_pages`; after the move it wrote to a table the website no longer
    reads, so a publish reported a count and changed nothing a visitor could see.

    Asserting BOTH pools are untouched is the point. A refusal that had already flipped cms_posts
    would leave the two stores disagreeing about what is published — the half-write is the state
    nobody can reason about later.
    """
    from fastapi import HTTPException
    from src.routers import page_blocks
    mock_cms_pool.fetch = AsyncMock(return_value=[_post_row('homepage-hero', ['homepage', 'hero'])])

    with pytest.raises(HTTPException) as exc:
        await page_blocks._bridge_publish(mock_cms_pool, mock_shared_pool, page='homepage')

    assert exc.value.status_code == 410
    # The refusal says where content IS authored — an error that only says "no" sends the reader
    # looking through a service that is no longer the answer.
    assert '/admin/site' in exc.value.detail and 'content_pages' in exc.value.detail
    assert mock_cms_pool.fetch.await_count == 0
    assert mock_shared_pool.execute.await_count == 0


# ── HTTP endpoints ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_reads_cms_posts(mock_db):
    cms_pool = AsyncMock()
    cms_pool.fetch = AsyncMock(return_value=[])
    with patch('src.routers.page_blocks.get_pool', return_value=cms_pool):
        from src.main import app
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test', headers=API_KEY) as client:
            resp = await client.get('/api/page-blocks/?page=homepage')
            assert resp.status_code == 200
            assert 'FROM cms_posts' in cms_pool.fetch.await_args.args[0]


@pytest.mark.asyncio
async def test_publish_endpoint_refuses_rather_than_silently_doing_nothing(mock_db):
    """POST /publish answers 410 and writes nothing to the main database.

    The endpoint could have been left returning 200 with published=0. It must not: an operator who
    presses Publish and is told it succeeded has no way to discover their edit is not on the site.
    """
    cms_pool = AsyncMock()
    cms_pool.fetch = AsyncMock(return_value=[_post_row('homepage-hero', ['homepage', 'hero'])])
    shared_pool = AsyncMock()
    with patch('src.routers.page_blocks.get_pool', return_value=cms_pool), \
         patch('src.routers.page_blocks.get_event_pool', return_value=shared_pool):
        from src.main import app
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test', headers=API_KEY) as client:
            resp = await client.post('/api/page-blocks/publish', json={'page': 'homepage'})
            assert resp.status_code == 410
            assert not any('cms_content' in str(c.args[0]) for c in shared_pool.execute.await_args_list)


@pytest.mark.asyncio
@pytest.mark.asyncio
async def test_delete_removes_from_cms_posts_only(mock_db):
    """Deleting a block removes it from the CMS store and does NOT touch the main database.

    It used to clean up the published copy in Main-DB cms_content. With publishing retired there is
    no published copy to clean up, and doing it anyway would leave this service as the last writer
    to a store it no longer authors.
    """
    cms_pool = AsyncMock()
    cms_pool.fetchrow = AsyncMock(return_value={'slug': 'homepage-hero'})
    shared_pool = AsyncMock()
    with patch('src.routers.page_blocks.get_pool', return_value=cms_pool), \
         patch('src.routers.page_blocks.get_event_pool', return_value=shared_pool):
        from src.main import app
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test', headers=API_KEY) as client:
            resp = await client.delete(f'/api/page-blocks/{uuid.uuid4()}')
            assert resp.status_code == 200
            assert 'DELETE FROM cms_posts' in cms_pool.fetchrow.await_args.args[0]
            assert not any('cms_content' in str(c.args[0]) for c in shared_pool.execute.await_args_list)
