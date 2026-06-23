"""CMS-02 — Auth flow tests (JWT/cookie issuance, bcrypt check, last_login_at, wrong password).

Tests target src.routers.auth directly (no live DB, no live bcrypt crunch).
Mocking strategy:
  - get_event_pool → AsyncMock fake pool (returned from the module's reference)
  - bcrypt.checkpw → patched to control pass/fail without real hashing
  - _emit_login_event → patched to skip the shared-DB INSERT
  - Routes are at /api/auth/login (prefix=/api per main.py)
  - /api/auth/login and /api/auth/me bypass the APIKeyMiddleware

No live DB (CMS_DATABASE_URL and SHARED_DATABASE_URL are empty in CI).
"""
import json
import os
import time
import pytest
import jwt
from unittest.mock import AsyncMock, MagicMock, patch

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_JWT_SECRET = 'test-jwt-secret-for-pytest'
_USER_ID = '00000000-0000-0000-0000-000000000042'
_HASHED_PW = '$2b$12$fakehashplaceholder1234567890123456789012'

# Patch targets for lifecycle hooks (same set used across test_health.py / test_todos_router.py)
_LIFECYCLE_PATCHES = [
    ('src.models.database.init_db', AsyncMock),
    ('src.models.database.close_db', AsyncMock),
    ('src.models.database.init_event_bridge', AsyncMock),
    ('src.models.database.close_event_bridge', AsyncMock),
    ('src.event_listener.start_event_listener', AsyncMock),
    ('src.event_listener.stop_event_listener', AsyncMock),
    ('src.workers.content_generator.generation_loop', AsyncMock),
    ('src.workers.email_queue.queue_loop', AsyncMock),
    ('src.workers.email_sweep.sweep_loop', AsyncMock),
    ('src.workers.campaign_executor.executor_loop', AsyncMock),
    ('src.workers.drip_engine.drip_loop', AsyncMock),
    ('src.workers.social_poster.social_loop', AsyncMock),
]


def _make_fake_user(role='rfp_admin', password_hash=_HASHED_PW):
    """Return an asyncpg-Record-like dict for a CMS admin user."""
    return {
        'id': _USER_ID,
        'email': 'admin@rfppipeline.com',
        'name': 'Admin User',
        'role': role,
        'password_hash': password_hash,
    }


def _make_pool(user_row=None):
    """Return a fake asyncpg pool where fetchrow returns user_row."""
    pool = AsyncMock()
    pool.fetchrow = AsyncMock(return_value=user_row)
    pool.execute = AsyncMock()
    return pool


from contextlib import AsyncExitStack
import contextlib


@contextlib.contextmanager
def _lifecycle_mock():
    """Context manager that applies all lifecycle patches at once."""
    with contextlib.ExitStack() as stack:
        for target, factory in _LIFECYCLE_PATCHES:
            stack.enter_context(patch(target, new_callable=factory))
        yield


# ---------------------------------------------------------------------------
# JWT helpers (pure unit tests, no HTTP)
# ---------------------------------------------------------------------------

