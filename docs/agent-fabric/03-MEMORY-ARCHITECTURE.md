# Chapter 3: Memory Architecture

This is the most important chapter. The memory system is what transforms generic
Claude calls into specialized, continuously-improving agents. Everything else in
the Agent Fabric depends on getting this right.

---

## The Three Memory Types

### Episodic Memory: "What Happened"

Append-only log of agent interactions, decisions, and observations. Every time an
agent does work, an episodic memory is created.

Examples:
- "Drafted Technical Approach for proposal P-123. Used 3 library units. Customer edited 40% of output."
- "Scored opportunity SAM-456 for AcmeTech. Adjustment: +8. Customer pursued it."
- "Pink team review for proposal P-123. AI score: 72. Human reviewers scored: 65. I was optimistic."

### Semantic Memory: "What I Know About This Customer"

Mutable, versioned facts and preferences extracted from episodic patterns. Updated
when new evidence confirms or contradicts existing knowledge.

Examples:
- "AcmeTech prefers formal tone in proposals. Evidence: 5 observations. Confidence: 0.9"
- "AcmeTech's PI is always Dr. Sarah Chen for RF/microwave topics."
- "Air Force SBIR proposals from AFRL weight TRL progression at 25% of technical evaluation."

### Procedural Memory: "How To Do Things For This Customer"

Learned strategies and workflows extracted from repeated semantic patterns.
The highest-value memories — these are the agent's "expertise."

Examples:
- "When AcmeTech does AF SBIRs, lead with TPOC alignment in section 1, then TRL roadmap."
- "Start nudging SubCo for hardware specs 7 days before deadline, not 3. They need extra time."
- "For AcmeTech Phase II proposals, use 3-year PoP with option years. They always restructure if I don't."

---

## PostgreSQL Schema

### Extensions Required

```sql
CREATE EXTENSION IF NOT EXISTS vector;      -- pgvector for embeddings
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- trigram text search
```

### Episodic Memories

```sql
CREATE TABLE episodic_memories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    agent_role      TEXT NOT NULL,           -- 'section_drafter', 'scoring_strategist', etc.
    embedding       vector(1536) NOT NULL,
    content         TEXT NOT NULL,           -- human-readable memory text
    memory_type     TEXT NOT NULL DEFAULT 'observation',
                    -- observation, interaction, decision, outcome
    importance      FLOAT NOT NULL DEFAULT 0.5,   -- 0.0-1.0
    entities        JSONB DEFAULT '[]',      -- [{type, name, id}]
    metadata        JSONB DEFAULT '{}',      -- flexible structured data
    source_task_id  UUID,                    -- links to agent_task_log
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_accessed   TIMESTAMPTZ NOT NULL DEFAULT now(),
    access_count    INT NOT NULL DEFAULT 0,
    decay_factor    FLOAT NOT NULL DEFAULT 1.0,
    is_archived     BOOLEAN NOT NULL DEFAULT FALSE,
    superseded_by   UUID REFERENCES semantic_memories(id)
);
```

### Semantic Memories

```sql
CREATE TABLE semantic_memories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    agent_role      TEXT NOT NULL,
    embedding       vector(1536) NOT NULL,
    content         TEXT NOT NULL,           -- the knowledge statement
    category        TEXT NOT NULL,           -- 'writing_preference', 'agency_knowledge',
                    -- 'personnel_knowledge', 'scoring_calibration', 'process_preference'
    subcategory     TEXT,
    confidence      FLOAT NOT NULL DEFAULT 0.5,   -- 0.0-1.0
    evidence_count  INT NOT NULL DEFAULT 1,
    relationships   JSONB DEFAULT '[]',      -- [{subject, predicate, object}]
    source_memories UUID[] DEFAULT '{}',     -- episodic memory IDs that led to this
    metadata        JSONB DEFAULT '{}',
    valid_from      TIMESTAMPTZ DEFAULT now(),
    valid_until     TIMESTAMPTZ,             -- NULL = still valid
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_accessed   TIMESTAMPTZ NOT NULL DEFAULT now(),
    access_count    INT NOT NULL DEFAULT 0,
    version         INT NOT NULL DEFAULT 1,
    previous_version UUID REFERENCES semantic_memories(id),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);
```

