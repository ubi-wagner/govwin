# RFP Pipeline SaaS — Complete Implementation Plan

**Created: 2026-04-06**
**Status: PENDING REVIEW — Do not begin until approved**

This is the master TODO for the full system redesign based on the V5 architecture,
agent fabric research, and RFP curation pipeline design produced during this session.

---

## Phase 0: Architecture Cleanup & Project Definition
*Goal: Clean separation of concerns, remove CMS from core, define all project boundaries*

### 0.1 Remove CMS/CRM from Core Portal
- [ ] **0.1.1** Identify all CMS tables in main DB: `site_content`, `content_posts`, `content_generations`, `content_reviews`, `content_generation_feedback`
- [ ] **0.1.2** Identify all CMS API routes in frontend: `/api/content/*`, `/api/content-pipeline/*`, `/api/admin/content-pipeline/*`
- [ ] **0.1.3** Identify all CMS lib files: `lib/content.ts`, `lib/cms-client.ts`, `lib/content-defaults.ts`
- [ ] **0.1.4** Identify CMS admin pages: `app/admin/content-pipeline/page.tsx` and components
- [ ] **0.1.5** Remove CMS tables from main DB migrations (move to `services/cms/db/migrations/`)
- [ ] **0.1.6** Remove CMS API routes from frontend (they belong in the CMS service)
- [ ] **0.1.7** Remove CMS admin page from core admin (future: CMS gets its own admin)
- [ ] **0.1.8** Keep `content_events` table in main DB as the event bridge
- [ ] **0.1.9** Keep `lib/cms-client.ts` as the HTTP client — this is how frontend calls CMS service
- [ ] **0.1.10** Keep marketing pages intact — they call `getPageContent()` which will route through cms-client
- [ ] **0.1.11** Update `lib/content.ts` to fetch from CMS service URL instead of direct DB query
- [ ] **0.1.12** Verify `services/cms/` has all needed tables, routes, and Dockerfile
- [ ] **0.1.13** Update docker-compose.yml to reflect clean separation
- [ ] **0.1.14** Verify marketing pages still render with CMS service down (static fallback works)
- [ ] **0.1.15** Run `npx tsc --noEmit` — zero errors after cleanup

### 0.2 Remove Google Drive Dependencies from Portal
- [ ] **0.2.1** Audit all imports of `lib/google-drive.ts` in portal/API routes
- [ ] **0.2.2** Remove/comment out Drive calls from any portal-critical paths
- [ ] **0.2.3** Keep `lib/google-drive.ts` file (future CRM/CMS may use it) but ensure no portal code imports it
- [ ] **0.2.4** Verify `lib/storage.ts` (local filesystem) handles all portal storage needs
- [ ] **0.2.5** Run `npx tsc --noEmit` — zero errors

### 0.3 Define Final Project Structure
- [ ] **0.3.1** Document the four services and their boundaries:
  ```
  SERVICE 1: Frontend (Next.js) — Portal UI + API routes
    DB: govtech_intel (main)
    Deploy: Railway frontend service

  SERVICE 2: Pipeline (Python) — Ingestion, scoring, workers, agents
    DB: govtech_intel (main, shared with frontend)
    Deploy: Railway background worker

  SERVICE 3: Agent Fabric (Python) — AI workforce
    DB: govtech_intel (main, agent memory tables added)
    Deploy: Integrated into Pipeline service (V1), separate service (V3+)

  SERVICE 4: CMS/CRM (Python FastAPI) — Content, email, future CRM
    DB: govtech_cms (separate)
    Deploy: Railway separate service (when needed)
  ```
- [ ] **0.3.2** Document the shared infrastructure:
  - Main PostgreSQL (govtech_intel): opportunities, tenants, users, proposals, library, agent memory, events
  - CMS PostgreSQL (govtech_cms): content, media, email campaigns
  - Event bridge: `content_events` in main DB, written by CMS service via SHARED_DATABASE_URL
  - Local storage: Railway volumes at `/data/`
