# RFP Pipeline Portal — V5 Full Architecture Vision
**Baseline Document — 2026-04-05**

## The Product in One Sentence

An AI-powered capture management platform where a continuously learning workforce of specialized AI agents partners with human teams to find, qualify, capture, and win government contracts — getting smarter with every proposal.

---

## I. The Five Services

```
┌─────────────────────────────────────────────────────────────────┐
│                        GATEWAY / EDGE                           │
│  Authentication, routing, rate limiting, tenant resolution      │
└──────────┬──────────┬──────────┬──────────┬──────────┬─────────┘
           │          │          │          │          │
     ┌─────▼───┐ ┌───▼────┐ ┌──▼───┐ ┌───▼────┐ ┌───▼─────┐
     │ FINDER  │ │CAPTURE │ │AGENT │ │CONTENT │ │IDENTITY │
     │ SERVICE │ │SERVICE │ │FABRIC│ │SERVICE │ │SERVICE  │
     └─────┬───┘ └───┬────┘ └──┬───┘ └───┬────┘ └───┬─────┘
           │          │         │          │          │
     ┌─────▼──────────▼─────────▼──────────▼──────────▼─────────┐
     │                    EVENT BUS                               │
     │  Namespaced streams, ordered, replayable, triggerable     │
     └─────────────────────────┬─────────────────────────────────┘
                               │
     ┌─────────────────────────▼─────────────────────────────────┐
     │                  PERSISTENCE LAYER                         │
     │  Relational store, document store, vector store,          │
     │  file store, memory store                                  │
     └───────────────────────────────────────────────────────────┘
```

### Service 1: FINDER SERVICE

**Purpose:** Opportunity discovery, scoring, monitoring, and presentation

**Responsibilities:**
- Ingest opportunities from all federal sources (SAM.gov, SBIR.gov, Grants.gov, USASpending, FPDS)
- Maintain canonical opportunity records (source-of-truth, deduplicated)
- Score every opportunity against every active tenant profile
- Detect amendments, track lifecycle (posted → active → closing → closed → awarded)
- Surface ranked opportunities with AI-generated rationale
- Manage spotlights (saved search buckets with persistent scoring)
- Track tenant reactions (thumbs, pins, pursuit status)
- Generate FOMO signals

**Events it emits:**
- `finder.opportunity.ingested`
- `finder.opportunity.amended`
- `finder.opportunity.awarded`
- `finder.opportunity.expired`
- `finder.scoring.completed`
- `finder.scoring.llm_adjusted`
- `finder.alert.high_match`
- `finder.alert.closing_soon`
- `finder.alert.missed_opportunity`

### Service 2: CAPTURE SERVICE

**Purpose:** Proposal lifecycle management from pursuit decision through submission and archival

**Responsibilities:**
- Proposal workspace creation (triggered by purchase)
- Stage-gate workflow management (outline → draft → pink → red → gold → final → submitted → archived)
- Collaborator/partner access control (invite, scope, revoke — stage-aware)
- Document management within proposals
- Library unit management (atomic reusable content)
- Proposal packaging and export
- Post-submission tracking (win/loss, debrief capture)
- Library feedback loop (harvest winning content)

**Events it emits:**
- `capture.proposal.created`
- `capture.proposal.stage_changed`
- `capture.proposal.stage_closed`
- `capture.section.drafted`
- `capture.section.reviewed`
- `capture.collaborator.invited`
- `capture.collaborator.access_granted`
- `capture.collaborator.access_revoked`
- `capture.partner.nudge_sent`
- `capture.partner.upload_received`
- `capture.library.unit_created`
- `capture.library.unit_approved`
- `capture.library.unit_harvested`
- `capture.proposal.submitted`
- `capture.proposal.outcome_recorded`

### Service 3: AGENT FABRIC

**Purpose:** The AI workforce — agent lifecycle, assignment, memory, and execution

**Responsibilities:**
- Maintain the agent archetype registry (the "talent pool")
- Instantiate agents for specific tasks
- Manage agent memory (short-term, medium-term, long-term)
- Route work to the right agent with the right context
- Track agent performance and outcomes
- Enforce guardrails
- Manage customer-specific specialization

**Events it emits:**
- `agent.task.assigned`
- `agent.task.completed`
- `agent.task.rejected_by_human`
- `agent.task.accepted_by_human`
- `agent.memory.updated`
- `agent.skill.improved`
- `agent.recommendation.made`