### Procedural Memories

```sql
CREATE TABLE procedural_memories (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id),
    agent_role        TEXT NOT NULL,
    embedding         vector(1536) NOT NULL,
    name              TEXT NOT NULL,          -- "AF SBIR Technical Approach Pattern"
    description       TEXT NOT NULL,
    trigger_conditions JSONB DEFAULT '{}',    -- when to activate
    steps             JSONB NOT NULL,         -- [{order, action, parameters}]
    success_rate      FLOAT DEFAULT 0.5,
    execution_count   INT NOT NULL DEFAULT 0,
    last_executed     TIMESTAMPTZ,
    metadata          JSONB DEFAULT '{}',
    source_memories   UUID[] DEFAULT '{}',    -- semantic IDs that led to this
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    version           INT NOT NULL DEFAULT 1,
    previous_version  UUID REFERENCES procedural_memories(id),
    is_active         BOOLEAN NOT NULL DEFAULT TRUE
);
```

### Agent Task Log

```sql
CREATE TABLE agent_task_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id),
    agent_role          TEXT NOT NULL,
    task_type           TEXT NOT NULL,         -- 'draft_section', 'score_opportunity', etc.
    trigger_event       TEXT,                  -- event that triggered this task
    trigger_event_id    UUID,
    proposal_id         UUID,
    opportunity_id      UUID,
    input_tokens        INT NOT NULL DEFAULT 0,
    output_tokens       INT NOT NULL DEFAULT 0,
    cached_tokens       INT NOT NULL DEFAULT 0,
    tool_calls_count    INT NOT NULL DEFAULT 0,
    duration_ms         INT NOT NULL DEFAULT 0,
    cost_usd            FLOAT NOT NULL DEFAULT 0,
    model_used          TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',
    status              TEXT NOT NULL DEFAULT 'completed',  -- completed, failed, timeout
    error_message       TEXT,
    human_accepted      BOOLEAN,              -- NULL until reviewed
    human_edit_pct      FLOAT,                -- 0.0-1.0, NULL until reviewed
    memories_retrieved  INT NOT NULL DEFAULT 0,
    memories_written    INT NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Agent Performance (Calibration)

```sql
CREATE TABLE agent_performance (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    agent_role      TEXT NOT NULL,
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    tasks_completed INT NOT NULL DEFAULT 0,
    acceptance_rate FLOAT,                    -- % of outputs accepted without major edits
    avg_edit_pct    FLOAT,                    -- average human edit percentage
    avg_cost_usd    FLOAT,
    avg_duration_ms FLOAT,
    accuracy_score  FLOAT,                    -- role-specific (scoring accuracy, compliance catch rate)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, agent_role, period_start, period_end)
);
```

---

## Indexes

### HNSW Vector Indexes

```sql
-- Episodic: highest volume, most frequent queries
CREATE INDEX idx_episodic_embedding ON episodic_memories
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 128);

-- Semantic: moderate volume, high accuracy requirement
CREATE INDEX idx_semantic_embedding ON semantic_memories
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 24, ef_construction = 200);

-- Procedural: low volume, accuracy critical
CREATE INDEX idx_procedural_embedding ON procedural_memories
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 128);
```

### B-Tree Indexes (Critical for Filtered Vector Queries)

```sql
-- Episodic
CREATE INDEX idx_episodic_tenant ON episodic_memories(tenant_id);
CREATE INDEX idx_episodic_tenant_role ON episodic_memories(tenant_id, agent_role);
CREATE INDEX idx_episodic_tenant_type ON episodic_memories(tenant_id, memory_type);
CREATE INDEX idx_episodic_occurred ON episodic_memories(occurred_at DESC);
CREATE INDEX idx_episodic_importance ON episodic_memories(importance DESC)
    WHERE NOT is_archived;
CREATE INDEX idx_episodic_active ON episodic_memories(tenant_id)
    WHERE NOT is_archived;