class TestJwtHelpers:
    def test_create_session_token_returns_valid_jwt(self):
        with patch.dict(os.environ, {'CMS_JWT_SECRET': _JWT_SECRET}):
            from src.routers.auth import _create_session_token
            token = _create_session_token(
                user_id=_USER_ID,
                email='admin@rfppipeline.com',
                role='rfp_admin',
                name='Admin User',
            )

        claims = jwt.decode(token, _JWT_SECRET, algorithms=['HS256'])
        assert claims['sub'] == _USER_ID
        assert claims['email'] == 'admin@rfppipeline.com'
        assert claims['role'] == 'rfp_admin'
        assert claims['name'] == 'Admin User'
        assert claims['exp'] > claims['iat']

    def test_create_session_token_expires_in_24h(self):
        with patch.dict(os.environ, {'CMS_JWT_SECRET': _JWT_SECRET}):
            from src.routers.auth import _create_session_token, _SESSION_MAX_AGE
            before = int(time.time())
            token = _create_session_token(
                user_id=_USER_ID, email='a@b.com', role='rfp_admin', name='A',
            )
            after = int(time.time())

        claims = jwt.decode(token, _JWT_SECRET, algorithms=['HS256'])
        assert claims['exp'] - claims['iat'] == _SESSION_MAX_AGE
        assert claims['exp'] >= before + _SESSION_MAX_AGE
        assert claims['exp'] <= after + _SESSION_MAX_AGE

    def test_verify_session_token_valid(self):
        with patch.dict(os.environ, {'CMS_JWT_SECRET': _JWT_SECRET}):
            from src.routers.auth import _create_session_token, verify_session_token
            token = _create_session_token(
                user_id=_USER_ID, email='a@b.com', role='rfp_admin', name='A',
            )
            claims = verify_session_token(token)

        assert claims is not None
        assert claims['sub'] == _USER_ID

    def test_verify_session_token_expired_returns_none(self):
        """An already-expired token should return None."""
        payload = {
            'sub': _USER_ID, 'email': 'a@b.com', 'role': 'rfp_admin', 'name': 'A',
            'iat': int(time.time()) - 100000,
            'exp': int(time.time()) - 1,  # already expired
        }
        token = jwt.encode(payload, _JWT_SECRET, algorithm='HS256')

        with patch.dict(os.environ, {'CMS_JWT_SECRET': _JWT_SECRET}):
            from src.routers.auth import verify_session_token
            result = verify_session_token(token)

        assert result is None

    def test_verify_session_token_wrong_secret_returns_none(self):
        payload = {
            'sub': _USER_ID, 'email': 'a@b.com', 'role': 'rfp_admin', 'name': 'A',
            'iat': int(time.time()), 'exp': int(time.time()) + 86400,
        }
        token = jwt.encode(payload, 'wrong-secret', algorithm='HS256')

        with patch.dict(os.environ, {'CMS_JWT_SECRET': _JWT_SECRET}):
            from src.routers.auth import verify_session_token
            result = verify_session_token(token)

        assert result is None

    def test_get_jwt_secret_falls_back_to_api_key(self):
        """If CMS_JWT_SECRET is unset, _get_jwt_secret falls back to CMS_API_KEY."""
        env = {'CMS_API_KEY': 'fallback-api-key'}
        with patch.dict(os.environ, env, clear=False):
            os.environ.pop('CMS_JWT_SECRET', None)
            from src.routers.auth import _get_jwt_secret
            secret = _get_jwt_secret()
        assert secret == 'fallback-api-key'


# ---------------------------------------------------------------------------
# Login endpoint — happy path
# ---------------------------------------------------------------------------

