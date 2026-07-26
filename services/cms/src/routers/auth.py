"""
Authentication routes for CMS SPA.

Provides login/logout/me endpoints. Authenticates against the shared
database users table (master_admin and rfp_admin roles only).
Issues a signed JWT session cookie on successful login.
"""
import logging
import os
import time

import bcrypt
import jwt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from ..models.database import get_event_pool
from ..models.events import emit_system_event

logger = logging.getLogger('cms.auth')

router = APIRouter()

_SESSION_MAX_AGE = 86400  # 24 hours
_CMS_SESSION_COOKIE = 'cms_login_session'


def _get_jwt_secret() -> str:
    """Get JWT secret, falling back to CMS_API_KEY if CMS_JWT_SECRET not set."""
    secret = os.getenv('CMS_JWT_SECRET', '') or os.getenv('CMS_API_KEY', '')
    if not secret:
        raise RuntimeError('Neither CMS_JWT_SECRET nor CMS_API_KEY is set')
    return secret


def _create_session_token(user_id: str, email: str, role: str, name: str) -> str:
    """Create a signed JWT session token."""
    payload = {
        'sub': user_id,
        'email': email,
        'role': role,
        'name': name,
        'iat': int(time.time()),
        'exp': int(time.time()) + _SESSION_MAX_AGE,
    }
    return jwt.encode(payload, _get_jwt_secret(), algorithm='HS256')


def verify_session_token(token: str) -> dict | None:
    """Verify and decode a session token. Returns claims or None."""
    try:
        return jwt.decode(token, _get_jwt_secret(), algorithms=['HS256'])
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None


@router.post('/auth/login')
async def login(request: Request):
    """Authenticate a CMS user and set a session cookie."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail='Invalid request body')

    email = (body.get('email') or '').strip().lower()
    password = body.get('password') or ''

    if not email or not password:
        raise HTTPException(
            status_code=400,
            detail='Email and password are required',
        )

    shared_pool = get_event_pool()
    if not shared_pool:
        logger.error('[auth/login] SHARED_DATABASE_URL not configured — cannot authenticate')
        raise HTTPException(
            status_code=503,
            detail='Authentication service unavailable',
        )

    try:
        user = await shared_pool.fetchrow(
            "SELECT id, email, name, role, password_hash FROM users "
            "WHERE email = $1 AND role IN ('master_admin', 'rfp_admin') AND is_active = true",
            email,
        )
    except Exception as e:
        logger.error('[auth/login] DB query failed: %s', e)
        raise HTTPException(
            status_code=500,
            detail='Authentication service error',
        )

    if not user:
        # Emit failed login event (best effort)
        try:
            await _emit_login_event(
                shared_pool, success=False, email=email, reason='user_not_found',
            )
        except Exception:
            pass
        raise HTTPException(status_code=401, detail='Invalid credentials')

    # Verify bcrypt password
    password_hash = user['password_hash'] or ''
    if not password_hash:
        try:
            await _emit_login_event(
                shared_pool, success=False, email=email, reason='no_password_set',
            )
        except Exception:
            pass
        raise HTTPException(status_code=401, detail='Invalid credentials')

    try:
        password_valid = bcrypt.checkpw(
            password.encode('utf-8'),
            password_hash.encode('utf-8'),
        )
    except Exception:
        password_valid = False

    if not password_valid:
        try:
            await _emit_login_event(
                shared_pool, success=False, email=email, reason='invalid_password',
            )
        except Exception:
            pass
        raise HTTPException(status_code=401, detail='Invalid credentials')

    # Create session token
    user_id = str(user['id'])
    token = _create_session_token(
        user_id=user_id,
        email=user['email'],
        role=user['role'],
        name=user['name'] or '',
    )

    # Emit successful login event
    try:
        await _emit_login_event(
            shared_pool, success=True, email=user['email'], user_id=user_id,
        )
    except Exception as e:
        logger.error('[auth/login] Failed to emit login event: %s', e)

    # Update last_login_at
    try:
        await shared_pool.execute(
            'UPDATE users SET last_login_at = NOW() WHERE id = $1',
            user['id'],
        )
    except Exception as e:
        logger.error('[auth/login] Failed to update last_login_at: %s', e)

    is_dev = os.getenv('RAILWAY_ENVIRONMENT_NAME', 'local') == 'local'

    response = JSONResponse(content={
        'data': {
            'id': user_id,
            'email': user['email'],
            'name': user['name'] or '',
            'role': user['role'],
        },
    })
    response.set_cookie(
        _CMS_SESSION_COOKIE,
        token,
        httponly=True,
        samesite='strict',
        secure=not is_dev,
        max_age=_SESSION_MAX_AGE,
        path='/',
    )
    return response


@router.post('/auth/logout')
async def logout():
    """Clear the session cookie."""
    response = JSONResponse(content={'data': {'ok': True}})
    response.delete_cookie(_CMS_SESSION_COOKIE, path='/')
    return response


@router.get('/auth/me')
async def me(request: Request):
    """Return current user info from session token."""
    token = request.cookies.get(_CMS_SESSION_COOKIE, '')
    if not token:
        raise HTTPException(status_code=401, detail='Not authenticated')

    claims = verify_session_token(token)
    if not claims:
        raise HTTPException(status_code=401, detail='Session expired')

    return {
        'data': {
            'id': claims['sub'],
            'email': claims['email'],
            'name': claims.get('name', ''),
            'role': claims['role'],
        },
    }


async def _emit_login_event(
    shared_pool,
    *,
    success: bool,
    email: str,
    user_id: str | None = None,
    reason: str | None = None,
) -> None:
    """Emit login event to the shared database system_events table."""
    event_type = 'cms_user.logged_in' if success else 'cms_user.login_failed'
    payload: dict = {
        'email': email,
        'source': 'cms_spa',
    }
    if user_id:
        payload['userId'] = user_id
    if reason:
        payload['reason'] = reason

    # Login audit events live in the 'identity' namespace; a failed/no-user login
    # attributes to the 'anonymous' system actor (not the 'cms_service' default).
    await emit_system_event(
        event_type=event_type, namespace='identity',
        actor_type='user' if user_id else 'system',
        actor_id=user_id or 'anonymous',
        payload=payload, pool=shared_pool,
    )
