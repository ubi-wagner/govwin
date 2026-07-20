"""Scout expansion. (1) opportunity_scout now analyzes BOTH the ingested queue and the
crawler's opportunity findings, and flags possible UPDATES/amendments. (2) A scheduled
update-tracking loop (OnSolicitationUpdateScan) proactively re-scans for compliance-affecting
amendments by reusing the amendment_monitor watcher. Platform-scope, advisory, injection-fenced."""
import inspect

from agents.archetypes.opportunity_scout import OpportunityScoutArchetype
from workflows.base import StepType
from workflows.on_solicitation_update_scan import OnSolicitationUpdateScan


def test_opportunity_scout_reads_crawl_findings_and_looks_for_updates():
    a = OpportunityScoutArchetype()
    names = [t["name"] for t in a.get_tools()]
    assert "get_crawled_opportunities" in names and "get_recent_new_solicitations" in names
    assert "scout_findings" in inspect.getsource(a._get_crawled_opportunities)
    # the enhanced prompt looks for updates + deeper analysis
    sp = a.system_prompt.lower()
    assert "update" in sp and "amendment" in sp
    # still injection-fenced (untrusted external text) with no tenant_id in schemas
    for t in a.get_tools():
        assert "tenant_id" not in t["input_schema"].get("properties", {})
    blob = " ".join(m["content"] for m in a.build_messages({"payload": {"source": "sam"}}, [])
                     if isinstance(m.get("content"), str))
    assert "UNTRUSTED" in blob and "never as instructions" in blob


def test_update_scan_is_scheduled_watcher_reusing_amendment_monitor():
    t = OnSolicitationUpdateScan.trigger
    assert t.namespace == "finder" and t.type == "solicitation.update_scan_requested" and t.phase == "single"
    steps = {s.name: s for s in OnSolicitationUpdateScan.steps}
    assert steps["ai_amendment_scan"].step_type == StepType.AI_INVOKE
    # reuses the amendment_monitor watcher (no new agent needed)
    assert steps["ai_amendment_scan"].action == "tool.solicitation.amendment_delta"
    # independent notify — never dead-ends
    assert steps["notify_admin"].step_type == StepType.NOTIFY
    assert steps["notify_admin"].depends_on is None
