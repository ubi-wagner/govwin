"""CMS-03 — Event listener action handler tests.

Tests the three action handlers directly:
  - _action_send_email  (via _do_action_inner)
  - _action_notify_admin (via _do_action_inner)
  - _action_create_todo

All DB calls are mocked (fake AsyncMock pool).
All email sends are mocked (fake send_email).
No live Gmail, no live DB.
"""
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch, call


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

def _make_event(ns='capture', etype='lead.submitted', event_id='evt-001', phase='single'):
    return {
        'id': event_id,
        'namespace': ns,
        'type': etype,
        'phase': phase,
        'payload': json.dumps({'contactEmail': 'customer@example.com', 'tenantId': 'tenant-1'}),
    }


def _make_cms_pool():
    pool = AsyncMock()
    pool.fetchrow = AsyncMock(return_value=None)
    pool.fetch = AsyncMock(return_value=[])
    pool.execute = AsyncMock()
    return pool


def _make_shared_pool():
    pool = AsyncMock()
    pool.fetchrow = AsyncMock(return_value=None)
    pool.fetch = AsyncMock(return_value=[])
    pool.execute = AsyncMock()
    return pool


# ---------------------------------------------------------------------------
# _action_create_todo
# ---------------------------------------------------------------------------

class TestActionCreateTodo:
    @pytest.mark.asyncio
    async def test_creates_todo_with_correct_fields(self):
        """_action_create_todo inserts a row into admin_todos with the right values."""
        from src.event_listener import _action_create_todo

        cms_pool = _make_cms_pool()
        event = _make_event()
        config = {
            'title_template': 'New lead: {contactEmail}',
            'todo_type': 'lead_review',
            'priority': 'high',
        }
        payload = {'contactEmail': 'customer@example.com'}

        with patch('src.event_listener._get_cms_pool', return_value=cms_pool), \
             patch('src.models.database.get_pool', return_value=cms_pool):
            await _action_create_todo(config, payload, event)

        assert cms_pool.execute.called
        call_args = cms_pool.execute.call_args[0]
        sql = call_args[0]
        assert 'admin_todos' in sql
        # Title should have the email interpolated
        title_arg = call_args[1]
        assert 'customer@example.com' in title_arg

    @pytest.mark.asyncio
    async def test_creates_todo_title_from_template(self):
        """Title is formatted from payload via title_template."""
        from src.event_listener import _action_create_todo

        cms_pool = _make_cms_pool()
        event = {'id': 'evt-1', 'namespace': 'capture', 'type': 'lead.submitted'}
        config = {'title_template': 'Review lead from {company}'}
        payload = {'company': 'Acme Corp'}

        with patch('src.models.database.get_pool', return_value=cms_pool):
            await _action_create_todo(config, payload, event)

        call_args = cms_pool.execute.call_args[0]
        assert call_args[1] == 'Review lead from Acme Corp'

    @pytest.mark.asyncio
    async def test_creates_todo_default_title_on_missing_key(self):
        """If payload keys are missing for format(), uses the raw template string."""
        from src.event_listener import _action_create_todo

        cms_pool = _make_cms_pool()
        event = {'id': 'evt-1', 'namespace': 'capture', 'type': 'lead.submitted'}
        config = {'title_template': 'Hello {missing_key}'}
        payload = {}

        with patch('src.models.database.get_pool', return_value=cms_pool):
            await _action_create_todo(config, payload, event)

        call_args = cms_pool.execute.call_args[0]
        # Falls back to the unformatted template
        assert call_args[1] == 'Hello {missing_key}'

    @pytest.mark.asyncio
    async def test_creates_todo_uses_default_todo_type_and_priority(self):
        """If config omits todo_type/priority, defaults are 'general' and 'medium'."""
        from src.event_listener import _action_create_todo

        cms_pool = _make_cms_pool()
        event = {'id': 'evt-1', 'namespace': 'capture', 'type': 'lead.submitted'}
        config = {}
        payload = {}

        with patch('src.models.database.get_pool', return_value=cms_pool):
            await _action_create_todo(config, payload, event)

        call_args = cms_pool.execute.call_args[0]
        todo_type_arg = call_args[2]
        priority_arg = call_args[3]
        assert todo_type_arg == 'general'
        assert priority_arg == 'medium'

    @pytest.mark.asyncio
    async def test_create_todo_cms_pool_unavailable_logs_warning_no_raise(self):
        """If get_pool raises RuntimeError, _action_create_todo logs a warning and returns."""
        from src.event_listener import _action_create_todo

        event = {'id': 'evt-1', 'namespace': 'capture', 'type': 'lead.submitted'}
        config = {}
        payload = {}

        with patch('src.models.database.get_pool', side_effect=RuntimeError('no pool')):
            # Must not raise
            await _action_create_todo(config, payload, event)


