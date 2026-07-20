"""
Action: attribute_outcome
Workflow: OnProposalOutcomeRecorded (PIPE-16)

Invokes OutcomeAttributor to trace a proposal win/loss back to contributing
agent task logs, creating episodic memories and updating agent_performance.
Advisory only — does NOT modify proposal stage or business state.

Degrades gracefully if OutcomeAttributor is unavailable or inputs are absent.
"""
from __future__ import annotations

import logging

logger = logging.getLogger("pipeline.workflows.actions.attribute_outcome")


async def attribute_outcome(conn, **inputs) -> dict:
    """Invoke OutcomeAttributor for a recorded proposal outcome.

    Expected inputs (from workflow step input_map):
        tenant_id    (str UUID)
        proposal_id  (str UUID)
        outcome      (str) — 'awarded', 'lost', 'withdrawn', etc.
        notes        (str, optional) — free-text notes from the record
        agency       (str, optional) — override agency name
        program_type (str, optional) — override program type

    Returns:
        Attribution result dict or {skipped: True, reason} on error.
    """
    tenant_id: str | None = inputs.get("tenant_id")
    proposal_id: str | None = inputs.get("proposal_id")
    outcome: str = inputs.get("outcome") or "unknown"

    if not tenant_id or not proposal_id:
        logger.warning(
            "attribute_outcome: missing tenant_id or proposal_id, skipping"
        )
        return {"skipped": True, "reason": "missing_tenant_or_proposal"}

    details = {
        "notes": inputs.get("notes"),
        "agency": inputs.get("agency"),
        "program_type": inputs.get("program_type"),
    }

    # #149: this action MUTATES state (agent_performance calibration + episodic_memories via
    # the delegate) — emit its OWN domain start/end pair so the attribution is observable
    # from the DB directly, not only via the delegate's system:memory.* event.
    from events import emit_event  # noqa: PLC0415
    start_id = ""
    try:
        start_id = await emit_event(
            conn, namespace="proposal", type="outcome.attributed", phase="start",
            tenant_id=tenant_id, payload={"proposalId": proposal_id, "outcome": outcome},
        )
    except Exception as exc:
        logger.error("attribute_outcome: start emit failed: %s", exc)

    async def _end(payload: dict) -> None:
        try:
            await emit_event(
                conn, namespace="proposal", type="outcome.attributed", phase="end",
                parent_event_id=start_id or None, tenant_id=tenant_id, payload=payload,
            )
        except Exception as exc:
            logger.error("attribute_outcome: end emit failed: %s", exc)

    try:
        from agents.learning.outcome_attributor import OutcomeAttributor  # noqa: PLC0415

        attributor = OutcomeAttributor()
        result = await attributor.attribute_outcome(
            conn,
            tenant_id=tenant_id,
            proposal_id=proposal_id,
            outcome=outcome,
            details=details,
        )
        logger.info(
            "outcome attributed: tenant=%s proposal=%s outcome=%s tasks=%d",
            tenant_id,
            proposal_id,
            outcome,
            result.get("total_tasks", 0),
        )
        await _end({"proposalId": proposal_id, "outcome": outcome, "totalTasks": result.get("total_tasks", 0)})
        return result
    except ImportError as exc:
        logger.warning(
            "attribute_outcome: OutcomeAttributor unavailable (%s), skipping", exc
        )
        await _end({"proposalId": proposal_id, "outcome": outcome, "error": f"import_error:{exc}"[:300]})
        return {"skipped": True, "reason": f"import_error:{exc}"}
    except Exception as exc:
        logger.error("attribute_outcome failed: %s", exc)
        await _end({"proposalId": proposal_id, "outcome": outcome, "error": str(exc)[:300]})
        return {"skipped": True, "reason": str(exc)[:300]}
