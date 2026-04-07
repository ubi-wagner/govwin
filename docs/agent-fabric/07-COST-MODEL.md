# Chapter 7: Cost Model and Scaling

Real numbers. What this costs per tenant, per proposal, and where the margins are.

---

## Per-Agent Cost Breakdown

All costs at Claude Sonnet pricing ($3/1M input, $15/1M output).
Cached input tokens at 0.1x ($0.30/1M).

| Agent | Avg Input | Avg Output | Tool Calls | Per Proposal | Cost/Call | Cost/Proposal |
|-------|-----------|------------|------------|-------------|-----------|---------------|
| Opportunity Analyst | 25K | 4K | 3 | 1x (per opp, not per tenant) | $0.14 | $0.14 |
| Scoring Strategist | 10K | 2K | 4 | 1x per high-scoring opp | $0.06 | $0.06 |
| Capture Strategist | 25K | 6K | 5 | 1x per pursuit | $0.17 | $0.17 |
| Proposal Architect | 18K | 5K | 5 | 2x | $0.13 | $0.26 |
| Section Drafter | 12K | 4K | 5 | 15x (one per section) | $0.10 | $1.50 |
| Compliance Reviewer | 25K | 3K | 4 | 4x | $0.12 | $0.48 |
| Color Team Reviewer | 35K | 8K | 4 | 3x (pink, red, gold) | $0.23 | $0.69 |
| Partner Coordinator | 5K | 2K | 3 | 10x | $0.05 | $0.50 |
| Librarian | 20K | 5K | 3 | 3x | $0.14 | $0.42 |
| Packaging Specialist | 20K | 3K | 3 | 1x | $0.11 | $0.11 |

---

## Cost Per Proposal (Full AI-Assisted Lifecycle)

### SBIR Phase I Proposal (Typical)

```
Stage           Agent Calls    Estimated Cost
─────────────────────────────────────────────
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
─────────────────────────────────────────────
TOTAL           ~42 calls      ~$5.03
```

### With Prompt Caching

The system prompt + tenant profile (~3,500 tokens) is cached across calls
within the same session. During active proposal work, cache hit rate is 80-90%.

```
Cached portion:  3,500 tokens × 42 calls = 147,000 tokens
Without cache:   147K × $3/1M = $0.44
With cache:      147K × $0.30/1M = $0.04

Savings:         ~$0.40 per proposal (small per-proposal, but compounds at scale)
```

The bigger savings come from the _dynamic_ portion being smaller because good
memory retrieval means less task-specific data needs to be included.

### Cost Summary

| Proposal Type | Agent Calls | Without Caching | With Caching |
|--------------|-------------|-----------------|--------------|
| SBIR Phase I | ~42 | ~$5.03 | ~$4.50 |
| SBIR Phase II | ~65 | ~$8.20 | ~$7.30 |
| BAA/OTA Response | ~55 | ~$6.80 | ~$6.10 |
| Full RFP (large) | ~90 | ~$12.50 | ~$11.00 |

---

## Cost Per Tenant Per Month

### Scenario Modeling

**Light User** (1 active proposal, reviews 20 opportunities/month):
```
Scoring: 20 opps × $0.06 = $1.20
Proposal work: $4.50 (amortized over ~2 months) = $2.25/month
Memory maintenance: ~$0.10
───────────────────────
Monthly AI cost: ~$3.55
```

**Active User** (3 active proposals, reviews 50 opportunities/month):
```
Scoring: 50 opps × $0.06 = $3.00
Proposal work: 3 × $4.50 / 2 = $6.75/month
Memory maintenance: ~$0.20
───────────────────────
Monthly AI cost: ~$9.95
```

**Power User** (5 active proposals, reviews 100 opportunities/month):
```
Scoring: 100 opps × $0.06 = $6.00
Proposal work: 5 × $4.50 / 2 = $11.25/month
Memory maintenance: ~$0.30
───────────────────────
Monthly AI cost: ~$17.55
```

### Non-AI Costs (Per Tenant)

```
PostgreSQL storage: ~$0.50/month (shared instance)
File storage: ~$0.10/month (Railway volume)
Compute (pipeline worker share): ~$2.00/month
───────────────────────
Total infrastructure: ~$2.60/month per tenant
```

---

## Break-Even Analysis

### Finder Subscription ($199/month)

```
Revenue:           $199.00
AI cost (active):   $9.95
Infrastructure:     $2.60
──────────────────────────
Gross margin:      $186.45 (94%)
```

Even a power user at $17.55 AI cost leaves 91% gross margin on the subscription.

### Proposal Portal Purchase ($999 one-time)

```
Revenue:           $999.00
AI cost:            $4.50 - $12.50
Infrastructure:     ~$1.00
──────────────────────────
Gross margin:      $985 - $993 (98-99%)
```

**The AI cost per proposal is negligible relative to revenue.**
At $5-12 per proposal in AI compute versus $999 in revenue, AI is a
<2% cost of goods sold. Even at 10x the estimated cost, margins remain
above 85%.

### Scaling to 100 Tenants

```
Monthly AI compute: 100 × $10 avg = $1,000
PostgreSQL (managed): ~$50/month
Railway (3 workers): ~$60/month
Anthropic API overhead: ~$0
──────────────────────────
Total monthly cost: ~$1,110
Monthly revenue (100 × $199): $19,900
Gross margin: 94%
```

