# Rate Limiting, Monitoring & Cost Model Reference

> Complete reference for rate limiting, cost estimation, usage tracking, and monitoring
> across the platform — AI **and** system.
> Source of truth: `frontend/lib/rate-limit.ts`, `pipeline/src/agents/fabric.py`,
> `docs/agent-fabric/07-COST-MODEL.md`; the observability model is `system_events` +
> `process_instances`/`_transitions`/`tasks` (see EVENT_CONTRACT_V3 §2/§6).
> Last updated: 2026-07-22.

---

## 1. HTTP Rate Limiting

### Current Implementation

The HTTP rate limiter is an in-memory, IP-based system suitable for single-container
Railway deployments. Located in `frontend/lib/rate-limit.ts`.

**Architecture:**
- `Map<string, { count, resetAt }>` stores per-IP counters
- Periodic cleanup every 5 minutes prevents memory leaks
- Edge-compatible (no external dependencies)
- Stateless across container restarts (counters reset on deploy)

### Rate Limit Tiers

| Endpoint Pattern | Limit | Window | Purpose |
|-----------------|-------|--------|---------|
| Public endpoints | 5 requests | 15 minutes | Application submissions, waitlist signups |
| Auth endpoints | Varies by middleware config | Varies | Login, password reset |

### Headers Returned

The `checkRateLimit()` function returns three values that should be mapped to
response headers:

| Return Value | Suggested Header | Description |
|-------------|-----------------|-------------|
| `remaining` | `X-RateLimit-Remaining` | Requests left in current window |
| `resetAt` | `Retry-After` | Epoch timestamp when window resets |
| `allowed` | (HTTP status) | `true` = 200, `false` = 429 |

### How to Adjust Limits

Limits are passed as arguments to `checkRateLimit(key, limit, windowMs)` at each
call site (typically in middleware). To change limits for a specific endpoint:

1. Find the middleware or route handler that calls `checkRateLimit`
2. Adjust the `limit` and `windowMs` parameters

### Path to Multi-Container (Redis/DB-Backed)

For horizontal scaling beyond a single Railway container:

**Option A: Database-backed** (simplest, already have PostgreSQL)
- Create `rate_limit_state` table: `(key TEXT, count INT, window_start TIMESTAMPTZ)`
- Replace in-memory Map with SQL queries
- Adds ~2ms latency per request

**Option B: Redis-backed** (fastest, requires new infrastructure)
- Use Redis `INCR` + `EXPIRE` for atomic counter operations
- Sub-millisecond latency
- Requires Railway Redis addon or external Redis

---

## 2. Agent Rate Limiting

### Per-Tenant Hourly Rate Limit

| Setting | Value | Configurable | Location |
|---------|-------|:---:|----------|
| Rate limit | 50 calls/hour/tenant (default) | **Yes** | tenant override `tenant_agent_config.rate_limit_per_hour` → platform default `platform_agent_config.default_rate_limit_per_hour` → `RATE_LIMIT_PER_HOUR` constant |

Effective limit resolves **tenant override → platform default → constant**. Set
the per-tenant value from the admin account profile (AI Budget & Limits card) and
the platform default from `/admin/agents` (Pipeline AI Controls, master_admin).

### Rate Check Implementation

The fabric checks the rate limit before every agent invocation:

```python
async def _check_rate_limit(self, conn, tenant_id: str) -> bool:
    row = await conn.fetchrow("""
        SELECT COUNT(*) AS cnt
        FROM agent_task_log
        WHERE tenant_id = $1
          AND created_at > now() - interval '1 hour'
    """, uuid.UUID(tenant_id))
    return row["cnt"] < RATE_LIMIT_PER_HOUR
```

The check queries `agent_task_log` (not an in-memory counter), making it
durable across worker restarts and multi-worker deployments.

### Fail-Closed Behavior

If the rate limit check fails due to a database error, the call is **denied**:

```python
except Exception as exc:
    logger.error("[rate_limit] check failed, denying call: %s", exc)
    return False  # Fail CLOSED
```

