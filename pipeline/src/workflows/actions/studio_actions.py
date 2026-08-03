"""
================================================================================
Proposal Studio — the phase advance ACTION  (docs/PROPOSAL_STUDIO_DESIGN.md)
================================================================================

`advance_studio_phase` runs at the END of each Studio phase workflow (Draft / Refine / Compliance),
after that phase's advisory agent cohort. It owns the phase state machine:

  - emits `proposal:review_phase.completed` (advisory audit — the loop finished).
  - MANUAL (auto=false): flips `proposals.studio_phase_status` to 'awaiting_review' — the human gate
    opens; the admin reviews the document, comments + regenerates, or approves (the route advances).
  - AUTO (auto=true, the doorbell path): auto-chains — sets `studio_phase` to the NEXT phase, status
    'running', and emits that phase's `review_phase.requested` so the chain runs with no human stop;
    after Compliance it sets `studio_phase='complete'`.

This is ORCHESTRATION state (which refinement loop we're in), NOT a proposal stage/gate — the Studio
never advances a stage, locks a section, or submits. Advisory: it writes only the studio_* state
columns + system_events, never a business content table.
================================================================================
"""
import logging
import uuid

logger = logging.getLogger("pipeline.workflows.studio_actions")

# Draft → Refine → Compliance → complete.
NEXT_PHASE = {"draft": "refine", "refine": "compliance", "compliance": "complete"}
_PHASES = ("draft", "refine", "compliance")


async def advance_studio_phase(
    conn,
    proposal_id=None,
    tenant_id=None,
    phase=None,
    auto=None,
    opportunity_id=None,
    guidance=None,
    source=None,
    **_ignored,
):
    """Close out a Studio phase: emit completed, then either open the human gate (manual) or
    auto-chain the next phase (auto). Safe no-op on bad input — never dead-ends the workflow."""
    if not proposal_id or phase not in _PHASES:
        return {"advanced": False, "reason": "bad_input"}

    from events import emit_event  # noqa: PLC0415

    try:
        pid = uuid.UUID(str(proposal_id))
    except (ValueError, TypeError):
        return {"advanced": False, "reason": "bad_proposal_id"}

    # 1) Advisory audit — this loop finished.
    try:
        await emit_event(
            conn, namespace="proposal", type="review_phase.completed", phase="single",
            tenant_id=tenant_id,
            payload={"proposal_id": proposal_id, "phase": phase, "auto": bool(auto)},
        )
    except Exception as exc:
        logger.error("advance_studio_phase: completed emit failed: %s", exc)

    nxt = NEXT_PHASE[phase]
    is_auto = bool(auto)

    # 2a) AUTO + more phases → chain the next one (no human stop).
    if is_auto and nxt != "complete":
        try:
            await conn.execute(
                "UPDATE proposals SET studio_phase = $1, studio_phase_status = 'running' WHERE id = $2",
                nxt, pid,
            )
        except Exception as exc:
            logger.error("advance_studio_phase: state update failed: %s", exc)
        try:
            await emit_event(
                conn, namespace="proposal", type="review_phase.requested", phase="end",
                tenant_id=tenant_id,
                payload={
                    "proposal_id": proposal_id, "tenant_id": tenant_id, "phase": nxt,
                    "auto": True, "opportunity_id": opportunity_id,
                    "source": source or "studio_auto",
                },
            )
        except Exception as exc:
            logger.error("advance_studio_phase: next-phase emit failed: %s", exc)
        return {"advanced": True, "next": nxt, "auto": True}

    # 2b) AUTO + last phase (compliance) done → complete.
    if is_auto and nxt == "complete":
        try:
            await conn.execute(
                "UPDATE proposals SET studio_phase = 'complete', studio_phase_status = NULL, studio_auto = false WHERE id = $1",
                pid,
            )
        except Exception as exc:
            logger.error("advance_studio_phase: complete update failed: %s", exc)
        return {"advanced": True, "next": "complete", "auto": True}

    # 3) MANUAL → open the human review gate for this phase.
    try:
        await conn.execute(
            "UPDATE proposals SET studio_phase_status = 'awaiting_review' WHERE id = $1", pid
        )
    except Exception as exc:
        logger.error("advance_studio_phase: awaiting_review update failed: %s", exc)
    return {"advanced": True, "status": "awaiting_review", "phase": phase}
