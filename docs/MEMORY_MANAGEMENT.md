# Memory Management Reference

> Complete reference for the AI memory system across all three services.
> Source of truth: `pipeline/src/agents/memory.py`, `pipeline/src/agents/context.py`,
> `pipeline/src/agents/lifecycle/`, `pipeline/src/agents/learning/`.
> Last updated: 2026-05-23.

---

## 1. Architecture Overview

### Three Memory Types

| Type | Table | Purpose | V1 Retrieval | V2 Retrieval |
|------|-------|---------|-------------|-------------|
| **Episodic** | `episodic_memories` | Raw interaction records: "what happened" | Recency + `importance * decay_factor` | pgvector cosine similarity |
| **Semantic** | `semantic_memories` | Confirmed facts and preferences: "what I know" | `confidence DESC, evidence_count DESC` | pgvector cosine similarity |
| **Procedural** | `procedural_memories` | Learned step-by-step procedures: "how to do things" | `success_rate DESC, execution_count DESC` | pgvector cosine similarity |

### Four Memory Layers (originally from ARCHITECTURE_V5.md — now archived; see ARCHITECTURE_V9.md)

| Layer | Scope | Mutability | Description |
|-------|-------|-----------|-------------|
| **Foundational** | Shared, all tenants | Immutable (platform-maintained) | FAR/DFARS, agency structures, evaluation criteria, formatting standards |
| **Learned** | Cross-tenant, anonymized | Append-only (statistical) | Win rate correlations, agency preferences, scoring model weights |
| **Tenant** | Per-customer, persistent | Mutable (evolves with each proposal) | Company profile, tech focus, key personnel, writing style, feedback patterns |
| **Working** | Per-session, ephemeral | Volatile (promoted to Tenant if significant) | Current task context, conversation state |

In V1, Layers 1 and 2 are represented by archetype system prompts (baked into code).
Layers 3 and 4 are backed by the three PostgreSQL memory tables.

### Context Injection (Not Fine-Tuning)

Agents are stateless functions. Every invocation is a fresh Claude API call. There is no
fine-tuning, no persistent agent state, and no agent memory outside the database. The
quality of the agent's output depends entirely on what the `ContextAssembler` puts into
the prompt:

1. **Archetype system prompt** -- role definition, instructions, guardrails (~800 tokens, cacheable)
2. **Tenant profile** -- NAICS codes, keywords, agency priorities, focus areas (~500 tokens)
3. **Retrieved memories** -- episodic + semantic + procedural per agent role (~2,000-4,000 tokens)
4. **Task data** -- the event payload or user request (variable size)

The system prompt and tenant profile are wrapped in `--- BEGIN/END TRUSTED CONTEXT ---`
delimiters to separate trusted context from user-supplied input (prompt injection defense).

---

## 2. CMS Memory (Simple)

The CMS/CRM service (`services/cms/`) is stateless per-request. It has no AI memory.

**Event-driven logging only:**

| Table | What It Tracks |
|-------|---------------|
| `automation_log` | Rule evaluations: which rule fired, what action ran, pass/fail |
| `email_sends` | Individual email delivery attempts with status and timestamps |
| `campaign_execution_log` | Batch email campaign runs with aggregate metrics |
| `cms_generations` | Content generation history (AI-generated blog posts, social posts) |

There is no learning loop. Each CMS request is independent. The CMS does not read
from or write to `episodic_memories`, `semantic_memories`, or `procedural_memories`.

---

## 3. RFP Pipeline Admin Memory

The admin pipeline uses memory for cross-cycle intelligence during curation.

### Shredder Cross-Cycle Memory

When a curator pushes a solicitation to the pipeline, `solicitation.push` calls
`memory.write` with a namespace key:

```
agent_role:  'opportunity_analyst'
memory_type: 'procedural'
namespace:   '<agencyKey>'  (e.g., 'USAF:AFWERX:SBIR:Phase1')
content:     curated compliance values + key extraction patterns
```

When a future curator opens a NEW solicitation in the same namespace,
`loadPriorCycleSuggestions` (in `frontend/lib/curation/prefill.ts`) calls
`memory.search_namespace` to retrieve prior cycle data, then pre-fills the
compliance matrix with ghost suggestions.