This prevents runaway agent invocations if the database is unreachable.

### How to Adjust Per-Tenant

Settable from the UI (no SQL needed):

- **Per-tenant:** admin account profile → "AI Budget & Limits" card (rfp_admin+),
  which `PATCH`es `/api/admin/tenants/[tenantId]/agent-config`. Blank = inherit
  the platform default.
- **Platform default:** `/admin/agents` → "Pipeline AI Controls" card
  (master_admin), which `PATCH`es `/api/admin/agents/platform-config`.

`_check_rate_limit()` reads the tenant override, then the platform default, then
the `RATE_LIMIT_PER_HOUR` constant.

---

## 3. Agent Budget Enforcement

### Per-Tenant Monthly Budget

| Setting | Default | Configurable | Location |
|---------|---------|:---:|----------|
| Monthly budget (per tenant) | $50.00/month | **Yes** | tenant override `tenant_agent_config.monthly_budget` → platform default `platform_agent_config.default_monthly_budget` |
| Platform monthly cap | off (NULL) | **Yes** | `platform_agent_config.platform_monthly_cap` — hard ceiling on TOTAL monthly spend across all tenants + admin/system |
| AI master switch | on | **Yes** | `platform_agent_config.ai_enabled` — FALSE disables the whole agent workforce |
| Per-call ceiling | $0.50 (default) | **Yes** | tenant override `tenant_agent_config.per_call_ceiling` → platform default `platform_agent_config.default_per_call_ceiling` → `PER_CALL_CEILING_USD`. Halts one invocation's tool-loop once its cost exceeds this (pipeline-only — the live single-shot surfaces never reach it). |

`monthly_budget = 0` disables AI for a single tenant. The platform cap closes the
otherwise-uncapped admin (`tenant_id = NULL`) Spotlight path. Both the frontend
guard (`lib/ai/agent-guard.ts`) and the pipeline (`fabric.py`) enforce all four.

### Budget Check Implementation

The fabric checks the budget before every agent invocation:

```python
async def _check_budget(self, conn, tenant_id: str) -> bool:
    # Get tenant's configured budget (default $50)
    config_row = await conn.fetchrow("""
        SELECT monthly_budget FROM tenant_agent_config WHERE tenant_id = $1
    """, uuid.UUID(tenant_id))
    monthly_budget = float(config_row["monthly_budget"]) if config_row else DEFAULT_MONTHLY_BUDGET_USD

    # Sum actual costs for current calendar month
    usage_row = await conn.fetchrow("""
        SELECT COALESCE(SUM(cost_usd), 0) AS total_cost
        FROM agent_task_log
        WHERE tenant_id = $1 AND created_at >= date_trunc('month', now())
    """, uuid.UUID(tenant_id))

    return float(usage_row["total_cost"]) < monthly_budget
```

### Fail-Closed Behavior

If the budget check fails due to a database error, the call is **denied**:

```python
except Exception as exc:
    logger.error("[budget] check failed, denying call: %s", exc)
    return False  # Fail CLOSED
```

### Per-Call Cost Ceiling

During the tool-use loop, the fabric checks accumulated cost against a $0.50
per-call ceiling. If exceeded, the loop terminates:

```python
accumulated_cost = total_input_tokens * INPUT_COST_PER_TOKEN + total_output_tokens * OUTPUT_COST_PER_TOKEN
if accumulated_cost > 0.50:  # $0.50 per-call ceiling
    break
```

### How to Adjust Per-Tenant

Budget is configurable per-tenant via the `tenant_agent_config` table:

```sql
UPDATE tenant_agent_config
SET monthly_budget = 100.00, updated_at = now()
WHERE tenant_id = '<tenant-uuid>';
```

If no row exists in `tenant_agent_config`, the default $50.00 applies.

### Monthly Budget Reset

The `monthly_used` column in `tenant_agent_config` is reset on the first of each
month via a cron job:

```sql
UPDATE tenant_agent_config
SET monthly_used = 0, updated_at = now()
WHERE monthly_used > 0;
```

Note: The actual cost tracking uses `SUM(cost_usd) FROM agent_task_log` for the
current month, so the `monthly_used` column is a denormalized cache, not the
source of truth.

---

## 4. Cost Estimation Model

### Pricing (Claude API)

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|-------|----------------------|----------------------|
| Claude Sonnet (`claude-sonnet-4-20250514`) | $3.00 | $15.00 |
| Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) | $1.00 | $5.00 |

Cost is computed **per-model** (`fabric.py::MODEL_PRICING` / `_cost_for`, mirrored
in `lib/ai/agent-guard.ts::MODEL_PRICING` and the admin usage dashboard). Haiku
archetypes are no longer billed at Sonnet rates. Unknown model ids fall back to
Sonnet pricing so nothing is ever costed as free. (Per-archetype cost estimates
below predate the per-model fix and are conservative for Haiku roles.)

### Per-Archetype Costs

| Archetype | Model (V1) | Avg Input | Avg Output | Tool Calls | Cost/Call |
|-----------|-----------|-----------|------------|------------|----------|
| Opportunity Analyst | Haiku | 25K | 4K | 3 | $0.14 |
| Scoring Strategist | Haiku | 10K | 2K | 4 | $0.06 |
| Capture Strategist | Sonnet | 25K | 6K | 5 | $0.17 |
| Proposal Architect | Sonnet | 18K | 5K | 5 | $0.13 |
| Section Drafter | Sonnet | 12K | 4K | 5 | $0.10 |
| Compliance Reviewer | Haiku | 25K | 3K | 4 | $0.12 |
| Color Team Reviewer | Sonnet | 35K | 8K | 4 | $0.23 |
| Librarian | Haiku | 20K | 5K | 3 | $0.14 |
| Partner Coordinator | Haiku | 5K | 2K | 3 | $0.05 |
| Packaging Specialist | Haiku | 20K | 3K | 3 | $0.11 |

### Per-Proposal Cost Breakdown

| Proposal Type | Agent Calls | Without Caching | With Caching |
|--------------|-------------|-----------------|--------------|
| SBIR Phase I | ~42 | ~$5.03 | ~$4.50 |
| SBIR Phase II | ~65 | ~$8.20 | ~$7.30 |
| BAA/OTA Response | ~55 | ~$6.80 | ~$6.10 |
| Full RFP (large) | ~90 | ~$12.50 | ~$11.00 |

**SBIR Phase I Breakdown by Stage:**

```
Stage           Agent Calls    Estimated Cost
----------------------------------------------
Pre-purchase    2              $0.23
  Scoring + Capture Strategy

Outline         4              $0.52
  Architect(2) + Compliance(1) + Librarian(1)

Draft           22             $2.20
  Drafter(15) + Compliance(1) + Partner(5) + Librarian(1)

Pink Team       4              $0.60
  Color Team(1) + Compliance(1) + Drafter(2 revisions)

Red Team        3              $0.46
  Color Team(1) + Scoring(1) + Drafter(1 revision)

Gold Team       2              $0.35
  Color Team(1) + Compliance(1)

Final           2              $0.25
  Packaging(1) + Compliance(1)

Post-Submit     3              $0.42
  Librarian(2 harvest) + Memory consolidation(1)
----------------------------------------------
TOTAL           ~42 calls      ~$5.03
```

### Per-Tenant Monthly Estimates

| Usage Level | Opportunities Reviewed | Active Proposals | Monthly AI Cost |
|------------|:----:|:----:|----------:|
| Light | 20 | 1 | ~$3.55 |
| Active | 50 | 3 | ~$9.95 |
| Power | 100 | 5 | ~$17.55 |

### Break-Even Analysis

**Spotlight Subscription ($499/month, 3-month minimum):**

```
Revenue:           $499.00
AI cost (active):   $9.95
Infrastructure:     $2.60
Gross margin:      $486.45 (97%)
```

