"""Health check endpoint for Railway."""
from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()


@router.get('/health')
async def health_check():
    """Liveness check — always returns 200 so Railway knows the process is up.
    Reports DB status as a detail field for observability."""
    db_status = 'unknown'
    try:
        from ..models.database import get_pool
        pool = get_pool()
        if pool:
            async with pool.acquire() as conn:
                await conn.fetchval('SELECT 1')
            db_status = 'connected'
        else:
            db_status = 'pool_not_initialized'
    except Exception as e:
        db_status = f'error: {type(e).__name__}'

    return {'status': 'ok', 'service': 'cms', 'database': db_status}
