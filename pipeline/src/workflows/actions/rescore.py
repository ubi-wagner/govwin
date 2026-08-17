"""
================================================================================
Workflow Action: tenant-side bucket rescore (rescore.py)
================================================================================

WHO:    The OnCardApplied / OnBucketsUpdated tenant-side scoring workflows.

WHAT:   The DETERMINISTIC bucket scorer, moved onto the audited workflow spine.
        Scoring is a TENANT-SIDE, EVENT-DRIVEN rescore (not baked into the admin
        push): a card landing in a tenant's mirror (capture:card.applied) or the
        tenant editing their OPP list / buckets (capture:buckets.updated) fires a
        rescore of that tenant's bucket scores.

        `score_card` is a faithful Python port of frontend/lib/bucket-ranking.ts
        `scoreCard` (same signals, same weights, JS-style rounding) so behavior is
        preserved. This deterministic pass is the DEFAULT of the scoring_strategist
        agent — the OnCardApplied step becomes AI_INVOKE(tool.opportunity.score)
        when the agent overlay (episodic memory + pin/purchase levers) is built out.

WHY:    "One Brain, two spines, a bridge": the platform delivers cards over the
        forward-only bridge; scoring belongs to the TENANT spine and runs as an
        audited process, not a synchronous side-effect of the admin's push.

TENANT ISOLATION:
        tenant_bucket_scores is RLS-FORCED, so every write sets app.tenant_id to
        the target tenant inside a transaction (SET LOCAL via set_config) — the
        tenant-bound invariant, satisfied even under the NOBYPASSRLS agent role.

EVENTS:
        capture:card.scored (per card) / capture:tenant.rescored (per tenant) —
        the audit signal that a rescore ran, with bucket counts.
================================================================================
"""
from __future__ import annotations

import json
import logging
import math
import re
import time
from datetime import datetime, timezone
from typing import Any, Optional

import asyncpg

from events import emit_event

log = logging.getLogger("pipeline.workflows.actions.rescore")


def _js_round(x: float) -> int:
    """JS Math.round semantics (round half toward +Infinity), for TS parity.

    Python's round() is banker's rounding (half-to-even), which diverges from the
    frontend scorer at .5 boundaries — floor(x+0.5) matches Math.round exactly.
    """
    return math.floor(x + 0.5)


def _coerce(v: Any, fallback: Any) -> Any:
    """asyncpg returns jsonb as a string unless a codec is registered — coerce."""
    if v is None:
        return fallback
    if isinstance(v, str):
        try:
            return json.loads(v)
        except (ValueError, TypeError):
            return fallback
    return v


def _keyword_hit(text: str, keyword: str) -> bool:
    """Mirror of frontend keywordHit (lib/bucket-ranking.ts): a short single-word token (<=3 chars)
    matches only on a WORD BOUNDARY so 'ai'/'ml' don't hit 'email'/'html'; longer tokens and
    multi-word phrases keep substring matching. Deterministic."""
    k = keyword.strip().lower()
    if not k:
        return False
    # Any whitespace (not just a literal space) marks a multi-word token → substring; parity with the
    # frontend's `!/\s/.test(k)` (a tab/newline in a <=3-char token must behave identically both sides).
    if len(k) <= 3 and not re.search(r"\s", k):
        return re.search(r"\b" + re.escape(k) + r"\b", text) is not None
    return k in text


def _close_ms(close_date: Any) -> Optional[float]:
    """Epoch ms for a card closeDate (ISO string or datetime), else None."""
    if not close_date:
        return None
    if isinstance(close_date, datetime):
        dt = close_date
    else:
        try:
            dt = datetime.fromisoformat(str(close_date).replace("Z", "+00:00"))
        except (ValueError, TypeError):
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp() * 1000.0