- [ ] **0.3.3** Create `PROJECT_STRUCTURE.md` with complete file tree for all services
- [ ] **0.3.4** Update `CLAUDE.md` with new project structure and development standards

---

## Phase 1: RFP Ingestion & Expert Curation System
*Goal: Build the admin-side RFP triage, analysis, compliance extraction, and templating workflow*

### 1.1 Database Schema for Curation
- [ ] **1.1.1** Write migration: `curated_solicitations` table (Chapter 8 schema)
- [ ] **1.1.2** Write migration: `solicitation_compliance` table with all compliance variables:
  - Page limits (per volume), font, margins, spacing, headers/footers
  - Required sections with sub-specifications (PDF with text+images, PowerPoint-as-PDF with slide limits, required slide order)
  - Required documents (with template references)
  - Cost volume specifications (TABA, indirect caps, partner limits, cost sharing)
  - PI eligibility (employee requirement, university PI for STTR)
  - Certifications (ITAR, FAR clauses, security classifications)
  - Evaluation criteria with weights
- [ ] **1.1.3** Write migration: `solicitation_templates` table (reusable per namespace)
- [ ] **1.1.4** Write migration: `solicitation_outlines` table (pre-built outlines cloned on purchase)
- [ ] **1.1.5** Write migration: `compliance_variables` reference table — the master list of all possible compliance fields that the HITL UI presents when an admin highlights a section
  - Seed with initial set: page_limit, font_family, font_size, margins, line_spacing, header_format, footer_format, submission_format, images_allowed, tables_allowed, slides_allowed, slide_limit, slide_order, required_sections, required_documents, taba_allowed, indirect_rate_cap, partner_max_pct, pi_employee_required, pi_university_allowed, itar_required, far_clauses, clearance_level, cost_sharing, evaluation_criteria
  - Support adding new variables when admin encounters novel requirements
- [ ] **1.1.6** Write migration: `solicitation_topics` table — individual topics under a solicitation (SBIR has dozens of topics per solicitation, each with its own requirements/focus)
- [ ] **1.1.7** Add `namespace` column logic with convention: `{agency}:{program_office}:{type}:{phase}`
- [ ] **1.1.8** Run migration, verify schema

### 1.2 Admin Triage Queue (UI)
- [ ] **1.2.1** Create admin page: `/admin/rfp-curation/page.tsx`
- [ ] **1.2.2** Build triage queue view: list of new solicitations with title, agency, program type, deadline, status
- [ ] **1.2.3** Implement three triage actions: Dismiss (with reason), Hold, Release for Analysis
- [ ] **1.2.4** Build dismiss confirmation with categorization (not small business, irrelevant sector, duplicate, other)
- [ ] **1.2.5** Dismissed RFPs: archive and mark as Phase-I-like or Phase-II-like regardless of actual type, for future reference
- [ ] **1.2.6** Implement claim/unclaim workflow for multi-admin support
- [ ] **1.2.7** Show unclaimed RFPs older than 48 hours as urgent
- [ ] **1.2.8** Build status badge system: new → claimed → released → ai_analyzed → curation_in_progress → review_requested → approved → pushed_to_pipeline → dismissed
- [ ] **1.2.9** Build API route: `POST /api/admin/rfp-curation/[solId]/triage` (dismiss/hold/release)
- [ ] **1.2.10** Build API route: `POST /api/admin/rfp-curation/[solId]/claim`
- [ ] **1.2.11** Build API route: `GET /api/admin/rfp-curation` (list with filters)

