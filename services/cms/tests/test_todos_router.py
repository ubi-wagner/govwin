"""Tests for the admin TODOs router."""
import pytest
import uuid
from unittest.mock import patch, AsyncMock, MagicMock
from httpx import AsyncClient, ASGITransport


@pytest.fixture
def mock_db():
    """Patch all database and worker dependencies."""
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


@pytest.fixture
def mock_pool():
    """Mock the CMS database pool for todos router."""
    pool = AsyncMock()
    with patch('src.routers.todos.get_pool', return_value=pool):
        yield pool


@pytest.mark.asyncio
async def test_list_todos_empty(mock_db, mock_pool):
    mock_pool.fetch = AsyncMock(return_value=[])
    from src.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url='http://test', headers={'x-cms-api-key': 'test-api-key-for-pytest'}) as client:
        resp = await client.get('/api/todos')
        assert resp.status_code == 200


@pytest.mark.asyncio
async def test_create_todo(mock_db, mock_pool):
    todo_id = str(uuid.uuid4())
    mock_row = {
        'id': todo_id, 'title': 'Test Todo', 'description': None,
        'todo_type': 'general', 'priority': 'medium', 'status': 'open',
        'assigned_to': None, 'tenant_id': None, 'related_entity_type': None,
        'related_entity_id': None, 'due_at': None, 'metadata': {},
        'created_by': None, 'created_at': '2025-01-01T00:00:00Z',
        'updated_at': '2025-01-01T00:00:00Z', 'completed_at': None,
    }
    mock_pool.fetchrow = AsyncMock(return_value=mock_row)
    from src.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url='http://test', headers={'x-cms-api-key': 'test-api-key-for-pytest'}) as client:
        resp = await client.post('/api/todos', json={
            'title': 'Test Todo',
            'todo_type': 'general',
        })
        assert resp.status_code in (200, 201)
