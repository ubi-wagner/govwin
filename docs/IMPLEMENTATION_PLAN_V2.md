# RFP Pipeline SaaS — Clean Build Implementation Plan

**Created: 2026-04-07**
**Status: PENDING REVIEW — Do not begin until approved**
**Approach: Clean build in new branch, cherry-pick proven components from existing codebase**

This is a CLEAN BUILD. We are not refactoring — we are building the system right
from the architecture we designed. Proven code from the existing codebase gets
copied in as components, not migrated.

---

## What We Carry Forward (Copy, Not Migrate)

### From existing frontend/lib/:
- `auth.ts` — NextAuth v5 config (credentials provider, JWT, role encoding)
- `db.ts` — postgres.js + pg Pool connection pattern
- `storage.ts` — local filesystem operations (tenant-scoped paths, SHA-256)
- `crypto.ts` — AES-256-GCM encryption for API keys
- `events.ts` — event emitter pattern (adapt to new namespaces)

### From existing pipeline/src/:
- `ingest/sam_gov.py` — SAM.gov ingester (proven, works)
- `ingest/sbir_gov.py` — SBIR.gov ingester
- `ingest/grants_gov.py` — Grants.gov ingester
- `scoring/engine.py` — scoring logic (adapt for curated-only pipeline)
- `workers/grinder.py` — document decomposition to library units
- `workers/embedder.py` — vector embedding generation
- `workers/reminder.py` — deadline nudge pattern
- `main.py` — job queue pattern (LISTEN/NOTIFY, dequeue, execute)

### From existing frontend/app/:
- Marketing page components and styling (visual design carries over)
- Tailwind config (brand colors, animations, shadows)
- Error boundary patterns (error.tsx, global-error.tsx)

### What We DO NOT Carry Forward:
- The 37 migrations (one clean baseline migration)
- All CMS/content tables, routes, pages, libs (CMS is a separate service)
- Google Drive integration in portal paths
- Flat collaborator model
- API routes that don't match new architecture
- Existing test files (rewrite against new schema)

---

## Final Project Structure (All Services)

