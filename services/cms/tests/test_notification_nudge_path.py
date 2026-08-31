"""Regression guard for the task-nudge notification path (the loop the pipeline
72h-curation nudge rides on): to_role → ADMIN_NOTIFICATION_EMAIL, senderNamespace
→ automation voice, HTML-escaped bodies, render-fail fallback, non-admin no-leak.

Self-contained (own google pre-mock + asyncio.run) so it needs no async plugin or
DB fixtures — only a captured send + a small id-aware fake pool. These scenarios
were proven against the real functions in a standalone harness during the #4 sweep.
"""
import os
import sys
import asyncio
from unittest.mock import MagicMock

for _m in ['_cffi_backend', 'cryptography', 'cryptography.exceptions', 'cryptography.hazmat',
           'cryptography.hazmat.bindings', 'cryptography.hazmat.bindings._rust',
           'cryptography.hazmat.bindings._rust.exceptions', 'google.auth', 'google.auth.crypt',
           'google.auth.crypt.es', 'google.auth._service_account_info', 'google.oauth2',
           'google.oauth2.service_account', 'googleapiclient', 'googleapiclient.discovery']:
    sys.modules.setdefault(_m, MagicMock())

os.environ.setdefault('ADMIN_NOTIFICATION_EMAIL', 'eric@rfppipeline.com')
os.environ.setdefault('GOOGLE_WORKSPACE_EMAIL', 'platform@rfppipeline.com')
os.environ.setdefault('SENDER_AUTOMATION_EMAIL', 'automation@rfppipeline.com')

from src.templates import render_template          # noqa: E402
import src.event_listener as EL                     # noqa: E402

ADMIN = 'eric@rfppipeline.com'


class _FakePool:
    async def fetchrow(self, q, *a):
        if 'FROM users WHERE id' in q:
            return {'email': 'user@acme.test'} if a and str(a[0]) == 'u1' else None
        if 'automation_log' in q:
            return None
        if 'FROM tenants' in q:
            return {'email': 'billing@acme.test'}
        return None

    async def fetch(self, q, *a):
        return []

    async def execute(self, q, *a):
        return 'OK'


def _install(sends):
    async def cap(to=None, subject=None, html=None, sender=None, **contract):
        # **contract is the seam's keyword-only fields (template, tenant_id, correlation_id,
        # idempotency_key, tags). RECORDED, not swallowed: a double that quietly accepts
        # anything stops the test noticing when a call site drops the correlation id.
        sends.append({'to': to, 'subject': subject, 'html': html or '', 'sender': sender,
                      **contract})
        return {'gmail_message_id': 'x'}

    async def _noop(*a, **k):
        return None

    EL.send_email = cap
    EL.get_event_pool = lambda: _FakePool()
    EL._emit_action_event = _noop
    EL._log_rule_execution = _noop


def _handle(payload):
    sends = []
    _install(sends)
    asyncio.run(EL._handle_notification_requested({'id': 'evt1', 'payload': payload}))
    return sends


def test_admin_role_nudge_routes_to_admin_email():
    s = _handle({'channel': 'email', 'template': 'task_nudge', 'to_role': 'rfp_admin',
                 'title': 'Curate portal', 'login_url': 'https://x/go?task=1'})
    assert len(s) == 1 and s[0]['to'] == ADMIN and 'Curate portal' in s[0]['html']


def test_master_admin_role_routes_to_admin_email():
    s = _handle({'channel': 'email', 'template': 'task_nudge', 'to_role': 'master_admin',
                 'title': 'X', 'login_url': 'u'})
    assert len(s) == 1 and s[0]['to'] == ADMIN


def test_nudge_sends_as_automation_voice():
    s = _handle({'channel': 'email', 'template': 'task_nudge', 'to_role': 'rfp_admin',
                 'senderNamespace': 'system', 'title': 'X', 'login_url': 'u'})
    assert len(s) == 1 and s[0]['sender'] == 'automation@rfppipeline.com'


def test_non_admin_role_does_not_leak_send():
    s = _handle({'channel': 'email', 'template': 'task_nudge', 'to_role': 'tenant_admin', 'title': 'X'})
    assert len(s) == 0


def test_user_id_recipient_resolves():
    s = _handle({'channel': 'email', 'template': 'task_nudge', 'user_id': 'u1',
                 'title': 'X', 'login_url': 'u'})
    assert len(s) == 1 and s[0]['to'] == 'user@acme.test'


def test_render_failure_falls_back_to_admin():
    s = _handle({'channel': 'email', 'template': 'definitely_missing_tmpl', 'to_role': 'rfp_admin', 'title': 'X'})
    assert len(s) == 1 and s[0]['to'] == ADMIN and 'render failed' in s[0]['subject'].lower()


def test_non_email_channel_skipped():
    s = _handle({'channel': 'sms', 'template': 'task_nudge', 'to_role': 'rfp_admin'})
    assert len(s) == 0


def test_task_nudge_escapes_html_in_title():
    h = render_template('task_nudge', {'title': "<script>alert('x')</script>", 'login_url': 'u'})
    assert h and '<script>' not in h and '&lt;script&gt;' in h


def test_task_nudge_missing_vars_uses_defaults():
    h = render_template('task_nudge', {})
    assert h and 'Your task' in h