-- Semantic
CREATE INDEX idx_semantic_tenant ON semantic_memories(tenant_id);
CREATE INDEX idx_semantic_tenant_cat ON semantic_memories(tenant_id, category);
CREATE INDEX idx_semantic_tenant_role ON semantic_memories(tenant_id, agent_role);
CREATE INDEX idx_semantic_active ON semantic_memories(tenant_id)
    WHERE is_active;
CREATE INDEX idx_semantic_confidence ON semantic_memories(confidence DESC)
    WHERE is_active;

-- Procedural
CREATE INDEX idx_procedural_tenant ON procedural_memories(tenant_id);
CREATE INDEX idx_procedural_active ON procedural_memories(tenant_id)
    WHERE is_active;

-- Task log
CREATE INDEX idx_task_log_tenant ON agent_task_log(tenant_id);
CREATE INDEX idx_task_log_tenant_role ON agent_task_log(tenant_id, agent_role);
CREATE INDEX idx_task_log_created ON agent_task_log(created_at DESC);
CREATE INDEX idx_task_log_proposal ON agent_task_log(proposal_id)
    WHERE proposal_id IS NOT NULL;
```

### GIN Indexes (JSONB Search)

```sql
CREATE INDEX idx_episodic_entities ON episodic_memories USING GIN (entities);
CREATE INDEX idx_episodic_metadata ON episodic_memories USING GIN (metadata);
CREATE INDEX idx_semantic_relationships ON semantic_memories USING GIN (relationships);
```

---

## Row-Level Security

```sql
ALTER TABLE episodic_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE semantic_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE procedural_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_task_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_episodic ON episodic_memories
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_semantic ON semantic_memories
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_procedural ON procedural_memories
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_task_log ON agent_task_log
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

---

## Memory Retrieval

### The Core Hybrid Search Query

This is the query that runs at the start of every agent invocation to retrieve
relevant memories. It combines vector similarity with structured filters,
importance, recency, and access frequency.

```sql
-- Retrieve memories for context injection
-- Called with: $1 = query embedding, $2 = tenant_id, $3 = agent_role

WITH episodic AS (
    SELECT
        'episodic' AS memory_kind,
        id,
        content,
        importance * decay_factor AS effective_importance,
        1 - (embedding <=> $1::vector) AS similarity,
        GREATEST(0, 1.0 - EXTRACT(EPOCH FROM (now() - occurred_at)) / (90 * 86400))
            AS recency_score,
        LEAST(access_count::float / 10.0, 1.0) AS access_score,
        occurred_at AS ts,
        CEIL(LENGTH(content) / 4.0) AS approx_tokens
    FROM episodic_memories
    WHERE tenant_id = $2
      AND NOT is_archived
      AND 1 - (embedding <=> $1::vector) > 0.65
    ORDER BY embedding <=> $1::vector
    LIMIT 10
),
semantic AS (
    SELECT
        'semantic' AS memory_kind,
        id,
        content,
        confidence AS effective_importance,
        1 - (embedding <=> $1::vector) AS similarity,
        GREATEST(0, 1.0 - EXTRACT(EPOCH FROM (now() - updated_at)) / (180 * 86400))
            AS recency_score,
        LEAST(access_count::float / 10.0, 1.0) AS access_score,
        updated_at AS ts,
        CEIL(LENGTH(content) / 4.0) AS approx_tokens
    FROM semantic_memories
    WHERE tenant_id = $2
      AND is_active
      AND 1 - (embedding <=> $1::vector) > 0.70
    ORDER BY embedding <=> $1::vector
    LIMIT 8
),
procedural AS (
    SELECT
        'procedural' AS memory_kind,
        id,
        name || ': ' || description AS content,
        success_rate AS effective_importance,
        1 - (embedding <=> $1::vector) AS similarity,
        GREATEST(0, 1.0 - EXTRACT(EPOCH FROM (now() - updated_at)) / (365 * 86400))
            AS recency_score,
        LEAST(execution_count::float / 10.0, 1.0) AS access_score,
        updated_at AS ts,
        CEIL(LENGTH(name || description) / 4.0) AS approx_tokens
    FROM procedural_memories
    WHERE tenant_id = $2
      AND is_active
      AND 1 - (embedding <=> $1::vector) > 0.70
    ORDER BY embedding <=> $1::vector
    LIMIT 5
),
all_memories AS (
    SELECT *, (
        0.40 * similarity
      + 0.20 * effective_importance
      + 0.20 * recency_score
      + 0.10 * access_score
      + 0.10 * CASE memory_kind
            WHEN 'procedural' THEN 1.0   -- procedural gets bonus
            WHEN 'semantic' THEN 0.8
            ELSE 0.5
          END
    ) AS composite_score
    FROM (
        SELECT * FROM episodic
        UNION ALL SELECT * FROM semantic
        UNION ALL SELECT * FROM procedural
    ) combined
)
SELECT memory_kind, id, content, composite_score, approx_tokens, ts
FROM all_memories
ORDER BY composite_score DESC;
```

