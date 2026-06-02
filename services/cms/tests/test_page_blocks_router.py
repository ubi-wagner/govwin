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
async def test_bridge_publish_moves_cms_posts_to_cms_content(mock_cms_pool, mock_shared_pool):
    from src.routers import page_blocks
    rows = [
        _post_row('homepage-hero', ['homepage', 'hero'],
                  metadata={'cta_text': 'Apply', '_versions': [1, 2], '_currentVersion': 3, '_draftedBy': 'x'}),
        _post_row('homepage-stats', ['homepage', 'stats'], metadata={'value': '99'}, display_order=1),
    ]
    mock_cms_pool.fetch = AsyncMock(return_value=rows)

    count = await page_blocks._bridge_publish(mock_cms_pool, mock_shared_pool, page='homepage')

    assert count == 2
    # 1) cms_posts flipped to published on the CMS pool
    assert mock_cms_pool.fetch.await_count == 1
    cms_sql = mock_cms_pool.fetch.await_args.args[0]
    assert 'UPDATE cms_posts' in cms_sql and "status = 'published'" in cms_sql
    # 2) one cms_content upsert per row on the shared pool
    assert mock_shared_pool.execute.await_count == 2
    upsert_sql = mock_shared_pool.execute.await_args_list[0].args[0]
    assert 'INSERT INTO cms_content' in upsert_sql
    # 3) editing bookkeeping stripped from the public metadata copy ($9 -> args[9])
    published_meta = json.loads(mock_shared_pool.execute.await_args_list[0].args[9])
    assert published_meta == {'cta_text': 'Apply'}
    assert '_versions' not in published_meta and '_currentVersion' not in published_meta


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
async def test_publish_bridges_to_cms_content(mock_db):
    cms_pool = AsyncMock()
    cms_pool.fetch = AsyncMock(return_value=[_post_row('homepage-hero', ['homepage', 'hero'])])
    shared_pool = AsyncMock()
    with patch('src.routers.page_blocks.get_pool', return_value=cms_pool), \
         patch('src.routers.page_blocks.get_event_pool', return_value=shared_pool):
        from src.main import app
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url='http://test', headers=API_KEY) as client:
            resp = await client.post('/api/page-blocks/publish', json={'page': 'homepage'})
            assert resp.status_code == 200
            assert resp.json()['data']['published'] == 1
            assert any('INSERT INTO cms_content' in c.args[0] for c in shared_pool.execute.await_args_list)


@pytest.mark.asyncio
async def test_delete_removes_from_both_stores(mock_db):
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
            assert any('DELETE FROM cms_content' in c.args[0] for c in shared_pool.execute.await_args_list)