### 1.3 AI Shredding (Triggered by Admin Release)
- [ ] **1.3.1** Build pipeline worker: `RfpShredder` — triggered when admin releases an RFP
- [ ] **1.3.2** Text extraction from solicitation PDF (pdfplumber/pymupdf)
- [ ] **1.3.3** Full-text indexing (tsvector) of extracted text
- [ ] **1.3.4** AI section atomization: identify and tag sections (overview, technical requirements, evaluation criteria, submission instructions, cost guidelines, eligibility, etc.)
- [ ] **1.3.5** AI compliance pre-extraction: parse out page limits, font, margins, required sections, required documents, cost rules, PI rules, partner limits, evaluation criteria
- [ ] **1.3.6** Memory lookup: query prior curations in same namespace (`USAF:AFWERX:SBIR:Phase1`)
- [ ] **1.3.7** If similarity > 0.9 to prior curation: pre-fill compliance metadata, highlight diffs
- [ ] **1.3.8** If similarity 0.7-0.9: pre-fill matches, flag differences
- [ ] **1.3.9** If similarity < 0.7: flag as new template, full manual curation required
- [ ] **1.3.10** Store AI extraction results in `curated_solicitations.ai_extracted` JSONB
- [ ] **1.3.11** Emit event: `finder.rfp.ai_analyzed`
- [ ] **1.3.12** Vectorize the shredded RFP for cross-cycle matching

### 1.4 Admin Curation Workspace (UI)
- [ ] **1.4.1** Create admin page: `/admin/rfp-curation/[solId]/page.tsx`
- [ ] **1.4.2** Build split-panel layout: RFP document viewer (left) + structured metadata panel (right)
- [ ] **1.4.3** RFP Document Viewer:
  - Render extracted text with section headers preserved
  - Text selection → opens compliance variable picker popup
  - Highlight tool for marking requirement sections
  - Text box annotation tool for admin notes/gotchas
  - Requirement tag tool (select text → tag as specific requirement type)
- [ ] **1.4.4** Compliance Variable Picker:
  - When admin highlights text and stops, popup shows list of compliance variables
  - If variable already captured: show current value, allow edit
  - If variable not in master list: allow adding new variable type
  - Auto-populate value from highlighted text where possible
  - Variables: page_limit, font, margins, spacing, header/footer, submission_format, required_sections (with sub-specs), required_documents, cost_rules, pi_eligibility, partner_limits, certifications, eval_criteria
- [ ] **1.4.5** Structured Metadata Panel:
  - Agency, program office, program type, phase — auto-populated, editable
  - Namespace display (auto-generated from above)
  - All compliance variables as structured form fields
  - Required sections list with sub-specifications per section (content type: PDF/PPTX, images allowed, page allocation)
  - Required documents checklist with template upload slots
  - Evaluation criteria with weight percentages
  - Topic-level overrides (ITAR, FAR, classification per-topic)
- [ ] **1.4.6** AI pre-fill indicator: show which fields were AI-extracted vs human-entered, with confidence scores
- [ ] **1.4.7** Prior curation diff view: when AI found similar prior, show side-by-side what changed
- [ ] **1.4.8** Save Draft / Request Review / Push to Pipeline buttons
- [ ] **1.4.9** Build API routes:
  - `GET /api/admin/rfp-curation/[solId]` — full curation data
  - `PATCH /api/admin/rfp-curation/[solId]` — save curation
  - `POST /api/admin/rfp-curation/[solId]/annotations` — save annotations
  - `POST /api/admin/rfp-curation/[solId]/push` — push to pipeline
  - `POST /api/admin/rfp-curation/[solId]/compliance` — save compliance data
  - `POST /api/admin/rfp-curation/[solId]/outline` — save pre-built outline
  - `POST /api/admin/rfp-curation/[solId]/templates` — upload supporting document templates

### 1.5 Push to Pipeline
- [ ] **1.5.1** When admin clicks "Push to Pipeline":
  - Validate all required compliance fields are filled
  - Package: curated RFP + compliance metadata + annotations + outline + templates
  - Mark opportunity as "curated" in main pipeline
  - Emit event: `finder.rfp.curated_and_pushed`
  - Vectorize template for same-namespace recall in future cycles
