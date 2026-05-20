"""Tests for CMS health check endpoint."""
import pytest
from unittest.mock import patch, AsyncMock
from httpx import AsyncClient, ASGITransport


@pytest.fixture
def mock_db():
    """Patch database pools for testing."""
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


@pytest.mark.asyncio
async def test_health_endpoint(mock_db):
    from src.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url='http://test') as client:
        resp = await client.get('/health')
        assert resp.status_code == 200
        data = resp.json()
        assert data.get('status') == 'ok' or 'status' in data
