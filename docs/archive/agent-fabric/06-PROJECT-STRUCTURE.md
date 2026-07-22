# Chapter 6: Project Structure and Code Architecture

Where the agent code lives, how it connects to the existing codebase, and
how it deploys on Railway.

---

## Directory Structure

```
pipeline/src/
  agents/                              # NEW — Agent Fabric
    __init__.py
    fabric.py                          # AgentFabric orchestrator
    context.py                         # Prompt assembly
    memory.py                          # Memory read/write/search
    tools.py                           # Tool definitions + execution
    embeddings.py                      # Embedding generation
    archetypes/                        # Agent role definitions
      __init__.py
      base.py                          # BaseArchetype class
      opportunity_analyst.py
      scoring_strategist.py
      capture_strategist.py
      proposal_architect.py
      section_drafter.py
      compliance_reviewer.py
      color_team_reviewer.py
      partner_coordinator.py
      librarian.py
      packaging_specialist.py
    learning/                          # Continuous learning subsystem
      __init__.py
      diff_analyzer.py                 # Detect human edits
      preference_extractor.py          # Extract preferences from patterns
      pattern_promoter.py              # Promote episodic → semantic → procedural
      outcome_attributor.py            # Win/loss attribution
      calibrator.py                    # Performance calibration
    lifecycle/                         # Memory maintenance jobs
      __init__.py
      decay.py                         # Daily decay job
      compactor.py                     # Monthly compaction
      gc.py                            # Weekly garbage collection
      contradiction_resolver.py        # Conflict detection + resolution

frontend/app/api/
  portal/[tenantSlug]/
    agents/                            # NEW — Agent API surface
      route.ts                         # GET: list agents + status
      [agentRole]/
        invoke/route.ts                # POST: trigger agent on demand
        memories/route.ts              # GET/DELETE: view/manage memories
        performance/route.ts           # GET: performance metrics
    proposals/[proposalId]/
      ai/                              # NEW — Proposal AI actions
        draft/route.ts                 # POST: request section draft
        review/route.ts                # POST: request AI review
        compliance/route.ts            # POST: request compliance check

frontend/lib/
  agent-client.ts                      # NEW — TypeScript client for agent API
```

---

## The AgentFabric Class

The orchestrator. Receives events, loads the right archetype, assembles context,
calls Claude, processes results.

```python
# pipeline/src/agents/fabric.py

import anthropic
from .context import build_prompt
from .memory import MemoryStore
from .tools import ToolRegistry
from .archetypes import ARCHETYPE_REGISTRY

class AgentFabric:
    def __init__(self, db_pool, config):
        self.pool = db_pool
        self.client = anthropic.AsyncAnthropic()
        self.memory = MemoryStore(db_pool)
        self.tools = ToolRegistry(db_pool)
        self.config = config
        self.model = config.get('CLAUDE_MODEL', 'claude-sonnet-4-20250514')

    async def invoke(
        self,
        tenant_id: str,
        agent_role: str,
        task: dict,
    ) -> dict:
        """Execute an agent task. This is the main entry point."""

        # 1. Load archetype
        archetype = ARCHETYPE_REGISTRY[agent_role]

        # 2. Check rate limit and budget
        async with self.pool.acquire() as conn:
            if not await self._check_limits(conn, tenant_id):
                return {"status": "rate_limited"}

            # 3. Load tenant profile
            profile = await self._get_tenant_profile(conn, tenant_id)

            # 4. Generate query embedding for memory retrieval
            query_text = task.get('context_query', task.get('prompt', ''))
            embedding = await self._embed(query_text)

            # 5. Retrieve relevant memories
            memories = await self.memory.search(
                conn, tenant_id, embedding,
                agent_role=agent_role,
                token_budget=archetype.memory_token_budget
            )

            # 6. Build prompt
            system_prompt, user_message = build_prompt(
                archetype=archetype,
                tenant_profile=profile,
                memories=memories,
                task_data=task
            )

            # 7. Build tools
            tools = self.tools.for_tenant(tenant_id, archetype.allowed_tools)

        # 8. Call Claude
        task_log = {"tenant_id": tenant_id, "agent_role": agent_role,
                    "task_type": task.get('type', 'unknown')}
        try:
            result = await self._agent_loop(
                system_prompt, user_message, tools, archetype, task_log
            )
        except Exception as e:
            task_log['status'] = 'failed'
            task_log['error_message'] = str(e)
            await self._log_task(task_log)
            raise

        # 9. Store results and memories
        async with self.pool.acquire() as conn:
            await self._store_results(conn, tenant_id, agent_role, result, task_log)
            await self._write_task_memories(conn, tenant_id, agent_role, result)
            await self._log_task(task_log)

        # 10. Emit event
        await self._emit_event(tenant_id, agent_role, result)

        return result

    async def _agent_loop(self, system, user, tools, archetype, task_log):
        """The tool-use loop: call Claude, execute tools, repeat."""
        messages = [{"role": "user", "content": user}]
        total_input = 0
        total_output = 0
        tool_calls = 0

        while True:
            response = await self.client.messages.create(
                model=self.model,
                max_tokens=archetype.max_tokens,
                temperature=archetype.temperature,
                system=system,
                messages=messages,
                tools=tools.definitions(),
            )

            total_input += response.usage.input_tokens
            total_output += response.usage.output_tokens

            # Process response blocks
            assistant_content = response.content
            messages.append({"role": "assistant", "content": assistant_content})

            if response.stop_reason == "end_turn":
                break

            if response.stop_reason == "tool_use":
                tool_results = []
                for block in assistant_content:
                    if block.type == "tool_use":
                        tool_calls += 1
                        result = await tools.execute(block.name, block.input)
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": json.dumps(result)
                        })
                messages.append({"role": "user", "content": tool_results})

            # Safety: max 20 tool call rounds
            if tool_calls > 20:
                break

        task_log['input_tokens'] = total_input
        task_log['output_tokens'] = total_output
        task_log['tool_calls_count'] = tool_calls
        task_log['cost_usd'] = self._calculate_cost(total_input, total_output)

        # Extract text response
        text_blocks = [b.text for b in assistant_content if hasattr(b, 'text')]
        return {"text": "\n".join(text_blocks), "tool_calls": tool_calls}
```

