"""C3 Increment 3 → #190 dual-read — tenant automation-preference gating.

_automation_pref_allows() checks (in order):
  1. tenant_automation_policies  (new table; fetchrow call 1)
  2. tenant_automation_preferences (legacy fallback; fetchrow call 2)
  3. _PREF_DEFAULTS if neither row exists

Default-on safety: ungated rules, non-tenant events, unknown prefs, missing rows,
and lookup errors all proceed. All DB calls are mocked.
"""
from unittest.mock import AsyncMock, patch


def _policy_pool(policy_enabled=None, legacy_pref=None):
    """Fake pool for the dual-read path (#190).

    policy_enabled:
        None      → no tenant_automation_policies row (first fetchrow → None)
        True/False → policy row found; returns {'enabled': value}
    legacy_pref:
        None      → no tenant_automation_preferences row (second fetchrow → None)
        True/False → legacy row found; returns all 6 boolean columns set to value.

    Call order: fetchrow call 1 = new-table (policy), call 2 = legacy-table (pref).
    The legacy mock must use actual column names because production code does
    row[pref] where pref is e.g. 'notify_team_on_document_locked', not 'v'.
    """
    call_1 = None if policy_enabled is None else {'enabled': policy_enabled}
    call_2 = None if legacy_pref is None else {
        'notify_team_on_document_locked': legacy_pref,
        'notify_collaborators_get_ready': legacy_pref,
        'notify_on_stage_advanced': legacy_pref,
        'notify_on_new_priority_opp': legacy_pref,
        'ai_review_on_advance': legacy_pref,
        'auto_advance_when_all_locked': legacy_pref,
    }
    pool = AsyncMock()
    pool.fetchrow = AsyncMock(side_effect=[call_1, call_2])
    pool.execute = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    return pool


def _event_pool(pref_value):
    """Backward-compat helper: no policy row (falls through to legacy pref).
    pref_value=None simulates a tenant with no tenant_automation_preferences row."""
    return _policy_pool(policy_enabled=None, legacy_pref=pref_value)


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
        # dual-read: up to 2 fetchrow calls (new table → None, legacy → False)
        assert pool.fetchrow.await_count >= 1
        # tenant scope resolved from the event's tenant_id column (both calls use it)
        assert any(
            call.args[1] == 'tenant-xyz'
            for call in pool.fetchrow.await_args_list
        )

    async def test_pref_on_dispatches_action(self):
        from src.event_listener import _execute_rule
        pool = _event_pool(True)
        with patch('src.event_listener.get_event_pool', return_value=pool), \
             patch('src.event_listener._do_action', new=AsyncMock()) as do_action, \
             patch('src.event_listener._check_dedup', new=AsyncMock(return_value=False)):
            await _execute_rule(_RULE, _COLS, _doc_locked_event())
        do_action.assert_awaited_once()


# ---------------------------------------------------------------------------
# Dual-read (#190) — tenant_automation_policies takes precedence over legacy table
# ---------------------------------------------------------------------------

class TestDualReadPrecedence:
    async def test_policy_row_enabled_true_allows(self):
        """Policy row enabled=True wins; legacy table not consulted."""
        from src.event_listener import _automation_pref_allows
        pool = _policy_pool(policy_enabled=True, legacy_pref=None)
        with patch('src.event_listener.get_event_pool', return_value=pool):
            result = await _automation_pref_allows(
                {'tenant_pref': 'notify_team_on_document_locked'}, {'tenantId': 't1'}
            )
        assert result is True
        # Only one fetchrow call needed (policy row found)
        assert pool.fetchrow.await_count == 1

    async def test_policy_row_enabled_false_suppresses(self):
        """Policy row enabled=False suppresses even if legacy pref is True."""
        from src.event_listener import _automation_pref_allows
        pool = _policy_pool(policy_enabled=False, legacy_pref=True)
        with patch('src.event_listener.get_event_pool', return_value=pool):
            result = await _automation_pref_allows(
                {'tenant_pref': 'notify_on_stage_advanced'}, {'tenantId': 't1'}
            )
        assert result is False
        assert pool.fetchrow.await_count == 1  # stopped at policy row

    async def test_no_policy_row_falls_back_to_legacy(self):
        """No policy row → falls through to legacy table."""
        from src.event_listener import _automation_pref_allows
        pool = _policy_pool(policy_enabled=None, legacy_pref=False)
        with patch('src.event_listener.get_event_pool', return_value=pool):
            result = await _automation_pref_allows(
                {'tenant_pref': 'notify_collaborators_get_ready'}, {'tenantId': 't1'}
            )
        assert result is False
        assert pool.fetchrow.await_count == 2  # both tables checked

    async def test_no_rows_anywhere_uses_default_on(self):
        """Neither table has a row → default_on applies."""
        from src.event_listener import _automation_pref_allows
        pool = _policy_pool(policy_enabled=None, legacy_pref=None)
        with patch('src.event_listener.get_event_pool', return_value=pool):
            result = await _automation_pref_allows(
                {'tenant_pref': 'notify_on_new_priority_opp'}, {'tenantId': 't1'}
            )
        assert result is True  # default-on

    async def test_policy_lookup_error_falls_back_to_legacy(self):
        """Policy lookup error → falls through to legacy table (never silently suppresses)."""
        from src.event_listener import _automation_pref_allows
        pool = AsyncMock()
        call_count = [0]
        async def _fetchrow(*args, **kwargs):
            call_count[0] += 1
            if call_count[0] == 1:
                raise Exception('policy table not found yet')
            # Return the actual column names — production code does row[pref], not row['v'].
            return {
                'notify_team_on_document_locked': True,
                'notify_collaborators_get_ready': True,
                'notify_on_stage_advanced': True,
                'notify_on_new_priority_opp': True,
                'ai_review_on_advance': True,
                'auto_advance_when_all_locked': True,
            }
        pool.fetchrow = _fetchrow
        pool.execute = AsyncMock()
        pool.fetch = AsyncMock(return_value=[])
        with patch('src.event_listener.get_event_pool', return_value=pool):
            result = await _automation_pref_allows(
                {'tenant_pref': 'notify_team_on_document_locked'}, {'tenantId': 't1'}
            )
        assert result is True  # legacy table returned True