- [ ] **1.5.2** For each topic under the solicitation: apply solicitation-level compliance as defaults, allow topic-level overrides (ITAR, classification, specific FAR clauses)
- [ ] **1.5.3** Customers can now see this opportunity in their Finder with full compliance data
- [ ] **1.5.4** When customer purchases a proposal portal for this opportunity:
  - Clone `solicitation_outlines` → `proposal_sections`
  - Clone `solicitation_compliance` → proposal compliance matrix
  - Attach `solicitation_templates` as required document checklist
  - Pre-built workspace ready on day one


---

## Phase 2: Customer Portal — Finder & Reminder Base License
*Goal: The customer-facing opportunity discovery, scoring, and monitoring experience*

### 2.1 Customer Onboarding
- [ ] **2.1.1** Profile wizard: company name, NAICS codes, keywords, agency preferences, set-aside qualifications, technology focus, certifications
- [ ] **2.1.2** Team setup: invite team members with roles (tenant_admin, tenant_user)
- [ ] **2.1.3** Library bootstrap: upload company docs (capabilities, past performance, bios) → Grinder atomizes into library units
- [ ] **2.1.4** Stripe subscription: $199/month Finder tier activation
- [ ] **2.1.5** Emit event: `identity.tenant.created` → triggers initial scoring run

### 2.2 Finder (Opportunity Pipeline)
- [ ] **2.2.1** Verify pipeline page works with curated solicitations (shows compliance data, admin curation quality)
- [ ] **2.2.2** Scoring engine integration: only score opportunities that have been pushed to pipeline (admin-curated)
- [ ] **2.2.3** Opportunity detail view: show full AI analysis, compliance summary, requirements matrix, evaluation criteria — all from admin curation
- [ ] **2.2.4** Reactions: thumbs up/down, pin, pursuit status (pursuing/monitoring/passed/unreviewed)
- [ ] **2.2.5** Spotlight buckets: custom saved search collections with persistent scoring
- [ ] **2.2.6** FOMO alerts: weekly email digest of missed high-match opportunities
- [ ] **2.2.7** Amendment tracking: notify when curated solicitations get amended

### 2.3 Reminder (Deadline & Nudge System)
- [ ] **2.3.1** Deadline tracking: opportunities closing in 7/14/30 days
- [ ] **2.3.2** Configurable notification preferences: email, in-app, frequency
- [ ] **2.3.3** Amendment alerts: when a solicitation the customer is pursuing gets amended
- [ ] **2.3.4** Pipeline worker: `ReminderNudgeWorker` (already exists, verify integration)

### 2.4 Stripe Integration
- [ ] **2.4.1** Stripe account setup and API key configuration
- [ ] **2.4.2** Products:
  - Finder subscription: $199/month (recurring)
  - Proposal Build - Phase I: $999 (one-time per proposal)
  - Proposal Build - Phase II: $2,500 (one-time per proposal)
- [ ] **2.4.3** Checkout flow: `/api/stripe/checkout` — create Stripe checkout session
- [ ] **2.4.4** Webhook handler: `/api/stripe/webhook` — handle payment confirmations
- [ ] **2.4.5** Subscription management: upgrade/downgrade/cancel
- [ ] **2.4.6** Proposal purchase flow: customer selects opportunity → checkout → on payment confirmation → emit `identity.purchase.completed` → trigger proposal workspace creation
- [ ] **2.4.7** Purchase history page: `/portal/[tenantSlug]/purchases`
- [ ] **2.4.8** Admin purchase tracking: `/admin/purchases`
- [ ] **2.4.9** Invoice/receipt generation via Stripe

---

## Phase 3: Proposal Workspace — Purchase, Sandbox, Pipeline
*Goal: When a customer buys a proposal, create a fully staged workspace with AI assistance at every step*

### 3.1 Proposal Purchase → Workspace Creation
- [ ] **3.1.1** On `identity.purchase.completed` event:
  - Create proposal record linked to opportunity
  - Clone solicitation outline → proposal sections
  - Clone compliance matrix → proposal compliance
  - Attach document templates
  - Set initial stage: outline
  - Pre-match library units to sections (Librarian agent)
