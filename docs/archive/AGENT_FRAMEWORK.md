# Agent Framework Reference

> Authoritative reference for the AI agent system in the RFP Pipeline Portal.
> Source of truth: `pipeline/src/agents/`. Last updated: 2026-05-22.

---

## 1. Architecture Overview

### Core Philosophy

Agents are **stateless functions with injected context**. There is no fine-tuning, no persistent agent state, and no agent memory outside the database. Every invocation is a fresh Claude API call whose behavior is shaped entirely by what the `ContextAssembler` puts into the prompt.

### Three-Layer Model

```
PLATFORM LAYER
  Agents that operate on platform-wide data, not scoped to a tenant.
  Example: Opportunity Analyst (parses RFPs once, shared across tenants)

COMPANY LAYER
  Per-tenant agents that learn company-specific patterns over time.
  Examples: Scoring Strategist, Capture Strategist, Librarian

PROPOSAL LAYER
  Per-proposal agents that exist for the lifecycle of one proposal.
  Examples: Section Drafter, Compliance Reviewer, Partner Coordinator,
            Proposal Architect, Color Team Reviewer, Packaging Specialist
```

### Context Injection (Not Fine-Tuning)

Every agent call assembles a prompt from four sources:

1. **Archetype system prompt** -- role definition, instructions, guardrails (~800 tokens, cacheable)
2. **Tenant profile** -- NAICS codes, keywords, agency priorities, focus areas (~500 tokens)
3. **Retrieved memories** -- episodic + semantic + procedural per agent role (~2,000-4,000 tokens)
4. **Task data** -- the event payload or user request (variable size)

The quality of context assembly directly determines output quality.

### The Learning Flywheel

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

---

## 2. Core Components

### 2.1 AgentFabric (`fabric.py`)

The central orchestrator. Owns the Anthropic client, memory store, context assembler, and tool registry. All agent invocations flow through the fabric.

**Invocation sequence:**

| Step | Action | Details |
|------|--------|---------|
| 1 | Emit `tool:agent.invoked` start event | Observability |
| 2 | Check rate limit | 50 calls/hour/tenant |
| 3 | Check monthly budget | Default $50/month, configurable per tenant |
| 4 | Assemble context | Via `ContextAssembler` |
| 5 | Call Claude API with tool-use loop | Max 20 rounds |
| 6 | Calculate cost | `input_tokens * $3/1M + output_tokens * $15/1M` |
| 7 | Store episodic memory | Interaction summary for future recall |
| 8 | Log to `agent_task_log` | Tokens, cost, duration, errors |
| 9 | Emit `tool:agent.invoked` end event | Observability |
| 10 | Return structured result | `{status, result, tokens, cost_usd, duration_ms}` |

**Task queue processing:**
- Polls `agent_task_queue` for pending tasks
- Uses `FOR UPDATE SKIP LOCKED` for safe multi-worker dequeuing
- Claims up to 5 tasks per poll cycle
- Stores results in `agent_task_results`

**Key constants:**

```python
MAX_TOOL_ROUNDS = 20
RATE_LIMIT_PER_HOUR = 50
DEFAULT_MONTHLY_BUDGET_USD = 50.00
DEFAULT_MODEL = "claude-sonnet-4-20250514"
DEFAULT_MAX_TOKENS = 4096
INPUT_COST_PER_TOKEN = 3.0 / 1_000_000   # $3/1M input (kept for backwards-compat)
OUTPUT_COST_PER_TOKEN = 15.0 / 1_000_000  # $15/1M output (kept for backwards-compat)
```

> Costing is now **per model** via `MODEL_PRICING` (Haiku $1/$5, Sonnet $3/$15 per 1M) with a `_cost_for(model, …)` helper, plus a `PER_CALL_CEILING_USD = 0.50` mid-loop ceiling. Effective rate/budget/ceiling limits resolve tenant override → `platform_agent_config` default → hardcoded constant, gated by a platform-wide AI master switch (`platform_agent_config.ai_enabled`).

**Exception classes:**
- `RateLimitExceeded` -- tenant exceeded 50 calls/hour
- `BudgetExceeded` -- tenant exceeded monthly AI budget

### 2.2 ContextAssembler (`context.py`)

Builds the complete prompt for every Claude API call. Stateless -- queries the database on every invocation (no caching in V1).

**Assembly steps:**

1. Load tenant profile from `tenant_profiles` + `tenants` tables
2. Retrieve episodic memories (sorted by `importance * decay_factor`, limit 10)
3. Retrieve semantic memories (sorted by `confidence`, limit 8)
4. Retrieve procedural memories (sorted by `success_rate`, limit 5)
5. Format system prompt with trusted context delimiters
6. Build messages via archetype's `build_messages()` or default serialization
7. Collect tool definitions from archetype

**Token budgets per category:**

| Category | Max Tokens | ~Max Characters |
|----------|-----------|-----------------|
| Episodic memories | 2,000 | 8,000 |
| Semantic memories | 1,500 | 6,000 |
| Procedural memories | 1,000 | 4,000 |
| Tenant profile | 500 | 2,000 |

**Prompt injection defense:**

Trusted context is wrapped in clear delimiters that separate it from user input:

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

### 2.3 ToolRegistry (`tools.py`)

Maps tool names to async handler functions. Every execution enforces tenant isolation.

**Security model:**
- `tenant_id` is **never** accepted from tool input -- always from invocation context
- Every query includes `WHERE tenant_id = $1`
- Tool execution failures return error dicts, never crash the agent
- Archetype allowlists restrict which tools each agent can call

**9 registered tools (V1):**