### Token Budget Selection (Application Code)

```python
async def select_memories_for_context(
    conn, tenant_id: str, query_embedding: list[float],
    token_budget: int = 3000
) -> list[dict]:
    """Retrieve and select memories that fit within token budget."""
    rows = await conn.fetch(HYBRID_SEARCH_QUERY, query_embedding, tenant_id)

    selected = []
    tokens_used = 0
    for row in rows:
        if tokens_used + row['approx_tokens'] > token_budget:
            break
        selected.append(dict(row))
        tokens_used += row['approx_tokens']

        # Update access tracking (fire-and-forget)
        table = f"{row['memory_kind']}_memories"
        await conn.execute(f"""
            UPDATE {table}
            SET last_accessed = now(), access_count = access_count + 1
            WHERE id = $1
        """, row['id'])

    return selected
```

---

## Context Assembly

### How Memories Are Injected Into the Prompt

```python
def build_prompt(archetype, tenant_profile, memories, task_data):
    """Assemble the complete prompt for a Claude API call."""

    # Section 1: System prompt (CACHED — 0.1x cost after first call)
    system = f"""{archetype.system_prompt}

## Customer Profile
- Company: {tenant_profile['name']}
- NAICS: {', '.join(tenant_profile['naics_codes'])}
- Focus: {tenant_profile['technology_focus']}
- Certifications: {', '.join(tenant_profile['certifications'])}
- Key Agencies: {', '.join(tenant_profile['target_agencies'])}
"""

    # Section 2: Retrieved memories (CACHED if stable within 5-minute window)
    if memories:
        system += "\n## What I Know About This Customer\n"

        procedural = [m for m in memories if m['memory_kind'] == 'procedural']
        semantic = [m for m in memories if m['memory_kind'] == 'semantic']
        episodic = [m for m in memories if m['memory_kind'] == 'episodic']

        if procedural:
            system += "\n### Learned Procedures\n"
            for m in procedural:
                system += f"- {m['content']} (success rate: {m['effective_importance']:.0%})\n"

        if semantic:
            system += "\n### Known Facts & Preferences\n"
            for m in semantic:
                system += f"- {m['content']} (confidence: {m['effective_importance']:.0%})\n"

        if episodic:
            system += "\n### Recent Relevant Interactions\n"
            for m in episodic:
                system += f"- [{m['ts'].strftime('%Y-%m-%d')}] {m['content']}\n"

    # Section 3: Task-specific data (DYNAMIC — full cost every call)
    user_message = task_data['prompt']

    return system, user_message
```

### Token Budget Allocation

```
Total context budget: ~30,000 tokens (Sonnet sweet spot)

System prompt (cached):
  Archetype instructions:     ~800 tokens
  Tenant profile:             ~500 tokens
  Retrieved memories:         ~2,000-4,000 tokens
  ─────────────────────────────────────────
  Subtotal:                   ~3,500 tokens (cached at 0.1x)

User message (dynamic):
  Task description:           ~500 tokens
  Task-specific data:         ~5,000-20,000 tokens
  (RFP text, section content, library units, etc.)
  ─────────────────────────────────────────
  Subtotal:                   ~5,500-20,500 tokens (full price)

Response budget:              ~2,000-8,000 tokens
Tool results (mid-conversation): ~1,000-5,000 tokens
```