**Proposal Portal Purchase (Phase I $1,999 · Phase II $4,999, or $3,999 linked):**

```
Revenue:           $1,999.00 (Phase I) · $4,999 / $3,999-linked (Phase II)
AI cost:            $4.50 - $12.50
Infrastructure:     ~$1.00
Gross margin:      $1,985 - $1,993 (99%) at Phase I; higher at Phase II
```

AI is <2% COGS at any usage level. Even at 10x estimated cost, margins remain above 85%.

---

## 5. Usage Tracking

### Data Sources

| Table | What It Tracks | Granularity |
|-------|---------------|-------------|
| `agent_task_log` | Every agent invocation: tokens, cost, duration, errors, acceptance | Per-call |
| `agent_performance` | Aggregated per-role per-tenant metrics over time periods | Per-period |
| `tenant_agent_config` | Budget + preferences per tenant | Per-tenant |
| `system_events` (namespace='tool') | Agent invocation start/end events with payloads | Per-event |

### Key Columns in agent_task_log

```
id, tenant_id, agent_role, task_type, trigger_event,
proposal_id, section_id, input_tokens, output_tokens,
tool_calls_count, duration_ms, cost_usd,
human_accepted, human_edit_pct,
memories_retrieved, memories_written,
error, created_at
```

### Query: Current Month Spend Per Tenant

```sql
SELECT
    t.name AS tenant_name,
    COUNT(*)::int AS total_calls,
    SUM(atl.input_tokens)::bigint AS total_input_tokens,
    SUM(atl.output_tokens)::bigint AS total_output_tokens,
    ROUND(SUM(atl.cost_usd)::numeric, 4) AS total_cost_usd,
    COALESCE(tac.monthly_budget, 50.00) AS monthly_budget,
    ROUND(SUM(atl.cost_usd) / NULLIF(COALESCE(tac.monthly_budget, 50.00), 0) * 100, 1) AS budget_pct
FROM agent_task_log atl
JOIN tenants t ON t.id = atl.tenant_id
LEFT JOIN tenant_agent_config tac ON tac.tenant_id = atl.tenant_id
WHERE atl.created_at >= date_trunc('month', now())
GROUP BY t.id, t.name, tac.monthly_budget
ORDER BY total_cost_usd DESC;
```

### Query: Usage Trends (Daily for Last 30 Days)

```sql
SELECT
    date_trunc('day', created_at)::date AS day,
    COUNT(*)::int AS calls,
    ROUND(SUM(cost_usd)::numeric, 4) AS cost_usd,
    SUM(input_tokens)::bigint AS input_tokens,
    SUM(output_tokens)::bigint AS output_tokens
FROM agent_task_log
WHERE created_at >= now() - interval '30 days'
GROUP BY day
ORDER BY day;
```

### Query: Error Rate by Agent Role

```sql
SELECT
    agent_role,
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE error IS NOT NULL)::int AS errors,
    ROUND(COUNT(*) FILTER (WHERE error IS NOT NULL)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS error_rate_pct
FROM agent_task_log
WHERE created_at >= now() - interval '30 days'
GROUP BY agent_role
ORDER BY error_rate_pct DESC;
```

---

## 6. Admin Monitoring Views

### The observability model (as-built)

Monitoring is **derived from the event ledger, not a separate metrics store.** Three primitives:

- **`system_events` is the audit river.** Every state-changing action posts a `start`/`end`
  pair (or a `single`); the `end` row carries `duration_ms` + a dedicated `error` column. AI/tool
  calls emit under `namespace='tool'`; workflow Jobs stamp `correlationId` + `processInstanceId`.
  The river is append-only — you read it forward (EVENT_CONTRACT_V3 §2).
- **Workflow state is derivable, not stored twice.** `process_instances` (current_step, status,
  deadline, `last_heartbeat_at`) + `process_instance_transitions` (one row per state change) +
  `tasks` give the live picture of every running Process Instance. The engine is stateless
  between polls — state lives in these tables, reconstructable from the river.