```
govwin/
├── CLAUDE.md                          # Dev standards + project structure
├── ARCHITECTURE_V5.md                 # System architecture reference
├── docs/
│   ├── agent-fabric/                  # Agent Fabric chapters 01-08
│   ├── IMPLEMENTATION_PLAN.md         # This file
│   ├── DEPLOYMENT.md                  # Railway service configuration
│   └── API_REFERENCE.md              # All API endpoints
│
├── frontend/                          # SERVICE 1: Next.js Portal
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   └── change-password/page.tsx
│   │   ├── (marketing)/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx               # Home
│   │   │   ├── about/page.tsx
│   │   │   ├── features/page.tsx
│   │   │   ├── pricing/page.tsx
│   │   │   ├── engine/page.tsx
│   │   │   ├── team/page.tsx
│   │   │   ├── customers/page.tsx
│   │   │   ├── get-started/page.tsx
│   │   │   └── legal/
│   │   │       ├── layout.tsx
│   │   │       ├── terms/page.tsx
│   │   │       ├── privacy/page.tsx
│   │   │       ├── acceptable-use/page.tsx
│   │   │       └── ai-disclosure/page.tsx
│   │   ├── admin/                     # Super admin + RFP Admin
│   │   │   ├── layout.tsx
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── tenants/
│   │   │   │   ├── page.tsx
│   │   │   │   └── [tenantId]/page.tsx
│   │   │   ├── rfp-curation/          # NEW: RFP expert curation
│   │   │   │   ├── page.tsx           # Triage queue
│   │   │   │   └── [solId]/page.tsx   # Curation workspace
│   │   │   ├── pipeline/page.tsx
│   │   │   ├── sources/page.tsx
│   │   │   ├── agents/page.tsx        # NEW: Agent monitoring
│   │   │   ├── purchases/page.tsx
│   │   │   ├── events/page.tsx
│   │   │   ├── analytics/page.tsx
│   │   │   └── waitlist/page.tsx
│   │   ├── portal/                    # Customer portal
│   │   │   ├── page.tsx               # Tenant selector
│   │   │   └── [tenantSlug]/
│   │   │       ├── layout.tsx
│   │   │       ├── dashboard/page.tsx
│   │   │       ├── pipeline/page.tsx          # Finder
│   │   │       ├── spotlights/
│   │   │       │   ├── page.tsx
│   │   │       │   └── [spotlightId]/page.tsx
│   │   │       ├── proposals/
│   │   │       │   ├── page.tsx               # Proposal list
│   │   │       │   └── [proposalId]/
│   │   │       │       ├── page.tsx           # Proposal workspace
│   │   │       │       ├── sections/[sectionId]/page.tsx  # Section editor
│   │   │       │       └── review/page.tsx    # Review interface
│   │   │       ├── library/page.tsx
│   │   │       ├── documents/page.tsx
│   │   │       ├── team/page.tsx
│   │   │       └── profile/page.tsx
│   │   ├── invite/[token]/page.tsx
│   │   ├── dashboard/page.tsx         # Post-login redirect
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/route.ts
│   │   │   ├── auth/change-password/route.ts
│   │   │   ├── health/route.ts
│   │   │   ├── system/route.ts
│   │   │   ├── stripe/
│   │   │   │   ├── checkout/route.ts
│   │   │   │   └── webhook/route.ts
│   │   │   ├── waitlist/route.ts
│   │   │   ├── consent/route.ts
│   │   │   ├── invite/route.ts
│   │   │   ├── admin/
│   │   │   │   ├── dashboard/route.ts
│   │   │   │   ├── rfp-curation/
│   │   │   │   │   ├── route.ts               # GET list, POST create
│   │   │   │   │   └── [solId]/
│   │   │   │   │       ├── route.ts           # GET detail, PATCH update
│   │   │   │   │       ├── triage/route.ts    # POST dismiss/hold/release
│   │   │   │   │       ├── claim/route.ts     # POST claim/unclaim
│   │   │   │   │       ├── compliance/route.ts
│   │   │   │   │       ├── annotations/route.ts
│   │   │   │   │       ├── outline/route.ts
│   │   │   │   │       ├── templates/route.ts
│   │   │   │   │       └── push/route.ts      # POST push to pipeline
│   │   │   │   ├── tenants/route.ts
│   │   │   │   ├── tenants/[tenantId]/route.ts
│   │   │   │   ├── pipeline/route.ts
│   │   │   │   ├── sources/route.ts
│   │   │   │   ├── agents/route.ts
│   │   │   │   ├── purchases/route.ts
│   │   │   │   ├── analytics/route.ts
│   │   │   │   └── waitlist/route.ts
│   │   │   ├── portal/[tenantSlug]/
│   │   │   │   ├── dashboard/route.ts
│   │   │   │   ├── proposals/
│   │   │   │   │   ├── route.ts
│   │   │   │   │   └── [proposalId]/
│   │   │   │   │       ├── route.ts
│   │   │   │   │       ├── sections/route.ts
│   │   │   │   │       ├── collaborators/route.ts
│   │   │   │   │       ├── compliance/route.ts
│   │   │   │   │       ├── reviews/route.ts
│   │   │   │   │       ├── stage/route.ts     # POST advance stage
│   │   │   │   │       ├── package/route.ts   # POST generate package
│   │   │   │   │       └── ai/
│   │   │   │   │           ├── draft/route.ts
│   │   │   │   │           ├── review/route.ts
│   │   │   │   │           └── compliance/route.ts
│   │   │   │   ├── spotlights/
│   │   │   │   │   ├── route.ts
│   │   │   │   │   └── [spotlightId]/route.ts
│   │   │   │   ├── library/
│   │   │   │   │   ├── route.ts
│   │   │   │   │   └── [unitId]/route.ts
│   │   │   │   ├── opportunities/
│   │   │   │   │   ├── route.ts
│   │   │   │   │   └── [opportunityId]/
│   │   │   │   │       ├── actions/route.ts
│   │   │   │   │       └── documents/route.ts
│   │   │   │   ├── team/route.ts
│   │   │   │   ├── profile/route.ts
│   │   │   │   ├── notifications/route.ts
│   │   │   │   ├── uploads/route.ts
│   │   │   │   ├── purchases/route.ts
│   │   │   │   └── agents/
│   │   │   │       ├── memories/route.ts
│   │   │   │       ├── performance/route.ts
│   │   │   │       └── config/route.ts
│   │   │   └── events/route.ts
│   │   ├── error.tsx
│   │   ├── global-error.tsx
│   │   └── layout.tsx
│   ├── components/                    # Shared UI components
│   │   ├── ui/                        # Base components (buttons, cards, modals)
│   │   ├── admin/                     # Admin-specific components
│   │   ├── portal/                    # Portal-specific components
│   │   ├── marketing/                 # Marketing page components
│   │   ├── proposals/                 # Proposal workspace components
│   │   │   ├── section-editor.tsx     # TipTap editor
│   │   │   ├── compliance-sidebar.tsx
│   │   │   ├── stage-pipeline.tsx
│   │   │   └── review-form.tsx
│   │   └── rfp-curation/             # RFP curation components
│   │       ├── document-viewer.tsx
│   │       ├── compliance-picker.tsx
│   │       ├── metadata-panel.tsx
│   │       └── annotation-layer.tsx
│   ├── lib/
│   │   ├── auth.ts                    # NextAuth config
│   │   ├── db.ts                      # Database connections
│   │   ├── storage.ts                 # Local filesystem ops
│   │   ├── crypto.ts                  # AES-256-GCM
│   │   ├── events.ts                  # Event emitters (new namespaces)
│   │   ├── stripe.ts                  # NEW: Stripe client
│   │   ├── email.ts                   # NEW: Resend client
│   │   ├── agent-client.ts            # NEW: Agent API client
│   │   └── cms-client.ts             # CMS service HTTP client (external)
│   ├── types/
│   │   └── index.ts                   # All TypeScript types
│   ├── middleware.ts
│   ├── next.config.mjs
│   ├── tailwind.config.ts
│   ├── package.json
│   ├── tsconfig.json
│   ├── Dockerfile
│   ├── vitest.config.ts
│   └── playwright.config.ts
│
├── pipeline/                          # SERVICE 2: Python Pipeline + Agents
│   ├── src/
│   │   ├── main.py                    # Job queue + event listener
│   │   ├── config.py                  # Environment + settings
│   │   ├── crypto.py                  # API key decryption
│   │   ├── events.py                  # Event emission
│   │   ├── ingest/
│   │   │   ├── __init__.py
│   │   │   ├── sam_gov.py
│   │   │   ├── sbir_gov.py
│   │   │   └── grants_gov.py
│   │   ├── scoring/
│   │   │   ├── __init__.py
│   │   │   └── engine.py
│   │   ├── workers/
│   │   │   ├── __init__.py
│   │   │   ├── rfp_shredder.py        # NEW: AI RFP analysis
│   │   │   ├── grinder.py             # Document → library units
│   │   │   ├── embedder.py            # Vector embedding generation
│   │   │   ├── reminder.py            # Deadline nudges
│   │   │   ├── document_fetcher.py    # Download RFP PDFs
│   │   │   └── emailer.py            # Email delivery via Resend
│   │   ├── agents/                    # NEW: Agent Fabric
│   │   │   ├── __init__.py
│   │   │   ├── fabric.py             # AgentFabric orchestrator
│   │   │   ├── context.py            # Context assembly
│   │   │   ├── memory.py             # Memory CRUD + hybrid search
│   │   │   ├── tools.py              # Tool registry + execution
│   │   │   ├── archetypes/
│   │   │   │   ├── __init__.py
│   │   │   │   ├── base.py
│   │   │   │   ├── opportunity_analyst.py
│   │   │   │   ├── scoring_strategist.py
│   │   │   │   ├── capture_strategist.py
│   │   │   │   ├── proposal_architect.py
│   │   │   │   ├── section_drafter.py
│   │   │   │   ├── compliance_reviewer.py
│   │   │   │   ├── color_team_reviewer.py
│   │   │   │   ├── partner_coordinator.py
│   │   │   │   ├── librarian.py
│   │   │   │   └── packaging_specialist.py
│   │   │   ├── learning/
│   │   │   │   ├── __init__.py
│   │   │   │   ├── diff_analyzer.py
│   │   │   │   ├── preference_extractor.py
│   │   │   │   ├── pattern_promoter.py
│   │   │   │   ├── outcome_attributor.py
│   │   │   │   └── calibrator.py
│   │   │   └── lifecycle/
│   │   │       ├── __init__.py
│   │   │       ├── decay.py
│   │   │       ├── compactor.py
│   │   │       ├── gc.py
│   │   │       └── contradiction_resolver.py
│   │   └── automation/
│   │       ├── __init__.py
│   │       └── engine.py
│   ├── tests/
│   │   ├── __init__.py
│   │   ├── test_sam_gov.py
│   │   ├── test_scoring.py
│   │   ├── test_agents.py             # NEW
│   │   ├── test_memory.py             # NEW
│   │   └── test_rfp_shredder.py       # NEW
│   ├── requirements.txt
│   └── Dockerfile
│
├── services/
│   └── cms/                           # SERVICE 3: CMS/CRM (Future)
│       ├── src/
│       │   ├── main.py                # FastAPI entry
│       │   └── routers/
│       ├── db/migrations/
│       ├── Dockerfile
│       └── requirements.txt
│
├── db/
│   └── migrations/
│       ├── 001_baseline.sql           # ONE clean baseline migration
│       ├── 002_seed_system.sql        # System config, API keys, schedules
│       ├── 003_seed_compliance.sql    # Compliance variable master list
│       ├── 004_seed_agents.sql        # Agent archetypes + foundational knowledge
│       └── run.sh
│
├── scripts/
│   ├── seed_admin.ts
│   ├── test-all.sh
│   └── migrate.sh
│
├── .github/
│   └── workflows/
│       └── ci.yml
│
├── docker-compose.yml                 # All services for local dev
├── railway.json
├── .env.example
└── Makefile
```