| Tool | Tenant Scoped | Description |
|------|:---:|-------------|
| `memory.search` | Yes | Search episodic/semantic/procedural memories by keyword (ILIKE) |
| `memory.write` | Yes | Write a new episodic memory entry |
| `library.search` | Yes | Search library units by keyword and/or category |
| `library.get_unit` | Yes | Get specific library unit content by ID |
| `proposal.get_sections` | Yes | Get proposal sections (joined through `proposals` for tenant check) |
| `proposal.get_compliance` | Yes | Get compliance matrix for a proposal |
| `opportunity.get_detail` | No | Get opportunity/solicitation details (shared data) |
| `tenant.get_profile` | Yes | Get tenant profile (capabilities, focus areas) |
| `compliance.check` | No | Get compliance rules for a solicitation |

**Execution flow:**

```
1. Validate tool exists in registry
2. Validate tool is in archetype's allowed list
3. Validate tenant_id is set (for tenant-scoped tools)
4. Strip tenant_id from params (never trust tool input)
5. Execute handler with tenant isolation
6. Return structured result or error dict
```

### 2.4 MemoryStore (`memory.py`)

PostgreSQL-backed memory with tenant isolation using the `episodic_memories`, `semantic_memories`, and `procedural_memories` tables.

**Three memory types:**

| Type | Table | Purpose | Retrieval (V1) |
|------|-------|---------|----------------|
| Episodic | `episodic_memories` | Raw interaction records | Recency + `importance * decay_factor` |
| Semantic | `semantic_memories` | Confirmed facts and preferences | `confidence DESC, evidence_count DESC` |
| Procedural | `procedural_memories` | Learned step-by-step procedures | `success_rate DESC, execution_count DESC` |

**Key operations:**

| Method | Description |
|--------|-------------|
| `store()` | Write episodic memory with zero vector placeholder |
| `recall()` | Retrieve recent memories by importance * decay, update access tracking |
| `search()` | V2 stub -- currently delegates to `recall()` |
| `write_semantic()` | Create semantic memory (via episodic table with metadata) |
| `write_procedural()` | Create procedural memory (via episodic table with metadata) |
| `promote_to_semantic()` | Create semantic memory from a cluster of episodic memories |
| `archive_memories()` | Bulk archive episodic memories (`is_archived = true`) |
| `update_decay()` | Update decay factor for a specific memory (clamped to 0.01-1.0) |
| `get_memories_for_lifecycle()` | Fetch old memories for decay/compaction/GC processing |

**V1 vs V2:**
- V1: Zero vector placeholder (1536 dims), text-based ILIKE search, recency-based recall
- V2: Real embeddings via `text-embedding-3-small`, pgvector cosine similarity search

---

## 3. Agent Archetypes

### Quick Reference Table

| # | Archetype | Layer | Model | Human Gate | Cost/Call | Calls/Proposal |
|---|-----------|-------|-------|:----------:|----------:|---------------:|
| 1 | Opportunity Analyst | Platform | Haiku | No | $0.14 | 1x (per opp) |
| 2 | Scoring Strategist | Company | Haiku | No | $0.06 | 1x |
| 3 | Capture Strategist | Company | Sonnet | Yes | $0.17 | 1x |
| 4 | Proposal Architect | Proposal | Sonnet | Yes | $0.13 | 2x |
| 5 | Section Drafter | Proposal | Sonnet | Yes | $0.10 | 15x |
| 6 | Compliance Reviewer | Proposal | Haiku | No | $0.12 | 4x |
| 7 | Color Team Reviewer | Proposal | Sonnet | Yes | $0.23 | 3x |
| 8 | Librarian | Company | Haiku | No* | $0.14 | 3x |
| 9 | Partner Coordinator | Proposal | Haiku | Yes | $0.05 | 10x |
| 10 | Packaging Specialist | Proposal | Haiku | Yes | $0.11 | 1x |

\* Implicit gate: new library units are created in DRAFT status; tenant admin must approve.

> **As-built wiring status (2026-07-15).** All 10 archetypes are registered in `fabric.py`, but only a subset has a live producer driving it. The per-archetype "Trigger events" listed below are the *declared* `handles_event` triggers — not proof of an active caller. The fabric's event dispatcher (`handle_event`) is not called anywhere in the pipeline; archetypes are invoked either by explicit `invoke_agent(role, …)` calls or by `agent_task_queue` rows keyed on `agent_role`.
>
> | Archetype | As-built status |
> |---|---|
> | Section Drafter | **WIRED end-to-end** — driven by the `draft_v0` V0-strawman action on `OnProposalCreated` and by the synchronous `ai/draft` route (registered `proposal.draft_section` tool) |
> | Compliance Reviewer | **PARTIAL** — the live compliance check runs INLINE in the Next `ai/compliance` route (Anthropic SDK directly, Haiku), billed to the ledger as `compliance_reviewer` but NOT executed through the fabric archetype |
> | Color Team Reviewer | **DEFINED, one live path** — the `ai/review` button route is event-only (emits `proposal:proposal.review_requested`; nothing consumes that event). Its live invocation is the advance-path enqueue (`ai_review_on_advance`, default-on) → `agent_task_queue` → `fabric.process_task_queue` → `proposal_comments` write-back, gated on the pipeline `ANTHROPIC_API_KEY` |
> | Other 7 | ⚠ **Dormant** — registered, no producer |

---

### 3.1 Opportunity Analyst

**Role:** Reads and understands solicitations. Parses RFPs on ingestion to produce structured requirements matrices.