class TestLoginSuccess:
    @pytest.mark.asyncio
    async def test_login_returns_200_with_user_data(self):
        """Valid credentials → 200, JSON body with id/email/role/name."""
        from httpx import AsyncClient, ASGITransport
        from src.main import app

        user = _make_fake_user()
        fake_pool = _make_pool(user_row=user)

        with _lifecycle_mock(), \
             patch('src.routers.auth.get_event_pool', return_value=fake_pool), \
             patch('src.routers.auth.bcrypt.checkpw', return_value=True), \
             patch('src.routers.auth._emit_login_event', new_callable=AsyncMock), \
             patch.dict(os.environ, {'CMS_JWT_SECRET': _JWT_SECRET}):

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url='http://test') as client:
                resp = await client.post(
                    '/api/auth/login',
                    json={'email': 'admin@rfppipeline.com', 'password': 'correct-pw'},
                )

        assert resp.status_code == 200
        data = resp.json()['data']
        assert data['email'] == user['email']
        assert data['role'] == user['role']
        assert data['id'] == str(user['id'])

    @pytest.mark.asyncio
    async def test_login_sets_session_cookie(self):
        """Valid login sets an httponly session cookie containing a valid JWT."""
        from httpx import AsyncClient, ASGITransport
        from src.main import app

        user = _make_fake_user()
        fake_pool = _make_pool(user_row=user)

        with _lifecycle_mock(), \
             patch('src.routers.auth.get_event_pool', return_value=fake_pool), \
             patch('src.routers.auth.bcrypt.checkpw', return_value=True), \
             patch('src.routers.auth._emit_login_event', new_callable=AsyncMock), \
             patch.dict(os.environ, {'CMS_JWT_SECRET': _JWT_SECRET}):

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url='http://test') as client:
                resp = await client.post(
                    '/api/auth/login',
                    json={'email': 'admin@rfppipeline.com', 'password': 'correct-pw'},
                )

        assert resp.status_code == 200
        cookie_header = resp.headers.get('set-cookie', '')
        assert 'cms_login_session' in cookie_header
        assert 'HttpOnly' in cookie_header or 'httponly' in cookie_header.lower()

    @pytest.mark.asyncio
    async def test_login_calls_bcrypt_checkpw(self):
        """Login invokes bcrypt.checkpw with the right arguments."""
        from httpx import AsyncClient, ASGITransport
        from src.main import app

        user = _make_fake_user(password_hash=_HASHED_PW)
        fake_pool = _make_pool(user_row=user)
        checkpw_mock = MagicMock(return_value=True)

        with _lifecycle_mock(), \
             patch('src.routers.auth.get_event_pool', return_value=fake_pool), \
             patch('src.routers.auth.bcrypt.checkpw', checkpw_mock), \
             patch('src.routers.auth._emit_login_event', new_callable=AsyncMock), \
             patch.dict(os.environ, {'CMS_JWT_SECRET': _JWT_SECRET}):

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url='http://test') as client:
                await client.post(
                    '/api/auth/login',
                    json={'email': 'admin@rfppipeline.com', 'password': 'mysecret'},
                )

        assert checkpw_mock.called
        call_args = checkpw_mock.call_args[0]
        assert call_args[0] == b'mysecret'
        assert call_args[1] == _HASHED_PW.encode('utf-8')

    @pytest.mark.asyncio
    async def test_login_updates_last_login_at(self):
        """Successful login executes UPDATE users SET last_login_at."""
        from httpx import AsyncClient, ASGITransport
        from src.main import app

        user = _make_fake_user()
        fake_pool = _make_pool(user_row=user)

        with _lifecycle_mock(), \
             patch('src.routers.auth.get_event_pool', return_value=fake_pool), \
             patch('src.routers.auth.bcrypt.checkpw', return_value=True), \
             patch('src.routers.auth._emit_login_event', new_callable=AsyncMock), \
             patch.dict(os.environ, {'CMS_JWT_SECRET': _JWT_SECRET}):

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url='http://test') as client:
                await client.post(
                    '/api/auth/login',
                    json={'email': 'admin@rfppipeline.com', 'password': 'correct-pw'},
                )

        # Pool.execute should have been called with last_login_at update
        execute_calls = [str(c) for c in fake_pool.execute.call_args_list]
        assert any('last_login_at' in c for c in execute_calls), (
            f"Expected last_login_at UPDATE; calls were: {execute_calls}"
        )

    @pytest.mark.asyncio
    async def test_login_jwt_contains_correct_claims(self):
        """The JWT in the cookie has sub/email/role/name matching the user."""
        from httpx import AsyncClient, ASGITransport
        from src.main import app

        user = _make_fake_user(role='master_admin')
        fake_pool = _make_pool(user_row=user)

        with _lifecycle_mock(), \
             patch('src.routers.auth.get_event_pool', return_value=fake_pool), \
             patch('src.routers.auth.bcrypt.checkpw', return_value=True), \
             patch('src.routers.auth._emit_login_event', new_callable=AsyncMock), \
             patch.dict(os.environ, {'CMS_JWT_SECRET': _JWT_SECRET}):

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url='http://test') as client:
                resp = await client.post(
                    '/api/auth/login',
                    json={'email': 'admin@rfppipeline.com', 'password': 'correct-pw'},
                )

        assert resp.status_code == 200
        # Extract cookie value
        cookie_header = resp.headers.get('set-cookie', '')
        # Parse out the token value (everything between cms_login_session= and next ;)
        token = None
        for part in cookie_header.split(';'):
            part = part.strip()
            if part.startswith('cms_login_session='):
                token = part.split('=', 1)[1]
                break

        assert token is not None
        claims = jwt.decode(token, _JWT_SECRET, algorithms=['HS256'])
        assert claims['sub'] == str(user['id'])
        assert claims['email'] == user['email']
        assert claims['role'] == 'master_admin'