---

## Roles & Access Levels

### V1 Role Hierarchy

```
SUPER ADMIN (master_admin)
  - Full system access
  - Runs migrations
  - Manages Railway services and secrets
  - Creates tenant accounts
  - All admin capabilities below

RFP PIPELINE ADMIN (rfp_admin)  ← NEW ROLE
  - Triage queue: dismiss/hold/release RFPs
  - Curation workspace: analyze, annotate, template RFPs
  - Push curated RFPs to customer pipeline
  - Customer onboarding assistance
  - Customer service (view tenant portals, assist with proposals)
  - View system dashboard, pipeline health, agent performance
  - Cannot: manage Railway, run migrations, manage other admins

TENANT ADMIN (tenant_admin)
  - Full access to their tenant portal
  - Invite/manage team members
  - Invite/manage collaborators with access levels
  - Set proposal-level permissions:
    - Per-team-member: see/comment/edit on ALL proposals or per-proposal
    - Per-collaborator: see/comment/edit on specific files, specific stages
  - Purchase proposals (Stripe)
  - Configure agent automation toggles
  - View agent memories, request deletions

TENANT USER (tenant_user)
  - Access per tenant_admin grant:
    - All proposals: see/comment/edit (company employee default)
    - Per-proposal: see/comment/edit (restricted employee)
  - Cannot: invite team, purchase, manage settings

COLLABORATOR (partner_user)
  - Access per tenant_admin grant PER PROPOSAL PER STAGE:
    - Specific artifacts only (e.g., "Bio Sketch section" only)
    - Permission: view, comment, or edit
    - Time-bounded: access revoked when stage closes
  - Cannot: see other proposals, see pipeline, access library
  - Login shows only portals with active access grants
  - Historical: same email can be collaborator on multiple tenants
```