| Property | Value |
|----------|-------|
| `role_name` | `opportunity_analyst` |
| Layer | Platform |
| Model | `claude-haiku-4-5-20251001` |
| `max_tokens` | 4096 |
| `temperature` | 0.2 |
| Human gate | No (runs autonomously on ingestion) |
| Cost per call | $0.14 |

**Trigger events:**
- `finder.opportunity.ingested` -- new opportunity from SAM.gov/SBIR.gov/Grants.gov

**Tools:** `get_tenant_profile`, `search_past_awards`

**Inputs:** Full solicitation text, agency template knowledge, amendment history

**Outputs:**
- Structured requirements matrix with evaluation weights
- Submission format requirements
- Eligibility constraints (size standards, certifications, clearances)
- Risk flags (short timelines, complex teaming requirements)

**Instantiated:** Admin Pipeline (on ingestion, once per opportunity, not per tenant)

---

### 3.2 Scoring Strategist

**Role:** Evaluates opportunity fit for specific tenants by providing an LLM-based score adjustment on top of algorithmic scores.

| Property | Value |
|----------|-------|
| `role_name` | `scoring_strategist` |
| Layer | Company |
| Model | `claude-haiku-4-5-20251001` |
| `max_tokens` | 2048 |
| `temperature` | 0.2 |
| Human gate | No (advisory only) |
| Cost per call | $0.06 |

**Trigger events:**
- `finder.opportunity.ingested` (after opportunity analyst)
- `finder.scoring.completed` (for high-potential opportunities)
- `capture.proposal.outcome_recorded` (recalibration on win/loss)

**Tools:** `get_tenant_profile`, `search_memory`

**Inputs:** Opportunity metadata + analyst output, tenant profile, past outcomes, scoring calibration memories

**Outputs:**
- Score adjustment: -15 to +15 points
- Rationale (2-3 sentences)
- Factor breakdown with per-factor impact
- Competitive risk assessment
- Confidence level

**Instantiated:** Customer Portal (per tenant per high-scoring opportunity)

---

### 3.3 Capture Strategist

**Role:** Recommends whether to pursue an opportunity and develops a winning capture strategy.

| Property | Value |
|----------|-------|
| `role_name` | `capture_strategist` |
| Layer | Company |
| Model | `claude-sonnet-4-20250514` |
| `max_tokens` | 8192 |
| `temperature` | 0.3 |
| Human gate | Yes (affects pursuit decision) |
| Cost per call | $0.17 |

**Trigger events:**
- `capture.pursuit.evaluation_requested` (user clicks "Analyze Fit")
- `identity.purchase.completed` (proposal portal purchased)

**Tools:** `get_tenant_profile`, `get_opportunity_detail`, `search_library`, `search_memory`

**Inputs:** Full RFP analysis, tenant profile + past performance, scoring results, similar past proposals, competitive landscape

**Outputs:**
- Go/No-Go recommendation with confidence score
- Win themes (3-5 discriminating themes)
- Competitive positioning assessment
- Teaming recommendations for capability gaps
- Risk register (technical, schedule, cost, competitive)
- Estimated level of effort

**Instantiated:** Customer Portal (on-demand when customer requests fit analysis)

---

### 3.4 Proposal Architect

**Role:** Designs proposal structure, maps content to requirements, and allocates page budgets.

| Property | Value |
|----------|-------|
| `role_name` | `proposal_architect` |
| Layer | Proposal |
| Model | `claude-sonnet-4-20250514` |
| `max_tokens` | 8192 |
| `temperature` | 0.3 |
| Human gate | Yes (outline must be approved before drafting) |
| Cost per call | $0.13 |

**Trigger events:**
- `proposal.created` (new proposal portal purchased)
- `capture.proposal.stage_changed` to outline
- User requests "Redesign outline" on demand

**Tools:** `get_opportunity_detail`, `get_compliance`, `search_library`, `search_memory`

**Inputs:** Requirements matrix, compliance variables + page limits, library content by category, past proposal structures

**Outputs:**
- Hierarchical proposal outline with section structure
- Page allocation per section
- Requirement-to-section mapping
- Suggested library units per section
- Writing guidance per section
- Compliance coverage percentage

**Instantiated:** Customer Portal (when proposal is created or outline stage entered)

---

### 3.5 Section Drafter

**Role:** Expert proposal writer. Highest-volume agent -- runs once per section per proposal.

| Property | Value |
|----------|-------|
| `role_name` | `section_drafter` |
| Layer | Proposal |
| Model | `claude-sonnet-4-20250514` |
| `max_tokens` | 8192 |
| `temperature` | 0.3 (inherited default) |
| Human gate | Yes (every draft goes to human for review) |
| Cost per call | $0.10 |

**Trigger events:**
- `proposal.section.draft_requested` (user clicks "AI Draft" or auto-draft on stage change)

**Tools:** `search_library`, `get_compliance`

**Inputs:** Section assignment + requirements, relevant library units, past proposal sections, tenant writing style preferences, page/word limits

**Outputs:**
- Draft section content with markdown-style headings
- `[PLACEHOLDER: description]` markers for claims needing verification
- Content grounded in contractor's actual capabilities from library atoms

**Instantiated:** Customer Portal (per section, on demand or auto-draft at draft stage)

---

### 3.6 Compliance Reviewer

**Role:** Verifies every solicitation requirement is addressed. Quality gate for requirement coverage.

| Property | Value |
|----------|-------|
| `role_name` | `compliance_reviewer` |
| Layer | Proposal |
| Model | `claude-haiku-4-5-20251001` |
| `max_tokens` | 4096 |
| `temperature` | 0.2 |
| Human gate | No (advisory output -- flags displayed in UI) |
| Cost per call | $0.12 |