---

## The BaseArchetype Class

```python
# pipeline/src/agents/archetypes/base.py

class BaseArchetype:
    """Base class for all agent archetypes."""

    name: str = ""
    description: str = ""

    # Prompt configuration
    system_prompt: str = ""
    temperature: float = 0.3        # Low for accuracy, higher for creativity
    max_tokens: int = 4096
    memory_token_budget: int = 3000  # Tokens reserved for memory injection

    # Tool access
    allowed_tools: list[str] = []

    # Behavior
    human_gate: bool = True          # Requires human approval?
    memory_categories: list[str] = []  # What kinds of memories this agent writes

    def task_summary(self, task: dict, result: dict) -> str:
        """Generate a summary for episodic memory. Override per archetype."""
        return f"{self.name} completed task: {task.get('type', 'unknown')}"

    def importance_score(self, task: dict, result: dict) -> float:
        """Calculate importance for episodic memory. Override per archetype."""
        return 0.5
```

### Example: Section Drafter Archetype

```python
# pipeline/src/agents/archetypes/section_drafter.py

from .base import BaseArchetype

class SectionDrafterArchetype(BaseArchetype):
    name = "section_drafter"
    description = "Drafts proposal sections from library units and requirements."

    temperature = 0.4   # Slightly creative for writing
    max_tokens = 8192   # Sections can be long
    memory_token_budget = 3000
    human_gate = True

    allowed_tools = [
        "memory_search", "memory_write",
        "library_search", "proposal_read",
        "opportunity_details", "section_draft",
        "request_human_review"
    ]

    memory_categories = [
        "writing_preference", "content_preference", "structure_preference"
    ]

    system_prompt = """You are a proposal section drafter for government
contracts (SBIR, STTR, BAA, OTA). Your job is to write compelling, compliant
proposal sections.

Your workflow:
1. Search your memory for this customer's writing preferences
2. Search the library for relevant reusable content
3. Read the RFP requirements for this section
4. Draft the section, incorporating library content and adapting to preferences
5. Flag any gaps where you need human input
6. Submit the draft with a confidence score

Rules:
- Always use active voice unless the customer prefers otherwise
- Always trace requirements — note which RFP requirement each paragraph addresses
- Never fabricate past performance, personnel, or technical capabilities
- If you lack information, flag it clearly rather than guessing
- Provide a confidence score (0-1) with your draft
"""

    def task_summary(self, task, result):
        section = task.get('section_title', 'unknown')
        confidence = result.get('confidence', 0)
        return (f"Drafted section '{section}' for proposal {task.get('proposal_id', '?')[:8]}. "
                f"Confidence: {confidence:.0%}.")

    def importance_score(self, task, result):
        return 0.6  # Drafting tasks are moderately important to remember
```

---

## Frontend ↔ Agent Communication

### Database-Mediated Pattern

The frontend (Next.js) does not call the Python agent service directly. Instead,
it writes to an `agent_task_queue` table, and the pipeline worker dequeues and
processes. This reuses the existing job queue architecture.