### Curation Memory

- **Compliance presets** (`compliance_presets` table): reusable compliance templates
  per agency/program type. Not AI memory — human-curated templates.
- **Prior cycle pre-fill**: When the same agency/program combination appears in a new
  cycle, the compliance workspace is pre-populated from the last cycle's curated values.
  The curator accepts, edits, or discards each suggestion.

### Topic Extraction Patterns

The shredder worker uses Claude with versioned prompts (`prompt_version` stamped in
events) to extract structured data from solicitation documents. Patterns recognized
in prior cycles (stored as procedural memories under the namespace key) improve
extraction accuracy for future cycles.

### Admin Scope

Admin memory is **not tenant-isolated**. It operates at the platform level:
- `tenant_id` may be NULL for admin-scoped memories
- No RLS filtering for platform-level agent operations
- All admin users share the same memory pool for a given namespace

---

## 4. Tenant Portal Memory (The Hard Cutover)

### When Does Memory Become Tenant-Scoped?

Memory becomes tenant-scoped at the moment of **proposal purchase / workspace creation**.
Before that, the tenant exists (from application acceptance) but has no agent memories.

The transition:

| Event | Memory State |
|-------|-------------|
| `identity.purchase.completed` | Tenant workspace created. Memory tables are empty for this tenant. |
| First agent invocation (scoring, capture strategy) | First episodic memory written. |
| First proposal created | Proposal-layer agents begin accumulating episodic memories. |
| Day 30+ | PreferenceExtractor begins finding patterns; semantic memories emerge. |
| Day 90+ | PatternPromoter promotes confirmed clusters. Agents start "knowing" the tenant. |

### How tenant_id Isolates All Memory Queries

**Four layers of isolation:**

| Layer | Mechanism |
|-------|-----------|
| **Database RLS** | Row-Level Security policies on `episodic_memories`, `semantic_memories`, `procedural_memories`, `agent_task_log` using `current_setting('app.current_tenant_id')` |
| **Query enforcement** | Every memory query includes `WHERE tenant_id = $1` with the tenant UUID as a parameter |
| **Context assembly** | `ContextAssembler._retrieve_episodic/semantic/procedural()` all filter by `tenant_uuid` |
| **Tool parameter stripping** | `tenant_id` is NEVER accepted from tool input — always injected from invocation context |

### Per-Tenant Memory Lifecycle

Day 1: The tenant starts with zero memories. Agents operate on the archetype system
prompt and tenant profile alone. Output quality is generic (~40% acceptance rate).

Over time, the learning flywheel turns:

```
Agent Output
    |
    v
Human Edits draft
    |
    v
DiffAnalyzer captures edit patterns (on-event)
    |
    v
PreferenceExtractor finds repeated patterns (daily)
    |
    v
PatternPromoter promotes to semantic memory (weekly)
    |
    v
ContextAssembler injects memory into next call
    |
    v
Better Agent Output (smaller diffs, more autonomy)
```

### Memory Namespace Keys for Cross-Cycle Learning

Tenant memory uses namespace keys to enable cross-cycle recall:

- `{agent_role}:{tenant_id}:{category}` -- standard recall scope
- Agent role + tenant combo ensures memories are only recalled for the correct
  archetype operating on the correct tenant

---

## 5. Proposal Workspace Memory

### Per-Proposal Context

Each proposal generates memories scoped to `proposal_id` in the `agent_task_log`
and through entity references in episodic memories:

| Data Source | Purpose |
|------------|---------|
| `proposal_sections` (content column) | Current section drafts in canvas document format |
| `proposal_compliance_matrix` | Per-variable compliance status (pass/fail/partial) |
| `proposal_comments` | Review feedback per section |
| `proposal_stage_history` | Stage transition audit trail |
| `proposal_activity_log` | Collaboration activity (who did what when) |

### Canvas Version History as Content Memory

The `canvas_versions` table stores every saved version of each proposal section.
This provides content memory — agents can reference prior drafts to understand the
evolution of a section, what was changed, and what was reverted.

### The AI Draft to Human Edit to AI Revision Chain

