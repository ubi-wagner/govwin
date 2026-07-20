"""#120 Agent guardrails — the "guardrail" step of *advisory → guardrail → land-or-review*.

An agent's output NEVER lands raw. Before any auto-apply or surface, it passes through
``enforce_guardrails()``, which returns a verdict the landing code acts on:

  - **disallowed content** (secrets/keys an advisory agent must never emit into a landed
    artifact) → ``decision="review"`` — routed to a tenant-admin ToDo, never auto-applied;
  - **scoring adjustment out of bounds** → clamped to ±cap and still applied (bounded
    auto-apply) — the ±15 rule from AGENT_WORKFORCE.md §7c;
  - **cost over the per-call ceiling** → flagged (the fabric already caps mid-loop).

The verdict is ``{decision: "apply"|"review", bounded: {...}, reasons: [...]}``. Landing code
(the audited frontend tool registry, or a per-tenant producer) checks ``decision``: "apply"
lands the bounded value; "review" opens a HITL task instead. So the loop is never
"advisory → land" — it is always "advisory → guardrail → land-or-review".

Tenant overrides live in ``guardrail_templates.config.agents``; safe defaults otherwise.
"""
import json
import logging
import uuid

logger = logging.getLogger("pipeline.agents.guardrails")

# The scoring_strategist may nudge the algorithmic score by at most ±this many points; it
# lands alongside the algo score (tenant_bucket_scores.factors), never overwriting it.
SCORE_ADJUSTMENT_CAP = 15.0
DEFAULT_PER_CALL_CEILING_USD = 0.50

# Route landing to HITL review if the output text contains any of these markers — material an
# advisory agent should never produce into content that lands. Case-insensitive substring match.
DEFAULT_DENYLIST = [
    "-----BEGIN RSA PRIVATE KEY-----",
    "-----BEGIN OPENSSH PRIVATE KEY-----",
    "-----BEGIN PRIVATE KEY-----",
    "aws_secret_access_key",
    "secret_access_key",
    "api_key=",
    "secret_key=",
    "password=",
]

# The adjustment can arrive as an explicit numeric field or inside the JSON the LLM emitted.
_ADJUSTMENT_KEYS = ("adjustment", "score_adjustment", "ai_adjustment", "delta", "score_delta")


def _result_text(result) -> str:
    """Best-effort concatenation of the human-readable text an agent produced."""
    if isinstance(result, str):
        return result
    if not isinstance(result, dict):
        return str(result or "")
    parts = []
    for k in ("text", "summary", "rationale", "output"):
        v = result.get(k)
        if isinstance(v, str):
            parts.append(v)
    return "\n".join(parts)


def _extract_adjustment(result):
    """Return (value, found). Look for an explicit numeric adjustment field, else parse the
    result text as JSON and look there. Non-numeric / absent → (0.0, False)."""
    if isinstance(result, dict):
        for k in _ADJUSTMENT_KEYS:
            if k in result:
                try:
                    return float(result[k]), True
                except (TypeError, ValueError):
                    pass
        text = result.get("text")
    else:
        text = result if isinstance(result, str) else None
    if isinstance(text, str) and text.strip():
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                for k in _ADJUSTMENT_KEYS:
                    if k in parsed:
                        return float(parsed[k]), True
        except (json.JSONDecodeError, TypeError, ValueError):
            pass
    return 0.0, False


def enforce_guardrails(agent_role: str, result, config: dict | None = None) -> dict:
    """Apply the tenant's agent guardrails to one agent result.

    Returns ``{decision, bounded, reasons}``:
      - ``decision`` — ``"apply"`` (safe to land the bounded output) or ``"review"``
        (route to a HITL task; do NOT auto-apply).
      - ``bounded`` — a shallow copy of the result with any clamped fields set
        (e.g. ``bounded_adjustment``).
      - ``reasons`` — human-readable strings for the audit trail / review task.
    """
    config = config or {}
    reasons: list[str] = []
    decision = "apply"
    bounded = dict(result) if isinstance(result, dict) else {"text": str(result or "")}

    # 1) Disallowed content → never auto-apply; route to review.
    text = _result_text(result)
    denylist = config.get("denylist") or DEFAULT_DENYLIST
    low = text.lower()
    hits = sorted({w for w in denylist if w.lower() in low})
    if hits:
        decision = "review"
        reasons.append("disallowed_content:" + ",".join(hits)[:120])

    # 2) Scoring adjustment bound (±cap): clamp and keep applying the bounded value.
    if agent_role == "scoring_strategist":
        try:
            cap = float(config.get("score_adjustment_cap", SCORE_ADJUSTMENT_CAP))
        except (TypeError, ValueError):
            cap = SCORE_ADJUSTMENT_CAP
        adj, found = _extract_adjustment(result)
        if found and abs(adj) > cap:
            clamped = max(-cap, min(cap, adj))
            bounded["bounded_adjustment"] = clamped
            reasons.append(f"score_adjustment_clamped:{adj}->{clamped}")
        elif found:
            bounded["bounded_adjustment"] = adj

    # 3) Cost ceiling (informational — the fabric already caps mid-loop).
    try:
        ceiling = float(config.get("per_call_ceiling", DEFAULT_PER_CALL_CEILING_USD))
        cost = float(result.get("cost_usd", 0) or 0) if isinstance(result, dict) else 0.0
        if cost > ceiling:
            reasons.append(f"cost_over_ceiling:{cost:.4f}>{ceiling:.2f}")
    except (TypeError, ValueError):
        pass

    return {"decision": decision, "bounded": bounded, "reasons": reasons}


async def load_guardrail_config(conn, tenant_id: str | None) -> dict:
    """Load the tenant's agent-guardrail overrides from guardrail_templates.config.agents,
    falling back to the platform default template, then to {} (safe built-in defaults).

    Best-effort: any error returns {} so guardrail enforcement always runs with defaults —
    an inability to read config must never disable the guardrail. Uses an explicit tenant
    filter (works under bypass today and under the agent role once app.tenant_id is set)."""
    try:
        row = None
        if tenant_id:
            row = await conn.fetchrow(
                "SELECT config FROM guardrail_templates WHERE tenant_id = $1 ORDER BY updated_at DESC LIMIT 1",
                uuid.UUID(tenant_id),
            )
        if row is None:
            row = await conn.fetchrow(
                "SELECT config FROM guardrail_templates WHERE is_default = true ORDER BY updated_at DESC LIMIT 1"
            )
        if not row or row["config"] is None:
            return {}
        cfg = row["config"]
        if isinstance(cfg, str):
            cfg = json.loads(cfg)
        if isinstance(cfg, dict):
            agents = cfg.get("agents")
            return agents if isinstance(agents, dict) else {}
    except Exception as exc:
        logger.warning("[guardrails] load_guardrail_config failed (using defaults): %s", exc)
    return {}