- [ ] **3.1.2** Admin notification: "Customer X purchased proposal for RFP Y — review and assist if time permits"
- [ ] **3.1.3** Admin can optionally review customer's library and pre-match content to sections before AI drafting

### 3.2 Collaborator/Partner Access Model
- [ ] **3.2.1** Schema update: `collaborator_stage_access` table
  ```
  collaborator_id, proposal_id, stage, artifact_types[], permission (view/comment/edit),
  access_granted_at, access_revoked_at, granted_by
  ```
- [ ] **3.2.2** Partner identity: unique by (email + tenant_id), historical roster per tenant
- [ ] **3.2.3** Invitation flow: tenant admin invites partners per stage
- [ ] **3.2.4** Partner login: sees only portals where they have active access
- [ ] **3.2.5** Auto-revoke: when stage closes, all stage-specific access revoked
- [ ] **3.2.6** Three permission tiers: view, comment, edit
- [ ] **3.2.7** Partner nudge engine: automated reminders for overdue deliverables
- [ ] **3.2.8** Partner contribution tracking: what they uploaded, commented, edited

### 3.3 Stage-Gate Workflow
- [ ] **3.3.1** Stages: outline → draft → pink_team → red_team → gold_team → final → submitted → archived
- [ ] **3.3.2** Stage transition: customer clicks "Advance to [next stage]"
  - Validate stage-specific requirements met (all sections drafted, compliance check passed, etc.)
  - Revoke current stage collaborator access
  - Emit event: `capture.proposal.stage_changed`
  - Set up next stage collaborators (from customer config)
  - Trigger appropriate agents (if automation enabled)
- [ ] **3.3.3** Stage skip: customer can skip stages (e.g., skip gold team for small proposals)
- [ ] **3.3.4** Per-proposal automation toggles: which AI agents are enabled/disabled for this proposal
- [ ] **3.3.5** Notification preferences: which stage events trigger notifications for whom

### 3.4 Proposal Editor (TipTap Integration)
- [ ] **3.4.1** Section editor: TipTap rich text editor for each proposal section
- [ ] **3.4.2** Section-level metadata: word/page count, requirement traceability, compliance flags
- [ ] **3.4.3** Inline comments: collaborators can comment on specific text ranges
- [ ] **3.4.4** Change tracking: view diffs between versions
- [ ] **3.4.5** AI Draft button: request Section Drafter agent to draft/revise this section
- [ ] **3.4.6** Library insert: search and insert library units directly into editor
- [ ] **3.4.7** Compliance sidebar: live compliance matrix showing which requirements are addressed
- [ ] **3.4.8** Save + version history for each section

### 3.5 Review Workflow (Color Teams)
- [ ] **3.5.1** Review request: when stage advances to pink/red/gold, create review cycle
- [ ] **3.5.2** AI pre-review: Color Team Reviewer agent scores before human reviewers see it
- [ ] **3.5.3** Reviewer interface: structured feedback form (strengths, weaknesses, recommendations per section)
- [ ] **3.5.4** Review summary: aggregate reviewer feedback with AI synthesis
- [ ] **3.5.5** Revision tracking: which review comments were addressed in subsequent edits

### 3.6 Submission & Closeout
- [ ] **3.6.1** Final compliance check: Compliance Reviewer verifies all requirements met
- [ ] **3.6.2** Package generation: compile sections into formatted documents per agency spec
- [ ] **3.6.3** Export formats: individual Word/PDF documents per volume, ZIP package
- [ ] **3.6.4** Required documents checklist: verify all required attachments present
- [ ] **3.6.5** Cost volume integration: auto-populate from tenant financial data (manual entry or QuickBooks upload)
- [ ] **3.6.6** Lock proposal: customer confirms final, proposal locked
- [ ] **3.6.7** Download package: customer downloads and uploads to government portal manually
- [ ] **3.6.8** Archive: proposal archived, library harvest triggered
- [ ] **3.6.9** Emit event: `capture.proposal.submitted`

