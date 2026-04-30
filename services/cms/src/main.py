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

from .models.database import init_db, close_db, init_event_bridge, close_event_bridge
from .routers import health, email, content
from .event_listener import start_event_listener, stop_event_listener

logging.basicConfig(level=os.getenv('LOG_LEVEL', 'INFO'))
logger = logging.getLogger('cms')

@asynccontextmanager
async def lifespan(app: FastAPI):
    env = os.getenv('RAILWAY_ENVIRONMENT_NAME', 'local')
    sha = os.getenv('RAILWAY_GIT_COMMIT_SHA', 'dev')[:7]
    logger.info('CMS-CRM service starting... (env=%s, version=%s)', env, sha)
    await init_db()
    await init_event_bridge()
    await start_event_listener()
    logger.info('CMS-CRM service ready (env=%s)', env)
    yield
    logger.info('CMS-CRM service shutting down...')
    await stop_event_listener()
    await close_event_bridge()
    await close_db()

app = FastAPI(title="RFP Pipeline CMS-CRM", version="1.0.0", lifespan=lifespan)

origins = [o.strip() for o in os.getenv('ALLOWED_ORIGINS', 'http://localhost:3000').split(',')]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

app.include_router(health.router, tags=["health"])
app.include_router(email.router, prefix="/api/email", tags=["email"])
app.include_router(content.router, prefix="/api/content", tags=["content"])