---

## Railway Services & Infrastructure

### V1 Deployment (3 services + 1 DB + 1 volume)

```
┌─────────────────────────────────────────────────┐
│ RAILWAY PROJECT: govwin                         │
├─────────────────────────────────────────────────┤
│                                                 │
│  SERVICE: frontend                              │
│    Image: Dockerfile (Node 20 Alpine)           │
│    Port: 3000                                   │
│    Deploy: auto on push to main                 │
│    Env: DATABASE_URL, AUTH_SECRET, AUTH_URL,     │
│         STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,│
│         RESEND_API_KEY, API_KEY_ENCRYPTION_SECRET│
│         STORAGE_ROOT=/data                      │
│                                                 │
│  SERVICE: pipeline                              │
│    Image: Dockerfile (Python 3.12)              │
│    Port: none (background worker)               │
│    Deploy: auto on push to main                 │
│    Env: DATABASE_URL, ANTHROPIC_API_KEY,         │
│         API_KEY_ENCRYPTION_SECRET,               │
│         SAM_GOV_API_KEY, CLAUDE_MODEL,           │
│         STORAGE_ROOT=/data                      │
│                                                 │
│  SERVICE: cms (placeholder — not deployed V1)   │
│    Image: services/cms/Dockerfile               │
│    Port: 8000                                   │
│    DB: CMS_DATABASE_URL (separate Postgres)     │
│    Status: DORMANT until CMS/CRM needed         │
│                                                 │
│  DATABASE: postgres                             │
│    PostgreSQL 16 + pgvector                     │
│    Extensions: vector, pg_trgm, uuid-ossp       │
│    Name: govtech_intel                          │
│                                                 │
│  VOLUME: storage                                │
│    Mount: /data                                 │
│    Shared by: frontend, pipeline                │
│    Structure: /data/opportunities/, /data/customers/│
│                                                 │
└─────────────────────────────────────────────────┘
```


