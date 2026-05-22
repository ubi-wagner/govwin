"""
CMS-CRM Service — email automation, content management, event-driven actions.

Separate from the frontend/pipeline services. Owns:
- Gmail API integration (send as platform@rfppipeline.com)
- Calendar API for deadline reminders
- Email templates and campaigns
- CMS content (blog, resources, guides)
- Event listener that bridges system_events → automated actions
- SBIR award lookup for application enrichment
"""
import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.staticfiles import StaticFiles
from starlette.responses import FileResponse

from .models.database import init_db, close_db, init_event_bridge, close_event_bridge
from .routers import health, email, content
from .routers.media import router as media_router
from .routers.social import router as social_router
from .routers.drip import router as drip_router
from .routers.todos import router as todos_router
from .event_listener import start_event_listener, stop_event_listener
from .middleware.auth import APIKeyMiddleware
from .workers.content_generator import generation_loop
from .workers.email_queue import queue_loop
from .workers.email_sweep import sweep_loop
from .workers.campaign_executor import executor_loop
from .workers.drip_engine import drip_loop
from .workers.social_poster import social_loop

logging.basicConfig(level=os.getenv('LOG_LEVEL', 'INFO'))
logger = logging.getLogger('cms')


async def _run_worker(name: str, coro):
    """Run a worker loop with automatic restart on crash."""
    backoff = 1
    while True:
        try:
            logger.info("Starting worker: %s", name)
            await coro()
        except asyncio.CancelledError:
            logger.info("Worker %s cancelled", name)
            return
        except Exception:
            logger.exception("Worker %s crashed, restarting in %ds", name, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 300)
        else:
            logger.info("Worker %s exited cleanly", name)
            return


@asynccontextmanager
async def lifespan(app: FastAPI):
    env = os.getenv('RAILWAY_ENVIRONMENT_NAME', 'local')
    sha = os.getenv('RAILWAY_GIT_COMMIT_SHA', 'dev')[:7]
    logger.info('CMS-CRM service starting... (env=%s, version=%s)', env, sha)
    await init_db()
    await init_event_bridge()
    await start_event_listener()

    # Launch background worker loops
    worker_tasks = [
        asyncio.create_task(_run_worker('content_generator', generation_loop)),
        asyncio.create_task(_run_worker('email_queue', queue_loop)),
        asyncio.create_task(_run_worker('email_sweep', sweep_loop)),
        asyncio.create_task(_run_worker('campaign_executor', executor_loop)),
        asyncio.create_task(_run_worker('drip_engine', drip_loop)),
        asyncio.create_task(_run_worker('social_poster', social_loop)),
    ]
    logger.info('CMS-CRM service ready (env=%s)', env)

    yield

    logger.info('CMS-CRM service shutting down...')
    for t in worker_tasks:
        t.cancel()
    await asyncio.gather(*worker_tasks, return_exceptions=True)
    await stop_event_listener()
    await close_event_bridge()
    await close_db()

app = FastAPI(title="RFP Pipeline CMS-CRM", version="1.0.0", lifespan=lifespan)

origins = [o.strip() for o in os.getenv('ALLOWED_ORIGINS', 'http://localhost:3000,https://www.rfppipeline.com,https://rfp-crm-production.up.railway.app').split(',')]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.add_middleware(APIKeyMiddleware)

app.include_router(health.router, tags=["health"])
app.include_router(email.router, prefix="/api/email", tags=["email"])
app.include_router(content.router, prefix="/api/content", tags=["content"])
app.include_router(media_router, prefix="/api/media", tags=["media"])
app.include_router(social_router, prefix="/api/social", tags=["social"])
app.include_router(drip_router, prefix="/api/drip", tags=["drip"])
app.include_router(todos_router, prefix="/api/todos", tags=["todos"])

# ── CMS Frontend SPA (static files) ───────────────────────────────
_static_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")

if os.path.isdir(_static_dir):
    _assets_dir = os.path.join(_static_dir, "assets")
    if os.path.isdir(_assets_dir):
        app.mount("/cms/assets", StaticFiles(directory=_assets_dir), name="cms-assets")

    @app.get("/cms")
    @app.get("/cms/{rest:path}")
    async def serve_cms_spa(rest: str = ""):
        index = os.path.join(_static_dir, "index.html")
        if os.path.isfile(index):
            return FileResponse(index)
        return JSONResponse({"error": "CMS frontend not built"}, status_code=404)