# ---------------------------------------------------------------------------
# Login endpoint — wrong password / failure paths
# ---------------------------------------------------------------------------

class TestLoginFailure:
    @pytest.mark.asyncio
    async def test_wrong_password_returns_401(self):
        """Wrong password → 401 'Invalid credentials'."""
        from httpx import AsyncClient, ASGITransport
        from src.main import app

        user = _make_fake_user()
        fake_pool = _make_pool(user_row=user)

        with _lifecycle_mock(), \
             patch('src.routers.auth.get_event_pool', return_value=fake_pool), \
             patch('src.routers.auth.bcrypt.checkpw', return_value=False), \
             patch('src.routers.auth._emit_login_event', new_callable=AsyncMock), \
             patch.dict(os.environ, {'CMS_JWT_SECRET': _JWT_SECRET}):

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url='http://test') as client:
                resp = await client.post(
                    '/api/auth/login',
                    json={'email': 'admin@rfppipeline.com', 'password': 'wrong-pw'},
                )

        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_wrong_password_does_not_set_cookie(self):
        """Failed login must NOT set a session cookie."""
        from httpx import AsyncClient, ASGITransport
        from src.main import app

        user = _make_fake_user()
        fake_pool = _make_pool(user_row=user)

        with _lifecycle_mock(), \
             patch('src.routers.auth.get_event_pool', return_value=fake_pool), \
             patch('src.routers.auth.bcrypt.checkpw', return_value=False), \
             patch('src.routers.auth._emit_login_event', new_callable=AsyncMock), \
             patch.dict(os.environ, {'CMS_JWT_SECRET': _JWT_SECRET}):

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url='http://test') as client:
                resp = await client.post(
                    '/api/auth/login',
                    json={'email': 'admin@rfppipeline.com', 'password': 'wrong-pw'},
                )

        cookie_header = resp.headers.get('set-cookie', '')
        assert 'cms_login_session' not in cookie_header

    @pytest.mark.asyncio
    async def test_user_not_found_returns_401(self):
        """User not in DB (or wrong role) → 401."""
        from httpx import AsyncClient, ASGITransport
        from src.main import app

        fake_pool = _make_pool(user_row=None)  # no user found

        with _lifecycle_mock(), \
             patch('src.routers.auth.get_event_pool', return_value=fake_pool), \
             patch('src.routers.auth._emit_login_event', new_callable=AsyncMock), \
             patch.dict(os.environ, {'CMS_JWT_SECRET': _JWT_SECRET}):

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url='http://test') as client:
                resp = await client.post(
                    '/api/auth/login',
                    json={'email': 'ghost@nowhere.com', 'password': 'pw'},
                )

        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_missing_fields_returns_400(self):
        """Missing email or password → 400."""
        from httpx import AsyncClient, ASGITransport
        from src.main import app

        # Provide a pool so middleware passes but the handler gets 400 before DB
        fake_pool = _make_pool()

        with _lifecycle_mock(), \
             patch('src.routers.auth.get_event_pool', return_value=fake_pool), \
             patch.dict(os.environ, {'CMS_JWT_SECRET': _JWT_SECRET}):

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url='http://test') as client:
                resp = await client.post(
                    '/api/auth/login',
                    json={'email': 'a@b.com'},  # missing password
                )

        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_no_shared_pool_returns_503(self):
        """If get_event_pool returns None (shared DB unavailable) → 503."""
        from httpx import AsyncClient, ASGITransport
        from src.main import app

        with _lifecycle_mock(), \
             patch('src.routers.auth.get_event_pool', return_value=None), \
             patch.dict(os.environ, {'CMS_JWT_SECRET': _JWT_SECRET}):

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url='http://test') as client:
                resp = await client.post(
                    '/api/auth/login',
                    json={'email': 'admin@rfppipeline.com', 'password': 'pw'},
                )

        assert resp.status_code == 503

    @pytest.mark.asyncio
    async def test_wrong_password_emits_login_failed_event(self):
        """Wrong password causes _emit_login_event to be called with success=False."""
        from httpx import AsyncClient, ASGITransport
        from src.main import app

        user = _make_fake_user()
        fake_pool = _make_pool(user_row=user)
        emit_mock = AsyncMock()

        with _lifecycle_mock(), \
             patch('src.routers.auth.get_event_pool', return_value=fake_pool), \
             patch('src.routers.auth.bcrypt.checkpw', return_value=False), \
             patch('src.routers.auth._emit_login_event', emit_mock), \
             patch.dict(os.environ, {'CMS_JWT_SECRET': _JWT_SECRET}):

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url='http://test') as client:
                await client.post(
                    '/api/auth/login',
                    json={'email': 'admin@rfppipeline.com', 'password': 'badpw'},
                )

        assert emit_mock.called
        call_kwargs = emit_mock.call_args[1]
        assert call_kwargs.get('success') is False