---

## Phase 4: Agent Fabric Implementation
*Goal: Build the AI workforce system — memory, archetypes, tools, and integration*

### 4.1 Database Schema (Agent Memory)
- [ ] **4.1.1** Write migration: `episodic_memories` table (Chapter 3 schema)
- [ ] **4.1.2** Write migration: `semantic_memories` table
- [ ] **4.1.3** Write migration: `procedural_memories` table
- [ ] **4.1.4** Write migration: `agent_task_log` table (every invocation tracked)
- [ ] **4.1.5** Write migration: `agent_archetypes` table (role definitions in DB, not code)
- [ ] **4.1.6** Write migration: `tenant_agent_config` table (per-tenant agent settings, token budgets)
- [ ] **4.1.7** Write migration: `agent_performance` table (acceptance rates, accuracy metrics per tenant per role)
- [ ] **4.1.8** Create HNSW indexes on all embedding columns (m=16, ef_construction=128)
- [ ] **4.1.9** Create RLS policies on all memory tables
- [ ] **4.1.10** Seed agent archetypes: 10 roles with base prompts, tools, guardrails, temperature settings
- [ ] **4.1.11** Run migrations, verify schema

### 4.2 Agent Framework (Python)
- [ ] **4.2.1** Create directory structure:
  ```
  pipeline/src/agents/
    __init__.py
    fabric.py              — AgentFabric orchestrator
    context.py             — Context assembly (prompt building)
    memory.py              — Memory read/write/search operations
    tools.py               — Tool definitions and execution layer
    archetypes/
      __init__.py
      base.py              — BaseArchetype class
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
    learning/
      __init__.py
      diff_analyzer.py
      preference_extractor.py
      pattern_promoter.py
      outcome_attributor.py
      calibrator.py
    lifecycle/
      __init__.py
      decay.py
      compactor.py
      gc.py
      contradiction_resolver.py
  ```
- [ ] **4.2.2** Implement `BaseArchetype` class: system_prompt, tools, max_tokens, temperature, memory_categories, human_gate, invoke()
- [ ] **4.2.3** Implement `AgentFabric` class: event listener, archetype loader, context assembler, Claude API caller, tool executor, result handler, memory updater
- [ ] **4.2.4** Implement `context.py`: load archetype → load tenant profile → retrieve memories (hybrid search) → load task data → assemble tools → apply prompt caching markers → manage token budget
- [ ] **4.2.5** Implement `memory.py`: memory_search (hybrid vector+metadata+recency+importance), memory_write, memory_update, batch retrieval across all three memory types
- [ ] **4.2.6** Implement `tools.py`: tool registry, tenant_id enforcement on every tool, input validation, output formatting, audit logging
- [ ] **4.2.7** Implement each archetype with specific system prompts, tool lists, and activation triggers (per Chapter 2 specs)

### 4.3 Agent Integration with Pipeline
- [ ] **4.3.1** Register agent event handlers in pipeline main loop
- [ ] **4.3.2** Agent activation on events:
  - `finder.rfp.curated_and_pushed` → Scoring Strategist scores for all tenants
  - `identity.purchase.completed` → Proposal Architect generates outline, Librarian matches content
  - `capture.proposal.stage_changed` → appropriate agents per stage (Chapter 2 table)
  - `capture.section.drafted` → Compliance Reviewer checks
  - `capture.partner.upload_received` → Librarian decomposes
  - `capture.proposal.submitted` → Librarian harvests
  - `capture.proposal.outcome_recorded` → all agents update memories
- [ ] **4.3.3** Database-mediated task queue: frontend writes to `agent_task_queue`, pipeline dequeues and executes
- [ ] **4.3.4** Result delivery: agent writes to `agent_task_results`, frontend polls or gets WebSocket notification