### Service 4: CONTENT SERVICE

**Purpose:** Public-facing content, CMS, marketing, waitlist, analytics

### Service 5: IDENTITY SERVICE

**Purpose:** Authentication, authorization, tenant management, billing

**Events it emits:**
- `identity.user.created`
- `identity.user.login`
- `identity.tenant.created`
- `identity.tenant.tier_changed`
- `identity.invitation.sent`
- `identity.invitation.accepted`
- `identity.purchase.completed`
- `identity.consent.accepted`

---

## II. The Event Bus

**Stream Architecture:**
```
finder.*          → Opportunity lifecycle events
capture.*         → Proposal/library lifecycle events
agent.*           → AI workforce events
content.*         → CMS/marketing events
identity.*        → Auth/billing/tenant events
automation.*      → Rule evaluation and execution events
```

**Event Contract:**
```json
{
  "id":             "globally unique event ID",
  "stream":         "namespaced stream (e.g. capture.proposal)",
  "type":           "specific event type (e.g. stage_changed)",
  "timestamp":      "when it happened",
  "actor":          "who/what caused it (user, system, agent, pipeline)",
  "tenant_id":      "tenant scope (null for global events)",
  "entity_id":      "primary entity affected",
  "entity_type":    "what kind of entity",
  "payload":        "event-specific data",
  "correlation_id": "traces related events across services",
  "causation_id":   "the event that caused this event",
  "version":        "schema version for evolution"
}
```

**Consumers:**
- **Automation Manager** — evaluates rules, fires actions
- **Notification Dispatcher** — routes to users/channels
- **Agent Orchestrator** — triggers AI work
- **Analytics Aggregator** — materializes metrics
- **Audit Recorder** — immutable compliance log

---

## III. The AI Workforce Architecture

### The Three-Layer Agent Model

```
┌─────────────────────────────────────────────────────────────┐
│ LAYER 3: CUSTOMER SPECIALISTS                               │
│ "I am the RFP Analyzer for AcmeTech who does AF SBIRs"    │
│ Customer-specific memory, preferences, patterns             │
├─────────────────────────────────────────────────────────────┤
│ LAYER 2: SKILLED PROFESSIONALS                              │
│ "I am an RFP Analyzer who understands SBIR Phase I"        │
│ Domain training, agency formats, evaluation criteria        │
├─────────────────────────────────────────────────────────────┤
│ LAYER 1: BASE CAPABILITIES                                  │
│ "I am Claude. I can read, write, analyze, reason."         │
│ Foundation model + platform guardrails                       │
└─────────────────────────────────────────────────────────────┘
```

### Agent Archetypes

| Role | Responsibility | Key Skill |
|------|---------------|-----------|
| **RFP Analyzer** | Parse solicitations, extract requirements | Deep reading, structured extraction |
| **Opportunity Scorer** | Score opportunities against tenant profile | Pattern matching, competitive analysis |
| **Proposal Strategist** | Recommend win themes, design outlines | Strategic reasoning, risk assessment |
| **Section Drafter** | Draft proposal sections from library + requirements | Technical writing, tone matching |
| **Compliance Reviewer** | Verify requirements addressed, format correct | Checklist verification, gap analysis |
| **Color Team Reviewer** | Simulate color team review, identify weaknesses | Critical analysis, rubric application |
| **Partner Coordinator** | Draft communications, track contributions | Communication, deadline management |
| **Packaging Specialist** | Format and compile submission documents | Agency-specific formatting |
| **Librarian** | Catalog, tag, score, maintain content library | Classification, freshness assessment |

### Four-Layer Memory Architecture

**Layer 1: Foundational Knowledge (Shared, Immutable)**
- FAR/DFARS, agency structures, evaluation criteria, formatting standards
- Platform-maintained, updated on regulation changes

**Layer 2: Learned Patterns (Cross-Tenant, Anonymized)**
- Statistical patterns from all proposals across all tenants
- Win rate correlations, agency preferences, scoring model weights

**Layer 3: Tenant Context (Per-Customer, Persistent)**
- Company profile, tech focus, key personnel, past proposals
- Writing style, reviewer feedback, partner relationships
- Evolves with every proposal, review, and outcome

**Layer 4: Working Memory (Per-Session, Ephemeral)**
- Current task context, conversation state
- Significant learnings promoted to Layer 3

### Agent Lifecycle: Pool to Specialist