def score_card(card: dict, criteria: dict, now_ms: float) -> dict:
    """Score one card (0-100) against a bucket's criteria. Faithful port of the
    frontend scoreCard — same signals, same default weights, same rounding."""
    card = card or {}
    criteria = criteria or {}
    w = criteria.get("weights") or {}
    parts: list[tuple[str, float, float]] = []  # (key, v in [0,1], weight)

    text = " ".join(
        str(x) for x in (
            card.get("title"), card.get("spotlightSummary"),
            card.get("description"), card.get("office"),
        ) if x
    ).lower()

    kws = criteria.get("keywords") or []
    if kws:
        hits = sum(1 for k in kws if k and _keyword_hit(text, k))
        parts.append(("keyword", hits / len(kws), w.get("keyword", 1)))

    naics = criteria.get("naics") or []
    if naics:
        cn = {str(n) for n in (card.get("naicsCodes") or [])}
        inter = sum(1 for n in naics if str(n) in cn)
        parts.append(("naics", inter / len(naics), w.get("naics", 1)))

    agencies = criteria.get("agencies") or []
    if agencies:
        a = (card.get("agency") or "").lower()
        parts.append(("agency", 1.0 if any(x.lower() in a for x in agencies) else 0.0, w.get("agency", 1)))

    ptypes = criteria.get("programTypes") or []
    if ptypes:
        p = (card.get("programType") or "").lower()
        parts.append(("program", 1.0 if any(p == x.lower() for x in ptypes) else 0.0, w.get("program", 1)))

    setasides = criteria.get("setAsides") or []
    if criteria.get("useAccessibility") and setasides:
        s = (card.get("setAsideType") or "").lower()
        parts.append(("accessibility", 1.0 if any(x.lower() in s for x in setasides) else 0.0, w.get("accessibility", 1)))

    if criteria.get("useTimeline") is not False and card.get("closeDate"):
        close_ms = _close_ms(card.get("closeDate"))
        if close_ms is not None:
            days = (close_ms - now_ms) / 86_400_000.0
            v = 0.0 if days <= 0 else 1.0 if days <= 30 else 0.6 if days <= 60 else 0.3 if days <= 90 else 0.1
            parts.append(("timeline", v, w.get("timeline", 0.5)))

    total_w = sum(p[2] for p in parts)
    # Clamp to [0,100] to belt the DB CHECK (mig 180) — matches frontend scoreCard.
    raw = _js_round(100 * sum(p[1] * p[2] for p in parts) / total_w) if total_w > 0 else 0
    score = max(0, min(100, raw))
    factors = {p[0]: max(0, min(100, _js_round(p[1] * 100))) for p in parts}
    return {"score": score, "factors": factors}


async def _upsert_scores(
    conn: asyncpg.Connection,
    tenant_id: str,
    rows: list[tuple[str, str, int, dict]],  # (bucket_id, opportunity_id, score, factors)
) -> int:
    """Upsert bucket scores under the tenant's RLS scope (SET LOCAL app.tenant_id)."""
    if not rows:
        return 0
    async with conn.transaction():
        # Tenant-bound: satisfies the RLS WITH CHECK on tenant_bucket_scores even under
        # a NOBYPASSRLS role. SET LOCAL (set_config is_local=true) scopes to this tx.
        await conn.execute("SELECT set_config('app.tenant_id', $1, true)", str(tenant_id))
        for bucket_id, opportunity_id, score, factors in rows:
            await conn.execute(
                """INSERT INTO tenant_bucket_scores (tenant_id, bucket_id, opportunity_id, score, factors)
                   VALUES ($1, $2, $3, $4, $5::jsonb)
                   ON CONFLICT (tenant_id, bucket_id, opportunity_id) DO UPDATE SET
                     score = EXCLUDED.score, factors = EXCLUDED.factors, computed_at = now()""",
                str(tenant_id), str(bucket_id), str(opportunity_id), score, json.dumps(factors),
            )
    return len(rows)


async def _active_buckets(conn: asyncpg.Connection, tenant_id: str) -> list[dict]:
    rows = await conn.fetch(
        "SELECT id, criteria FROM tenant_spotlight_buckets WHERE tenant_id = $1 AND is_active",
        str(tenant_id),
    )
    return [{"id": str(r["id"]), "criteria": _coerce(r["criteria"], {})} for r in rows]


