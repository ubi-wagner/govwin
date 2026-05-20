"""Shared fixtures for CMS service tests."""
import os
import sys
import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

# Set CMS_API_KEY for tests so the auth middleware doesn't reject requests
os.environ.setdefault('CMS_API_KEY', 'test-api-key-for-pytest')

# Pre-mock native crypto modules that the google-auth chain requires.
# In CI and test environments the C extension (_cffi_backend / cryptography Rust)
# may not be available, so we stub them before any CMS source is imported.
_NATIVE_MODULES = [
    '_cffi_backend',
    'cryptography', 'cryptography.exceptions',
    'cryptography.hazmat', 'cryptography.hazmat.bindings',
    'cryptography.hazmat.bindings._rust',
    'cryptography.hazmat.bindings._rust.exceptions',
    'google.auth', 'google.auth.crypt', 'google.auth.crypt.es',
    'google.auth._service_account_info',
    'google.oauth2', 'google.oauth2.service_account',
    'googleapiclient', 'googleapiclient.discovery',
]
for _mod in _NATIVE_MODULES:
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()

# Now force-import the CMS app so all src.* modules are in sys.modules.
# This must happen after the google/crypto mocking above.
import src.main  # noqa: E402, F401


@pytest.fixture
def mock_cms_pool():
    """Mock CMS database pool."""
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    pool.fetchrow = AsyncMock(return_value=None)
    pool.fetchval = AsyncMock(return_value=None)
    pool.execute = AsyncMock()
    return pool


@pytest.fixture
def mock_shared_pool():
    """Mock shared/main database pool (event bridge)."""
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    pool.fetchrow = AsyncMock(return_value=None)
    pool.fetchval = AsyncMock(return_value=None)
    pool.execute = AsyncMock()
    return pool


@pytest.fixture
def sample_tenant():
    return {
        'id': '00000000-0000-0000-0000-000000000001',
        'name': 'Acme Corp',
        'lifecycle_stage': 'customer',
        'tier': 'SBIR',
        'created_at': '2025-01-15',
    }


@pytest.fixture
def sample_user():
    return {
        'id': '00000000-0000-0000-0000-000000000002',
        'name': 'Jane Doe',
        'email': 'jane@acme.com',
    }


@pytest.fixture
def sample_template():
    return {
        'id': '00000000-0000-0000-0000-000000000010',
        'slug': 'lead-initial-outreach',
        'name': 'Lead Initial Outreach',
        'subject_template': 'Opportunities for {{company_name}}',
        'body_html': '<p>Hi {{contact_name}}, we found {{matched_count}} opportunities for {{company_name}}.</p>',
        'body_text': '',
        'is_active': True,
        'trigger_config': {
            'namespace': 'capture',
            'type': 'lead.outreach',
            'expected_responses': ['interest', 'question', 'decline'],
            'auto_response_enabled': True,
            'escalation_on': ['urgent'],
        },
        'response_map': {
            'interest': {'template_slug': 'lead-interest-followup', 'delay_hours': 0, 'priority': 'high'},
            'default': {'template_slug': 'lead-generic-followup', 'delay_hours': 4, 'priority': 'medium'},
        },
        'profile_variables': ['company_name', 'contact_name', 'matched_count'],
        'template_category': 'outreach',
        'tags': ['outreach', 'lead'],
        'category': 'campaign',
    }