```
1. User clicks "AI Draft" on a section
2. Section Drafter agent invoked with:
   - Section requirements from compliance matrix
   - Library units relevant to this section
   - Tenant writing preferences (from semantic memories)
   - Prior draft versions (if revision, not first draft)
3. Agent produces draft with [PLACEHOLDER] markers for unverified claims
4. Human reviews and edits the draft
5. DiffAnalyzer fires on section.edited event:
   - Computes edit distance and percentage
   - Classifies change type (STYLE/CONTENT/STRUCTURE/MINOR)
   - Creates episodic memory of the edit pattern
6. If user requests "AI Revise" on the edited section:
   - Section Drafter sees the human edits + the original draft
   - Episodic memories of prior edits inform better output
   - Semantic preferences (if accumulated) shape tone and structure
```

### Outcome Recording and Feedback

When a proposal outcome (win/loss) is recorded:

1. `OutcomeAttributor` runs (on-event, triggered by `proposal.outcome.recorded`)
2. Traces the outcome back to contributing agent tasks and library units
3. Updates `agent_performance` metrics
4. Creates episodic memories recording the outcome attribution
5. Winning library units get boosted; losing ones get flagged for review
6. This feeds the learning flywheel: future proposals start with better context

---

## 6. Memory Lifecycle

### Schedule Reference (from `lifecycle_scheduler.py`)

| Schedule | Time (UTC) | Modules |
|----------|-----------|---------|
| **Daily** | 3:00 AM | MemoryDecay, PreferenceExtractor |
| **Weekly** | Monday 4:00 AM | MemoryGC, PatternPromoter |
| **Monthly** | 1st Monday 5:00 AM | MemoryCompactor, ContradictionResolver, Calibrator |

### Daily: MemoryDecay (`lifecycle/decay.py`)

Applies gradual decay to `decay_factor` values on episodic memories.

**Formula (from the migration/design doc):**

```sql
UPDATE episodic_memories
SET decay_factor = GREATEST(
    0.01,                                    -- floor: never goes to zero
    decay_factor * (
        0.995                                -- base daily decay
        * (1.0 + 0.1 * LN(GREATEST(access_count, 1)))  -- access boost
        * CASE
            WHEN importance > 0.8 THEN 0.999  -- important decays slower
            WHEN importance < 0.3 THEN 0.98   -- unimportant decays faster
            ELSE 1.0
          END
    )
)
WHERE NOT is_archived
  AND last_accessed < now() - INTERVAL '1 day';
```

**Exemptions:**
- Memories accessed in the last 7 days are exempt (access recency boost via the formula)
- Memories with `importance >= 0.9` have a practical floor (human-pinned)

**Decay rates by memory type:**

| Memory Type | Mechanism | Notes |
|-------------|----------|-------|
| Episodic | `decay_factor` column, 0.995/day base | Fastest decay, ranges from 0.01 to 1.0 |
| Semantic | N/A in V1 | Uses `confidence` as proxy; evidence-based, not time-based |
| Procedural | N/A in V1 | Uses `success_rate` as proxy; execution-based |

**Event emitted:** `system:memory.decay_applied`

### Daily: PreferenceExtractor (`learning/preference_extractor.py`)

Runs once per active tenant. Scans episodic memories from the last 30 days with
`importance > 0.3`. Groups by `agent_role`. When the same edit type or keyword pattern
appears **3+ times**, extracts a semantic memory representing a tenant preference.

**Event emitted:** `system:memory.preferences_extracted`

### Weekly: MemoryGC (`lifecycle/gc.py`)

Hard-deletes memories past retention period. Runs across all tenants.

| Rule | Criteria | Safety Guard |
|------|----------|-------------|
| Archived episodic > 6 months | `DELETE WHERE is_archived AND created_at < now() - '6 months'` | Never deletes `importance >= 0.9` |
| Inactive semantic > 3 months | `DELETE WHERE NOT is_active AND valid_until < now() - '3 months'` | Never deletes `evidence_count >= 5` |
| Procedural > 12 months | Delete if no execution (`execution_count = 0`) | Active procedures are never deleted |
| Low-value episodic | Archive (not delete) if `decay_factor < 0.05 AND importance < 0.2 AND access_count < 2 AND occurred_at < 60 days` | Sets `is_archived = true` only |

