# Chapter 1: How Agents Actually Work

## The Core Mental Model

An AI agent is not a persistent process. It is not a running program that
"remembers" things. It is not a neural network that gets retrained per customer.

An agent is a **stateless function call** with **injected context**.

Every single time an agent does work — scores an opportunity, drafts a proposal
section, reviews compliance — the following happens:

```
1. Something triggers the agent (event, user action, scheduled job)
2. The system assembles a PROMPT:
   - Base instructions (who you are, what you can do, what you cannot do)
   - Tenant context (retrieved from memory store)
   - Task-specific context (the RFP text, the section requirements, etc.)
   - Relevant memories (retrieved via semantic search)
   - Available tools (what the agent can call)
3. The prompt is sent to Claude's API
4. Claude returns a response (text, tool calls, or both)
5. If tool calls: execute them, send results back, get next response
6. Repeat until Claude says "done" or hits a human gate
7. Store results, update memories, emit events
```

That's it. There is no persistent "agent process" running somewhere. There is no
model that got fine-tuned for this customer. There is a function that assembles
context, calls Claude, and processes the response.

**The entire "intelligence" of the agent comes from what you put in the prompt.**

This is not a limitation — it is the architecture. It means:
- Agents are stateless → horizontally scalable, no session affinity needed
- Agents are deterministic in structure → testable, auditable
- Agent "specialization" is context injection → no training cost, instant updates
- Agent "memory" is database queries → queryable, deletable, tenant-isolated

---

## What "Learning" Actually Means

When we say "the agent learns that Customer A prefers formal tone," what actually
happens is:

1. Customer A edits an agent's casual draft to be formal
2. The system detects the diff: casual → formal
3. A memory entry is created:
   ```json
   {
     "type": "style_preference",
     "content": "Customer prefers formal tone in proposal sections. They edited
                 a casual draft to use third-person passive voice, removed
                 contractions, and added section numbering.",
     "confidence": 0.7,
     "evidence_count": 1,
     "tenant_id": "acme-uuid"
   }
   ```
4. This gets embedded (vector) and stored in PostgreSQL
5. Next time the Section Drafter runs for Customer A:
   - The system queries: "What do I know about writing style for this tenant?"
   - This memory comes back with high similarity
   - It gets injected into the prompt:
     ```
     ## Known Preferences for This Customer
     - Customer prefers formal tone (confidence: 0.7, based on 1 observation)
       They use third-person passive voice, no contractions, numbered sections.
     ```
   - Claude reads this and adjusts its output accordingly

6. If the customer edits again → confidence increases, evidence_count goes up
7. If the customer doesn't edit → the preference is confirmed, confidence grows
8. If the customer edits in the opposite direction → contradiction detected,
   old memory superseded

**The model's weights never change.** The context changes. That IS the learning.

---

## Why This Works (And Where It Doesn't)

### It works because:

- **Claude is a strong base model.** It already knows how to write proposals,
  understand government contracting, follow formatting rules. We are not teaching
  it new capabilities — we are telling it which of its existing capabilities to
  apply and how to apply them for this specific customer.

- **Context injection is equivalent to few-shot learning.** Research shows that
  for most practical tasks, injecting 3-8 relevant examples in context performs
  as well as or better than fine-tuning on hundreds of examples. We are doing
  precisely this: injecting the customer's past edits, preferences, and successful
  outputs as examples.

- **The memory store compounds.** Every proposal adds content. Every review adds
  preferences. Every outcome adds signal. After 5 proposals, the agent has seen
  enough of this customer's work to be genuinely useful. After 10, it is
  approaching expert-level customization.

### It does NOT work for:

- **Novel capabilities the base model lacks.** If Claude cannot do X (e.g.,
  certain types of mathematical modeling), no amount of context injection will
  teach it X. This is not our problem — proposal writing is squarely within
  Claude's capabilities.

- **Tasks requiring more context than the window allows.** Claude's context
  window is large (200K+ tokens) but not infinite. If a customer has 500 library
  units, 50 past proposals, and 200 memory entries, we cannot inject all of them.
  We must retrieve the RIGHT ones. This is why retrieval quality is the moat.

- **Guaranteed determinism.** The same prompt can produce different outputs on
  different calls. For compliance-critical outputs, the agent produces a draft
  and the human verifies. This is by design — the HITL gates are not a weakness,
  they are the architecture.

---

## The Tool Use Pattern

Claude does not just generate text. It can call tools — structured function calls
that the system executes on Claude's behalf. This is how agents interact with
the database, filesystem, and other services.

For our system, agents have access to these tool categories:

```
MEMORY TOOLS (read/write agent memory):
  - memory_search(query, tenant_id, memory_type, limit)
  - memory_write(content, memory_type, metadata, tenant_id)
  - memory_update(memory_id, content, confidence)

KNOWLEDGE TOOLS (read tenant data):
  - library_search(query, tenant_id, category, limit)
  - proposal_read(proposal_id, section_id)
  - tenant_profile(tenant_id)
  - opportunity_details(opportunity_id)

ACTION TOOLS (write outputs):
  - section_draft(proposal_id, section_id, content, confidence)
  - compliance_flag(proposal_id, requirement_id, status, note)
  - review_comment(proposal_id, section_id, comment, severity)
  - score_adjust(tenant_id, opportunity_id, adjustment, rationale)

COORDINATION TOOLS (interact with workflow):
  - notify(user_id, message, priority)
  - request_human_review(proposal_id, section_id, reason)
  - emit_event(stream, type, payload)
```

**The agent does not have direct database access.** It calls tools. The tools
enforce tenant isolation, validate inputs, and log everything. The agent cannot
bypass the tools — Claude's tool use is structured output that the system
interprets and executes.

This is a critical security property: the agent's capabilities are exactly and
only what the tools allow. Adding a new capability means adding a new tool.
Removing a capability means removing a tool. The agent cannot improvise
access paths.

---

## The Agent Loop

When an agent is invoked, the execution follows this loop:

```
┌─────────────────────────────────────────────────────┐
│ 1. TRIGGER                                          │
│    Event arrives (e.g., capture.proposal.created)    │
│    OR scheduled job fires                           │
│    OR user requests action                          │
├─────────────────────────────────────────────────────┤
│ 2. CONTEXT ASSEMBLY                                 │
│    a. Load agent archetype (base system prompt)     │
│    b. Load tenant profile (structured context)      │
│    c. Retrieve relevant memories (semantic search)  │
│    d. Load task-specific data (RFP, section, etc.)  │
│    e. Assemble tool definitions                     │
│    f. Build the complete prompt                     │
├─────────────────────────────────────────────────────┤
│ 3. CLAUDE API CALL                                  │
│    Send assembled prompt + tools to Claude          │
│    (with prompt caching for stable portions)        │
├─────────────────────────────────────────────────────┤
│ 4. RESPONSE PROCESSING                              │
│    Claude returns one of:                           │
│    a. Text → store as output                        │
│    b. Tool call → execute tool, return result       │
│    c. Stop → agent is done                          │
│                                                     │
│    If tool call: execute, send result back to       │
│    Claude, goto step 4 (tool use loop)              │
├─────────────────────────────────────────────────────┤
│ 5. OUTPUT HANDLING                                  │
│    a. Store agent output (draft, review, score)     │
│    b. Extract learnings → write to memory store     │
│    c. Emit events (agent.task.completed, etc.)      │
│    d. If human gate required: queue for review      │
│    e. Log task metrics (tokens, latency, cost)      │
└─────────────────────────────────────────────────────┘
```

### The Tool Use Loop in Detail

Most agent tasks require multiple tool calls. Example: the Section Drafter
working on a Technical Approach section:

```
Turn 1: Claude receives prompt with task description
  → Calls: memory_search("technical approach writing style", tenant_id)
  → System returns: 3 style preferences, 2 past corrections

Turn 2: Claude receives memory results
  → Calls: library_search("technical approach RF microwave", tenant_id)
  → System returns: 5 relevant library units with confidence scores

Turn 3: Claude receives library results
  → Calls: opportunity_details(opportunity_id)
  → System returns: full RFP requirements for this section

Turn 4: Claude receives RFP details
  → Calls: section_draft(proposal_id, section_id, content="...", confidence=0.75)
  → System stores the draft, returns confirmation

Turn 5: Claude receives confirmation
  → Returns text: "I've drafted the Technical Approach section using 3 library
     units and adapting to your preference for formal tone with TRL roadmaps.
     Confidence: 75%. Key areas needing human input: [specific gaps identified]."
  → Agent loop ends
```

Each turn costs tokens. Typical agent task: 3-8 tool calls, 5K-20K input tokens,
1K-5K output tokens. With prompt caching, the stable portion (system prompt +
tenant profile) costs 0.1x after the first call.

---

## What This Means For Our Architecture

1. **Agents are Python functions**, not long-running processes. They are invoked
   by the pipeline worker when triggered by events or schedules.

2. **Agent "identity" is a database row**, not a running instance. The archetype
   definition, tenant binding, and memory are all in PostgreSQL. Any worker can
   execute any agent — there is no affinity.

3. **Agent "specialization" is query results.** When we say "the agent specialized
   for AcmeTech," we mean "the memory store has 200 entries scoped to AcmeTech's
   tenant_id that get retrieved and injected on every call."

4. **Agent "improvement" is memory growth.** More memories with higher confidence
   and more evidence = better context injection = better outputs.

5. **The moat is retrieval quality.** The model is the same for everyone (Claude).
   The difference is what context we give it. Getting the RIGHT 5 memories out of
   200 is the hard problem. This is why Chapter 3 (Memory Architecture) is the
   most important chapter in this series.
