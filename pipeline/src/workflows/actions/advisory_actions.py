"""
================================================================================
Workflow Actions — Advisory / Adversarial overlay elevation + auto-land  (P4-D)
================================================================================

Two ACTION-step functions that connect the Proposal Draft Manager's Mode C to the
reusable AdvisoryOverlay, realizing the "adversarial-gate = overlay applied with
policy=auto" from ADVISORY_MANAGER_OVERLAY_DESIGN.md — WITHOUT weakening any invariant.

request_advisory_overlay — the ELEVATION seam. A single INDEPENDENT ACTION step at the
    tail of OnFullDraftRequestedModeC (before the human review_gate). It gates INTERNALLY
    on `adversarial`: the declarative engine can NOT be used to skip it conditionally,
    because the managed engine marks a false CONDITION step 'completed' (manager.py:
    step_result is not None → completed), so a CONDITION-gated dependent would still run.
    The gate therefore lives here in Python. When `adversarial` is set, it emits the
    proposal.advisory_overlay_requested start/end pair (the AdvisoryOverlay trigger) with
    the 6 overlay parameters in the payload: target advisor, per-lens directives, fan-out
    (bounded by the overlay), resolution rule, and the admin-selected policy (hitl|auto).
    Advisory-only: emits an event, writes NO business table, advances NO gate.

record_advisory_reconciliation — the AUTO-land. Terminal step of AdvisoryOverlayAuto
    (policy=auto). It records the reconciled adversarial verdict as an advisory audit
    event (proposal.advisory_overlay_reconciled) INSTEAD of parking a human review TODO —
    this is precisely how a per-tenant auto policy "takes HITL out": a landing choice, not
    a rewrite, and STILL no gate advance and no business-table write. The durable learning
    is advisory_manager's memory (written in the reconcile step); this event is the audit
    trail that the cohort cleared/flagged the draft under an auto policy.

Both honor the fabric invariants: advisory (no business-table write), never dead-ends a
workflow (safe no-op returns), never advances a stage/gate.

CHANGE LOG:
    P4-D -- Initial implementation (Proposal Draft Manager · adversarial-gate).
================================================================================
"""
import logging

logger = logging.getLogger("pipeline.workflows.actions.advisory")

# The AdvisoryOverlay trigger this action emits (must match advisory_overlay.py exactly:
# namespace 'proposal', type 'proposal.advisory_overlay_requested', phase 'end').
_OVERLAY_NAMESPACE = "proposal"
_OVERLAY_TYPE = "proposal.advisory_overlay_requested"

# The advisory-overlay audit event the auto-land records (nothing triggers on it — it is
# a terminal audit record).
_RECONCILED_TYPE = "proposal.advisory_overlay_reconciled"

# Default fan-out lenses (perspective-diverse) when the request omits them. Kept ≤ the
# overlay's OVERLAY_FANOUT_SLOTS (3); extra lenses beyond the slots are safe-skipped.
DEFAULT_LENSES = ["adversarial-skeptic", "compliance", "technical"]

# Default canonical fan-out target advisor + survival rule.
DEFAULT_TARGET = "continuity_manager"
DEFAULT_RESOLUTION = "majority"

_VALID_POLICIES = ("hitl", "auto")


async def request_advisory_overlay(
    conn,
    adversarial=None,
    proposal_id=None,
    tenant_id=None,
    opportunity_id=None,
    policy=None,
    resolution=None,
    target=None,
    lenses=None,
    **_ignored,
):
    """Elevate the Mode C gate cohort to the 1:n AdvisoryOverlay — but only when the
    admin requested the adversarial gate. Safe no-op otherwise (never dead-ends)."""
    # INTERNAL gate — see module docstring on why this is not a declarative CONDITION.
    if not adversarial or not proposal_id:
        return {"requested": False, "reason": "not_adversarial"}

    pol = policy if policy in _VALID_POLICIES else "hitl"
    res = resolution or DEFAULT_RESOLUTION
    tgt = target or DEFAULT_TARGET
    lens_list = lenses if (isinstance(lenses, list) and lenses) else DEFAULT_LENSES

    payload = {
        "proposal_id": proposal_id,
        "tenant_id": tenant_id,
        "opportunity_id": opportunity_id,
        "policy": pol,
        "resolution": res,
        "target": tgt,
    }
    # Per-lens directives the overlay reads as payload.lens_0 / lens_1 / lens_2.
    for i, lens in enumerate(lens_list[:3]):
        payload[f"lens_{i}"] = lens

    from events import emit_event  # noqa: PLC0415

    start_id = ""
    try:
        start_id = await emit_event(
            conn, namespace=_OVERLAY_NAMESPACE, type=_OVERLAY_TYPE, phase="start",
            tenant_id=tenant_id, payload=payload,
        )
    except Exception as exc:
        logger.error("request_advisory_overlay: start emit failed: %s", exc)

    try:
        await emit_event(
            conn, namespace=_OVERLAY_NAMESPACE, type=_OVERLAY_TYPE, phase="end",
            parent_event_id=start_id or None, tenant_id=tenant_id, payload=payload,
        )
    except Exception as exc:
        logger.error("request_advisory_overlay: end emit failed: %s", exc)
        return {"requested": False, "reason": f"emit_failed:{str(exc)[:200]}"}

    logger.info(
        "advisory overlay requested: proposal=%s policy=%s target=%s lenses=%s",
        proposal_id, pol, tgt, lens_list[:3],
    )
    return {"requested": True, "policy": pol, "target": tgt, "lenses": lens_list[:3]}


async def record_advisory_reconciliation(
    conn,
    proposal_id=None,
    tenant_id=None,
    resolution=None,
    target=None,
    **_ignored,
):
    """Auto-land: record the reconciled adversarial verdict as an advisory audit event
    instead of a HITL review TODO. Never advances a gate; never writes a business table."""
    if not proposal_id:
        return {"recorded": False, "reason": "missing_proposal"}

    from events import emit_event  # noqa: PLC0415

    try:
        await emit_event(
            conn, namespace=_OVERLAY_NAMESPACE, type=_RECONCILED_TYPE, phase="single",
            tenant_id=tenant_id,
            payload={
                "proposal_id": proposal_id,
                "tenant_id": tenant_id,
                "resolution": resolution or DEFAULT_RESOLUTION,
                "target": target or DEFAULT_TARGET,
                "landing": "auto",
            },
        )
    except Exception as exc:
        logger.error("record_advisory_reconciliation: emit failed: %s", exc)
        return {"recorded": False, "reason": f"emit_failed:{str(exc)[:200]}"}

    logger.info("advisory overlay auto-reconciled (advisory record): proposal=%s", proposal_id)
    return {"recorded": True, "landing": "auto"}