### 4.4 Agent API Surface (Frontend)
- [ ] **4.4.1** `POST /api/portal/[tenantSlug]/proposals/[proposalId]/ai/draft` — request section draft
- [ ] **4.4.2** `POST /api/portal/[tenantSlug]/proposals/[proposalId]/ai/review` — request AI review
- [ ] **4.4.3** `POST /api/portal/[tenantSlug]/proposals/[proposalId]/ai/compliance` — request compliance check
- [ ] **4.4.4** `GET /api/portal/[tenantSlug]/agents/memories` — view agent memories (customer transparency)
- [ ] **4.4.5** `DELETE /api/portal/[tenantSlug]/agents/memories/[id]` — delete a memory (customer control)
- [ ] **4.4.6** `GET /api/portal/[tenantSlug]/agents/performance` — agent performance metrics
- [ ] **4.4.7** `PATCH /api/portal/[tenantSlug]/agents/config` — toggle agent automations

### 4.5 Learning Subsystem
- [ ] **4.5.1** Implement `diff_analyzer.py`: detect human edits to agent output, classify edit types
- [ ] **4.5.2** Implement `preference_extractor.py`: extract style/content preferences from edit patterns
- [ ] **4.5.3** Implement `pattern_promoter.py`: promote episodic → semantic → procedural via LLM consolidation
- [ ] **4.5.4** Implement `outcome_attributor.py`: trace win/loss to library units and agent outputs
- [ ] **4.5.5** Implement `calibrator.py`: compare agent predictions to outcomes, adjust confidence

### 4.6 Memory Lifecycle Jobs
- [ ] **4.6.1** Daily: memory decay job (reduce decay_factor based on time, importance, access)
- [ ] **4.6.2** Weekly: garbage collection (archive decayed memories, delete old archives)
- [ ] **4.6.3** Monthly: compaction (cluster similar episodic memories, LLM-summarize to semantic)
- [ ] **4.6.4** Monthly: contradiction detection and resolution
- [ ] **4.6.5** Monthly: pattern promotion (identify repeated behaviors, crystallize to procedural)
- [ ] **4.6.6** Add these to pipeline_schedules table

---

## Phase 5: Security, Email, and Operational Infrastructure
*Goal: Production-ready security, email delivery, and monitoring*

### 5.1 Security
- [ ] **5.1.1** Rate limiting on public endpoints: login, waitlist, get-started
- [ ] **5.1.2** CSRF protection on custom POST endpoints
- [ ] **5.1.3** Verify tenant isolation: every API route validates tenant access
- [ ] **5.1.4** Verify RLS policies on all memory tables
- [ ] **5.1.5** Agent guardrails: tools enforce tenant_id, agents cannot bypass
- [ ] **5.1.6** Input sanitization: user content clearly delimited in agent prompts (prompt injection defense)
- [ ] **5.1.7** Audit trail: all admin actions logged, all agent actions logged
- [ ] **5.1.8** API key rotation workflow for SAM.gov/Anthropic keys

### 5.2 Email (Resend Integration)
- [ ] **5.2.1** Resend API integration for transactional email
- [ ] **5.2.2** Email templates: invitation, password reset, deadline reminder, weekly digest, purchase confirmation
- [ ] **5.2.3** Forgot-password flow (unauthenticated reset via email)
- [ ] **5.2.4** Notification preferences: per-user email frequency settings

### 5.3 Monitoring & Observability
- [ ] **5.3.1** Health check endpoints: `/api/health` (frontend), pipeline health
- [ ] **5.3.2** Error logging: structured error logs with tenant context
- [ ] **5.3.3** Agent cost tracking: per-tenant token usage dashboard in admin
- [ ] **5.3.4** Pipeline monitoring: job queue depth, failure rates, source health

---

## Phase 6: Final Documentation & Deployment
*Goal: Complete system documentation, seeded agents, and production deployment*

### 6.1 Architecture Documentation
- [ ] **6.1.1** Update `ARCHITECTURE_V5.md` with final implemented design
- [ ] **6.1.2** Update agent fabric chapters (01-08) with any implementation changes
- [ ] **6.1.3** Create `DEPLOYMENT.md` — Railway service configuration for all services
- [ ] **6.1.4** Create `API_REFERENCE.md` — all API endpoints documented
- [ ] **6.1.5** Update `CLAUDE.md` with final coding standards and project structure