**Trigger events:**
- `proposal.compliance.check_requested` (on demand or stage transition)
- `capture.section.drafted` (check newly drafted section)
- `capture.proposal.stage_changed` to pink_team/final (full check)

**Tools:** `get_sections`, `get_compliance`, `search_memory`

**Inputs:** All proposal sections, compliance variables (requirements matrix), prior compliance patterns from memory

**Outputs:**
- Per-variable compliance matrix: pass / fail / partial / not_applicable
- Evidence excerpts (max 200 chars)
- Gap descriptions for failures
- Section references for traceability

**Instantiated:** Customer Portal (per proposal during draft/review/final stages)

---

### 3.7 Color Team Reviewer

**Role:** Simulates formal color team reviews (Pink/Red/Gold).

| Property | Value |
|----------|-------|
| `role_name` | `color_team_reviewer` |
| Layer | Proposal |
| Model | `claude-sonnet-4-20250514` |
| `max_tokens` | 8192 |
| `temperature` | 0.3 (inherited default) |
| Human gate | Yes (AI review happens before human review) |
| Cost per call | $0.23 |

**Trigger events:**
- `proposal.review_requested` (pink_team/red_team/gold_team stage transitions or on-demand)

**Tools:** `get_eval_criteria`, `get_compliance_matrix`

**Scoring rubric:**
- Outstanding (Blue) / Good (Green) / Acceptable (Yellow) / Marginal (Orange) / Unacceptable (Red)

**Inputs:** Full proposal at current stage, evaluation criteria and weights, agency scoring rubric, previous review feedback

**Outputs:**
- Section-by-section score against evaluation criteria
- Strengths and weaknesses
- Specific revision recommendations with priority
- Overall win probability estimate

**Instantiated:** Customer Portal (3x per proposal: pink, red, gold)

---

### 3.8 Librarian

**Role:** Catalogs, scores, and retrieves content library units. Manages content lifecycle from ingestion to retirement.

| Property | Value |
|----------|-------|
| `role_name` | `librarian` |
| Layer | Company |
| Model | `claude-haiku-4-5-20251001` |
| `max_tokens` | 2048 |
| `temperature` | 0.2 |
| Human gate | No (implicit: units created in DRAFT status) |
| Cost per call | $0.14 |

**Trigger events:**
- `library.unit.created` (new content uploaded)
- `library.bulk_import.completed` (batch import)
- `capture.partner.upload_received` (partner document decomposition)
- `capture.proposal.submitted` (harvest content)
- `capture.proposal.outcome_recorded` (tag with win/loss)

**Tools:** `search_library`, `search_memory`, `get_tenant_profile`

**Inputs:** New content text, existing library units (for dedup), tenant profile, usage patterns

**Outputs:**
- Category classification
- Quality score (0-1) and relevance score (0-1)
- Suggested tags
- Duplicate candidate IDs
- Freshness assessment
- Content summary

**Instantiated:** Customer Portal (on content upload or bulk import)

---

### 3.9 Partner Coordinator

**Role:** Manages partner/subcontractor communications and coordination.

| Property | Value |
|----------|-------|
| `role_name` | `partner_coordinator` |
| Layer | Proposal |
| Model | `claude-haiku-4-5-20251001` |
| `max_tokens` | 2048 |
| `temperature` | 0.3 |
| Human gate | Yes (all external communications require review) |
| Cost per call | $0.05 |

**Trigger events:**
- `proposal.partner.added` (new partner invited)
- `proposal.partner.communication_requested` (outreach needed)
- `capture.collaborator.invited` (collaborator invitation)
- `capture.proposal.stage_changed` (stage transition notifications)

**Tools:** `get_sections`, `get_compliance`, `search_memory`

**Inputs:** Current proposal state, partner-relevant compliance requirements, past partner interaction history, deliverable status

**Outputs:**
- Communication drafts (welcome, reminders, deadline nudges)
- Partner status report
- Commitment tracking
- Risk flags (overdue deliverables, missing LOIs)

**Instantiated:** Customer Portal (when partners are added or communications needed)

---

### 3.10 Packaging Specialist

**Role:** Compiles and validates the final submission package.

| Property | Value |
|----------|-------|
| `role_name` | `packaging_specialist` |
| Layer | Proposal |
| Model | `claude-haiku-4-5-20251001` |
| `max_tokens` | 4096 |
| `temperature` | 0.2 |
| Human gate | Yes (customer reviews, locks, downloads, submits manually) |
| Cost per call | $0.11 |

**Trigger events:**
- `proposal.stage.advanced` (to final stage)
- `capture.proposal.stage_changed` to final
- User clicks "Generate Package" (on demand)

**Tools:** `get_sections`, `get_compliance`, `search_memory`

**Inputs:** All approved sections, submission requirements, agency template, required government forms

**Outputs:**
- Package manifest (all documents with format, page count, file type)
- Violations list by severity (critical/major/minor/info)
- Formatting notes
- Upload instructions (agency portal-specific guidance)
- Upload checklist (ordered submission steps)

**Instantiated:** Customer Portal (when proposal enters final stage)

---

## 4. Memory Lifecycle

### 4.1 Learning Modules

Located in `pipeline/src/agents/learning/`.

#### DiffAnalyzer

| Property | Value |
|----------|-------|
| Schedule | On-event (`proposal.section.edited`) |
| Algorithm | `difflib.SequenceMatcher` (no LLM) |
| Event emitted | `system:memory.edit_analyzed` |

Compares original agent output with human-edited version. Computes edit metrics (distance, lines changed, percentage) and classifies the change type:

| Type | Signal |
|------|--------|
| STYLE | Word substitutions, tone changes |
| CONTENT | Significant text additions/removals |
| STRUCTURE | Paragraph reordering |
| MINOR | Small edits below threshold |

Creates an episodic memory capturing the edit pattern for future learning.

#### PreferenceExtractor

| Property | Value |
|----------|-------|
| Schedule | Daily (once per active tenant) |
| Algorithm | Keyword matching (no LLM in V1) |
| Input | Episodic memories from last 30 days, importance > 0.3 |
| Event emitted | `system:memory.preferences_extracted` |

Groups episodic memories by `agent_role`. When the same edit type or keyword pattern appears **3+ times**, extracts a semantic memory representing a tenant preference.

#### PatternPromoter

| Property | Value |
|----------|-------|
| Schedule | Weekly (once per active tenant) |
| Algorithm | Keyword overlap (set intersection > 50%) |
| Input | Unarchived episodic memories grouped by `agent_role` + `memory_type` |
| Event emitted | `system:memory.pattern_promoted` |

Finds clusters of 3+ similar episodic memories. For each cluster:
1. Creates a semantic memory with summarized content
2. Sets confidence based on cluster size
3. Records source episodic IDs
4. Archives the original episodic memories

#### OutcomeAttributor

| Property | Value |
|----------|-------|
| Schedule | On-event (`proposal.outcome.recorded`) |
| Input | `proposal_id`, outcome (won/lost), `agent_task_log`, `proposal_sections` |
| Event emitted | `system:memory.outcome_attributed` |

Traces a win/loss back to contributing agent tasks and library units. Updates `agent_performance` metrics. Creates episodic memories recording the outcome.

#### Calibrator

| Property | Value |
|----------|-------|
| Schedule | Monthly (once per active tenant) |
| Input | `agent_task_log` (last 90 days), `semantic_memories` |
| Event emitted | `system:agent.calibrated` |

Aggregates per-role metrics over 90 days:
- Acceptance rate
- Average edit percentage
- Cost per task
- Task count

Flags roles with acceptance_rate < 50% for memory review. Suggests model changes:
- Consistently high-quality roles -> Haiku (cost savings)
- Consistently low-quality roles -> Opus (quality upgrade)

### 4.2 Lifecycle Modules

Located in `pipeline/src/agents/lifecycle/`.

#### MemoryDecay

| Property | Value |
|----------|-------|
| Schedule | Daily (all tenants in single pass) |
| Event emitted | `system:memory.decay_applied` |

Applies gradual decay to `decay_factor` values:

| Memory Type | Decay Rate | Notes |
|-------------|-----------|-------|
| Episodic | 0.999/day | Fastest decay |
| Semantic | N/A (V1) | Uses `confidence` as proxy, evidence-based |
| Procedural | N/A (V1) | Uses `success_rate` as proxy |

**Exemptions:**
- Memories accessed in last 7 days are exempt
- Importance >= 0.9 has a minimum floor (human-pinned)

#### MemoryGC

| Property | Value |
|----------|-------|
| Schedule | Weekly (all tenants) |
| Event emitted | `system:memory.gc_completed` |

Hard-deletes memories past retention period:

| Rule | Criteria |
|------|----------|
| Archived episodic > 6 months | DELETE |
| Inactive semantic > 3 months | Only if confidence < 0.3 and no recent access |
| Procedural > 12 months | Only if no execution |

**Safety guards:**
- Never deletes memories with importance >= 0.9 (pinned by human)
- Never deletes semantic memories with evidence_count >= 5 (well-confirmed)

#### MemoryCompactor

| Property | Value |
|----------|-------|
| Schedule | Monthly (per active tenant) |
| Algorithm | Keyword overlap > 60% (set intersection) |
| Event emitted | `system:memory.compaction_completed` |

Finds clusters of similar old episodic memories (older than 30 days). For clusters with **5+ members**:
1. Creates a semantic memory with summarized content
2. Archives the originals

#### ContradictionResolver

| Property | Value |
|----------|-------|
| Schedule | Monthly (per active tenant, runs after compactor) |
| Algorithm | Keyword overlap > 50% + opposing-pair detection |
| Event emitted | `system:memory.contradictions_resolved` |

Scans active semantic memories grouped by category. Detects contradictions using opposing word pairs (e.g., "formal"/"casual", "brief"/"detailed", "always"/"never").

**Resolution strategy:**
- Higher confidence wins -> lower confidence is deactivated
- If confidence is within 0.1 -> flagged for human review (not auto-resolved)

### 4.3 Memory Maturation Timeline

```
DAY 1
  Raw episodic memory created from agent interaction.
  Importance: 0.5 (default). Decay: 1.0.

DAY 7
  DiffAnalyzer has captured any human edits.
  Decay factor: ~0.993 (nearly full strength).

DAY 30
  PreferenceExtractor has run ~30 times.
  If 3+ similar episodics exist, a semantic preference is created.
  PatternPromoter has run ~4 times, promoting confirmed clusters.
  Compactor evaluates 30-day-old memories for consolidation.

DAY 90
  Calibrator has run ~3 times.
  Agent performance metrics reflect outcome data.
  Unaccessed episodic memories: decay_factor ~0.914

DAY 180
  MemoryGC deletes archived episodic memories older than 6 months.
  Inactive semantic memories (confidence < 0.3) eligible for deletion.
  Surviving memories are high-value, well-confirmed knowledge.

DAY 365
  Procedural memories with no execution eligible for GC.
  Semantic memories with evidence_count >= 5 are effectively permanent.
  Calibrator has recalibrated ~12 times.

DAY 1000+
  Only highly-confirmed semantic and frequently-used procedural
  memories survive. The memory store is lean and high-signal.
```