# ---------------------------------------------------------------------------
# _action_notify_admin (via _do_action_inner with action_type='notify_admin')
# ---------------------------------------------------------------------------

class TestActionNotifyAdmin:
    @pytest.mark.asyncio
    async def test_notify_admin_sends_email_to_admin_address(self):
        """notify_admin calls send_email with the ADMIN_EMAIL address."""
        from src.event_listener import _do_action_inner

        event = _make_event()
        config = {
            'to': 'custom-admin@rfppipeline.com',
            'template': 'admin_notification',
            'subject': 'Lead Review Required',
        }
        payload = {'contactEmail': 'customer@example.com', 'event_type': 'lead.submitted'}

        fake_html = '<p>Admin notification</p>'
        mock_send = AsyncMock(return_value={'provider': 'gmail', 'message_id': 'msg-1'})

        with patch('src.event_listener.render_template', return_value=fake_html), \
             patch('src.event_listener.send_email', mock_send):

            await _do_action_inner('notify_admin', config, payload, event)

        assert mock_send.called
        call_kwargs = mock_send.call_args
        # Recipient should be the configured 'to' address
        to_arg = call_kwargs[1].get('to') or call_kwargs[0][0]
        assert 'rfppipeline.com' in to_arg

    @pytest.mark.asyncio
    async def test_notify_admin_falls_back_to_admin_notification_template(self):
        """If specified template renders None, notify_admin falls back to 'admin_notification'."""
        from src.event_listener import _do_action_inner

        event = _make_event()
        config = {
            'to': 'admin@rfppipeline.com',
            'template': 'nonexistent_template',
        }
        payload = {}

        mock_send = AsyncMock(return_value={'provider': 'gmail', 'message_id': 'msg-1'})

        def fake_render(template_name, ctx):
            if template_name == 'admin_notification':
                return '<p>Generic admin notification</p>'
            return None  # primary template not found

        with patch('src.event_listener.render_template', side_effect=fake_render), \
             patch('src.event_listener.send_email', mock_send):

            await _do_action_inner('notify_admin', config, payload, event)

        assert mock_send.called

    @pytest.mark.asyncio
    async def test_notify_admin_no_template_rendered_no_email_sent(self):
        """If both primary and fallback templates return None, no email is sent."""
        from src.event_listener import _do_action_inner

        event = _make_event()
        config = {'to': 'admin@rfppipeline.com', 'template': 'missing_template'}
        payload = {}

        mock_send = AsyncMock()

        with patch('src.event_listener.render_template', return_value=None), \
             patch('src.event_listener.send_email', mock_send):

            await _do_action_inner('notify_admin', config, payload, event)

        assert not mock_send.called

    @pytest.mark.asyncio
    async def test_notify_admin_uses_env_admin_email_when_no_to(self):
        """If config has no 'to', notify_admin uses the ADMIN_EMAIL env var."""
        import src.event_listener as el
        from src.event_listener import _do_action_inner

        event = _make_event()
        config = {'template': 'admin_notification'}
        payload = {}
        fake_html = '<p>Notification</p>'

        mock_send = AsyncMock(return_value={'provider': 'gmail', 'message_id': 'msg-1'})

        with patch('src.event_listener.render_template', return_value=fake_html), \
             patch('src.event_listener.send_email', mock_send):

            await _do_action_inner('notify_admin', config, payload, event)

        assert mock_send.called
        call_kwargs = mock_send.call_args
        to_arg = call_kwargs[1].get('to') or call_kwargs[0][0]
        # Should be the module-level ADMIN_EMAIL
        assert to_arg == el.ADMIN_EMAIL


# ---------------------------------------------------------------------------
# _action_send_email (via _do_action_inner with action_type='send_email')
# ---------------------------------------------------------------------------

