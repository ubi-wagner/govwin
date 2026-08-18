"""
================================================================================
Ingest Studio — the phase advance ACTION  (docs/INGEST_STUDIO_DESIGN.md)
================================================================================

`advance_ingest_phase` runs at the END of each Ingest Studio phase workflow, after that phase's
agent cohort. It owns the phase state machine, and nothing else:

  - emits `finder:ingest.phase_completed` (advisory audit — the loop finished).
  - MANUAL (auto=false): leaves the phase where it is; the human gate in the Ingest Studio panel
    is now meaningful, because there is something staged to look at.
  - AUTO (auto=true): chains the next phase and emits its `ingest.phase_requested`.

WHAT IT DELIBERATELY CANNOT DO: land a matrix. `solicitation_compliance` is written by the LAND
step alone (frontend `landSkeleton`), and a land is refused while the provenance audit reports a
blocker. An automation policy may decide how much review a sound matrix needs; it may not publish
one already known to be unfounded. So the auto-chain stops AT the land gate and parks a human
rather than promoting agent output into the table a customer builds against.

This is ORCHESTRATION state, not curation status: it never flips `curated_solicitations.status`,
never pushes, never writes a business table.
================================================================================
"""
import json
import logging
import uuid

logger = logging.getLogger("pipeline.workflows.ingest_actions")

# extract → matrix → review → (LAND: human or explicit policy) → molds → complete.
# 'review' intentionally has NO auto successor: the next step is landing, and landing is gated.
NEXT_PHASE = {"extract": "matrix", "matrix": "review", "review": None, "molds": "complete"}
_PHASES = ("extract", "matrix", "review", "molds")


async def advance_ingest_phase(
    conn,
    solicitation_id=None,
    phase=None,
    auto=None,
    draft_id=None,
    guidance=None,
    source=None,
    **_ignored,
):
    """Close out an Ingest Studio phase. Safe no-op on bad input — never dead-ends the workflow."""
    if not solicitation_id or phase not in _PHASES:
        return {"advanced": False, "reason": "bad_input"}

    from events import emit_event  # noqa: PLC0415

    try:
        sid = uuid.UUID(str(solicitation_id))
    except (ValueError, TypeError):
        return {"advanced": False, "reason": "bad_solicitation_id"}

    try:
        await emit_event(
            conn, namespace="finder", type="ingest.phase_completed", phase="single",
            tenant_id=None,
            payload={"solicitation_id": str(solicitation_id), "phase": phase, "auto": bool(auto)},
        )
    except Exception as exc:
        logger.error("advance_ingest_phase: completed emit failed: %s", exc)

    nxt = NEXT_PHASE.get(phase)
    is_auto = bool(auto)

    # The review phase ends AT the land gate, auto or not. This is the one place the automation
    # policy is deliberately not sovereign (docs/INGEST_STUDIO_DESIGN.md §"never auto").
    if phase == "review":
        try:
            await conn.execute(
                "UPDATE curated_solicitations SET ingest_phase = 'review', updated_at = now() WHERE id = $1",
                sid,
            )
        except Exception as exc:
            logger.error("advance_ingest_phase: review state update failed: %s", exc)
        return {"advanced": True, "status": "awaiting_land", "phase": "review"}

    if is_auto and nxt:
        try:
            await conn.execute(
                "UPDATE curated_solicitations SET ingest_phase = $1, updated_at = now() WHERE id = $2",
                nxt, sid,
            )
        except Exception as exc:
            logger.error("advance_ingest_phase: state update failed: %s", exc)
        try:
            await emit_event(
                conn, namespace="finder", type="ingest.phase_requested", phase="end",
                tenant_id=None,
                payload={
                    "solicitation_id": str(solicitation_id), "phase": nxt, "auto": True,
                    "draft_id": draft_id, "guidance": guidance,
                    "source": source or "ingest_auto",
                    "lens_0": "citation", "lens_1": "completeness", "lens_2": "consistency",
                    "resolution": "majority",
                },
            )
        except Exception as exc:
            logger.error("advance_ingest_phase: next-phase emit failed: %s", exc)
        return {"advanced": True, "next": nxt, "auto": True}

    # MANUAL — the phase stands at its gate. The panel shows what was staged; a human acts.
    return {"advanced": True, "status": "awaiting_review", "phase": phase}


async def record_ingest_review(
    conn,
    solicitation_id=None,
    resolution=None,
    **_ignored,
):
    """Attach the adversarial cohort's reconciled verdict to the open staged draft.

    ADVISORY: it marks the draft `reviewed` so the panel can show that a colour team has been
    through it — it does NOT land the matrix and does NOT authorize a land. A reviewed draft with
    surviving challenges is exactly the case a human is supposed to look at.
    """
    if not solicitation_id:
        return {"recorded": False, "reason": "bad_input"}
    try:
        sid = uuid.UUID(str(solicitation_id))
    except (ValueError, TypeError):
        return {"recorded": False, "reason": "bad_solicitation_id"}

    verdict = {"resolution": resolution or "majority", "recorded_by": "advisory_manager"}
    try:
        row = await conn.fetchrow(
            """UPDATE solicitation_compliance_drafts
               SET review = $2, status = 'reviewed', reviewed_at = now()
               WHERE id = (
                 SELECT id FROM solicitation_compliance_drafts
                 WHERE solicitation_id = $1 AND status IN ('staged', 'reviewed')
                 ORDER BY created_at DESC LIMIT 1
               )
               RETURNING id""",
            sid, json.dumps(verdict),
        )
        if not row:
            return {"recorded": False, "reason": "no_open_draft"}
        return {"recorded": True, "draft_id": str(row["id"])}
    except Exception as exc:
        logger.error("record_ingest_review failed: %s", exc)
        return {"recorded": False, "reason": str(exc)}
