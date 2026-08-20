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

#: The phase machine in order, INCLUDING the states only the frontend writes. A worker hop must
#: never move the phase to a lower rank than it already holds — see `_advance_to`.
PHASE_ORDER = ("not_started", "extract", "matrix", "review", "landed", "molds", "complete")


async def _advance_to(conn, sid, to_phase):
    """Move the phase FORWARD only. Returns the phase actually in effect afterwards.

    WHY THIS IS NOT A PLAIN UPDATE. Two writers share `curated_solicitations.ingest_phase`: this
    worker, hopping asynchronously through the auto chain, and the human at the Ingest Studio gate
    panel. They are not serialized, and the worker's hops are SLOW — each one waits on an agent
    cohort. So the ordering that actually happens is:

        20:18:33  human   auto → the chain is dispatched at 'extract'
        20:18:33  human   ...parks at the land gate, reviews the blocker, LANDS it by hand
        20:18:34  human   molds proposed + built → phase 'complete'
        20:18:34  worker  extract hop finishes  → SET ingest_phase = 'matrix'
        20:18:44  worker  matrix  hop finishes  → SET ingest_phase = 'review'
        20:18:54  worker  review  hop finishes  → SET ingest_phase = 'review'

    — measured on a live drive of the DoD X25.5 CSO. The compliance row, six volumes, 22 items and
    21 molds all exist; the panel says the solicitation is still awaiting review. The admin is
    invited to redo work that is already done, and `landSkeleton` will happily re-land against the
    draft the chain restaged.

    The frontend has had the discipline all along — `setIngestPhase(id, to, expected)` is a
    compare-and-swap, and the approve gate passes `expected` exactly so two clicks cannot
    double-advance. This side ignored it. The phase machine is a total order, so the guard does
    not need coordination or a lock: refuse any write that would LOWER the rank.

    Deliberately scoped to the worker. A human restart legitimately moves backwards — `regenerate`
    returns to 'matrix', `auto` returns to 'extract' — and those go through the frontend's own
    writer, which is unaffected.
    """
    try:
        row = await conn.fetchrow(
            """UPDATE curated_solicitations SET ingest_phase = $1, updated_at = now()
                WHERE id = $2
                  AND array_position($3::text[], COALESCE(ingest_phase, 'not_started'))
                    < array_position($3::text[], $1::text)
               RETURNING ingest_phase""",
            to_phase, sid, list(PHASE_ORDER),
        )
    except Exception as exc:
        logger.error("advance_ingest_phase: state update failed: %s", exc)
        return None
    if row:
        return row["ingest_phase"]
    # Refused: someone is further along than this hop. Say so out loud — silently doing nothing is
    # how the original bug hid, and an operator watching a chain needs to see the hop arrive late.
    try:
        cur = await conn.fetchval("SELECT ingest_phase FROM curated_solicitations WHERE id = $1", sid)
    except Exception:
        cur = None
    logger.info(
        "advance_ingest_phase: hop to '%s' arrived after the solicitation reached '%s' — not rewinding",
        to_phase, cur,
    )
    return cur


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
        now_at = await _advance_to(conn, sid, "review")
        if now_at is not None and now_at != "review":
            # The gate is already behind them — a human landed while this cohort was running.
            return {"advanced": False, "status": "superseded", "phase": now_at}
        return {"advanced": True, "status": "awaiting_land", "phase": "review"}

    if is_auto and nxt:
        now_at = await _advance_to(conn, sid, nxt)
        if now_at is not None and now_at != nxt:
            # Chaining the next phase from here would restage a draft over a matrix a person has
            # already landed, so the chain ENDS instead: the human took it from here.
            return {"advanced": False, "status": "superseded", "phase": now_at}
        try:
            # START/END pair, like every other trigger emitter (EVENT_CONTRACT). The END is what
            # the processor's trigger matches, so it carries the full payload; the START gives
            # the hop a parent so the ledger can pair it — a bare END is an event nothing can
            # correlate, and the coverage verifier rightly flags it as an orphan.
            hop_payload = {
                "solicitation_id": str(solicitation_id), "phase": nxt, "auto": True,
                "draft_id": draft_id, "guidance": guidance,
                "source": source or "ingest_auto",
                "lens_0": "citation", "lens_1": "completeness", "lens_2": "consistency",
                "resolution": "majority",
            }
            start_id = await emit_event(
                conn, namespace="finder", type="ingest.phase_requested", phase="start",
                tenant_id=None, payload=hop_payload,
            )
            await emit_event(
                conn, namespace="finder", type="ingest.phase_requested", phase="end",
                tenant_id=None, parent_event_id=start_id, payload=hop_payload,
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
    _ai_step_status=None,
    **_ignored,
):
    """Attach the adversarial cohort's reconciled verdict to the open staged draft.

    ADVISORY: it marks the draft `reviewed` so the panel can show that a colour team has been
    through it — it does NOT land the matrix and does NOT authorize a land. A reviewed draft with
    surviving challenges is exactly the case a human is supposed to look at.

    B17 — it marks the draft reviewed ONLY IF THE COLOUR TEAM ACTUALLY RAN. This step is
    deliberately independent of the cohort (no `depends_on`, so a dead agent can never strand the
    ingest), which used to mean it stamped 'reviewed' even when every reviewer safe-skipped for
    want of a key. `_ai_step_status` is the engine's own record of what those steps did (see
    `cohort_evidence`); with no evidence the draft KEEPS its status and the attempt is written
    into `review` instead. A draft nobody reviewed stays staged, which is the truth, and the
    panel's "a colour team has been through it" keeps meaning what it says.
    """
    if not solicitation_id:
        return {"recorded": False, "reason": "bad_input"}
    try:
        sid = uuid.UUID(str(solicitation_id))
    except (ValueError, TypeError):
        return {"recorded": False, "reason": "bad_solicitation_id"}

    from workflows.actions.cohort_evidence import cohort_verdict  # noqa: PLC0415

    review_verdict, ran, evidence = cohort_verdict(_ai_step_status)
    verdict = {
        "resolution": resolution or "majority",
        "recorded_by": "advisory_manager",
        "verdict": review_verdict,
        "cohort_ran": ran,
        "evidence": evidence,
    }
    try:
        row = await conn.fetchrow(
            """UPDATE solicitation_compliance_drafts
               SET review = $2,
                   status      = CASE WHEN $3::bool THEN 'reviewed' ELSE status      END,
                   reviewed_at = CASE WHEN $3::bool THEN now()      ELSE reviewed_at END
               WHERE id = (
                 SELECT id FROM solicitation_compliance_drafts
                 WHERE solicitation_id = $1 AND status IN ('staged', 'reviewed')
                 ORDER BY created_at DESC LIMIT 1
               )
               RETURNING id, status""",
            sid, json.dumps(verdict), ran,
        )
        if not row:
            return {"recorded": False, "reason": "no_open_draft"}
        return {
            "recorded": True,
            "draft_id": str(row["id"]),
            "status": row["status"],
            "verdict": review_verdict,
            "cohort_ran": ran,
            "evidence": evidence,
        }
    except Exception as exc:
        logger.error("record_ingest_review failed: %s", exc)
        return {"recorded": False, "reason": str(exc)}