- **A missing `end` past the deadline IS the alert.** Because every Job posts start→end, an
  unpaired `start` older than the Job's `default_timeout` (or a parked instance past its
  `wait_deadline`) is the signal that something stuck. The time-sweeper reconciler
  (EVENT_CONTRACT_V3 §6) turns "no end row" into an escalation rather than a silent hang — no
  heartbeat table beyond `last_heartbeat_at` is required.

### The three admin surfaces

| Surface | Route | Shows |
|---------|-------|-------|
| **Agent Workforce** | `/admin/agents` | Agent roster (**36 archetypes, all auto-registered**; wired/dormant status per archetype) + tool registry + **per-tenant AI usage** (calls, cost, budget %) + recent tool invocations. Pipeline AI Controls (platform default budget/rate + master switch). |
| **Workflows** | `/admin/workflows` | Live **Process Instance** state off `process_instances`/`_transitions`/`tasks` — current step, status, deadline, force-advance (the sanctioned HITL override). Cross-tenant, tenant-filterable. |
| **Events** | `/admin/events` | The raw **audit river** — a live `system_events` stream (namespace/type/phase/actor/duration/error), the ground truth the other two are derived from. |

### Runaway caps — the four bounds every agent invocation clears

The agent runtime is bounded on four axes; a breach on any one halts the call (fail-closed) and
routes to safe-skip rather than dead-ending the workflow (EVENT_CONTRACT_V3 §3.1; the safety
contract is docs/AGENT_WORKFORCE.md). All four are visible/settable from `/admin/agents`
(platform) + the admin account profile (per-tenant):

| Cap | Bound (default) | Enforced in | §ref |
|-----|-----------------|-------------|------|
| **Round** | 20 tool-use rounds / invocation | `fabric.invoke_agent` loop | §10.8 (V3) |
| **Cost** (per-call) | $0.50 (tenant/platform overridable) | tool-loop accumulator | §3 |
| **Rate** | 50 calls / hour / tenant (overridable) | `_check_rate_limit` (durable, `agent_task_log`) | §2 |
| **Budget** (monthly) | $50 / month / tenant + optional platform cap | `_check_budget` (SUM `cost_usd`) | §3 |

### Current: /admin/agents Page

The existing admin agents page (`frontend/app/admin/agents/page.tsx`) shows:

1. **Tool Registry** -- all registered tools grouped by namespace, with descriptions,
   minimum role requirements, and tenant-scoping status
2. **Recent Tool Invocations** -- last 30 `system_events` with namespace='tool',
   showing event type, phase, actor, duration, and error status

### Current: GET /api/admin/agents

The existing API (`frontend/app/api/admin/agents/route.ts`) returns:
- Task queue summary by status (pending/running/completed/failed)
- Tasks grouped by agent role and status
- Last 10 failures with error messages
- Last 20 tool invocation events from system_events

### New: GET /api/admin/agents/usage

The usage dashboard API (`frontend/app/api/admin/agents/usage/route.ts`) returns
comprehensive usage data:

| Section | Contents |
|---------|----------|
| `summary` | Total calls, tokens, cost, unique tenants, average cost per call |
| `byArchetype` | Per-agent-role breakdown: calls, tokens, cost, avg duration, error rate |
| `byTenant` | Per-tenant breakdown: calls, cost, budget, budget utilization % |
| `dailyTrend` | Daily time series: calls and cost per day |
| `pricing` | Current model pricing, default budget, rate limit constants |

### Additional Monitoring Needed (V2)

- Real-time cost alerts when a tenant approaches budget threshold
- Weekly cost trend emails to master_admin
- Per-archetype quality metrics (acceptance rate, edit percentage)
- Agent queue depth monitoring with auto-scaling triggers
- **Total-cost-of-ownership rollup per tenant:** the planned budget view combines the live
  Claude spend (`SUM(cost_usd)` from `agent_task_log`) with Railway Postgres + Cloudflare R2 (S3)
  infra-cost estimates, for a true per-tenant margin picture. Today only the Claude leg is metered;
  infra is the flat estimate baked into §4's break-even, not yet a live per-tenant rollup.

