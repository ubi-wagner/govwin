"""
CMS + CRM Service — FastAPI application

Standalone service for content management, media storage, and future CRM.
Fully isolated from customer/tenant data (own database, own storage volume).

Architecture:
  - FastAPI async app on Railway
  - Own PostgreSQL database (separate from frontend/pipeline)
  - Railway persistent volume for media assets at /data/cms
  - Event bridge: writes to shared event tables for automation triggers
  - Frontend calls this service via internal Railway networking
"""
import os
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import content, media, health, email
from .models.database import init_db, close_db, init_event_bridge, close_event_bridge
from .storage.volume import ensure_dirs

logging.basicConfig(
    level=getattr(logging, os.getenv('LOG_LEVEL', 'INFO').upper()),
    format='%(asctime)s [%(name)s] %(levelname)s: %(message)s',
)
logger = logging.getLogger('cms')

_generation_task: asyncio.Task | None = None
_email_queue_task: asyncio.Task | None = None
_email_sweep_task: asyncio.Task | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle."""
    global _generation_task, _email_queue_task, _email_sweep_task
    logger.info('CMS service starting...')

    # Initialize databases
    await init_db()
    logger.info('CMS database connected')

    await init_event_bridge()

    # Ensure storage directories exist
    ensure_dirs()

    # Start content generation worker if ANTHROPIC_API_KEY is available
    if os.getenv('ANTHROPIC_API_KEY'):
        from .workers.content_generator import generation_loop
        _generation_task = asyncio.create_task(generation_loop())
        logger.info('Content generation worker started')
    else:
        logger.warning('ANTHROPIC_API_KEY not set — content generation worker disabled')

    # Start email workers if Google service account is configured
    if os.getenv('GOOGLE_SERVICE_ACCOUNT_JSON') or os.getenv('GOOGLE_SERVICE_ACCOUNT_PATH'):
        from .workers.email_queue import queue_loop
        from .workers.email_sweep import sweep_loop
        _email_queue_task = asyncio.create_task(queue_loop())
        _email_sweep_task = asyncio.create_task(sweep_loop())
        logger.info('Email queue and sweep workers started')
    else:
        logger.warning('Google service account not configured — email workers disabled')

    yield

    # Shutdown
    logger.info('CMS service shutting down...')
    for task in (_generation_task, _email_queue_task, _email_sweep_task):
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
    await close_event_bridge()
    await close_db()


app = FastAPI(
    title='GovWin CMS Service',
    description='Content management, media storage, and CRM subsystem',
    version='0.1.0',
    lifespan=lifespan,
)

# CORS — allow frontend origin (Railway internal networking uses service names)
allowed_origins = os.getenv('ALLOWED_ORIGINS', 'http://localhost:3000').split(',')
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

# Mount routers
app.include_router(health.router, tags=['health'])
app.include_router(content.router, prefix='/api/content', tags=['content'])
app.include_router(media.router, prefix='/api/media', tags=['media'])
app.include_router(email.router, prefix='/api/email', tags=['email'])