---

## Database: One Clean Baseline Migration

### 001_baseline.sql covers ALL tables:

**Core Auth & Tenancy:**
- users, accounts, sessions, verification_tokens
- tenants, tenant_profiles
- roles: master_admin, rfp_admin, tenant_admin, tenant_user, partner_user

**Opportunities & Pipeline:**
- opportunities (canonical, global)
- tenant_pipeline_items (per-tenant scoring)
- tenant_actions (thumbs, pins, pursuit status)
- documents, amendments, resource_links

**RFP Curation (NEW):**
- curated_solicitations (admin workspace state, namespace, annotations)
- solicitation_compliance (structured compliance variables)
- solicitation_templates (reusable docs per namespace)
- solicitation_outlines (pre-built outlines cloned on purchase)
- solicitation_topics (per-topic under a solicitation)
- compliance_variables (master reference list, extensible)

**Proposals & Workspace:**
- proposals (linked to opportunity + tenant)
- proposal_sections (content, status, assignment)
- proposal_workspace_files
- proposal_collaborators (base identity)
- collaborator_stage_access (NEW: per-stage, per-artifact, permission-tiered)
- proposal_stage_history
- proposal_changes, proposal_comments
- proposal_reviews (color team)
- proposal_checklists
- proposal_compliance_matrix

**Content Library:**
- library_units (atomic content, vector embeddings, categories, confidence)
- library_unit_images
- library_harvest_log
- library_atom_similarities
- library_atom_outcomes
- focus_areas + junction tables
- tenant_uploads

**Agent Fabric (NEW):**
- agent_archetypes (role definitions, system prompts, tools, guardrails)
- episodic_memories (vector, tenant-scoped, decaying)
- semantic_memories (vector, tenant-scoped, versioned)
- procedural_memories (vector, tenant-scoped)
- agent_task_log (every invocation: tokens, cost, acceptance)
- agent_task_queue (frontend → pipeline communication)
- agent_task_results (pipeline → frontend results)
- tenant_agent_config (per-tenant settings, token budgets)
- agent_performance (metrics per tenant per role)

**Event Bus:**
- opportunity_events
- customer_events
- content_events (bridge to CMS service)
- automation_rules, automation_log

**Control Plane:**
- pipeline_jobs, pipeline_schedules, pipeline_runs
- api_key_registry, rate_limit_state, source_health
- system_config

**Identity & Billing:**
- invitations
- consent_records, legal_document_versions
- purchases (Stripe payment references)
- audit_log

**Analytics:**
- visitor_sessions, page_views, visitor_actions
- waitlist

**All indexes:**
- HNSW on all vector columns (agent memories + library units)
- B-tree on tenant_id everywhere
- GIN on JSONB columns (entities, metadata, annotations)
- Full-text search (tsvector) on opportunities + curated solicitations
- Partial indexes for is_active/is_archived queries
- Composite indexes for common query patterns

**Row-Level Security:**
- RLS enabled on all tenant-scoped tables
- Policies enforce tenant_id = current_setting('app.current_tenant_id')

**Functions:**
- dequeue_job(), get_system_status(), mark_events_processed()
- set_updated_at() trigger
- notify triggers on event tables

---

## Phase-by-Phase TODO

### Phase 0: Clean Project Setup
*Goal: New branch with clean project skeleton — all files stubbed, all routes defined, compiles, deploys*

