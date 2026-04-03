"""Health check endpoint for Railway."""
from fastapi import APIRouter
from ..models.database import get_pool

router = APIRouter()


@router.get('/health')
async def health_check():
    """Health check — verifies DB connectivity."""
    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            await conn.fetchval('SELECT 1')
        return {'status': 'healthy', 'service': 'cms', 'database': 'connected'}
    except Exception as e:
        return {'status': 'degraded', 'service': 'cms', 'database': str(e)}