class TestActionSendEmail:
    @pytest.mark.asyncio
    async def test_send_email_renders_template_and_dispatches(self):
        """send_email action renders the template and calls send_email."""
        from src.event_listener import _do_action_inner

        event = _make_event()
        config = {
            'template': 'lead-initial-outreach',
            'subject': 'Hello!',
            'to': 'customer@example.com',
        }
        payload = {'contactEmail': 'customer@example.com', 'company_name': 'Acme'}

        fake_html = '<p>Dear Acme, ...</p>'
        mock_send = AsyncMock(return_value={'provider': 'gmail', 'message_id': 'msg-123'})
        mock_cms_pool = _make_cms_pool()  # for trigger metadata lookup

        with patch('src.event_listener.render_template', return_value=fake_html), \
             patch('src.event_listener.send_email', mock_send), \
             patch('src.event_listener._get_cms_pool', return_value=mock_cms_pool), \
             patch('src.event_listener._resolve_recipient_email', new_callable=AsyncMock, return_value=None):

            await _do_action_inner('send_email', config, payload, event)

        assert mock_send.called
        call_kwargs = mock_send.call_args[1]
        assert call_kwargs.get('to') == 'customer@example.com'
        assert call_kwargs.get('html') == fake_html

    @pytest.mark.asyncio
    async def test_send_email_resolves_recipient_via_to_field(self):
        """If config has 'to_field', recipient is resolved via _resolve_recipient_email."""
        from src.event_listener import _do_action_inner

        event = _make_event()
        config = {
            'template': 'welcome_email',
            'to_field': 'payload.contactEmail',
        }
        payload = {'contactEmail': 'dynamic@example.com'}

        fake_html = '<p>Welcome!</p>'
        mock_send = AsyncMock(return_value={'provider': 'gmail', 'message_id': 'msg-456'})
        mock_cms_pool = _make_cms_pool()

        with patch('src.event_listener.render_template', return_value=fake_html), \
             patch('src.event_listener.send_email', mock_send), \
             patch('src.event_listener._get_cms_pool', return_value=mock_cms_pool), \
             patch('src.event_listener._resolve_recipient_email',
                   new_callable=AsyncMock,
                   return_value='dynamic@example.com'):

            await _do_action_inner('send_email', config, payload, event)

        assert mock_send.called
        to_arg = mock_send.call_args[1].get('to')
        assert to_arg == 'dynamic@example.com'

    @pytest.mark.asyncio
    async def test_send_email_no_template_renders_skips_send(self):
        """If render_template returns None/empty, the email is skipped (no send call)."""
        from src.event_listener import _do_action_inner

        event = _make_event()
        config = {'template': 'nonexistent_template', 'to': 'a@b.com'}
        payload = {}

        mock_send = AsyncMock()
        mock_cms_pool = _make_cms_pool()

        with patch('src.event_listener.render_template', return_value=None), \
             patch('src.event_listener.send_email', mock_send), \
             patch('src.event_listener._get_cms_pool', return_value=mock_cms_pool):

            await _do_action_inner('send_email', config, payload, event)

        assert not mock_send.called

    @pytest.mark.asyncio
    async def test_send_email_no_recipient_skips_send(self):
        """If no recipient can be resolved, the email is skipped."""
        from src.event_listener import _do_action_inner

        event = _make_event()
        config = {'template': 'some_template'}  # no 'to', no 'to_field'
        payload = {}  # no contactEmail

        fake_html = '<p>Hello</p>'
        mock_send = AsyncMock()
        mock_cms_pool = _make_cms_pool()

        with patch('src.event_listener.render_template', return_value=fake_html), \
             patch('src.event_listener.send_email', mock_send), \
             patch('src.event_listener._get_cms_pool', return_value=mock_cms_pool), \
             patch('src.event_listener._resolve_recipient_email',
                   new_callable=AsyncMock, return_value=None):

            await _do_action_inner('send_email', config, payload, event)

        assert not mock_send.called

    @pytest.mark.asyncio
    async def test_send_email_falls_back_to_payload_contact_email(self):
        """If to_field resolution fails, falls back to payload.contactEmail."""
        from src.event_listener import _do_action_inner

        event = _make_event()
        config = {'template': 'welcome_email', 'to_field': 'result.user_id'}
        payload = {'contactEmail': 'fallback@example.com'}

        fake_html = '<p>Hi!</p>'
        mock_send = AsyncMock(return_value={'provider': 'gmail', 'message_id': 'msg-789'})
        mock_cms_pool = _make_cms_pool()

        with patch('src.event_listener.render_template', return_value=fake_html), \
             patch('src.event_listener.send_email', mock_send), \
             patch('src.event_listener._get_cms_pool', return_value=mock_cms_pool), \
             patch('src.event_listener._resolve_recipient_email',
                   new_callable=AsyncMock,
                   return_value=None):  # to_field resolution fails

            await _do_action_inner('send_email', config, payload, event)

        assert mock_send.called
        to_arg = mock_send.call_args[1].get('to')
        assert to_arg == 'fallback@example.com'