- [ ] **0.1** Pull main (after you merge the plan)
- [ ] **0.2** Create new branch: `clean-build-v2`
- [ ] **0.3** Remove all existing source files (keep docs/agent-fabric/, ARCHITECTURE_V5.md, .env.example)
- [ ] **0.4** Create complete directory structure (as defined above)
- [ ] **0.5** Write `CLAUDE.md` — updated dev standards, project structure, role hierarchy, coding rules
- [ ] **0.6** Write `package.json` with all dependencies (same as current + stripe + resend)
- [ ] **0.7** Write `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `postcss.config.js`
- [ ] **0.8** Write `requirements.txt` for pipeline (same as current + any new deps)
- [ ] **0.9** Write `Dockerfile` for frontend (multi-stage, same pattern)
- [ ] **0.10** Write `Dockerfile` for pipeline
- [ ] **0.11** Write `docker-compose.yml` (frontend + pipeline + postgres with pgvector + volume)
- [ ] **0.12** Write `railway.json`
- [ ] **0.13** Write `.github/workflows/ci.yml`
- [ ] **0.14** Write `.env.example` with all required/optional vars
- [ ] **0.15** Write `Makefile` (up, migrate, seed, dev, type-check, shell-db)
- [ ] **0.16** Write `001_baseline.sql` — ONE complete migration with ALL tables
- [ ] **0.17** Write `002_seed_system.sql` — system config, API key registry, pipeline schedules, rate limits
- [ ] **0.18** Write `003_seed_compliance.sql` — compliance variable master list (~25 initial types)
- [ ] **0.19** Write `004_seed_agents.sql` — 10 agent archetypes with base prompts, tools, guardrails
- [ ] **0.20** Write `db/migrations/run.sh`
- [ ] **0.21** Write `types/index.ts` — ALL TypeScript types for the full system
- [ ] **0.22** Write `lib/auth.ts` — copy from existing, add rfp_admin role
- [ ] **0.23** Write `lib/db.ts` — copy from existing
- [ ] **0.24** Write `lib/storage.ts` — copy from existing
- [ ] **0.25** Write `lib/crypto.ts` — copy from existing
- [ ] **0.26** Write `lib/events.ts` — adapt for new event namespaces (finder.*, capture.*, agent.*, identity.*)
- [ ] **0.27** Write `lib/stripe.ts` — Stripe client setup
- [ ] **0.28** Write `lib/email.ts` — Resend client setup
- [ ] **0.29** Write `lib/agent-client.ts` — TypeScript client for agent task queue/results
- [ ] **0.30** Write `lib/cms-client.ts` — HTTP client stub for future CMS service
- [ ] **0.31** Write `middleware.ts` — route protection for all roles (super admin, rfp_admin, tenant_admin, tenant_user, partner_user)
- [ ] **0.32** Write `app/layout.tsx`, `app/error.tsx`, `app/global-error.tsx`
- [ ] **0.33** Stub ALL pages (every page.tsx in the tree — can be blank with title + "Coming soon")
- [ ] **0.34** Stub ALL API routes (every route.ts — proper method handlers returning 501 Not Implemented with correct shapes)
- [ ] **0.35** Write admin layout with nav (dashboard, tenants, rfp-curation, pipeline, sources, agents, purchases, analytics, waitlist)
- [ ] **0.36** Write portal layout with nav (dashboard, pipeline, spotlights, proposals, library, documents, team, profile)
- [ ] **0.37** Write marketing layout with header/footer
- [ ] **0.38** Pipeline: stub `main.py` with job queue skeleton
- [ ] **0.39** Pipeline: stub all worker files with class definitions
- [ ] **0.40** Pipeline: stub all agent files with class definitions
- [ ] **0.41** Pipeline: stub `fabric.py`, `context.py`, `memory.py`, `tools.py`
- [ ] **0.42** Run `npm ci && npx tsc --noEmit` — ZERO errors
- [ ] **0.43** Run `npm run build` — succeeds
- [ ] **0.44** Verify Docker builds for both services
- [ ] **0.45** Commit and push
- [ ] **0.46** Verify CI passes

### Phase 1: RFP Ingestion & Expert Curation
*Goal: Admin can triage, release, curate, and push RFPs to the customer pipeline*

- [ ] **1.1** Implement ingesters (copy from existing): sam_gov.py, sbir_gov.py, grants_gov.py
- [ ] **1.2** Implement pipeline main.py job queue (copy pattern from existing)
- [ ] **1.3** Implement admin triage queue page + API routes
- [ ] **1.4** Implement RFP shredder worker (AI text extraction + section atomization + compliance pre-extraction)
- [ ] **1.5** Implement admin curation workspace page:
  - Document viewer with text selection → compliance variable picker
  - Highlight/annotate/tag tools
  - Structured metadata panel with all compliance fields
  - Dismissed RFPs: archive with Phase-I-like/Phase-II-like classification
- [ ] **1.6** Implement compliance variable picker popup:
  - Standard list on text selection stop
  - Add new variables when novel requirements found
  - Auto-populate value from highlighted text
- [ ] **1.7** Implement namespace memory (`{agency}:{program_office}:{type}:{phase}`)
  - Cross-cycle similarity matching
  - Pre-fill from prior curations when similarity > 0.9
  - Diff view for changes between cycles
- [ ] **1.8** Implement push-to-pipeline flow
  - Validation of required fields
  - Vectorize for future recall
  - Emit `finder.rfp.curated_and_pushed` event
- [ ] **1.9** Implement solicitation outline builder (pre-built sections cloned on purchase)
- [ ] **1.10** Implement template upload (cost templates, required forms, example docs)
- [ ] **1.11** Multi-admin claim/review/approve workflow
- [ ] **1.12** Test: curate an RFP end-to-end, verify it appears in customer pipeline

### Phase 2: Customer Portal — Finder + Stripe
*Goal: Customers can sign up, browse curated opportunities, and purchase proposal portals*

- [ ] **2.1** Implement login page + auth flow (copy from existing)
- [ ] **2.2** Implement customer onboarding wizard (profile, NAICS, keywords, certifications)
- [ ] **2.3** Implement Stripe subscription checkout ($199/month Finder)
- [ ] **2.4** Implement scoring engine (copy from existing, filter to curated-only opportunities)
- [ ] **2.5** Implement Finder pipeline page (scored opportunities with compliance data from curation)
- [ ] **2.6** Implement opportunity detail view (full analysis, compliance summary, eval criteria)
- [ ] **2.7** Implement reactions (thumbs, pins, pursuit status)
- [ ] **2.8** Implement spotlights (saved search buckets)
- [ ] **2.9** Implement Stripe proposal purchase ($999 Phase I / $2,500 Phase II)
- [ ] **2.10** Implement purchase webhook → workspace creation trigger
- [ ] **2.11** Implement Resend email integration (transactional: invite, password reset, digest)
- [ ] **2.12** Implement forgot-password flow
- [ ] **2.13** Test: sign up, browse, purchase end-to-end

### Phase 3: Proposal Workspace
*Goal: Full proposal lifecycle from purchase through submission*

- [ ] **3.1** Implement workspace creation on purchase (clone outline, compliance, templates)
- [ ] **3.2** Implement proposal list page with stage badges
- [ ] **3.3** Implement proposal workspace page (sections, compliance sidebar, stage controls)
- [ ] **3.4** Implement TipTap section editor with save/version history
- [ ] **3.5** Implement collaborator invitation + stage-scoped access
- [ ] **3.6** Implement partner login experience (see only active grants)
- [ ] **3.7** Implement stage advancement with validation + access revocation
- [ ] **3.8** Implement review workflow (create review cycle, feedback forms)
- [ ] **3.9** Implement library page (content units, categories, search)
- [ ] **3.10** Implement document upload + Grinder decomposition to library units
- [ ] **3.11** Implement team management page
- [ ] **3.12** Implement proposal package generation + download
- [ ] **3.13** Implement cost volume data entry (manual + QuickBooks CSV upload)
- [ ] **3.14** Implement proposal archive + library harvest on submission
- [ ] **3.15** Test: full proposal lifecycle from outline through submission

### Phase 4: Agent Fabric
*Goal: AI agents active at all lifecycle stages*

- [ ] **4.1** Implement memory.py (hybrid search, write, update, batch retrieval)
- [ ] **4.2** Implement tools.py (tool registry, tenant enforcement, audit logging)
- [ ] **4.3** Implement context.py (prompt assembly with caching markers)
- [ ] **4.4** Implement fabric.py (orchestrator: event → archetype → context → Claude → tools → result)
- [ ] **4.5** Implement BaseArchetype class
- [ ] **4.6** Implement Opportunity Analyst (RFP shredding assist)
- [ ] **4.7** Implement Scoring Strategist (LLM adjustment for high-scoring opps)
- [ ] **4.8** Implement Proposal Architect (outline generation from curated data + tenant library)
- [ ] **4.9** Implement Section Drafter (draft sections from library + requirements + memory)
- [ ] **4.10** Implement Compliance Reviewer (continuous gap checking)
- [ ] **4.11** Implement Color Team Reviewer (pre-review scoring)
- [ ] **4.12** Implement Librarian (decompose uploads, harvest submissions, tag outcomes)
- [ ] **4.13** Implement Partner Coordinator (nudges, status tracking)
- [ ] **4.14** Implement Packaging Specialist (format verification, manifest generation)
- [ ] **4.15** Implement Capture Strategist (pursue/pass recommendation)
- [ ] **4.16** Implement diff_analyzer.py + preference_extractor.py (learn from human edits)
- [ ] **4.17** Implement memory lifecycle jobs (decay, GC, compaction, contradiction resolution)
- [ ] **4.18** Implement agent API routes (draft, review, compliance, memories, config)
- [ ] **4.19** Implement agent monitoring admin page
- [ ] **4.20** Test: invoke each agent, verify memory isolation, verify learning loop

### Phase 5: Security, Monitoring, Polish
*Goal: Production-ready*

- [ ] **5.1** Rate limiting on public endpoints
- [ ] **5.2** CSRF protection on custom POST endpoints
- [ ] **5.3** Tenant isolation audit (every route validates access)
- [ ] **5.4** Agent prompt injection defense (user content delimited, outputs validated)
- [ ] **5.5** API key rotation workflow
- [ ] **5.6** Admin audit trail (all actions logged)
- [ ] **5.7** Health check endpoints
- [ ] **5.8** Error logging with tenant context
- [ ] **5.9** Agent cost tracking dashboard
- [ ] **5.10** Pipeline monitoring (queue depth, failure rates)
- [ ] **5.11** Full test suite: unit + integration + E2E
- [ ] **5.12** `npx tsc --noEmit` — zero errors
- [ ] **5.13** `npm run build` — succeeds
- [ ] **5.14** CI green

### Phase 6: Documentation & Deploy
*Goal: Ship it*

- [ ] **6.1** Update all architecture docs with final implementation
- [ ] **6.2** Write DEPLOYMENT.md for Railway
- [ ] **6.3** Write API_REFERENCE.md
- [ ] **6.4** Seed production database (admin user, agent archetypes, compliance vars, schedules)
- [ ] **6.5** Configure Railway services + volumes + env vars
- [ ] **6.6** Deploy and verify

---

## Phase Dependencies

```
Phase 0 (skeleton)
  ├── Phase 1 (RFP curation) ──────┐
  └── Phase 2 (Finder + Stripe) ───┤
       Phase 4 (agents) starts ─────┤
       with Phase 1 schema          │
                                    ▼
                              Phase 3 (proposals)
                                    │
                                    ▼
                              Phase 5 (security)
                                    │
                                    ▼
                              Phase 6 (deploy)
```

Phases 1, 2, and 4 can progress in parallel after Phase 0.

---

## Estimated File Counts

| Category | New Files | Notes |
|----------|-----------|-------|
| Database migrations | 4 | One baseline + 3 seed files |
| Frontend pages | ~35 | All stubbed in Phase 0, implemented incrementally |
| Frontend API routes | ~45 | All stubbed in Phase 0, implemented incrementally |
| Frontend components | ~20 | UI components built as pages need them |
| Frontend lib | ~10 | Core utilities |
| Frontend types | 1 | One comprehensive types file |
| Frontend config | ~8 | tsconfig, tailwind, next, postcss, vitest, playwright, middleware, Dockerfile |
| Pipeline Python files | ~35 | Ingest, scoring, workers, agents, learning, lifecycle |
| Pipeline config | ~3 | requirements.txt, Dockerfile, config.py |
| CMS service (stub) | ~5 | Placeholder structure only |
| Documentation | ~5 | Architecture, deployment, API reference |
| CI/CD + scripts | ~5 | GitHub Actions, Makefile, test runner, migrate, seed |
| **Total** | **~176** | All defined upfront, implemented phase by phase |
