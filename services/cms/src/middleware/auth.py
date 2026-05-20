"""
API key authentication middleware for CMS service.

Checks X-CMS-API-Key header against CMS_API_KEY env var.
Skips auth for health, docs, OpenAPI schema, and SPA routes.
If CMS_API_KEY is not set, rejects all API requests (fail closed).

SPA users are authenticated via a session cookie set when /cms/ is served.
External callers (e.g. Next.js frontend) use the X-CMS-API-Key header.
"""
import hashlib
import hmac
import os

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

_CMS_COOKIE = 'cms_session'


def _sign_cookie(api_key: str) -> str:
    """Produce a signed value for the SPA session cookie."""
    return hmac.new(api_key.encode(), b'cms_spa_session', hashlib.sha256).hexdigest()


class APIKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        path = request.url.path

        # Always allow health checks, docs, and SPA routes without API auth
        if path == '/health' or path.startswith('/cms') or path in ('/docs', '/openapi.json'):
            response = await call_next(request)
            # Set session cookie when serving SPA pages (not static assets)
            if path.startswith('/cms') and not path.startswith('/cms/assets'):
                api_key = os.getenv('CMS_API_KEY', '')
                if api_key:
                    is_dev = os.getenv('RAILWAY_ENVIRONMENT_NAME', 'local') == 'local'
                    response.set_cookie(
                        _CMS_COOKIE,
                        _sign_cookie(api_key),
                        httponly=True,
                        samesite='strict',
                        secure=not is_dev,
                        max_age=86400,
                    )
            return response

        api_key = os.getenv('CMS_API_KEY', '')

        # Fail closed: if no key configured, reject all API requests
        if not api_key:
            return JSONResponse(
                {'error': 'CMS_API_KEY not configured', 'code': 'auth_not_configured'},
                status_code=503,
            )

        # Check API key header (for external callers)
        provided = request.headers.get('x-cms-api-key', '')
        if hmac.compare_digest(provided, api_key):
            return await call_next(request)

        # Check session cookie (for SPA users)
        cookie = request.cookies.get(_CMS_COOKIE, '')
        if cookie and hmac.compare_digest(cookie, _sign_cookie(api_key)):
            return await call_next(request)

        return JSONResponse(
            {'error': 'Invalid API key', 'code': 'invalid_api_key'},
            status_code=401,
        )