```sql
CREATE TABLE agent_task_queue (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    agent_role      TEXT NOT NULL,
    task_type       TEXT NOT NULL,
    task_data       JSONB NOT NULL,       -- The task payload
    priority        INT NOT NULL DEFAULT 5,  -- 1=highest, 10=lowest
    status          TEXT NOT NULL DEFAULT 'pending',
    result          JSONB,
    error_message   TEXT,
    requested_by    UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_agent_queue_pending ON agent_task_queue(priority, created_at)
    WHERE status = 'pending';

-- Notify pipeline worker on new task
CREATE OR REPLACE FUNCTION notify_agent_worker()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('agent_task', NEW.id::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_task_notify
    AFTER INSERT ON agent_task_queue
    FOR EACH ROW EXECUTE FUNCTION notify_agent_worker();
```

### Next.js API Route (Request AI Draft)

```typescript
// frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/ai/draft/route.ts

export async function POST(request: Request, { params }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { tenantSlug, proposalId } = params;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const hasAccess = await verifyTenantAccess(session.user.id, session.user.role, tenant.id);
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body = await request.json();
    const { sectionId } = body;

    // Queue the agent task
    const [task] = await sql`
      INSERT INTO agent_task_queue
        (tenant_id, agent_role, task_type, task_data, requested_by)
      VALUES (
        ${tenant.id}, 'section_drafter', 'draft_section',
        ${JSON.stringify({ proposal_id: proposalId, section_id: sectionId })},
        ${session.user.id}
      )
      RETURNING id, status, created_at
    `;

    return NextResponse.json({ data: task });
  } catch (error) {
    console.error('[POST /ai/draft] Error:', error);
    return NextResponse.json({ error: 'Failed to queue draft request' }, { status: 500 });
  }
}
```

### Result Polling (Frontend)

```typescript
// frontend/lib/agent-client.ts

export async function pollAgentTask(tenantSlug: string, taskId: string): Promise<AgentTaskResult> {
  const maxAttempts = 30;
  const pollInterval = 2000; // 2 seconds

  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`/api/portal/${tenantSlug}/agents/tasks/${taskId}`);
    const { data } = await res.json();

    if (data.status === 'completed') return data;
    if (data.status === 'failed') throw new Error(data.error_message);

    await new Promise(r => setTimeout(r, pollInterval));
  }

  throw new Error('Agent task timed out');
}
```

---

## Pipeline Worker Integration

The agent task processor integrates with the existing pipeline main loop:

```python
# In pipeline/src/main.py — add to the main worker loop

async def process_agent_tasks(conn, fabric: AgentFabric):
    """Dequeue and process agent tasks."""
    task = await conn.fetchrow("""
        UPDATE agent_task_queue
        SET status = 'running', started_at = now()
        WHERE id = (
            SELECT id FROM agent_task_queue
            WHERE status = 'pending'
            ORDER BY priority, created_at
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        RETURNING *
    """)

    if not task:
        return False

    try:
        result = await fabric.invoke(
            tenant_id=str(task['tenant_id']),
            agent_role=task['agent_role'],
            task=json.loads(task['task_data'])
        )
        await conn.execute("""
            UPDATE agent_task_queue
            SET status = 'completed', result = $1, completed_at = now()
            WHERE id = $2
        """, json.dumps(result), task['id'])
    except Exception as e:
        await conn.execute("""
            UPDATE agent_task_queue
            SET status = 'failed', error_message = $1, completed_at = now()
            WHERE id = $2
        """, str(e), task['id'])

    return True
```

---

## Deployment on Railway

The agent system runs as part of the existing pipeline service:

```dockerfile
# Same Dockerfile as pipeline — no separate service needed for V1
FROM python:3.12-slim
# ... existing pipeline setup ...
# agents/ directory is included in the src/ copy
COPY src/ /app/src/
CMD ["python", "src/main.py"]
```

The pipeline worker's main loop now listens for both `pipeline_worker` and
`agent_task` notifications:

```python
# Main loop addition
await conn.add_listener('agent_task', on_agent_task_notify)
```

**Scaling**: When agent load grows beyond what one pipeline worker can handle,
add more worker containers on Railway. The `FOR UPDATE SKIP LOCKED` pattern
ensures each task is processed by exactly one worker.

**Future**: When volume justifies it, split the agent system into a separate
Railway service with its own scaling configuration.

---

## Configuration

### Environment Variables

```
ANTHROPIC_API_KEY=sk-ant-...          # Required
CLAUDE_MODEL=claude-sonnet-4-20250514   # Default model
AGENT_MAX_RETRIES=3                   # Retry on transient failures
AGENT_DEFAULT_TEMPERATURE=0.3         # Override per archetype
EMBEDDING_MODEL=all-MiniLM-L6-v2     # sentence-transformers model
```

### Per-Tenant Configuration

```sql
CREATE TABLE tenant_agent_config (
    tenant_id       UUID PRIMARY KEY REFERENCES tenants(id),
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    model_override  TEXT,               -- NULL = use default
    monthly_budget  FLOAT DEFAULT 50.0,
    monthly_used    FLOAT DEFAULT 0.0,
    preferences     JSONB DEFAULT '{}', -- UI-configurable settings
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