# ---------------------------------------------------------------------------
# _do_action wrapper — confirms start/end events are emitted
# ---------------------------------------------------------------------------

class TestDoActionEventWrapper:
    @pytest.mark.asyncio
    async def test_do_action_emits_start_and_end_events(self):
        """_do_action emits both start and end action events via _emit_action_event."""
        from src.event_listener import _do_action

        event = _make_event()
        config = {}
        payload = {}

        emitted = []

        async def fake_emit(*, event_type, phase, payload, parent_event_id=None):
            emitted.append({'event_type': event_type, 'phase': phase})
            return 'fake-event-id'

        with patch('src.event_listener._emit_action_event', side_effect=fake_emit), \
             patch('src.event_listener._do_action_inner', new_callable=AsyncMock):

            await _do_action('create_todo', config, payload, event)

        phases = [e['phase'] for e in emitted]
        assert 'start' in phases
        assert 'end' in phases

    @pytest.mark.asyncio
    async def test_do_action_emits_end_with_failed_status_on_exception(self):
        """If _do_action_inner raises, _do_action emits end event with status='failed'."""
        from src.event_listener import _do_action

        event = _make_event()
        config = {}
        payload = {}

        emitted = []

        async def fake_emit(*, event_type, phase, payload, parent_event_id=None):
            emitted.append({'event_type': event_type, 'phase': phase, 'payload': payload})
            return 'fake-event-id'

        async def exploding_inner(action_type, config, payload, event):
            raise RuntimeError('inner failure')

        with patch('src.event_listener._emit_action_event', side_effect=fake_emit), \
             patch('src.event_listener._do_action_inner', side_effect=exploding_inner):

            with pytest.raises(RuntimeError, match='inner failure'):
                await _do_action('create_todo', config, payload, event)

        end_events = [e for e in emitted if e['phase'] == 'end']
        assert len(end_events) == 1
        assert end_events[0]['payload']['status'] == 'failed'


# ---------------------------------------------------------------------------
# Integration: _action_send_email stores trigger metadata on email_send record
# ---------------------------------------------------------------------------

class TestSendEmailTriggerMetadata:
    @pytest.mark.asyncio
    async def test_trigger_metadata_stored_when_message_id_returned(self):
        """If send_email returns a message_id and the template has trigger_config,
        the trigger_metadata is stored on the email_send record."""
        from src.event_listener import _do_action_inner

        event = _make_event()
        config = {
            'template': 'lead-initial-outreach',
            'to': 'customer@example.com',
        }
        payload = {'contactEmail': 'customer@example.com'}

        fake_html = '<p>Outreach</p>'
        send_id = 'send-row-id'
        mock_send = AsyncMock(return_value={'provider': 'gmail', 'message_id': 'msg-999'})

        mock_cms_pool = _make_cms_pool()
        # fetchrow returns the DB template with trigger_config
        mock_cms_pool.fetchrow = AsyncMock(side_effect=[
            # First call: lookup DB template by slug
            {
                'id': 'tmpl-1',
                'slug': 'lead-initial-outreach',
                'trigger_config': json.dumps({
                    'namespace': 'capture', 'type': 'lead.outreach',
                    'auto_response_enabled': True,
                    'expected_responses': ['interest'],
                }),
                'response_map': json.dumps({}),
                'profile_variables': None,
                'template_category': 'outreach',
            },
            # Second call: lookup email_send by gmail_message_id
            {'id': send_id},
        ])

        with patch('src.event_listener.render_template', return_value=fake_html), \
             patch('src.event_listener.send_email', mock_send), \
             patch('src.event_listener._get_cms_pool', return_value=mock_cms_pool), \
             patch('src.event_listener._resolve_recipient_email',
                   new_callable=AsyncMock, return_value=None):

            await _do_action_inner('send_email', config, payload, event)

        # execute should have been called to update trigger_metadata
        execute_calls_str = str(mock_cms_pool.execute.call_args_list)
        assert 'trigger_metadata' in execute_calls_str