---

## Model Selection Strategy

### V1: Claude Sonnet for Everything

Sonnet provides the best cost/quality ratio for all agent tasks. At $3/$15
per million tokens, a full proposal lifecycle costs ~$5. Quality is sufficient
for drafting, reviewing, and scoring.

### V2+: Tiered Model Selection

```python
MODEL_MAP = {
    # Complex reasoning tasks → Opus ($15/$75 per 1M)
    'capture_strategist': 'claude-opus-4-20250918',
    'color_team_reviewer': 'claude-opus-4-20250918',

    # Standard tasks → Sonnet ($3/$15 per 1M)
    'opportunity_analyst': 'claude-sonnet-4-20250514',
    'scoring_strategist': 'claude-sonnet-4-20250514',
    'proposal_architect': 'claude-sonnet-4-20250514',
    'section_drafter': 'claude-sonnet-4-20250514',
    'compliance_reviewer': 'claude-sonnet-4-20250514',
    'librarian': 'claude-sonnet-4-20250514',

    # Simple tasks → Haiku ($0.25/$1.25 per 1M)
    'partner_coordinator': 'claude-haiku-4-5-20251001',
    'packaging_specialist': 'claude-haiku-4-5-20251001',
}
```

Cost impact of tiered models:
- Opus for 2 agents (6 calls/proposal): adds ~$2.50
- Haiku for 2 agents (11 calls/proposal): saves ~$0.40
- Net increase per proposal: ~$2.10
- Justified if Opus quality measurably improves win rates

### The Model Parameter is Configurable

```python
class BaseArchetype:
    model: str = None  # None = use default from config

    def get_model(self, tenant_config: dict) -> str:
        # Tenant override > archetype default > global default
        return (
            tenant_config.get('model_override')
            or self.model
            or os.environ.get('CLAUDE_MODEL', 'claude-sonnet-4-20250514')
        )
```

---

## Token Budget Management

### Per-Invocation Budget

```python
MAX_INPUT_TOKENS = 50_000    # Safety limit per call
MAX_OUTPUT_TOKENS = 8_192    # Per archetype, adjustable
MAX_TOOL_ROUNDS = 20         # Prevent infinite tool loops
```

### Per-Tenant Monthly Budget

Default: $50/month. Configurable per tenant.

```python
async def check_budget(conn, tenant_id: str, estimated_cost: float) -> bool:
    """Check if tenant has budget remaining."""
    config = await conn.fetchrow("""
        SELECT monthly_budget, monthly_used
        FROM tenant_agent_config
        WHERE tenant_id = $1
    """, tenant_id)

    if not config:
        return True  # No config = no limit (master admin tenants)

    return (config['monthly_used'] + estimated_cost) <= config['monthly_budget']
```

Monthly budget resets on the first of each month:

```sql
-- Cron job: reset monthly budgets
UPDATE tenant_agent_config
SET monthly_used = 0, updated_at = now()
WHERE monthly_used > 0;
```

---

## Scaling Considerations

### Database (pgvector)

| Metric | Threshold | Action |
|--------|-----------|--------|
| Total vectors | < 1M | No action needed |
| Total vectors | 1-5M | Monitor query latency, tune HNSW ef_search |
| Total vectors | > 5M | Partition tables by tenant_id hash |
| Query p99 | > 20ms | Add read replica for agent queries |
| Index size | > available RAM | Upgrade instance or partition |

### Pipeline Workers

| Metric | Threshold | Action |
|--------|-----------|--------|
| Agent queue depth | > 10 pending | Add another worker container |
| Avg task latency | > 30s | Add worker or optimize context assembly |
| Worker CPU | > 80% sustained | Scale horizontally |

Workers scale linearly on Railway — add containers, they all dequeue from
the same `agent_task_queue` with `SKIP LOCKED`.

### Claude API

| Metric | Threshold | Action |
|--------|-----------|--------|
| Rate limit hits | > 5/hour | Add retry with exponential backoff |
| Sustained rate limiting | Daily | Request rate limit increase from Anthropic |
| Token throughput | > 1M tokens/min | Consider Anthropic Batch API for non-urgent tasks |

### Storage

| Metric | Threshold | Action |
|--------|-----------|--------|
| Railway volume | > 80% full | Archive old proposals to R2/S3 |
| Tenant file count | > 10,000 files | Implement subdirectory sharding |

---

## Cost Tracking Dashboard

For the admin dashboard, surface these metrics:

```sql
-- Real-time cost dashboard query
SELECT
    t.name AS tenant_name,
    tac.monthly_budget,
    tac.monthly_used,
    ROUND(tac.monthly_used / NULLIF(tac.monthly_budget, 0) * 100) AS budget_pct,
    (SELECT COUNT(*) FROM agent_task_log atl
     WHERE atl.tenant_id = t.id
       AND atl.created_at >= date_trunc('month', now())) AS tasks_this_month,
    (SELECT AVG(cost_usd) FROM agent_task_log atl
     WHERE atl.tenant_id = t.id
       AND atl.created_at >= date_trunc('month', now())) AS avg_cost_per_task
FROM tenants t
LEFT JOIN tenant_agent_config tac ON tac.tenant_id = t.id
WHERE t.status = 'active'
ORDER BY tac.monthly_used DESC;
```