---

## Memory Write Patterns

### After Every Agent Task

```python
async def write_task_memories(
    conn, tenant_id: str, agent_role: str,
    task_summary: str, task_result: dict,
    embed_fn
):
    """Write episodic memory after completing a task."""
    embedding = await embed_fn(task_summary)

    await conn.execute("""
        INSERT INTO episodic_memories
            (tenant_id, agent_role, embedding, content, memory_type,
             importance, metadata, source_task_id)
        VALUES ($1, $2, $3::vector, $4, $5, $6, $7, $8)
    """,
        tenant_id, agent_role, embedding, task_summary,
        task_result.get('memory_type', 'observation'),
        task_result.get('importance', 0.5),
        json.dumps(task_result.get('metadata', {})),
        task_result.get('task_id')
    )
```

### Promoting Episodic to Semantic (LLM-Mediated)

Run as a scheduled job after each proposal milestone:

```python
async def promote_episodic_to_semantic(conn, tenant_id: str, agent_role: str):
    """Find patterns in episodic memories and create semantic memories."""

    # 1. Get recent un-promoted episodic memories
    episodes = await conn.fetch("""
        SELECT id, content, importance, metadata
        FROM episodic_memories
        WHERE tenant_id = $1 AND agent_role = $2
          AND NOT is_archived
          AND access_count >= 2
          AND importance >= 0.5
          AND occurred_at > now() - INTERVAL '90 days'
        ORDER BY importance DESC
        LIMIT 30
    """, tenant_id, agent_role)

    if len(episodes) < 3:
        return  # Not enough data to find patterns

    # 2. Ask Claude to identify patterns
    prompt = f"""Review these {len(episodes)} observations about a customer
and extract durable facts or preferences. Only extract patterns you are
confident about (supported by 2+ observations).

Observations:
{chr(10).join(f'- {e["content"]}' for e in episodes)}

Return JSON array of extracted knowledge:
[{{"content": "...", "category": "writing_preference|agency_knowledge|
personnel_knowledge|scoring_calibration|process_preference",
"confidence": 0.5-1.0, "source_indices": [0, 3, 7]}}]"""

    response = await call_claude(prompt, max_tokens=2000)
    patterns = json.loads(response)

    # 3. Store as semantic memories
    for pattern in patterns:
        embedding = await embed_fn(pattern['content'])
        source_ids = [episodes[i]['id'] for i in pattern['source_indices']]

        await conn.execute("""
            INSERT INTO semantic_memories
                (tenant_id, agent_role, embedding, content, category,
                 confidence, evidence_count, source_memories)
            VALUES ($1, $2, $3::vector, $4, $5, $6, $7, $8)
        """,
            tenant_id, agent_role, embedding, pattern['content'],
            pattern['category'], pattern['confidence'],
            len(source_ids), source_ids
        )
```

---

## Memory Lifecycle Management

### Decay (Daily Job)

```sql
-- Reduce decay_factor based on time, importance, and access patterns
UPDATE episodic_memories
SET decay_factor = GREATEST(
    0.01,
    decay_factor * (
        0.995                                                    -- base daily decay
        * (1.0 + 0.1 * LN(GREATEST(access_count, 1)))          -- access boost
        * CASE
            WHEN importance > 0.8 THEN 0.999                    -- important decays slower
            WHEN importance < 0.3 THEN 0.98                     -- unimportant decays faster
            ELSE 1.0
          END
    )
)
WHERE NOT is_archived
  AND last_accessed < now() - INTERVAL '1 day';
```

### Compaction (Monthly Job)

Find clusters of similar old episodic memories, summarize them into a single
semantic memory, and archive the originals.

```sql
-- Step 1: Find compaction candidates (old, low-importance, similar to each other)
SELECT a.id AS id_a, b.id AS id_b,
       1 - (a.embedding <=> b.embedding) AS similarity
FROM episodic_memories a
JOIN episodic_memories b ON a.tenant_id = b.tenant_id
    AND a.id < b.id
    AND a.agent_role = b.agent_role
WHERE a.tenant_id = $1
  AND NOT a.is_archived AND NOT b.is_archived
  AND a.occurred_at < now() - INTERVAL '30 days'
  AND b.occurred_at < now() - INTERVAL '30 days'
  AND a.importance < 0.5 AND b.importance < 0.5
  AND 1 - (a.embedding <=> b.embedding) > 0.85
ORDER BY similarity DESC
LIMIT 100;
```