# ---------------------------------------------------------------------------
# /api/auth/me endpoint
# ---------------------------------------------------------------------------

class TestMeEndpoint:
    def _valid_token(self, role='rfp_admin'):
        payload = {
            'sub': _USER_ID,
            'email': 'admin@rfppipeline.com',
            'role': role,
            'name': 'Admin User',
            'iat': int(time.time()),
            'exp': int(time.time()) + 86400,
        }
        return jwt.encode(payload, _JWT_SECRET, algorithm='HS256')

    @pytest.mark.asyncio
    async def test_me_with_valid_cookie_returns_user(self):
        """A request with a valid JWT cookie returns the user's info."""
        from httpx import AsyncClient, ASGITransport
        from src.main import app

        token = self._valid_token()

        with _lifecycle_mock(), \
             patch.dict(os.environ, {'CMS_JWT_SECRET': _JWT_SECRET}):

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url='http://test') as client:
                client.cookies.set('cms_login_session', token)
                resp = await client.get('/api/auth/me')

        assert resp.status_code == 200
        data = resp.json()['data']
        assert data['id'] == _USER_ID
        assert data['role'] == 'rfp_admin'

    @pytest.mark.asyncio
    async def test_me_without_cookie_returns_401(self):
        """No cookie → 401."""
        from httpx import AsyncClient, ASGITransport
        from src.main import app

        with _lifecycle_mock(), \
             patch.dict(os.environ, {'CMS_JWT_SECRET': _JWT_SECRET}):

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url='http://test') as client:
                resp = await client.get('/api/auth/me')

        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_me_with_expired_cookie_returns_401(self):
        """Expired JWT → 401."""
        from httpx import AsyncClient, ASGITransport
        from src.main import app

        expired_payload = {
            'sub': _USER_ID, 'email': 'a@b.com', 'role': 'rfp_admin', 'name': 'A',
            'iat': int(time.time()) - 100000,
            'exp': int(time.time()) - 1,
        }
        expired_token = jwt.encode(expired_payload, _JWT_SECRET, algorithm='HS256')

        with _lifecycle_mock(), \
             patch.dict(os.environ, {'CMS_JWT_SECRET': _JWT_SECRET}):

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url='http://test') as client:
                client.cookies.set('cms_login_session', expired_token)
                resp = await client.get('/api/auth/me')

        assert resp.status_code == 401
