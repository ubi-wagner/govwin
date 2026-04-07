# Chapter 4: Continuous Learning

How agents get better over time without model fine-tuning. All "learning" happens
by changing what goes into the context window — not by changing model weights.

---

## The Learning Flywheel

```
Agent produces output
  → Human reviews/edits
    → System captures the diff
      → Memory entry created (what changed, why it likely changed)
        → Future invocations retrieve relevant corrections
          → Better output next time
            → Smaller diffs → Higher confidence → More autonomy
```

### Concrete Example: Section Drafter

**Day 1 — First Technical Approach draft for AcmeTech:**

Agent drafts section using generic SBIR template + library units.
Customer edits 40% of the output:
- Changed passive voice to active voice throughout
- Added a TRL roadmap table (agent didn't include one)
- Replaced generic past performance reference with specific contract FA8750-24-C-0001
- Restructured from narrative to bullet-heavy format

**System captures these edits and creates memories:**

Episodic: "Drafted Technical Approach for P-123. Customer edited 40%. Key changes:
active voice, added TRL table, specific past perf, bullet format."

Semantic (extracted):
- "AcmeTech prefers active voice in technical sections." (confidence: 0.5, evidence: 1)
- "AcmeTech always includes a TRL roadmap table in Technical Approach." (confidence: 0.5)
- "AcmeTech prefers bullet-heavy format over narrative." (confidence: 0.5)

**Day 60 — Third Technical Approach for AcmeTech:**

Agent retrieves these memories before drafting. The prompt now includes:
```
### Known Preferences for This Customer
- Prefers active voice in technical sections (confidence: 70%, 3 observations)
- Always includes TRL roadmap table in Technical Approach (confidence: 70%)
- Prefers bullet-heavy format over narrative (confidence: 80%, confirmed by explicit feedback)
- Reference contract FA8750-24-C-0001 for RF/microwave past performance
```

Result: Customer edits only 15% of the output. The agent is learning.

---

## Five Learning Channels

### Channel 1: Edit-Based Learning

The highest-signal learning channel. When a human edits agent output, we know
exactly what the agent got wrong.

**Diff Detection:**

```python
async def analyze_edits(
    conn, tenant_id: str, agent_role: str,
    original: str, edited: str, task_id: str,
    embed_fn
):
    """Analyze human edits to agent output and create memories."""

    # Calculate edit percentage
    from difflib import SequenceMatcher
    ratio = SequenceMatcher(None, original, edited).ratio()
    edit_pct = 1.0 - ratio

    # Update task log
    await conn.execute("""
        UPDATE agent_task_log
        SET human_accepted = $1, human_edit_pct = $2
        WHERE id = $3
    """, edit_pct < 0.2, edit_pct, task_id)

    # If minimal edits, no learning needed
    if edit_pct < 0.05:
        return

    # Ask Claude to classify the edits
    analysis_prompt = f"""Compare the original AI draft with the human-edited version.
Identify specific patterns in how the human changed the text.

ORIGINAL:
{original[:3000]}

EDITED VERSION:
{edited[:3000]}

Classify each change as one of:
- style: tone, voice, formality, formatting
- content: added information, removed information, factual corrections
- structure: reordered sections, added subsections, changed hierarchy

Return JSON:
[{{"type": "style|content|structure",
   "observation": "specific pattern observed",
   "category": "writing_preference|content_preference|structure_preference"}}]"""

    changes = json.loads(await call_claude(analysis_prompt, max_tokens=1000))

    for change in changes:
        content = change['observation']
        embedding = await embed_fn(content)

        # Check if this reinforces an existing memory
        existing = await conn.fetchrow("""
            SELECT id, confidence, evidence_count
            FROM semantic_memories
            WHERE tenant_id = $1 AND agent_role = $2
              AND is_active
              AND 1 - (embedding <=> $3::vector) > 0.85
            ORDER BY embedding <=> $3::vector
            LIMIT 1
        """, tenant_id, agent_role, embedding)

        if existing:
            # Reinforce existing memory
            new_confidence = min(1.0, existing['confidence'] + 0.1)
            await conn.execute("""
                UPDATE semantic_memories
                SET confidence = $1, evidence_count = evidence_count + 1,
                    updated_at = now()
                WHERE id = $2
            """, new_confidence, existing['id'])
        else:
            # Create new memory
            await conn.execute("""
                INSERT INTO semantic_memories
                    (tenant_id, agent_role, embedding, content,
                     category, confidence, evidence_count)
                VALUES ($1, $2, $3::vector, $4, $5, 0.5, 1)
            """, tenant_id, agent_role, embedding, content, change['category'])
```

### Channel 2: Acceptance/Rejection Signals

Binary signal tracked in `agent_task_log`:
- `human_accepted = TRUE, human_edit_pct < 0.2` → Agent was right
- `human_edit_pct > 0.5` → Agent was significantly wrong
- `human_accepted = FALSE` → Output rejected entirely

**Calibration query:**

```sql
-- Monthly acceptance rate per agent role per tenant
SELECT
    agent_role,
    COUNT(*) AS total_tasks,
    AVG(CASE WHEN human_accepted THEN 1.0 ELSE 0.0 END) AS acceptance_rate,
    AVG(human_edit_pct) AS avg_edit_pct,
    AVG(cost_usd) AS avg_cost
FROM agent_task_log
WHERE tenant_id = $1
  AND created_at > now() - INTERVAL '30 days'
  AND human_accepted IS NOT NULL
GROUP BY agent_role
ORDER BY acceptance_rate DESC;
```

When acceptance rate drops below 50% for an agent role: trigger memory review.
Check for stale preferences, contradictory memories, or changed customer behavior.

### Channel 3: Outcome Attribution

When a proposal wins or loses, trace the outcome back to the content and agents
that contributed.

```python
async def attribute_outcome(conn, tenant_id: str, proposal_id: str, won: bool):
    """Attribute proposal outcome to library units and agent memories."""

    # 1. Find all library units used in this proposal
    used_units = await conn.fetch("""
        SELECT lu.id, lu.category, lu.content,
               ps.section_number, ps.title
        FROM library_harvest_log lhl
        JOIN library_units lu ON lu.id = lhl.unit_id
        JOIN proposal_sections ps ON ps.id = lhl.section_id
        WHERE lhl.proposal_id = $1
    """, proposal_id)

    # 2. Tag each unit with outcome
    for unit in used_units:
        await conn.execute("""
            INSERT INTO library_atom_outcomes
                (unit_id, proposal_id, tenant_id, won, section_used)
            VALUES ($1, $2, $3, $4, $5)
        """, unit['id'], proposal_id, tenant_id, won, unit['section_number'])

    # 3. Update unit confidence scores based on win rate
    await conn.execute("""
        UPDATE library_units lu
        SET confidence = (
            SELECT AVG(CASE WHEN won THEN 1.0 ELSE 0.0 END)
            FROM library_atom_outcomes lao
            WHERE lao.unit_id = lu.id
        )
        WHERE lu.id = ANY($1::uuid[])
    """, [u['id'] for u in used_units])

    # 4. Create scoring calibration memory
    scoring_tasks = await conn.fetch("""
        SELECT agent_role, metadata->>'total_score' AS predicted_score
        FROM agent_task_log
        WHERE proposal_id = $1 AND agent_role = 'scoring_strategist'
    """, proposal_id)

    outcome_text = "won" if won else "lost"
    for task in scoring_tasks:
        memory_content = (
            f"Proposal {proposal_id[:8]} {outcome_text}. "
            f"I predicted score: {task['predicted_score']}. "
            f"{'Scoring was accurate.' if won else 'I was over-optimistic.'}"
        )
        embedding = await embed_fn(memory_content)
        await conn.execute("""
            INSERT INTO episodic_memories
                (tenant_id, agent_role, embedding, content, memory_type, importance)
            VALUES ($1, 'scoring_strategist', $2::vector, $3, 'outcome', 0.9)
        """, tenant_id, embedding, memory_content)
```

### Channel 4: Explicit Feedback

Customer directly tells the agent a preference. Highest confidence.

```python
async def store_explicit_feedback(
    conn, tenant_id: str, agent_role: str,
    feedback: str, embed_fn
):
    """Store explicit customer feedback as high-confidence semantic memory."""
    embedding = await embed_fn(feedback)
    await conn.execute("""
        INSERT INTO semantic_memories
            (tenant_id, agent_role, embedding, content,
             category, confidence, evidence_count)
        VALUES ($1, $2, $3::vector, $4, 'explicit_preference', 0.95, 100)
    """, tenant_id, agent_role, embedding, feedback)
```

Evidence_count set to 100 so it never gets overridden by inferred preferences.

### Channel 5: Cross-Proposal Pattern Extraction

Monthly scheduled job that looks for patterns across multiple proposals:

```python
async def extract_cross_proposal_patterns(conn, tenant_id: str):
    """Find patterns that repeat across proposals for this tenant."""

    episodes = await conn.fetch("""
        SELECT content, metadata, agent_role
        FROM episodic_memories
        WHERE tenant_id = $1
          AND NOT is_archived
          AND memory_type IN ('observation', 'decision')
          AND importance >= 0.4
        ORDER BY occurred_at DESC
        LIMIT 50
    """, tenant_id)

    prompt = f"""Review these {len(episodes)} observations about a customer's
proposal development patterns. Identify PROCEDURAL rules — things they
consistently do the same way across multiple proposals.

Observations:
{chr(10).join(f'- [{e["agent_role"]}] {e["content"]}' for e in episodes)}

Return JSON array of procedural rules:
[{{"name": "short name",
   "description": "what to do and when",
   "trigger": "when this situation occurs",
   "agent_role": "which agent should follow this rule",
   "confidence": 0.5-1.0}}]

Only include rules supported by 2+ observations."""

    rules = json.loads(await call_claude(prompt, max_tokens=2000))

    for rule in rules:
        embedding = await embed_fn(rule['description'])
        await conn.execute("""
            INSERT INTO procedural_memories
                (tenant_id, agent_role, embedding, name, description,
                 trigger_conditions, steps, success_rate)
            VALUES ($1, $2, $3::vector, $4, $5, $6, '[]', 0.5)
        """, tenant_id, rule['agent_role'], embedding,
            rule['name'], rule['description'],
            json.dumps({"trigger": rule['trigger']}))
```

---

## The Confidence Model

```
confidence = min(1.0, base + (evidence_count - 1) * 0.1)

First observation:   0.5
Second:              0.6
Third:               0.7
Fifth:               0.9
Tenth+:              1.0

Contradicting evidence:  confidence *= 0.5
Explicit human feedback: confidence = 0.95 (immutable)
```

How confidence affects retrieval: the composite scoring function weights
effective_importance at 0.20 of the total score. A memory with confidence 0.9
scores 0.18 on this dimension; one with 0.3 scores 0.06. Combined with similarity
and recency, high-confidence memories surface reliably.

Memories below 0.3 confidence are candidates for archival during the weekly
garbage collection job.

---

## What Day 1 vs Day 1000 Looks Like

### Day 1 (Account Created)
- Episodic: 0
- Semantic: ~5 (seeded from onboarding — NAICS, tech focus, target agencies)
- Procedural: 0
- Agent behavior: Fully generic. Uses base archetype prompts. Acceptance rate: ~40%

### Day 30 (First Proposal Submitted)
- Episodic: ~50 task logs
- Semantic: ~10 (style preferences, basic content preferences)
- Procedural: 0 (not enough patterns yet)
- Agent behavior: Knows basic preferences. Acceptance rate: ~55%

### Day 180 (5 Proposals)
- Episodic: ~250 (many older ones compacted/archived)
- Semantic: ~40 (writing style, content, reviewer patterns, agency knowledge)
- Procedural: ~5 (repeat patterns for main agency/program type)
- Agent behavior: Confident recommendations. Cross-references past proposals. Acceptance rate: ~70%

### Day 365 (10 Proposals)
- Episodic: ~200 active (older compacted)
- Semantic: ~80 (rich knowledge base)
- Procedural: ~15 (agency-specific, category-specific patterns)
- Agent behavior: Suggests partners, pre-builds 60%+ of drafts. Acceptance rate: ~80%

### Day 1000 (25+ Proposals)
- Episodic: ~300 active
- Semantic: ~150 (deep institutional knowledge)
- Procedural: ~30 (mature rulebook)
- Agent behavior: Predicts pursuit decisions. Cross-agency recommendations.
  Drafts need ~20% editing. Scoring calibrated within ±5% of actual win rate.
