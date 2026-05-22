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

    # Check pending generations (debug: is the worker picking them up?)
    pending_gens = 0
    try:
        from ..models.database import get_pool as _gp
        p = _gp()
        pending_gens = await p.fetchval(
            "SELECT COUNT(*) FROM cms_generations WHERE status IN ('pending', 'generating')"
        ) or 0
    except Exception:
        pass

    import os
    return {
        'status': 'ok',
        'service': 'cms',
        'database': db_status,
        'pending_generations': pending_gens,
        'anthropic_key_set': bool(os.getenv('ANTHROPIC_API_KEY')),
    }