---

## 5. Guardrails and Security

### What Agents CAN Do Autonomously

- Draft proposal sections
- Score opportunities
- Flag compliance gaps
- Suggest content from library
- Categorize library content (in DRAFT status)
- Send internal notifications
- Write episodic memories
- Search tenant data (within tenant boundary)

### What Requires Human Approval

- Pursuit decisions (Capture Strategist recommends, human decides)
- Outline approval (Proposal Architect outputs, human approves)
- Section acceptance (Section Drafter drafts, human reviews)
- External communications (Partner Coordinator drafts, human sends)
- Library unit activation (Librarian creates in DRAFT, admin approves)
- Package submission (Packaging Specialist compiles, human submits)
- Stage advancement (all stage gates require human action)

### What Agents Can NEVER Do

- Submit proposals to government portals
- Grant or revoke user access
- Delete content or data
- Communicate externally (email, API calls outside the system)
- Override human decisions
- Auto-finalize any proposal section
- Commit to terms on behalf of a tenant
- Share proprietary content beyond partner scope

### Tenant Isolation

**Four layers of isolation:**

| Layer | Mechanism |
|-------|-----------|
| Database RLS | Row-Level Security on all agent memory tables |
| Query enforcement | Every tool query includes `WHERE tenant_id = $1` |
| Context assembly | ContextAssembler only loads data for the invoking tenant |
| S3/storage paths | Object keys scoped to the R2 `customers/{tenant_slug}/` prefix (there is no `/data` business-data volume — the `STORAGE_ROOT=/data` constant is dead) |

**Critical invariant:** `tenant_id` is NEVER accepted from tool input parameters. It always comes from the invocation context set by the fabric. Even if an agent's prompt is compromised via injection, tools will only return data belonging to the authenticated tenant.

### Prompt Injection Defense

1. **Trusted context delimiters**: System prompt uses `--- BEGIN/END TRUSTED CONTEXT ---` markers
2. **User content separation**: Task data is in user messages, never in the system prompt
3. **Tool parameter stripping**: `tenant_id` stripped from all tool inputs before execution
4. **Content truncation**: Library unit content truncated to 500 chars in search results, 1000 chars in sections, 2000 chars in opportunity descriptions

### Cost Controls