---

## 7. Customer Usage Views

### What the Customer Should See

Customers see **aggregate usage metrics** without any pricing data. They should
never see dollar amounts, token counts, or cost-per-call figures.

**Visible to tenant_admin:**

| Metric | Description |
|--------|-------------|
| Total AI calls this period | How many times agents ran for this tenant |
| Budget utilization % | Progress bar showing how much of their allocation is used |
| Calls remaining this hour | How many more agent calls they can make right now |
| Per-agent contribution | Which agent roles have been most active |
| Recent activity | Last N agent invocations with task type and duration |

### Per-Agent Contribution Breakdown

Show a breakdown by agent display name (human-friendly, not role_name):

| Agent Role | Display Name |
|-----------|-------------|
| `opportunity_analyst` | Opportunity Analyst |
| `scoring_strategist` | Scoring Strategist |
| `capture_strategist` | Capture Strategist |
| `proposal_architect` | Proposal Architect |
| `section_drafter` | Section Drafter |
| `compliance_reviewer` | Compliance Reviewer |
| `color_team_reviewer` | Color Team Reviewer |
| `librarian` | Librarian |
| `partner_coordinator` | Partner Coordinator |
| `packaging_specialist` | Packaging Specialist |

### Usage Bars / Metering Concept

The customer portal should display:

1. **Budget meter** -- horizontal progress bar showing budget utilization percentage.
   Green (0-70%), yellow (70-90%), red (90-100%).
2. **Rate limit indicator** -- "X calls remaining this hour" with countdown.
3. **Agent activity feed** -- scrollable list of recent agent actions with timestamps.

---

## 8. File Map

| File | Description |
|------|-------------|
| `frontend/lib/rate-limit.ts` | In-memory IP-based HTTP rate limiter for Edge middleware |
| `pipeline/src/agents/fabric.py` | Agent rate limiting (50/hr) and budget enforcement ($50/mo) |
| `pipeline/src/agents/context.py` | Token budget management for memory retrieval |
| `docs/agent-fabric/07-COST-MODEL.md` | Full cost model design with scaling projections |
| `frontend/app/admin/agents/page.tsx` | Admin agent monitoring UI (tool registry + invocations) |
| `frontend/app/api/admin/agents/route.ts` | Admin agent API: queue summary, failures, events |
| `frontend/app/api/admin/agents/usage/route.ts` | Admin usage dashboard API: costs, trends, per-tenant |
| `frontend/app/api/portal/[tenantSlug]/agents/usage/route.ts` | Tenant usage API: calls, budget, activity |
| `frontend/app/api/portal/[tenantSlug]/agents/config/route.ts` | Tenant agent configuration |
| `frontend/app/api/portal/[tenantSlug]/agents/performance/route.ts` | Tenant performance metrics |
| `db/migrations/001_baseline.sql` | Schema: agent_task_log, tenant_agent_config, agent_performance |
| `db/migrations/072_agent_config_settable.sql` | Adds `tenant_agent_config.rate_limit_per_hour`; creates `platform_agent_config` singleton (defaults + cap + master switch) |
| `frontend/lib/ai/agent-guard.ts` | Unified guard + ledger for the live product-AI surfaces; resolves effective limits + platform cap |
| `frontend/app/api/admin/tenants/[tenantId]/agent-config/route.ts` | GET/PATCH per-tenant budget + rate limit (rfp_admin+) |
| `frontend/app/api/admin/agents/platform-config/route.ts` | GET/PATCH pipeline-wide defaults + cap + master switch (master_admin) |
| `frontend/components/admin/tenant-ai-config-card.tsx` | Per-tenant AI limits editor on the admin account profile |
| `frontend/components/admin/platform-ai-config-card.tsx` | Pipeline AI defaults + cap editor on `/admin/agents` |
