"""C3 follow-on — multi-tenant notification fan-out (spotlight "new priority
opportunity" digest).

A NOTIFY step passes tenant_ids (plural); _handle_multi_tenant_notification fans
the digest out to each tenant, gating each on notify_on_new_priority_opp and
de-duplicating per (event, tenant). All DB / email calls mocked.
"""
from unittest.mock import AsyncMock, patch


def _patches(*, sends, pref_allows=None, dedup=None, resolve=None):
    """Common patch set for _handle_multi_tenant_notification."""
    async def fake_send(to, subject, html, sender=None):
        sends.append(to)
        return {'provider': 'gmail', 'message_id': 'm'}

    async def default_resolve(to_field, p, ev):
        return f"{p['tenantId']}@x.com"

    return [
        patch('src.event_listener.get_event_pool', return_value=AsyncMock()),
        patch('src.event_listener.render_template', return_value='<html>digest</html>'),
        patch('src.event_listener.send_email', side_effect=fake_send),
        patch('src.event_listener.resolve_sender', return_value='sender@rfppipeline.com'),
        patch('src.event_listener._automation_pref_allows',
              side_effect=(pref_allows or AsyncMock(return_value=True))),
        patch('src.event_listener._check_dedup',
              side_effect=(dedup or AsyncMock(return_value=False))),
        patch('src.event_listener._resolve_recipient_email',
              side_effect=(resolve or default_resolve)),
        patch('src.event_listener._log_rule_execution', new=AsyncMock()),
    ]


_EVENT = {'id': '11111111-1111-4111-8111-111111111111'}


async def _run(payload, sends, **kw):
    from src.event_listener import _handle_multi_tenant_notification
    ctx = _patches(sends=sends, **kw)
    for p in ctx:
        p.start()
    try:
        await _handle_multi_tenant_notification(_EVENT, payload, payload['template'])
    finally:
        for p in ctx:
            p.stop()


class TestMultiTenantNotification:
    async def test_fans_out_to_each_tenant(self):
        sends = []
        await _run(
            {'template': 'spotlight_new_topics', 'tenant_ids': ['t1', 't2', 't3'],
             'trigger_event_id': _EVENT['id']},
            sends,
        )
        assert sends == ['t1@x.com', 't2@x.com', 't3@x.com']

    async def test_gates_each_tenant_on_pref(self):
        sends = []

        async def pref_allows(config, p):
            return p.get('tenantId') != 't2'  # t2 opted out of notify_on_new_priority_opp

        await _run(
            {'template': 'spotlight_new_topics', 'tenant_ids': ['t1', 't2', 't3'],
             'tenant_pref': 'notify_on_new_priority_opp', 'trigger_event_id': _EVENT['id']},
            sends, pref_allows=pref_allows,
        )
        assert sends == ['t1@x.com', 't3@x.com']  # t2 suppressed

    async def test_dedup_skips_already_sent_tenant(self):
        sends = []

        async def dedup(conn, teid, action):
            return action == 'send_email:t1'  # t1 already delivered for this event

        await _run(
            {'template': 'spotlight_new_topics', 'tenant_ids': ['t1', 't2'],
             'trigger_event_id': _EVENT['id']},
            sends, dedup=dedup,
        )
        assert sends == ['t2@x.com']

    async def test_skips_tenant_without_resolvable_email(self):
        sends = []

        async def resolve(to_field, p, ev):
            return None if p['tenantId'] == 't2' else f"{p['tenantId']}@x.com"

        await _run(
            {'template': 'spotlight_new_topics', 'tenant_ids': ['t1', 't2'],
             'trigger_event_id': _EVENT['id']},
            sends, resolve=resolve,
        )
        assert sends == ['t1@x.com']

    async def test_no_pref_sends_to_all(self):
        sends = []
        await _run(
            {'template': 'spotlight_new_topics', 'tenant_ids': ['t1', 't2']},  # no tenant_pref
            sends,
        )
        assert sends == ['t1@x.com', 't2@x.com']

    async def test_failed_send_is_not_dedup_logged(self):
        # A transient send failure must NOT write a dedup row, else the tenant is
        # suppressed forever on the next poll. send_email returns {error}, not raises.
        from src.event_listener import _handle_multi_tenant_notification
        log_mock = AsyncMock()

        async def failing_send(to, subject, html, sender=None):
            return {'provider': 'gmail', 'error': 'rate limited'}

        with patch('src.event_listener.get_event_pool', return_value=AsyncMock()), \
             patch('src.event_listener.render_template', return_value='<html>digest</html>'), \
             patch('src.event_listener.send_email', side_effect=failing_send), \
             patch('src.event_listener.resolve_sender', return_value='sender@x'), \
             patch('src.event_listener._automation_pref_allows', new=AsyncMock(return_value=True)), \
             patch('src.event_listener._check_dedup', new=AsyncMock(return_value=False)), \
             patch('src.event_listener._resolve_recipient_email', new=AsyncMock(return_value='t1@x.com')), \
             patch('src.event_listener._log_rule_execution', new=log_mock):
            await _handle_multi_tenant_notification(
                _EVENT,
                {'template': 'spotlight_new_topics', 'tenant_ids': ['t1'], 'trigger_event_id': _EVENT['id']},
                'spotlight_new_topics',
            )
        log_mock.assert_not_called()  # no dedup row written → retried next poll


class TestNotificationRequestedRouting:
    async def test_tenant_ids_list_routes_to_multi_tenant(self):
        from src.event_listener import _handle_notification_requested
        with patch('src.event_listener.get_event_pool', return_value=AsyncMock()), \
             patch('src.event_listener._handle_multi_tenant_notification', new=AsyncMock()) as h:
            await _handle_notification_requested({
                'id': 'e1',
                'payload': {'channel': 'email', 'template': 'spotlight_new_topics', 'tenant_ids': ['t1', 't2']},
            })
        h.assert_awaited_once()

    async def test_single_tenant_does_not_route_to_multi_tenant(self):
        from src.event_listener import _handle_notification_requested
        with patch('src.event_listener.get_event_pool', return_value=AsyncMock()), \
             patch('src.event_listener._handle_multi_tenant_notification', new=AsyncMock()) as h, \
             patch('src.event_listener._resolve_recipient_email', new=AsyncMock(return_value=None)), \
             patch('src.event_listener.render_template', return_value='<html>x</html>'), \
             patch('src.event_listener.send_email', new=AsyncMock(return_value={'message_id': 'm'})):
            await _handle_notification_requested({
                'id': 'e1',
                'payload': {'channel': 'email', 'template': 'spotlight_new_topics', 'tenant_id': 't1'},
            })
        h.assert_not_called()