### 6.2 Agent Seeding
- [ ] **6.2.1** Seed all 10 agent archetypes with production-quality system prompts
- [ ] **6.2.2** Seed foundational knowledge (Layer 1): FAR/DFARS basics, agency structures, SBIR/STTR program rules, proposal evaluation patterns
- [ ] **6.2.3** Seed compliance variable master list with initial ~25 variable types
- [ ] **6.2.4** Seed pipeline schedules for memory lifecycle jobs

### 6.3 Railway Deployment
- [ ] **6.3.1** Verify frontend Dockerfile builds and runs
- [ ] **6.3.2** Verify pipeline Dockerfile builds and runs (now includes agent fabric)
- [ ] **6.3.3** Configure Railway services: frontend, pipeline, PostgreSQL
- [ ] **6.3.4** Configure Railway volumes for local storage
- [ ] **6.3.5** Set all environment variables (DATABASE_URL, AUTH_SECRET, ANTHROPIC_API_KEY, STRIPE_SECRET_KEY, RESEND_API_KEY, etc.)
- [ ] **6.3.6** Run migrations on production database
- [ ] **6.3.7** Seed production data (admin user, agent archetypes, compliance variables)
- [ ] **6.3.8** Verify CI/CD: GitHub Actions → Railway auto-deploy on push to main

### 6.4 Testing
- [ ] **6.4.1** Run existing test suite: `scripts/test-all.sh`
- [ ] **6.4.2** Add agent fabric unit tests: memory operations, tool execution, context assembly
- [ ] **6.4.3** Add integration tests: agent invocation end-to-end, multi-tenant memory isolation
- [ ] **6.4.4** Add RFP curation tests: triage, compliance extraction, push-to-pipeline
- [ ] **6.4.5** Add Stripe integration tests: checkout, webhook, purchase flow
- [ ] **6.4.6** Verify `npx tsc --noEmit` passes
- [ ] **6.4.7** Verify `npm run build` succeeds

---

## Phase Summary

| Phase | Focus | Depends On |
|-------|-------|------------|
| **0** | Cleanup & project definition | Nothing |
| **1** | RFP ingestion & admin curation | Phase 0 |
| **2** | Customer portal (Finder/Reminder + Stripe) | Phase 0 |
| **3** | Proposal workspace & pipeline | Phase 1 + 2 |
| **4** | Agent fabric (memory, archetypes, learning) | Phase 1 |
| **5** | Security, email, monitoring | Phase 2 + 3 |
| **6** | Documentation, seeding, deployment | All phases |

Phases 1 and 2 can run in parallel after Phase 0.
Phase 4 can start as soon as Phase 1 schema is in place.
Phase 3 depends on both 1 (curated outlines) and 2 (Stripe purchases).
Phase 5 runs alongside 3-4.
Phase 6 is the final integration and deploy.

---

## Files Created/Modified Summary

### New Files (Estimated)
```
Database Migrations:           ~8 new migration files
Pipeline Agent Code:          ~20 new Python files
Frontend Admin Curation:       ~8 new page/component files
Frontend Agent API Routes:     ~7 new route files
Frontend Stripe Integration:   ~3 new route files
Documentation:                 ~5 updated doc files
Tests:                        ~10 new test files
Total:                        ~61 new files
```

### Modified Files (Estimated)
```
Pipeline main.py:              Add agent event handlers
Pipeline workers/:             Integration with agent fabric
Frontend middleware.ts:         Add admin curation routes
Frontend admin/layout.tsx:      Add RFP Curation nav item
Frontend portal pages:          Integrate agent UI elements
Frontend lib/:                  CMS cleanup, agent-client
Docker/deployment configs:      Service separation updates
Total:                         ~20 modified files
```