| Control | Default | Configurable |
|---------|---------|:---:|
| Rate limit | 50 calls/hour/tenant | Yes (tenant → platform default → constant) |
| Monthly budget | $50/month/tenant | Yes (via `tenant_agent_config` → `platform_agent_config`) |
| Per-call cost ceiling | $0.50/invocation (mid-loop) | Yes (tenant → platform default) |
| Platform master switch + monthly cap | via `platform_agent_config` | Yes (admin) |
| Per-model pricing | Haiku $1/$5, Sonnet $3/$15 per 1M | costed per model (`MODEL_PRICING`) |
| Max tool rounds | 20 per invocation | No (hardcoded) |
| Max output tokens | 4096-8192 per archetype | Per archetype |
| Budget/rate check failure | **Fail closed** (deny the call if it can't be verified) | N/A |

---

## 6. How to Build a New Archetype

### Step 1: Create the file

```
pipeline/src/agents/archetypes/your_agent.py
```

### Step 2: Extend BaseArchetype

Every archetype must implement the abstract properties from `BaseArchetype`:

```python
"""your_agent agent archetype -- one-line description."""

import json
import logging
import uuid

from .base import BaseArchetype

logger = logging.getLogger("pipeline.agents.your_agent")


class YourAgentArchetype(BaseArchetype):
    """Description of what this agent does.

    Handles: your.trigger.event_name
    """

    @property
    def role_name(self) -> str:
        return "your_agent"

    @property
    def model(self) -> str:
        # "claude-sonnet-4-20250514" for complex tasks
        # "claude-haiku-4-5-20251001" for fast/cheap tasks
        # None to use fabric default (Sonnet)
        return "claude-sonnet-4-20250514"

    @property
    def max_tokens(self) -> int:
        return 4096  # Adjust based on expected output size

    @property
    def temperature(self) -> float:
        return 0.3  # 0.2 for classification, 0.3 for balanced, higher for creative

    @property
    def human_gate(self) -> bool:
        return True  # Does output require human approval?

    @property
    def system_prompt(self) -> str:
        return """You are an expert in [domain].

Your task is to [primary objective].

Rules:
1. [Constraint]
2. [Constraint]

Use [tool_name] to [purpose].

Output format: [describe expected output]."""

    @property
    def tools(self) -> list[str]:
        return ["tool_name_1", "tool_name_2"]

    def handles_event(self, event_type: str) -> bool:
        """Check if this archetype handles the given event type."""
        return event_type in (
            "your.trigger.event_name",
        )

    def get_tools(self) -> list[dict]:
        """Return tool definitions in Anthropic tool-use format."""
        return [
            {
                "name": "tool_name_1",
                "description": "What this tool does and when to use it.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "param_name": {
                            "type": "string",
                            "description": "Description of the parameter",
                        },
                    },
                    "required": ["param_name"],
                },
            },
        ]

    def build_messages(self, context: dict, memories: list[dict]) -> list[dict]:
        """Build the message list for Claude."""
        # Extract task-specific data from context
        task_data = context.get("payload", {})

        content = f"""Please analyze the following:

Task: {task_data.get('description', 'No description provided')}

Provide your analysis."""

        return [{"role": "user", "content": content}]

    async def execute_tool(self, conn, tool_name: str, tool_input: dict, context: dict) -> dict:
        """Execute a tool call with real DB queries."""
        tenant_id = context.get("tenant_id")

        if tool_name == "tool_name_1":
            try:
                rows = await conn.fetch(
                    """
                    SELECT id, content
                    FROM your_table
                    WHERE tenant_id = $1
                    LIMIT 10
                    """,
                    uuid.UUID(tenant_id),
                )
                return {"results": [dict(r) for r in rows]}
            except Exception as exc:
                logger.error("[your_agent] tool_name_1 failed: %s", exc)
                return {"error": f"Query failed: {str(exc)[:200]}"}

        return {"error": f"Unknown tool: {tool_name}"}

    def summarize_result(self, result: dict) -> str:
        """Summarize the result for memory storage."""
        text = result.get("text", "")
        return text[:200] if text else "No text output"
```

### Step 3: Register in `__init__.py`

Edit `pipeline/src/agents/archetypes/__init__.py`:

```python
from .your_agent import YourAgentArchetype

__all__ = [
    # ... existing exports ...
    "YourAgentArchetype",
]
```

### Step 4: Register in the fabric

The fabric auto-discovers archetypes via `register_archetype()`. Add registration wherever the fabric is initialized:

```python
fabric.register_archetype("your_agent", YourAgentArchetype())
```

### Checklist

- [ ] Extends `BaseArchetype`
- [ ] All abstract properties implemented (`role_name`, `system_prompt`, `tools`)
- [ ] `handles_event()` returns True for the correct event types
- [ ] `get_tools()` returns Anthropic-format tool definitions
- [ ] `build_messages()` constructs a focused user message
- [ ] `execute_tool()` uses parameterized SQL with tenant isolation
- [ ] All SQL queries include `WHERE tenant_id = $1`
- [ ] All `await conn.fetch/execute` calls are inside try/catch
- [ ] Registered in `__init__.py`
- [ ] Registered in fabric initialization
- [ ] Header docstring includes: ROLE, LAYER, TRIGGERS, INPUTS, OUTPUTS, TOOLS, MODEL, HUMAN GATE, GUARDRAILS, MEMORY, INSTANCES, COST, EVENT EMISSIONS

---

## 7. V2 Roadmap

Features planned but **NOT yet implemented**:

| Feature | Description | Status |
|---------|-------------|--------|
| Vector embeddings | Replace recency-based recall with pgvector cosine similarity using `text-embedding-3-small` | Planned |
| Multi-turn conversations | Agents that maintain conversation state across multiple user interactions | Planned |
| Agent-to-agent delegation | One agent triggers another (e.g., Section Drafter calls Compliance Reviewer) | Planned |
| Intake Agent | Decomposes uploaded documents into library units automatically | Planned |
| Spotlight Analyst | Deep opportunity analysis with competitive intelligence | Planned |
| Model tiering | Opus for complex reasoning (Capture Strategist, Color Team), Haiku for cheap ops | Planned |
| Prompt caching | 50-70% hit rate on system prompt + tenant profile (~3,500 tokens cached) | Planned |
| Cross-tenant patterns | Anonymized aggregate patterns from all tenants (e.g., "DoD SBIR Phase I typically...") | Planned |
| Agent performance dashboard | Admin UI showing per-agent metrics, costs, acceptance rates | Planned |
| Custom archetype creation | Tenants define their own agent roles and prompts | Planned |

### V2 Model Tiering Plan

```python
MODEL_MAP = {
    # Complex reasoning -> Opus ($15/$75 per 1M)
    'capture_strategist': 'claude-opus-4-20250918',
    'color_team_reviewer': 'claude-opus-4-20250918',

    # Standard tasks -> Sonnet ($3/$15 per 1M)
    'opportunity_analyst': 'claude-sonnet-4-20250514',
    'scoring_strategist': 'claude-sonnet-4-20250514',
    'proposal_architect': 'claude-sonnet-4-20250514',
    'section_drafter': 'claude-sonnet-4-20250514',
    'compliance_reviewer': 'claude-sonnet-4-20250514',
    'librarian': 'claude-sonnet-4-20250514',

    # Simple tasks -> Haiku ($0.25/$1.25 per 1M)
    'partner_coordinator': 'claude-haiku-4-5-20251001',
    'packaging_specialist': 'claude-haiku-4-5-20251001',
}
```

---

## 8. Cost Model

### Per-Call Costs by Archetype

All costs at Claude Sonnet pricing ($3/1M input, $15/1M output).

| Agent | Avg Input | Avg Output | Tool Calls | Cost/Call | Calls/Proposal | Cost/Proposal |
|-------|----------:|----------:|-----------:|----------:|---------------:|--------------:|
| Opportunity Analyst | 25K | 4K | 3 | $0.14 | 1x (per opp) | $0.14 |
| Scoring Strategist | 10K | 2K | 4 | $0.06 | 1x | $0.06 |
| Capture Strategist | 25K | 6K | 5 | $0.17 | 1x | $0.17 |
| Proposal Architect | 18K | 5K | 5 | $0.13 | 2x | $0.26 |
| Section Drafter | 12K | 4K | 5 | $0.10 | 15x | $1.50 |
| Compliance Reviewer | 25K | 3K | 4 | $0.12 | 4x | $0.48 |
| Color Team Reviewer | 35K | 8K | 4 | $0.23 | 3x | $0.69 |
| Partner Coordinator | 5K | 2K | 3 | $0.05 | 10x | $0.50 |
| Librarian | 20K | 5K | 3 | $0.14 | 3x | $0.42 |
| Packaging Specialist | 20K | 3K | 3 | $0.11 | 1x | $0.11 |

### Per-Proposal Totals

| Proposal Type | Agent Calls | Without Caching | With Caching |
|--------------|------------:|----------------:|-------------:|
| SBIR Phase I | ~42 | ~$5.03 | ~$4.50 |
| SBIR Phase II | ~65 | ~$8.20 | ~$7.30 |
| BAA/OTA Response | ~55 | ~$6.80 | ~$6.10 |
| Full RFP (large) | ~90 | ~$12.50 | ~$11.00 |

### SBIR Phase I Breakdown

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

| Usage Level | Opportunities | Active Proposals | Monthly AI Cost |
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

## 9. Event Emissions

### Fabric Events

| Event | Namespace | Phase | When |
|-------|-----------|-------|------|
| `agent.dispatch` | `tool` | start | Fabric receives an event to route |
| `agent.dispatch` | `tool` | end | Routing complete (with archetype name, status) |
| `agent.invoked` | `tool` | start | Agent invocation begins |
| `agent.invoked` | `tool` | end | Agent invocation complete (with tokens, cost, duration) |

### Learning Module Events

| Event | Namespace | When |
|-------|-----------|------|
| `memory.edit_analyzed` | `system` | DiffAnalyzer processes a human edit |
| `memory.preferences_extracted` | `system` | PreferenceExtractor daily run completes |
| `memory.pattern_promoted` | `system` | PatternPromoter weekly run promotes clusters |
| `memory.outcome_attributed` | `system` | OutcomeAttributor traces win/loss to content |

### Lifecycle Module Events

| Event | Namespace | When |
|-------|-----------|------|
| `memory.decay_applied` | `system` | MemoryDecay daily run completes |
| `memory.gc_completed` | `system` | MemoryGC weekly run deletes old memories |
| `memory.compaction_completed` | `system` | MemoryCompactor monthly run completes |
| `memory.contradictions_resolved` | `system` | ContradictionResolver monthly run completes |

### Calibration Events

| Event | Namespace | When |
|-------|-----------|------|
| `agent.calibrated` | `system` | Calibrator monthly run completes |

### Workflow Events

| Event | Namespace | When |
|-------|-----------|------|
| `workflow.step_completed` | `system` | For AI_INVOKE workflow steps |

---

## 10. File Map

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
| `pipeline/src/agents/archetypes/base.py` | Abstract base class: `role_name`, `system_prompt`, `tools`, `handles_event`, etc. |
| `pipeline/src/agents/archetypes/opportunity_analyst.py` | Platform agent: parses RFPs, extracts requirements matrices |
| `pipeline/src/agents/archetypes/scoring_strategist.py` | Company agent: LLM-based score adjustment (-15 to +15) |
| `pipeline/src/agents/archetypes/capture_strategist.py` | Company agent: go/no-go recommendation, win themes, competitive analysis |
| `pipeline/src/agents/archetypes/proposal_architect.py` | Proposal agent: outline design, requirement mapping, page allocation |
| `pipeline/src/agents/archetypes/section_drafter.py` | Proposal agent: drafts proposal sections (highest volume) |
| `pipeline/src/agents/archetypes/compliance_reviewer.py` | Proposal agent: per-variable compliance matrix verification |
| `pipeline/src/agents/archetypes/color_team_reviewer.py` | Proposal agent: Pink/Red/Gold team review simulation |
| `pipeline/src/agents/archetypes/librarian.py` | Company agent: content cataloging, scoring, dedup, harvesting |
| `pipeline/src/agents/archetypes/partner_coordinator.py` | Proposal agent: partner communications and deliverable tracking |
| `pipeline/src/agents/archetypes/packaging_specialist.py` | Proposal agent: final package compilation and format validation |

### Learning Modules

| File | Description |
|------|-------------|
| `pipeline/src/agents/learning/__init__.py` | Exports: DiffAnalyzer, PreferenceExtractor, PatternPromoter, OutcomeAttributor, Calibrator |
| `pipeline/src/agents/learning/diff_analyzer.py` | On-event: classifies human edits to agent output (STYLE/CONTENT/STRUCTURE/MINOR) |
| `pipeline/src/agents/learning/preference_extractor.py` | Daily: extracts repeated patterns into semantic preferences |
| `pipeline/src/agents/learning/pattern_promoter.py` | Weekly: promotes episodic clusters to semantic memories |
| `pipeline/src/agents/learning/outcome_attributor.py` | On-event: traces win/loss outcomes to contributing content |
| `pipeline/src/agents/learning/calibrator.py` | Monthly: recalibrates agent performance metrics and suggests model changes |

### Lifecycle Modules

| File | Description |
|------|-------------|
| `pipeline/src/agents/lifecycle/__init__.py` | Exports: MemoryDecay, MemoryGC, MemoryCompactor, ContradictionResolver |
| `pipeline/src/agents/lifecycle/decay.py` | Daily: applies time-based decay to memory importance scores |
| `pipeline/src/agents/lifecycle/gc.py` | Weekly: hard-deletes memories past retention period |
| `pipeline/src/agents/lifecycle/compactor.py` | Monthly: compresses similar episodic clusters into semantic summaries |
| `pipeline/src/agents/lifecycle/contradiction_resolver.py` | Monthly: detects and resolves conflicting semantic memories |

### Design Documents

| File | Description |
|------|-------------|
| `docs/agent-fabric/02-ARCHETYPES-AND-INSERTION-POINTS.md` | Detailed spec for all archetypes with trigger matrices |
| `docs/agent-fabric/07-COST-MODEL.md` | Cost analysis, scaling projections, break-even calculations |
| `docs/AGENT_FABRIC_DESIGN.md` | High-level agent fabric design document |
