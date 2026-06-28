"""C3 Increment 3 — tenant automation-preference gating in the event_listener.

Proposal-lifecycle notification rules opt into a customer toggle via
action_config.tenant_pref. The listener consults tenant_automation_preferences
(shared DB, via the event pool) and skips the action when the tenant turned the
toggle off — with default-on safety (ungated rules, non-tenant events, unknown
prefs, missing rows, and lookup errors all proceed). All DB calls are mocked.
"""
from unittest.mock import AsyncMock, patch


def _event_pool(pref_value):
    """Fake shared/event pool whose fetchrow returns a one-column pref row.
    pref_value=None simulates a tenant with no tenant_automation_preferences row."""
    pool = AsyncMock()
    pool.fetchrow = AsyncMock(return_value=(None if pref_value is None else {'v': pref_value}))
    pool.execute = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    return pool


# ---------------------------------------------------------------------------
# _extract_tenant_pref
# ---------------------------------------------------------------------------

class TestExtractTenantPref:
    def test_dict_form(self):
        from src.event_listener import _extract_tenant_pref
        assert _extract_tenant_pref(
            {'template': 'x', 'tenant_pref': 'notify_on_stage_advanced'}
        ) == 'notify_on_stage_advanced'

    def test_list_form_first_match(self):
        from src.event_listener import _extract_tenant_pref
        assert _extract_tenant_pref(
            [{'type': 'send_email'}, {'tenant_pref': 'notify_collaborators_get_ready'}]
        ) == 'notify_collaborators_get_ready'

    def test_none_when_absent(self):
        from src.event_listener import _extract_tenant_pref
        assert _extract_tenant_pref({'template': 'x'}) is None
        assert _extract_tenant_pref([{'type': 'send_email'}]) is None
        assert _extract_tenant_pref('not-a-config') is None


# ---------------------------------------------------------------------------
# _automation_pref_allows
# ---------------------------------------------------------------------------

class TestAutomationPrefAllows:
    async def test_ungated_rule_allows_without_lookup(self):
        from src.event_listener import _automation_pref_allows
        pool = _event_pool(False)
        with patch('src.event_listener.get_event_pool', return_value=pool):
            assert await _automation_pref_allows({'template': 'x'}, {'tenantId': 't1'}) is True
        pool.fetchrow.assert_not_called()

    async def test_unknown_pref_allows_without_lookup(self):
        from src.event_listener import _automation_pref_allows
        pool = _event_pool(False)
        with patch('src.event_listener.get_event_pool', return_value=pool):
            assert await _automation_pref_allows(
                {'tenant_pref': 'drop_table_students'}, {'tenantId': 't1'}
            ) is True
        pool.fetchrow.assert_not_called()  # never reaches SQL — allowlist guard

    async def test_no_tenant_in_payload_allows(self):
        from src.event_listener import _automation_pref_allows
        pool = _event_pool(False)
        with patch('src.event_listener.get_event_pool', return_value=pool):
            assert await _automation_pref_allows(
                {'tenant_pref': 'notify_on_stage_advanced'}, {}
            ) is True
        pool.fetchrow.assert_not_called()

    async def test_pref_on_allows(self):
        from src.event_listener import _automation_pref_allows
        pool = _event_pool(True)
        with patch('src.event_listener.get_event_pool', return_value=pool):
            assert await _automation_pref_allows(
                {'tenant_pref': 'notify_team_on_document_locked'}, {'tenantId': 't1'}
            ) is True

    async def test_pref_off_suppresses(self):
        from src.event_listener import _automation_pref_allows
        pool = _event_pool(False)
        with patch('src.event_listener.get_event_pool', return_value=pool):
            assert await _automation_pref_allows(
                {'tenant_pref': 'notify_team_on_document_locked'}, {'tenantId': 't1'}
            ) is False

    async def test_no_row_uses_default_on(self):
        from src.event_listener import _automation_pref_allows
        pool = _event_pool(None)  # tenant has no preferences row yet
        with patch('src.event_listener.get_event_pool', return_value=pool):
            assert await _automation_pref_allows(
                {'tenant_pref': 'notify_collaborators_get_ready'}, {'tenantId': 't1'}
            ) is True

    async def test_lookup_error_allows(self):
        from src.event_listener import _automation_pref_allows
        pool = AsyncMock()
        pool.fetchrow = AsyncMock(side_effect=Exception('relation does not exist'))
        with patch('src.event_listener.get_event_pool', return_value=pool):
            assert await _automation_pref_allows(
                {'tenant_pref': 'notify_on_stage_advanced'}, {'tenantId': 't1'}
            ) is True


# ---------------------------------------------------------------------------
# _execute_rule — gate short-circuits dispatch + tenant_id column injection
# ---------------------------------------------------------------------------

_RULE = {
    'id': 'rule-1',
    'name': 'Proposal document locked — notify team',
    'action_type': 'send_email',
    'action_config': {
        'template': 'document_locked_team_notify',
        'to_field': 'payload.tenantId',
        'tenant_pref': 'notify_team_on_document_locked',
    },
}
_COLS = {'trigger_namespace', 'trigger_type', 'action_type', 'action_config'}


def _doc_locked_event():
    # tenant scope lives ONLY on the system_events.tenant_id column (emitters do
    # not copy it into the payload) — the listener must surface it.
    return {
        'id': 'evt-1', 'namespace': 'proposal', 'type': 'document.locked',
        'phase': 'single', 'payload': {'proposalId': 'p1'}, 'tenant_id': 'tenant-xyz',
    }


class TestExecuteRuleGate:
    async def test_pref_off_skips_action_and_reads_tenant_from_column(self):
        from src.event_listener import _execute_rule
        pool = _event_pool(False)
        with patch('src.event_listener.get_event_pool', return_value=pool), \
             patch('src.event_listener._do_action', new=AsyncMock()) as do_action:
            await _execute_rule(_RULE, _COLS, _doc_locked_event())
        do_action.assert_not_called()  # suppressed before dispatch
        pool.fetchrow.assert_awaited_once()
        # the gate resolved tenant scope from the event's tenant_id column
        assert pool.fetchrow.call_args[0][1] == 'tenant-xyz'

    async def test_pref_on_dispatches_action(self):
        from src.event_listener import _execute_rule
        pool = _event_pool(True)
        with patch('src.event_listener.get_event_pool', return_value=pool), \
             patch('src.event_listener._do_action', new=AsyncMock()) as do_action, \
             patch('src.event_listener._check_dedup', new=AsyncMock(return_value=False)):
            await _execute_rule(_RULE, _COLS, _doc_locked_event())
        do_action.assert_awaited_once()
