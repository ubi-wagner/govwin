"""C3 follow-on — collaborator "get ready" email fan-out.

The advance_ready rule sets recipients='collaborators'; the send_email handler
then emails every accepted collaborator on the proposal (falling back to the
tenant admin when there are none). All DB / email calls are mocked.
"""
from unittest.mock import AsyncMock, patch


# ---------------------------------------------------------------------------
# _resolve_collaborator_emails
# ---------------------------------------------------------------------------

class TestResolveCollaboratorEmails:
    async def test_queries_accepted_collaborators_scoped_to_tenant(self):
        from src.event_listener import _resolve_collaborator_emails
        pool = AsyncMock()
        pool.fetch = AsyncMock(return_value=[{'email': 'a@x.com'}, {'email': 'b@x.com'}])
        with patch('src.event_listener.get_event_pool', return_value=pool):
            emails = await _resolve_collaborator_emails('p1', 't1')
        assert emails == ['a@x.com', 'b@x.com']
        sql = pool.fetch.call_args[0][0]
        assert 'proposal_collaborators' in sql
        assert 'accepted_at IS NOT NULL' in sql  # active collaborators only
        assert 'p.tenant_id' in sql               # tenant-scoped

    async def test_empty_without_pool_or_ids(self):
        from src.event_listener import _resolve_collaborator_emails
        with patch('src.event_listener.get_event_pool', return_value=None):
            assert await _resolve_collaborator_emails('p1', 't1') == []
        pool = AsyncMock()
        with patch('src.event_listener.get_event_pool', return_value=pool):
            assert await _resolve_collaborator_emails(None, 't1') == []
            assert await _resolve_collaborator_emails('p1', None) == []

    async def test_swallows_query_error(self):
        from src.event_listener import _resolve_collaborator_emails
        pool = AsyncMock()
        pool.fetch = AsyncMock(side_effect=Exception('relation does not exist'))
        with patch('src.event_listener.get_event_pool', return_value=pool):
            assert await _resolve_collaborator_emails('p1', 't1') == []


# ---------------------------------------------------------------------------
# _do_action_inner send_email — collaborator fan-out
# ---------------------------------------------------------------------------

_CONFIG = {
    'template': 'collaborator_get_ready',
    'recipients': 'collaborators',
    'to_field': 'payload.tenantId',
    'subject': 'Your proposal is ready to advance',
}
_PAYLOAD = {'proposalId': 'p1', 'tenantId': 't1'}
_EVENT = {'id': 'e1'}


class TestSendEmailCollaboratorFanout:
    async def test_sends_to_each_collaborator_deduped(self):
        from src.event_listener import _do_action_inner
        sends = []

        async def fake_send(to, subject, html, sender=None):
            sends.append(to)
            return {'provider': 'gmail', 'message_id': 'm'}

        with patch('src.event_listener.render_template', return_value='<html>ready</html>'), \
             patch('src.event_listener.send_email', side_effect=fake_send), \
             patch('src.event_listener._resolve_collaborator_emails',
                   new=AsyncMock(return_value=['a@x.com', 'b@x.com', 'a@x.com'])):
            await _do_action_inner('send_email', _CONFIG, _PAYLOAD, _EVENT)
        assert sends == ['a@x.com', 'b@x.com']  # de-duped, both collaborators

    async def test_falls_back_to_to_field_when_no_collaborators(self):
        from src.event_listener import _do_action_inner
        sends = []

        async def fake_send(to, subject, html, sender=None):
            sends.append(to)
            return {'message_id': 'm'}

        with patch('src.event_listener.render_template', return_value='<html>ready</html>'), \
             patch('src.event_listener.send_email', side_effect=fake_send), \
             patch('src.event_listener._resolve_collaborator_emails', new=AsyncMock(return_value=[])), \
             patch('src.event_listener._resolve_recipient_email', new=AsyncMock(return_value='admin@acme.com')):
            await _do_action_inner('send_email', _CONFIG, _PAYLOAD, _EVENT)
        assert sends == ['admin@acme.com']  # tenant-admin fallback

    async def test_skips_when_no_recipients_at_all(self):
        from src.event_listener import _do_action_inner
        send_mock = AsyncMock()
        with patch('src.event_listener.render_template', return_value='<html>ready</html>'), \
             patch('src.event_listener.send_email', new=send_mock), \
             patch('src.event_listener._resolve_collaborator_emails', new=AsyncMock(return_value=[])), \
             patch('src.event_listener._resolve_recipient_email', new=AsyncMock(return_value=None)):
            await _do_action_inner('send_email', _CONFIG, _PAYLOAD, _EVENT)
        send_mock.assert_not_called()