```
Day 1:    Generic assignment → reads tenant profile, builds initial memory
Day 30:   First proposal complete → episodic memory, initial preferences
Day 365:  5 proposals later → calibrated scoring, confident recommendations
Day 1000: Domain expert → predicts pursuits, cross-agency recommendations
```

### Guardrails

**Never autonomous:** Submit proposals, grant/revoke access, delete content, communicate externally, override humans
**Autonomous if enabled:** Draft sections, score opportunities, flag compliance, suggest content, send internal notifications
**Recommend but human decides:** Pursuit decisions, win themes, partner selection, stage advancement, final approval

---

## IV. The Customer Journey

```
DISCOVER → ONBOARD → MONITOR → QUALIFY → BUILD → SUBMIT → LEARN → WIN/MANAGE
```

### Build Phase (The Core Product)

```
OUTLINE → DRAFT → PINK TEAM → RED TEAM → GOLD TEAM → FINAL → SUBMIT

Each stage:
  → Customer sets collaborators + permissions
  → AI pre-builds what it can, flags what needs human input
  → Collaborators notified, given scoped access (view/comment/edit)
  → HITL editing in collaborative editor
  → AI reviews for compliance, quality, consistency
  → Stage review happens (human or AI-assisted)
  → Customer closes stage → access revoked → next stage opens
```

### Partner/Collaborator Model

- Identity: `(email)` globally, access scoped to `(email + tenant + proposal + stage)`
- Historical roster per tenant for quick re-invitation
- Three permission tiers: view, comment, edit
- Auto-revoke on stage close

---

## V. Technology Stack

### Frontend/Portal
- Next.js 15 (App Router), React 19, TypeScript
- Tailwind CSS, TipTap (ProseMirror), Recharts, TanStack Query, dnd-kit
- WebSocket for collaborative editing (V2+)

### Backend/Services
- Next.js API routes (V1, monolith → split V3+)
- Python async workers (pipeline, AI agents)
- NextAuth v5 (Auth.js)

### AI/Agent Fabric
- Claude (Anthropic) — primary LLM
- Sentence Transformers (V1) → Anthropic Embeddings (V2+)
- Custom agent framework (not LangChain/CrewAI)
- PostgreSQL + pgvector for all memory types

### Data Persistence
- PostgreSQL 16 (relational, JSON, FTS, pgvector)
- Local filesystem (Railway volumes) — tenant-isolated
- R2/S3 for archive (V2+)
- PostgreSQL append-only tables for event store

### Infrastructure
- Railway (hosting, PostgreSQL, volumes)
- GitHub Actions → Railway auto-deploy
- Resend (email), Stripe (payments)
- Sentry (errors, V2+), PostHog (analytics, V2+)

---

## VI. Data Segregation

```
GLOBAL (Platform-Level, Shared):
  - opportunities (canonical)
  - pipeline infrastructure
  - system config
  - agent archetype definitions
  - cross-tenant patterns (anonymized)

TENANT-SCOPED (Strictly Isolated):
  - tenant profiles, scored views
  - proposals and all sub-entities
  - library units, harvest logs, outcomes
  - partner directory, access grants
  - customer events
  - agent memory (per-tenant instances)
  - /data/customers/{slug}/ filesystem tree

PROPOSAL-SCOPED (Subset of Tenant):
  - collaborator access grants (stage-scoped)
  - proposal sections, reviews, comments
  - workspace files
  - compliance matrix
```

---

## VII. Design Principles

1. **Manual-first, automation-ready** — Every step works with human clicks; automation toggles layer on top
2. **Event-driven spine** — All services communicate through named, ordered, replayable event streams
3. **Tenant isolation is structural** — DB-level, filesystem-level, memory-level
4. **Append-only where it matters** — Events, memories, stage transitions are never overwritten
5. **Configuration over code** — Automation rules, agent archetypes, workflow templates in the DB
6. **The AI learns, the human decides** — Agents recommend with transparency; humans approve
7. **Build the plane as you fly** — V1 foundations support V5 vision without premature complexity

---

## VIII. The Learning Flywheel

```
PROPOSAL OUTCOME (win/loss)
  → OUTCOME ATTRIBUTION (which atoms, themes, strategies?)
  → LIBRARY FEEDBACK (boost winners, review losers)
  → AGENT MEMORY UPDATE (procedural rules refined)
  → GLOBAL POOL LEARNING (anonymized patterns)
  → NEXT PROPOSAL STARTS STRONGER
```
