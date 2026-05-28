"""
API key authentication middleware for CMS service.

Checks X-CMS-API-Key header against CMS_API_KEY env var.
Skips auth for health, docs, OpenAPI schema, and SPA routes.
If CMS_API_KEY is not set, rejects all API requests (fail closed).

Auth modes (CMS_AUTH_MODE env var):
- "session" (default): SPA users authenticate via /api/auth/login which sets
  a JWT session cookie. The old API-key-derived cookie is also accepted.
- "basic": Legacy HTTP Basic Auth on /cms/ routes (CMS_BASIC_USER / CMS_BASIC_PASS).

External callers always use the X-CMS-API-Key header regardless of mode.
"""
import base64
import hashlib
import hmac
import os

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

_CMS_COOKIE = 'cms_session'
_CMS_LOGIN_COOKIE = 'cms_login_session'

# ── Basic Auth helpers (legacy fallback) ────────────────────────────

CMS_BASIC_USER = os.getenv('CMS_BASIC_USER', 'admin')
CMS_BASIC_PASS = os.getenv('CMS_BASIC_PASS', '')


def _check_basic_auth(request: Request) -> bool:
    """Check HTTP Basic Auth for CMS SPA access."""
    if not CMS_BASIC_PASS:
        return True  # No password set = open (dev mode)
    auth_header = request.headers.get('authorization', '')
    if not auth_header.startswith('Basic '):
        return False
    try:
        decoded = base64.b64decode(auth_header[6:]).decode()
        user, passwd = decoded.split(':', 1)
        return hmac.compare_digest(user, CMS_BASIC_USER) and hmac.compare_digest(passwd, CMS_BASIC_PASS)
    except Exception:
        return False


# ── Cookie helpers ──────────────────────────────────────────────────

def _sign_cookie(api_key: str) -> str:
    """Produce a signed value for the SPA session cookie (legacy)."""
    return hmac.new(api_key.encode(), b'cms_spa_session', hashlib.sha256).hexdigest()


def _has_valid_login_session(request: Request) -> bool:
    """Check if request has a valid JWT login session cookie."""
    token = request.cookies.get(_CMS_LOGIN_COOKIE, '')
    if not token:
        return False
    # Lazy import to avoid circular dependency at module load
    from ..routers.auth import verify_session_token
    return verify_session_token(token) is not None


def _get_auth_mode() -> str:
    """Get the current auth mode from env var."""
    return os.getenv('CMS_AUTH_MODE', 'session').lower()


# ── Paths that never require auth ──────────────────────────────────

_PUBLIC_API_PATHS = frozenset({'/api/auth/login', '/api/auth/logout'})


class APIKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        path = request.url.path
        auth_mode = _get_auth_mode()

        # Always allow health checks, docs, OpenAPI schema
        if path == '/health' or path in ('/docs', '/openapi.json'):
            return await call_next(request)

        # Always allow auth endpoints (login/logout) without any auth
        if path in _PUBLIC_API_PATHS:
            return await call_next(request)

        # ── SPA routes (/cms/...) ───────────────────────────────────
        if path.startswith('/cms'):
            if auth_mode == 'basic':
                # Legacy: enforce HTTP Basic Auth on CMS SPA pages
                if not path.startswith('/cms/assets'):
                    if not _check_basic_auth(request):
                        return Response(
                            'Authentication required',
                            status_code=401,
                            headers={'WWW-Authenticate': 'Basic realm="CMS"'},
                        )

            response = await call_next(request)

            # In basic mode, set the legacy API-key-derived session cookie
            if auth_mode == 'basic' and not path.startswith('/cms/assets'):
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

        # ── API routes (/api/...) ───────────────────────────────────
        # Allow /api/auth/me without API key (it checks its own cookie)
        if path == '/api/auth/me':
            return await call_next(request)

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

        # Check legacy session cookie (API-key-derived)
        cookie = request.cookies.get(_CMS_COOKIE, '')
        if cookie and hmac.compare_digest(cookie, _sign_cookie(api_key)):
            return await call_next(request)

        # Check JWT login session cookie (new session-based auth)
        if _has_valid_login_session(request):
            return await call_next(request)

        return JSONResponse(
            {'error': 'Invalid API key', 'code': 'invalid_api_key'},
            status_code=401,
        )