**Event emitted:** `system:memory.gc_completed`

### Weekly: PatternPromoter (`learning/pattern_promoter.py`)

Runs once per active tenant. Finds clusters of 3+ similar unarchived episodic memories
grouped by `agent_role` + `memory_type`. Similarity measured by keyword overlap
(set intersection > 50%).

For each cluster:
1. Creates a semantic memory with summarized content
2. Sets confidence based on cluster size (more members = higher confidence)
3. Records source episodic IDs in `source_memories` array
4. Archives the original episodic memories

**Event emitted:** `system:memory.pattern_promoted`

### Monthly: MemoryCompactor (`lifecycle/compactor.py`)

Runs per active tenant. Finds clusters of similar old episodic memories
(older than 30 days). Uses keyword overlap > 60% to identify clusters.
For clusters with **5+ members**:

1. Creates a semantic memory with summarized content
2. Archives the originals

This differs from PatternPromoter in threshold (5+ vs 3+) and age requirement
(30+ days vs any age). The compactor handles the long tail of memories that
didn't get promoted but are still redundant.

**Event emitted:** `system:memory.compaction_completed`

### Monthly: ContradictionResolver (`lifecycle/contradiction_resolver.py`)

Runs per active tenant, after the compactor. Scans active semantic memories
grouped by category. Detects contradictions using opposing word pairs
(e.g., "formal"/"casual", "brief"/"detailed", "always"/"never").

**Resolution strategy:**
- Higher confidence wins: lower confidence memory is deactivated (`is_active = false`)
- If confidence is within 0.1: flagged for human review (not auto-resolved)

**Event emitted:** `system:memory.contradictions_resolved`

### Monthly: Calibrator (`learning/calibrator.py`)

Runs per active tenant. Aggregates per-role metrics from `agent_task_log`
over the last 90 days:

| Metric | Source |
|--------|--------|
| Acceptance rate | `human_accepted` column |
| Average edit percentage | `human_edit_pct` column |
| Cost per task | `cost_usd` column |
| Task count | `COUNT(*)` |

Flags roles with acceptance_rate < 50% for memory review. Suggests model changes:
- Consistently high-quality roles (>80% acceptance) -> Haiku (cost savings)
- Consistently low-quality roles (<50% acceptance) -> Opus (quality upgrade)

Writes results to `agent_performance` table.

**Event emitted:** `system:agent.calibrated`

---

## 7. Memory Retrieval for Agent Context

### How ContextAssembler Loads Memories

The `ContextAssembler` (in `context.py`) queries three memory tables on every
invocation. There is no caching in V1 — every call is a fresh read.

**Retrieval pipeline:**

| Step | Query | Limit | Sort Order |
|------|-------|-------|------------|
| 1. Load tenant profile | `tenant_profiles JOIN tenants` | 1 row | N/A |
| 2. Retrieve episodic | `episodic_memories WHERE tenant_id AND agent_role AND NOT is_archived` | 10 | `(importance * decay_factor) DESC, occurred_at DESC` |
| 3. Retrieve semantic | `semantic_memories WHERE tenant_id AND agent_role AND is_active` | 8 | `confidence DESC, evidence_count DESC, updated_at DESC` |
| 4. Retrieve procedural | `procedural_memories WHERE tenant_id AND agent_role AND is_active` | 5 | `success_rate DESC, execution_count DESC` |

### Token Budgets per Memory Type

| Category | Max Tokens | ~Max Characters |
|----------|-----------|-----------------|
| Episodic memories | 2,000 | 8,000 |
| Semantic memories | 1,500 | 6,000 |
| Procedural memories | 1,000 | 4,000 |
| Tenant profile | 500 | 2,000 |

Each memory category is independently truncated. If a single memory exceeds
the remaining budget, it is skipped entirely (no partial memories).

### Scoring

**V1 (current):** Pure database-level scoring:
- Episodic: `importance * decay_factor` (higher = more relevant + more recent)
- Semantic: `confidence` then `evidence_count` (more confirmed = more trusted)
- Procedural: `success_rate` then `execution_count` (more successful = more useful)

**V2 (planned):** Hybrid scoring with vector similarity:

```
composite_score =
    0.40 * similarity          -- vector cosine similarity to query
  + 0.20 * effective_importance -- importance * decay (or confidence/success_rate)
  + 0.20 * recency_score       -- time-based decay from occurred_at
  + 0.10 * access_score        -- LEAST(access_count / 10.0, 1.0)
  + 0.10 * type_bonus          -- procedural: 1.0, semantic: 0.8, episodic: 0.5
```

### Trusted Context Delimiters

The assembled prompt uses clear delimiters for prompt injection defense:

```
{archetype system prompt}

--- BEGIN TRUSTED CONTEXT ---
## Tenant Profile
{profile data}

## Relevant Memories
### Past Interactions (Episodic)
{episodic memories}

### Known Facts & Preferences (Semantic)
{semantic memories}

### Learned Procedures
{procedural memories}
--- END TRUSTED CONTEXT ---
```

User-supplied task data is placed in the user message, never in the system prompt.

---

## 8. Memory Maturation Timeline

| Milestone | Episodic | Semantic | Procedural | Est. Acceptance Rate |
|-----------|----------|----------|------------|---------------------|
| **Day 1** | 0 | ~5 (seeded from tenant profile) | 0 | ~40% |
| **Day 30** | ~50 | ~10 (preferences extracted) | 0 | ~55% |
| **Day 180** | ~250 (compacted) | ~40 | ~5 | ~70% |
| **Day 365** | ~200 (GC'd) | ~80 | ~15 | ~80% |
| **Day 1000** | ~300 | ~150 | ~30 | ~85%+ |

**Day 1:** Agent has only the archetype system prompt and tenant profile. Output is
generic. Human edits are heavy (60%+ of content changed). Every interaction creates
an episodic memory.

**Day 30:** PreferenceExtractor has run ~30 times. PatternPromoter has run ~4 times.
If 3+ similar edit patterns exist, semantic preferences are created. Agents begin
adapting to the tenant's writing style and formatting preferences.

**Day 180:** MemoryGC has deleted archived episodic memories older than 6 months.
MemoryCompactor has consolidated redundant clusters. Surviving memories are
high-value, well-confirmed knowledge. Agents produce drafts that require
significantly less editing.

**Day 365:** Procedural memories with no execution are eligible for GC. Semantic
memories with `evidence_count >= 5` are effectively permanent. Calibrator has
recalibrated ~12 times. Agent performance metrics are stable and meaningful.

**Day 1000+:** Only highly-confirmed semantic and frequently-used procedural
memories survive. The memory store is lean and high-signal. Agents predict
tenant preferences, writing styles, and even strategic decisions with high
accuracy.

---

## 9. File Map

### Core Agent System

| File | Description |
|------|-------------|
| `pipeline/src/agents/__init__.py` | Package exports: AgentFabric, ContextAssembler, MemoryStore, ToolRegistry |
| `pipeline/src/agents/fabric.py` | Central orchestrator: routing, rate limits, budgets, tool-use loop, cost tracking |
| `pipeline/src/agents/context.py` | Prompt assembler: tenant profile + memories + task data with token budgets |
| `pipeline/src/agents/tools.py` | Tool registry with 9 tenant-isolated tools and Anthropic-format definitions |
| `pipeline/src/agents/memory.py` | Memory store: episodic/semantic/procedural CRUD with lifecycle support |

### Archetypes

| File | Description |
|------|-------------|
| `pipeline/src/agents/archetypes/__init__.py` | Exports all 10 archetype classes |
| `pipeline/src/agents/archetypes/base.py` | Abstract base class with role_name, system_prompt, tools, handles_event |
| `pipeline/src/agents/archetypes/opportunity_analyst.py` | Platform agent: parses RFPs, extracts requirements matrices |
| `pipeline/src/agents/archetypes/scoring_strategist.py` | Company agent: LLM-based score adjustment (-15 to +15) |
| `pipeline/src/agents/archetypes/capture_strategist.py` | Company agent: go/no-go recommendation, win themes |
| `pipeline/src/agents/archetypes/proposal_architect.py` | Proposal agent: outline design, requirement mapping |
| `pipeline/src/agents/archetypes/section_drafter.py` | Proposal agent: drafts proposal sections (highest volume) |
| `pipeline/src/agents/archetypes/compliance_reviewer.py` | Proposal agent: per-variable compliance verification |
| `pipeline/src/agents/archetypes/color_team_reviewer.py` | Proposal agent: Pink/Red/Gold team review simulation |
| `pipeline/src/agents/archetypes/librarian.py` | Company agent: content cataloging, scoring, dedup |
| `pipeline/src/agents/archetypes/partner_coordinator.py` | Proposal agent: partner communications and tracking |
| `pipeline/src/agents/archetypes/packaging_specialist.py` | Proposal agent: final package compilation and validation |

### Learning Modules

| File | Description |
|------|-------------|
| `pipeline/src/agents/learning/__init__.py` | Exports: DiffAnalyzer, PreferenceExtractor, PatternPromoter, OutcomeAttributor, Calibrator |
| `pipeline/src/agents/learning/diff_analyzer.py` | On-event: classifies human edits (STYLE/CONTENT/STRUCTURE/MINOR) |
| `pipeline/src/agents/learning/preference_extractor.py` | Daily: extracts repeated patterns into semantic preferences |
| `pipeline/src/agents/learning/pattern_promoter.py` | Weekly: promotes episodic clusters to semantic memories |
| `pipeline/src/agents/learning/outcome_attributor.py` | On-event: traces win/loss outcomes to contributing content |
| `pipeline/src/agents/learning/calibrator.py` | Monthly: recalibrates agent performance metrics |

### Lifecycle Modules

| File | Description |
|------|-------------|
| `pipeline/src/agents/lifecycle/__init__.py` | Exports: MemoryDecay, MemoryGC, MemoryCompactor, ContradictionResolver |
| `pipeline/src/agents/lifecycle/decay.py` | Daily: applies time-based decay to episodic memory importance |
| `pipeline/src/agents/lifecycle/gc.py` | Weekly: hard-deletes memories past retention period |
| `pipeline/src/agents/lifecycle/compactor.py` | Monthly: compresses similar episodic clusters into semantic summaries |
| `pipeline/src/agents/lifecycle/contradiction_resolver.py` | Monthly: detects and resolves conflicting semantic memories |

### Scheduler

| File | Description |
|------|-------------|
| `pipeline/src/lifecycle_scheduler.py` | Hourly check loop that runs daily/weekly/monthly lifecycle jobs on schedule |

### Design Documents

| File | Description |
|------|-------------|
| `docs/agent-fabric/03-MEMORY-ARCHITECTURE.md` | Full memory schema, indexes, RLS, retrieval queries, lifecycle SQL |
| `docs/agent-fabric/07-COST-MODEL.md` | Cost analysis, scaling projections, break-even calculations |
| `docs/archive/AGENT_FRAMEWORK.md` | Agent system architecture, all 10 archetypes, tool registry |
| `docs/AGENT_FABRIC_DESIGN.md` | High-level agent fabric design document |

### Database Schema

| File | Description |
|------|-------------|
| `db/migrations/001_baseline.sql` | Creates episodic_memories, semantic_memories, procedural_memories, agent_task_log, agent_task_queue, agent_task_results, tenant_agent_config, agent_performance |

### Frontend (Agent-Related)

| File | Description |
|------|-------------|
| `frontend/app/admin/agents/page.tsx` | Admin agent monitoring page (tool registry + recent invocations) |
| `frontend/app/api/admin/agents/route.ts` | Admin agent API: task queue summary, failures, tool events |
| `frontend/app/api/admin/agents/usage/route.ts` | Admin usage dashboard API: costs, trends, per-tenant spend |
| `frontend/app/api/portal/[tenantSlug]/agents/config/route.ts` | Tenant agent configuration (enabled agents, preferences) |
| `frontend/app/api/portal/[tenantSlug]/agents/performance/route.ts` | Tenant agent performance metrics |
| `frontend/app/api/portal/[tenantSlug]/agents/memories/route.ts` | Tenant agent memory browsing |
| `frontend/app/api/portal/[tenantSlug]/agents/usage/route.ts` | Tenant usage API: calls, budget, recent activity |