Then in application code: group the pairs into clusters, send each cluster
to Claude for summarization, create a semantic memory, archive the originals.

### Contradiction Detection

```sql
-- Find semantic memories about the same topic that might conflict
SELECT
    a.id AS mem_a, a.content AS content_a, a.confidence AS conf_a,
    b.id AS mem_b, b.content AS content_b, b.confidence AS conf_b,
    1 - (a.embedding <=> b.embedding) AS similarity
FROM semantic_memories a
JOIN semantic_memories b ON a.tenant_id = b.tenant_id
    AND a.id < b.id
    AND a.category = b.category
    AND a.is_active AND b.is_active
WHERE a.tenant_id = $1
  AND 1 - (a.embedding <=> b.embedding) > 0.88   -- same topic
  AND 1 - (a.embedding <=> b.embedding) < 0.98   -- but not identical
ORDER BY similarity DESC
LIMIT 50;
```

Resolution: send pairs to Claude with prompt "Do these two statements contradict
each other?" If yes: higher evidence_count wins. If tied: more recent wins.
Loser gets `is_active = FALSE, valid_until = now()`.

### Garbage Collection (Weekly Job)

```sql
-- Hard-delete archived episodic memories older than 6 months
DELETE FROM episodic_memories
WHERE is_archived AND created_at < now() - INTERVAL '6 months';

-- Hard-delete inactive semantic memories older than 3 months
DELETE FROM semantic_memories
WHERE NOT is_active AND valid_until < now() - INTERVAL '3 months';

-- Archive low-value episodic memories
UPDATE episodic_memories
SET is_archived = TRUE
WHERE NOT is_archived
  AND decay_factor < 0.05
  AND importance < 0.2
  AND access_count < 2
  AND occurred_at < now() - INTERVAL '60 days';

-- Vacuum to reclaim space
VACUUM ANALYZE episodic_memories;
VACUUM ANALYZE semantic_memories;
```

---

## Scale Considerations

### pgvector Performance Benchmarks

| Vector Count | Dimension | Query p50 | Query p99 | Index Size | Recall@10 |
|-------------|-----------|-----------|-----------|------------|-----------|
| 100K | 1536 | 1ms | 3ms | ~900 MB | 99% |
| 1M | 1536 | 3ms | 8ms | ~9 GB | 98% |
| 5M | 1536 | 7ms | 20ms | ~45 GB | 97% |

### When to Partition

If total vectors across all tenants exceed 5M, partition by tenant_id:

```sql
CREATE TABLE episodic_memories (/* ... */) PARTITION BY HASH (tenant_id);
CREATE TABLE episodic_memories_p0 PARTITION OF episodic_memories
    FOR VALUES WITH (MODULUS 16, REMAINDER 0);
-- ... through p15
```

Each partition gets its own HNSW index. Queries filtered by tenant_id hit only
the relevant partition.

### Embedding Model Strategy

**V1**: sentence-transformers (local, free, 384 or 1536 dimensions)
- Pro: zero API cost, runs on pipeline worker, no external dependency
- Con: lower quality than commercial embeddings

**V2+**: Anthropic embeddings or OpenAI text-embedding-3-large
- Pro: higher quality retrieval, better semantic matching
- Con: API cost (~$0.13 per 1M tokens)
- Justified when: memory quality directly impacts proposal quality

### HNSW Tuning

```sql
-- At query time, set search depth:
SET hnsw.ef_search = 100;   -- default 40; 100 for agent memory retrieval
                              -- higher = better recall, slightly slower
```

PostgreSQL tuning for vector workloads:
- `shared_buffers`: 25% of RAM (ensure HNSW index fits)
- `work_mem`: 256MB-1GB (vector operations use significant working memory)
- `maintenance_work_mem`: 2GB+ (for index builds)
