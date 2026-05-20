"""
API key authentication middleware for CMS service.

Checks X-CMS-API-Key header against CMS_API_KEY env var.
Skips auth for health, docs, and OpenAPI schema endpoints.
If CMS_API_KEY is not set, all requests pass through (no auth required).
"""
import os

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


class APIKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.url.path in ("/health", "/docs", "/openapi.json"):
            return await call_next(request)

        api_key = os.getenv("CMS_API_KEY")
        if not api_key:
            return await call_next(request)  # no key configured = no auth required

        provided = request.headers.get("x-cms-api-key")
        if provided != api_key:
            return JSONResponse(
                {"error": "Invalid API key", "code": "UNAUTHORIZED"},
                status_code=401,
            )

        return await call_next(request)