async def rescore_tenant_card(
    conn: asyncpg.Connection,
    *,
    tenant_id: str,
    opportunity_id: str,
) -> dict[str, Any]:
    """Rescore ONE card against every active bucket of the tenant (capture:card.applied).

    The deterministic default: a card landing in the tenant's mirror is ranked across
    all their buckets. No-op (never a dead-end) if the tenant has no active buckets or
    the card is gone.
    """
    if not tenant_id or not opportunity_id:
        return {"status": "skipped", "reason": "missing_ids"}

    now_ms = time.time() * 1000.0
    buckets = await _active_buckets(conn, tenant_id)
    if not buckets:
        return {"bucketsScored": 0, "reason": "no_active_buckets"}

    row = await conn.fetchrow(
        "SELECT card, lifecycle_status FROM tenant_opportunity_cards WHERE tenant_id = $1 AND opportunity_id = $2",
        str(tenant_id), str(opportunity_id),
    )
    if not row:
        return {"bucketsScored": 0, "reason": "card_not_found"}
    card = _coerce(row["card"], {})
    is_open = row["lifecycle_status"] == "open"

    to_write: list[tuple[str, str, int, dict]] = []
    for b in buckets:
        # Card-set rule (parity with frontend rankBucket / scoreCardForTenant): a closed card is
        # scored only into buckets that include closed opps, so all writers agree on which pairs exist.
        if not is_open and not b["criteria"].get("includeClosed"):
            continue
        r = score_card(card, b["criteria"], now_ms)
        to_write.append((b["id"], str(opportunity_id), r["score"], r["factors"]))
    written = await _upsert_scores(conn, tenant_id, to_write)

    try:
        await emit_event(
            conn, namespace="capture", type="card.scored", phase="single",
            tenant_id=str(tenant_id),
            payload={"opportunityId": str(opportunity_id), "bucketsScored": written},
        )
    except Exception as exc:
        log.error("rescore_tenant_card: emit failed: %s", exc)
    return {"bucketsScored": written, "opportunityId": str(opportunity_id)}


async def rescore_tenant(
    conn: asyncpg.Connection,
    *,
    tenant_id: str,
    bucket_id: Optional[str] = None,
) -> dict[str, Any]:
    """Rescore a tenant's cards against its active buckets (capture:buckets.updated).

    TARGETED when the event carries a bucket_id (a single bucket create/edit/rank): only THAT
    bucket is rescored, so editing one lens no longer needlessly re-scores every other bucket (the
    frontend also rankBucket()s the changed bucket synchronously — this is the idempotent worker-side
    recompute + audit, not a duplicate of the whole tenant). FULL when no bucket_id (the daily rescore,
    where timeline decay shifts every bucket). Card-set rule matches rankBucket: a bucket scores a card
    iff the card is open OR the bucket includes closed opps.
    """
    if not tenant_id:
        return {"status": "skipped", "reason": "missing_tenant"}

    now_ms = time.time() * 1000.0
    buckets = await _active_buckets(conn, tenant_id)
    if bucket_id:
        buckets = [b for b in buckets if b["id"] == str(bucket_id)]
    if not buckets:
        return {"pairsScored": 0, "reason": "no_active_buckets"}

    # Fetch ALL non-archived cards + their lifecycle so the per-bucket includeClosed rule can decide
    # each pair (was hardcoded to open-only, which starved includeClosed buckets of closed cards).
    cards = await conn.fetch(
        "SELECT opportunity_id, card, lifecycle_status FROM tenant_opportunity_cards "
        "WHERE tenant_id = $1 AND lifecycle_status <> 'archived'",
        str(tenant_id),
    )
    to_write: list[tuple[str, str, int, dict]] = []
    for c in cards:
        card = _coerce(c["card"], {})
        opp = str(c["opportunity_id"])
        is_open = c["lifecycle_status"] == "open"
        for b in buckets:
            if not is_open and not b["criteria"].get("includeClosed"):
                continue
            r = score_card(card, b["criteria"], now_ms)
            to_write.append((b["id"], opp, r["score"], r["factors"]))
    written = await _upsert_scores(conn, tenant_id, to_write)

    try:
        await emit_event(
            conn, namespace="capture", type="tenant.rescored", phase="single",
            tenant_id=str(tenant_id),
            payload={"cardsScored": len(cards), "bucketsActive": len(buckets),
                     "pairsWritten": written, "bucketId": str(bucket_id) if bucket_id else None},
        )
    except Exception as exc:
        log.error("rescore_tenant: emit failed: %s", exc)
    return {"pairsScored": written, "cards": len(cards), "buckets": len(buckets)}
