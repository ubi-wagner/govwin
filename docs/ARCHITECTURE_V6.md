# RFP Pipeline Portal — V6 System Architecture (V1 Launch Baseline)

**Date:** 2026-05-20
**Status:** Authoritative — supersedes ARCHITECTURE_V5.md for all V1 decisions
**Audience:** Engineering, DevOps, Security review, onboarding

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Services](#2-services)
3. [Database Architecture](#3-database-architecture)
4. [Event-Driven Architecture](#4-event-driven-architecture)
5. [Tool Registry](#5-tool-registry)
6. [UI/UX Architecture](#6-uiux-architecture)
7. [Roles & Access Control](#7-roles--access-control)
8. [Data Flow Architecture](#8-data-flow-architecture)
9. [V1 Launch Requirements](#9-v1-launch-requirements)
10. [Current to V1 Gap Analysis](#10-current-to-v1-gap-analysis)

---

## 1. System Overview

RFP Pipeline is a multi-tenant SaaS platform for government contractors to discover,
score, and build proposals for federal opportunities (SBIR, STTR, BAA, OTA, CSO).
An AI agent workforce assists at every lifecycle stage, learning from each proposal
cycle to improve the next.

### Three-Service Architecture

| Service | Runtime | Role | Port |
|---------|---------|------|------|
| **Frontend** | Next.js 15 (Node 20) | Portal UI + all API routes | 3000 |
| **Pipeline** | Python 3.12 (async) | Ingestion, scoring, shredder, agents, workflows | background |
| **CMS/CRM** | FastAPI | Email delivery, event listener, content generation | 8000 |

### Two Databases

| Database | Engine | Name | Used By |
|----------|--------|------|---------|
| **Main Postgres** | PostgreSQL 16 + pgvector | govtech_intel | Frontend, Pipeline |
| **CMS Postgres** | PostgreSQL 16 | cms_db | CMS/CRM only |

### Shared Infrastructure

- **S3 Storage:** Single Railway bucket (`rfp-pipeline-prod-r8t7tr6`) with three prefixes: `rfp-admin/`, `rfp-pipeline/`, `customers/`
- **Event Coordination:** `system_events` table with pg_notify trigger, polled by Pipeline (10s) and CMS (10s)
- **Shared Volume:** `/data` mounted by Frontend and Pipeline for local ops

### System Topology

```
                    ┌─────────────┐
                    │   Browser   │
                    └──────┬──────┘
                           │ HTTPS
                    ┌──────┴──────┐
                    │  Frontend   │
                    │  (Next.js)  │
                    └──┬──────┬───┘
                       │      │
              ┌────────┘      └────────┐
              ▼                        ▼
    ┌─────────────────┐      ┌─────────────────┐
    │  Main Postgres  │◄────►│    Pipeline      │
    │  (govtech_intel)│      │    (Python)      │
    └────────┬────────┘      └─────────────────┘
             │
             │ SHARED_DATABASE_URL
             ▼
    ┌─────────────────┐      ┌─────────────────┐
    │    CMS/CRM      │◄────►│  CMS Postgres   │
    │    (FastAPI)     │      │                 │
    └─────────────────┘      └─────────────────┘
```

### Technology Stack

| Layer | Technology |
|-------|-----------|
| UI Framework | Next.js 15 App Router, React 19, TypeScript |
| Styling | Tailwind CSS |
| Editor | Canvas JSON model (WYSIWYG renderer, not TipTap) |
| Charts | Recharts |
| Auth | NextAuth v5 (Auth.js) with Credentials + JWT |
| Database | postgres.js (Frontend), asyncpg (Pipeline) |
| AI/LLM | Claude (Anthropic) via Sonnet + Haiku model tiering |
| Embeddings | pgvector with sentence-transformers (V1), Anthropic (V2+) |
| Payments | Stripe (checkout, webhooks, billing portal) |
| Email | Gmail API via CMS service (OAuth2) |
| Storage | AWS S3 (Railway bucket) + local /data volume |
| Hosting | Railway (3 services + 2 databases + 1 volume) |
| CI/CD | GitHub Actions, auto-deploy on push to main |

---

## 2. Services

### 2.1 Frontend (Next.js 15)

**Purpose:** All user-facing UI and the entire HTTP API surface. Admin dashboard, customer portal, marketing site, and every API route.

**Entry point:** `frontend/app/layout.tsx` (App Router)

**Key dependencies:** Next.js 15, React 19, NextAuth v5, postgres.js, Stripe SDK, Zod, Recharts

**Database connection:** postgres.js to Main Postgres via `DATABASE_URL`

**Source files:** ~160+ TypeScript source files

| Metric | Count |
|--------|-------|
| API routes | 104 total (75 working, 29 stubs returning 501) |
| Pages | 70 (27 admin, 17 portal, 26 public/auth) |
| Registered tools | 30 (dual-use: UI, agents, automation) |
| Components | ~60 across admin, portal, marketing, canvas |

**HTTP endpoints by area:**

| Area | Working Routes | Stub Routes |
|------|---------------|-------------|
| Admin (rfp-curation, sources, content, etc.) | ~35 | ~7 |
| Portal (proposals, library, spotlights, etc.) | ~20 | ~18 |
| Auth & system (login, health, stripe, etc.) | ~15 | ~2 |
| Public (waitlist, consent, events) | ~5 | ~2 |

**Background workers/loops:** None (stateless request handler). All background work delegated to Pipeline and CMS.

**Event emission:** 50+ event types emitted via `emitEventStart/End/Single` into `system_events`. Every mutation route emits at least one event.

**Event consumption:** None directly. Frontend reads events for display only (admin events page, dashboard).

---

### 2.2 Pipeline (Python 3.12)

**Purpose:** Data ingestion from federal sources, AI document processing (shredder), opportunity scoring, workflow execution, agent fabric, and all background jobs.

**Entry point:** `pipeline/src/main.py` (async job queue with LISTEN/NOTIFY)

**Key dependencies:** asyncpg, httpx, anthropic, pymupdf4llm, boto3, python-docx, pptxgenjs, openpyxl

**Database connection:** asyncpg to Main Postgres via `DATABASE_URL`

**Source files:** 82 Python files

| Component | Files | Status |
|-----------|-------|--------|
| Ingesters (SAM.gov, SBIR.gov, DSIP, Grants.gov) | 6 | Active (SAM, SBIR, DSIP), seeded (Grants) |
| Document agents (DOCX, PPTX, XLSX, PDF) | 7 | Built — full lifecycle for 4 formats |
| Shredder (PDF extraction + compliance mapping) | 5 | Built — framework and prompts ready |
| Source Scout worker | 1 | Built — HTTP fetch + Claude classification |
| Workflow engine (base + 6 definitions + processor) | 8 | Defined — processor not yet wired to main loop |
| Agent archetypes (10 roles) | 12 | Stubbed — class definitions, not implemented |
| Agent learning modules | 5 | Stubbed |
| Agent lifecycle modules | 4 | Stubbed |
| Workers (shredder, reminder, emailer, embedder, etc.) | 7 | Mixed (some built, some partial) |
| Storage (S3 client, paths, provisioner) | 3 | Built |

**Background loops:**

| Loop | Interval | Function |
|------|----------|----------|
| Job queue dequeue | Continuous (LISTEN/NOTIFY) | Picks up pipeline_jobs rows |
| Ingest: SAM.gov | Daily | Fetches new opportunities |
| Ingest: SBIR.gov | Weekly | Fetches SBIR/STTR topics |
| Ingest: DSIP | Daily | Fetches defense innovation posts |
| Scoring | On-demand (post-push) | Scores opportunities against tenant profiles |

**Event emission:** Pipeline emits events for ingest runs, shredder operations, and workflow steps via direct INSERT to `system_events`.

**Event consumption:** Workflow processor (defined, not yet wired) polls `system_events` for unprocessed events and matches against workflow triggers.

---

### 2.3 CMS/CRM (FastAPI)

**Purpose:** Email delivery via Gmail API, event-driven automation rule execution, CMS content management, and email campaign orchestration.

**Entry point:** `services/cms/src/main.py`

**Key dependencies:** FastAPI, SQLAlchemy, Google API Client (Gmail OAuth2)

**Database connection:** SQLAlchemy to CMS Postgres via `CMS_DATABASE_URL`, reads Main Postgres via `SHARED_DATABASE_URL`

**Source files:** 23 Python files

| Component | Files | Status |
|-----------|-------|--------|
| Gmail API integration | 2 | Built (OAuth2 flow) |
| Event listener | 1 | Built (polls system_events at 10s) |
| Email templates (5 responsive HTML) | 1 | Built |
| Email queue + sweep workers | 3 | Built |
| Content routers (CRUD for CMS) | 4 | Built |
| Content generator + template drafter | 2 | Built |

**HTTP endpoints:**

| Route | Method | Purpose |
|-------|--------|---------|
| `/health` | GET | Health check |
| `/api/content` | CRUD | CMS post management |
| `/api/media` | CRUD | Media uploads |
| `/api/email/send` | POST | Trigger email delivery |
| `/api/email/campaigns` | CRUD | Campaign management |

**Event consumption:** Polls `system_events` via `SHARED_DATABASE_URL`, matches events against `automation_rules`, executes actions (send_email, notify_admin).

**Email templates (5):**

| Template | Trigger |
|----------|---------|
| `welcome_accepted` | Application accepted |
| `proposal_workspace_ready` | Proposal created |
| `new_rfp_uploaded` | RFP uploaded for curation |
| `stage_advanced` | Proposal stage change |
| `source_change_detected` | Source Scout alert |

---

## 3. Database Architecture

### 3.1 Main Postgres (govtech_intel)

40 migration files (000-039), ~80 tables across 12 domains.

#### Auth & Tenants (9 tables)

| Table | Key Columns | Scope |
|-------|-------------|-------|
| `tenants` | id, slug, name, status, product_tier, stripe_customer_id, subscription_status | Global |
| `users` | id, email, name, role, tenant_id, password_hash, is_active, temp_password | Global (tenant_id nullable) |
| `accounts` | id, user_id, provider, provider_account_id | Global |
| `sessions` | id, session_token, user_id, expires | Global |
| `verification_tokens` | identifier, token, expires | Global |
| `tenant_profiles` | id, tenant_id, naics_codes, tech_focus, capabilities | Tenant-scoped |
| `invitations` | id, tenant_id, email, role, token, status | Tenant-scoped |
| `consent_records` | id, user_id, document_version_id, accepted_at | Global |
| `legal_document_versions` | id, document_type, version, content | Global |

#### Opportunities (12 tables)

| Table | Key Columns | Scope |
|-------|-------------|-------|
| `opportunities` | id, source, source_id, title, agency, solicitation_id, topic_number, naics_codes | Global |
| `curated_solicitations` | id, opportunity_id, namespace, status, claimed_by, ai_extracted, annotations | Global |
| `solicitation_compliance` | id, solicitation_id, topic_id, page_limit_technical, font_family, etc. | Global |
| `solicitation_documents` | id, solicitation_id, document_type, storage_key, extracted_text | Global |
| `solicitation_volumes` | id, solicitation_id, volume_number, volume_name, applies_to_phase | Global |
| `volume_required_items` | id, volume_id, item_number, item_name, item_type, page_limit, font_size | Global |
| `solicitation_outlines` | id, solicitation_id, outline_json | Global |
| `solicitation_templates` | id, solicitation_id, template_type, storage_key | Global |
| `solicitation_annotations` | id, solicitation_id, kind, anchor, body | Global |
| `compliance_presets` | id, name, agency, program_type, variables | Global |
| `compliance_variables` | id, name, label, category, data_type | Global |
| `triage_actions` | id, solicitation_id, action, actor_id | Global |

#### Proposals (8 tables)

| Table | Key Columns | Scope |
|-------|-------------|-------|
| `proposals` | id, tenant_id, opportunity_id, solicitation_id, title, stage, gate_config | Tenant-scoped |
| `proposal_sections` | id, proposal_id, section_number, title, content (TEXT), status, version | Tenant-scoped |
| `proposal_collaborators` | id, proposal_id, email, name, assigned_sections, dropbox_enabled | Tenant-scoped |
| `collaborator_stage_access` | id, collaborator_id, proposal_id, stage, permission | Tenant-scoped |
| `proposal_stage_history` | id, proposal_id, from_stage, to_stage, changed_by, notes | Tenant-scoped |
| `proposal_comments` | id, proposal_id, section_id, user_id, content, resolved | Tenant-scoped |
| `proposal_reviews` | id, proposal_id, reviewer_id, stage, score, feedback | Tenant-scoped |
| `proposal_compliance_matrix` | id, proposal_id, requirement_text, section_id, status, notes | Tenant-scoped |

#### Library (4 tables)

| Table | Key Columns | Scope |
|-------|-------------|-------|
| `library_units` | id, tenant_id, content, category, tags, source_type, embedding | Tenant-scoped |
| `library_harvest_log` | id, tenant_id, proposal_id, unit_id, outcome | Tenant-scoped |
| `library_atom_outcomes` | id, unit_id, proposal_id, outcome, score | Tenant-scoped |
| `tenant_uploads` | id, tenant_id, filename, storage_key, content_type | Tenant-scoped |

#### Customer Pipeline (4 tables)

| Table | Key Columns | Scope |
|-------|-------------|-------|
| `tenant_pipeline_items` | id, tenant_id, opportunity_id, score, rank | Tenant-scoped |
| `tenant_actions` | id, tenant_id, opportunity_id, action_type (pin, thumb, pursue) | Tenant-scoped |
| `purchases` | id, tenant_id, opportunity_id, proposal_id, stripe_session_id, product_type | Tenant-scoped |
| `spotlights` | id, tenant_id, name, filters, sort | Tenant-scoped |

#### Agents (9 tables)

| Table | Key Columns | Scope |
|-------|-------------|-------|
| `agent_archetypes` | id, role, system_prompt, tools, guardrails | Global |
| `episodic_memories` | id, tenant_id, agent_role, content, embedding, namespace | Tenant-scoped (RLS) |
| `semantic_memories` | id, tenant_id, agent_role, category, content, embedding | Tenant-scoped (RLS) |
| `procedural_memories` | id, tenant_id, agent_role, procedure_name, content | Tenant-scoped (RLS) |
| `agent_task_log` | id, tenant_id, agent_role, tool_name, tokens_in, tokens_out, cost_cents | Tenant-scoped |
| `agent_task_queue` | id, tenant_id, tool_name, input, status, max_retries | Tenant-scoped |
| `agent_task_results` | id, task_id, output, error, completed_at | Tenant-scoped |
| `tenant_agent_config` | id, tenant_id, max_cost_per_month_cents, model_overrides | Tenant-scoped |
| `agent_performance` | id, tenant_id, agent_role, metric_name, metric_value | Tenant-scoped |

#### Events & Automation (6 tables)

| Table | Key Columns | Scope |
|-------|-------------|-------|
| `system_events` | id, namespace, type, phase, actor_type, actor_id, tenant_id, payload | Global |
| `automation_rules` | id, name, trigger_namespace, trigger_type, action_type, action_config, is_active | Global |
| `automation_log` | id, rule_id, trigger_event_id, action_type, status, error_message | Global |
| `opportunity_events` | id, opportunity_id, event_type, metadata (legacy) | Global |
| `customer_events` | id, tenant_id, event_type, metadata (legacy) | Tenant-scoped |
| `content_events` | id, content_type, event_type, metadata (legacy) | Global |

#### Pipeline Operations (6 tables)

| Table | Key Columns | Scope |
|-------|-------------|-------|
| `pipeline_jobs` | id, kind, priority, status, metadata, created_at | Global |
| `pipeline_schedules` | id, source, cron_expression, is_active | Global |
| `pipeline_runs` | id, job_id, source, status, stats | Global |
| `api_key_registry` | id, service, encrypted_key, is_active | Global |
| `rate_limit_state` | id, source, limit_kind, retry_after | Global |
| `source_health` | id, source, last_check, status | Global |

#### Source Scout (4 tables)

| Table | Key Columns | Scope |
|-------|-------------|-------|
| `source_profiles` | id, name, url, auto_crawl_enabled, crawl_cron, last_crawled_at | Global |
| `source_regions` | id, profile_id, css_selector, label, guidance | Global |
| `source_snapshots` | id, profile_id, content_hash, storage_key | Global |
| `source_diffs` | id, profile_id, from_snapshot_id, to_snapshot_id, diff_summary, significance | Global |

#### Content & Analytics (9 tables)

| Table | Key Columns | Scope |
|-------|-------------|-------|
| `cms_content` | id, slug, title, content_type, body, published, featured_image | Global |
| `document_templates` | id, name, format, template_json | Global |
| `canvas_versions` | id, section_id, version, canvas_json | Global |
| `page_views` | id, path, session_id, created_at | Global |
| `visitor_sessions` | id, visitor_id, referrer, utm_params | Global |
| `waitlist` | id, email, company, status | Global |
| `applications` | id, email, company_name, status, tenant_id | Global |
| `audit_log` | id, actor_id, action, target, details | Global |
| `system_config` | key, value, updated_at | Global |

#### Data Imports (3 tables)

| Table | Key Columns | Scope |
|-------|-------------|-------|
| `sbir_companies` | id, name, duns, cage, state | Global (45K+ rows) |
| `sbir_awards` | id, company_id, agency, topic_number, amount, year | Global (350K+ rows) |
| `sbir_data_uploads` | id, filename, status, stats | Global |

#### System Monitoring (2 tables)

| Table | Key Columns | Scope |
|-------|-------------|-------|
| `system_health_snapshots` | id, service, metrics, created_at | Global |
| `tool_invocation_metrics` | id, tool_name, actor_type, success, duration_ms | Global |

### 3.2 CMS Postgres

| Table | Purpose |
|-------|---------|
| `cms_posts` | Blog posts and CMS content |
| `cms_media` | Media file references |
| `cms_generations` | AI-generated content drafts |
| `cms_reviews` | Content review workflow |
| `cms_events` | CMS-local event log |
| `cms_config` | CMS service configuration |
| `email_accounts` | Gmail OAuth2 credentials |
| `email_templates` | HTML email templates |
| `email_campaigns` | Campaign definitions |
| `email_sends` | Individual send records |
| `email_engagement` | Open/click tracking |
| `email_threads` | Conversation threads |
| `email_queue` | Pending email queue |
| `email_outbox` | Sent email archive |

### 3.3 Key Indexes

| Type | Purpose | Tables |
|------|---------|--------|
| HNSW | Vector similarity search | episodic_memories, semantic_memories, library_units |
| B-tree | Tenant isolation queries | All tenant-scoped tables (on tenant_id) |
| GIN | JSONB field queries | ai_extracted, annotations, metadata, payload |
| GiST (tsvector) | Full-text search | opportunities.full_text_tsv, curated_solicitations.full_text_tsv |
| Partial | Active-record filtering | is_active, is_archived, status conditions |

---

## 4. Event-Driven Architecture

### 4.1 Event Bus: system_events Table

```sql
system_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace     TEXT NOT NULL,        -- finder, capture, identity, proposal, library, system, tool
  type          TEXT NOT NULL,        -- entity.verb_past_tense (snake_case)
  phase         TEXT NOT NULL,        -- 'start' | 'end' | 'single'
  actor_type    TEXT NOT NULL,        -- 'user' | 'system' | 'pipeline' | 'agent'
  actor_id      TEXT NOT NULL,
  actor_email   TEXT,
  tenant_id     UUID,                 -- NULL for admin/system events
  parent_event_id UUID,              -- links end to start, enables correlation chains
  payload       JSONB NOT NULL,       -- must include correlationId
  created_at    TIMESTAMPTZ DEFAULT now()
)
```

**pg_notify trigger:** Fires on INSERT. Currently defined but not consumed (Pipeline and CMS poll instead).

**Consumers:**

| Consumer | Service | Mechanism | Interval |
|----------|---------|-----------|----------|
| Workflow processor | Pipeline | DB poll (planned) | 10s |
| Automation rule matcher | CMS/CRM | DB poll | 10s |
| Admin events page | Frontend | API read on request | On demand |

### 4.2 Event Namespaces (7 Total)

| Namespace | Owner | Scope | Admin tenantId | Portal tenantId |
|-----------|-------|-------|----------------|-----------------|
| `finder` | Admin curation | RFP upload, triage, curation, topics, sources, ingest | `null` | n/a |
| `capture` | Customer lifecycle | Application, subscription, purchase, pin/unpin | `null` (app) | tenant UUID |
| `identity` | Auth only | Login, password change, role change | varies | varies |
| `proposal` | Proposal workspace | Create, section save, comment, stage, lock | n/a | tenant UUID |
| `library` | Content library | Upload, atomize, save atom, delete, bulk ops | n/a | tenant UUID |
| `system` | Infrastructure | Storage, health, errors, capacity, config | `null` | n/a |
| `tool` | Tool invocations | Registry dispatch start/end (auto-emitted) | varies | varies |

**Forbidden namespaces:** `admin`, `cms`, `spotlight`, `pipeline` -- NEVER use.

**Event type format:** `entity.verb_past_tense` (snake_case). Examples: `solicitation.claimed`, `proposal.created`, `section.saved`

**Phase rules:**
- `start` + `end` for multi-step operations (enables stuck detection, duration tracking)
- `single` for atomic CRUD operations
- Every payload includes `correlationId: crypto.randomUUID()`

### 4.3 Registered Event Types

**50+ event types across 7 namespaces.** Key types per namespace:

| Namespace | Key Event Types | Count |
|-----------|----------------|-------|
| `finder` | rfp.uploaded, solicitation.claimed/released/dismissed/approved/pushed, annotation.saved, topic.added/imported, source.created/visited, ingest.triggered, sbir_data.ingested | ~20 |
| `capture` | application.submitted/accepted/rejected, subscription.started/renewed/canceled, purchase.completed, topic.pinned/unpinned | ~10 |
| `identity` | user.logged_in, user.password_changed | 2 |
| `proposal` | proposal.created, section.saved, comment.created/resolved, proposal.advanced/locked/unlocked | ~7 |
| `library` | file.uploaded, document.atomized, atom.saved, unit.updated/deleted | ~5 |
| `system` | file.uploaded/deleted, content.published/updated/deleted, ingester.rate_limited, shredder.budget_exceeded | ~8 |
| `tool` | invoke.start, invoke.end (auto-emitted per invocation) | 2 |

### 4.4 Workflows (7 Definitions)

| # | Workflow | Trigger | Steps | Status |
|---|----------|---------|-------|--------|
| 1 | **OnRfpUploaded** | `finder:rfp.uploaded:end` | (1) ACTION: shred_document, (2) ACTION: extract_compliance, (3) NOTIFY: email rfp_admin | Defined, not wired |
| 2 | **OnSolicitationPushed** | `finder:solicitation.pushed:single` | (1) ACTION: match_tenants, (2) NOTIFY: Spotlight digest email | Defined, not wired |
| 3 | **OnApplicationAccepted** | `capture:application.accepted:end` | (1) NOTIFY: welcome email, (2) ACTION: library defaults, (3) HITL_WAIT: first login | Defined, not wired |
| 4 | **OnProposalCreated** | `proposal:proposal.created:end` | (1) AI_INVOKE: draft sections, (2) NOTIFY: workspace ready | Defined, not wired |
| 5 | **OnProposalAdvancedToPinkTeam** | `proposal:proposal.advanced:single` (stage=review) | (1) AI_INVOKE: pink team review, (2) NOTIFY: review ready, (3) HITL_WAIT: reviewer action | Defined, not wired |
| 6 | **OnProposalAdvancedToFinal** | `proposal:proposal.advanced:single` (stage=final) | (1) ACTION: generate export preview, (2) NOTIFY: final ready | Defined, not wired |
| 7 | **OnSourceChangeDetected** | `finder:source.change_detected:single` | (1) ACTION: create draft solicitations, (2) NOTIFY: admin alert, (3) CONDITION: auto-triage if confidence > 0.9 | Defined, not wired |

**Workflow step types:**

| Type | Description | Actor |
|------|-------------|-------|
| ACTION | Call a registered pipeline function | system/pipeline |
| AI_INVOKE | Call Claude via the tool registry | agent |
| HITL_WAIT | Pause until a human takes an action (with timeout) | user |
| NOTIFY | Send email/notification | system |
| CONDITION | Branch based on payload data | n/a |

### 4.5 Automation Rules (6 Seeded)

| # | Rule Name | Trigger (namespace:type) | Action | Active |
|---|-----------|--------------------------|--------|--------|
| 1 | Welcome new customer | `capture:application.accepted` | send_email (welcome_accepted) | Yes |
| 2 | Proposal workspace ready | `proposal:proposal.created` | send_email (proposal_workspace_ready) | Yes |
| 3 | New RFP ready for curation | `finder:rfp.uploaded` | notify_admin (new_rfp_uploaded) | Yes |
| 4 | Source change detected | `finder:source.change_detected` | notify_admin (source_change_detected) | Yes |
| 5 | Proposal stage advanced | `proposal:proposal.advanced` | send_email (stage_advanced) | Yes |
| 6 | Topic pinned by customer | `capture:topic.pinned` | notify_admin (admin_notification) | Yes |

**Action types supported:** `log_only`, `queue_notification`, `queue_job`, `emit_event`, `send_email`, `notify_admin`, `webhook`, `update_status`

---

## 5. Tool Registry

### Overview

30 registered tools, all dual-use (callable by UI, agents, and automation). Every tool invocation goes through `invoke()` in `frontend/lib/tools/registry.ts` which enforces: role check, tenant scope check, input validation (Zod), event emission (start/end), and metrics recording.

**Three entry points, one implementation:**
1. Direct in-process call from API routes
2. HTTP via generic adapter `POST /api/tools/[name]`
3. Pipeline dispatcher polling `agent_task_queue` (Phase 4)

### Tool Catalog (30 Tools)

| # | Tool Name | Namespace | Description | Required Role | Tenant-Scoped | Status |
|---|-----------|-----------|-------------|---------------|---------------|--------|
| 1 | `solicitation.list_triage` | solicitation | List triage-ready solicitations | rfp_admin | No | Built |
| 2 | `solicitation.get_detail` | solicitation | Fetch solicitation with compliance + annotations | rfp_admin | No | Built |
| 3 | `solicitation.claim` | solicitation | Atomic claim from triage queue (race-safe) | rfp_admin | No | Built |
| 4 | `solicitation.release` | solicitation | Release for AI analysis, triggers shredder | rfp_admin | No | Built |
| 5 | `solicitation.dismiss` | solicitation | Dismiss with phase classification | rfp_admin | No | Built |
| 6 | `solicitation.request_review` | solicitation | Request peer review from another admin | rfp_admin | No | Built |
| 7 | `solicitation.approve` | solicitation | Reviewer approves (enforces curated_by != approved_by) | rfp_admin | No | Built |
| 8 | `solicitation.reject_review` | solicitation | Reviewer rejects with notes | rfp_admin | No | Built |
| 9 | `solicitation.push` | solicitation | Publish to customer pipeline | rfp_admin | No | Built |
| 10 | `solicitation.save_annotation` | solicitation | Persist annotation on solicitation | rfp_admin | No | Built |
| 11 | `solicitation.delete_annotation` | solicitation | Remove annotation by id | rfp_admin | No | Built |
| 12 | `compliance.list_variables` | compliance | List master compliance variable catalog | rfp_admin | No | Built |
| 13 | `compliance.add_variable` | compliance | Add novel compliance variable | rfp_admin | No | Built |
| 14 | `compliance.extract_from_text` | compliance | AI-extract compliance vars from text fragment | rfp_admin | No | Built |
| 15 | `compliance.save_variable_value` | compliance | Save confirmed variable value for solicitation | rfp_admin | No | Built |
| 16 | `volume.add` | volume | Add volume to solicitation | rfp_admin | No | Built |
| 17 | `volume.delete` | volume | Delete volume from solicitation | rfp_admin | No | Built |
| 18 | `volume.add_required_item` | volume | Add required item to volume | rfp_admin | No | Built |
| 19 | `volume.update_required_item` | volume | Update required item properties | rfp_admin | No | Built |
| 20 | `volume.delete_required_item` | volume | Delete required item from volume | rfp_admin | No | Built |
| 21 | `opportunity.get_by_id` | opportunity | Lookup opportunity + compliance matrix | rfp_admin | No | Built |
| 22 | `opportunity.add_topic` | opportunity | Add topic manually | rfp_admin | No | Built |
| 23 | `opportunity.bulk_add_topics` | opportunity | Paste-import topics | rfp_admin | No | Built |
| 24 | `ingest.trigger_manual` | ingest | Enqueue manual ingester run | master_admin | No | Built |
| 25 | `ingest.list_recent_runs` | ingest | List recent pipeline runs | rfp_admin | No | Built |
| 26 | `ingest.get_run_detail` | ingest | Fetch run details + events | rfp_admin | No | Built |
| 27 | `memory.search` | memory | Text search over tenant agent memories | tenant_user | Yes | Built |
| 28 | `memory.write` | memory | Insert memory row for tenant | tenant_user | Yes | Built |
| 29 | `library.save_atom` | library | Save library atom for tenant | tenant_user | Yes | Built |
| 30 | `library.search_atoms` | library | Search library atoms by keyword | tenant_user | Yes | Built |
| 31 | `proposal.draft_section` | proposal | AI-draft a proposal section | tenant_user | Yes | Built |
| 32 | `source.scout` | source | HTTP fetch + Claude classification of source | rfp_admin | No | Built |

(Note: `curation_memory` is a helper module, not a registered tool.)

---

## 6. UI/UX Architecture

### 6.1 Admin Pages (27)

**Operations (10 pages)**

| Page | Path | Description | Status |
|------|------|-------------|--------|
| Dashboard | `/admin/dashboard` | 8 stat cards, event stream, alerts | Working |
| RFP Triage Queue | `/admin/rfp-curation` | Triage queue with filters, batch actions | Working |
| RFP Curation Workspace | `/admin/rfp-curation/[solId]` | PDF viewer, compliance tagging, topics, documents | Working |
| RFP Upload | `/admin/rfp-curation/upload` | Multi-file upload with extraction | Working |
| Topic Compliance | `/admin/rfp-curation/[solId]/topic/[topicId]` | Phase-grouped compliance, preset application | Working |
| Admin Section Editor | `/admin/proposals/[id]/section/[id]` | Canvas WYSIWYG with AI revision | Working |
| Applications | `/admin/applications` | Application review (accept/reject) | Working |
| Tenants List | `/admin/tenants` | Tenant management | Working |
| Tenant Detail | `/admin/tenants/[tenantId]` | Tenant detail and config | Working |
| Admin Root | `/admin` | Redirect to dashboard | Working |

**Monitoring (6 pages)**

| Page | Path | Description | Status |
|------|------|-------------|--------|
| Events Viewer | `/admin/events` | System event stream with namespace filters | Working |
| Pipeline Monitor | `/admin/pipeline` | Job queue, run history, failure rates | Working |
| Process Monitor | `/admin/process` | Workflow instances and step status | Working |
| System Dashboard | `/admin/system` | Tool metrics, capacity, health | Working |
| Storage Browser | `/admin/storage` | S3 bucket explorer | Working |
| Billing Admin | `/admin/billing` | Stripe dashboard integration | Working |

**Intelligence (4 pages)**

| Page | Path | Description | Status |
|------|------|-------------|--------|
| Sources Hub | `/admin/sources` | 6 seeded sources, crawl settings | Working |
| Source Detail | `/admin/sources/[profileId]` | Region annotation, scout trigger, diff history | Working |
| Analytics | `/admin/analytics` | Platform metrics and charts | Stub |
| Agents Monitor | `/admin/agents` | Agent performance, memories, config | Stub |

**Content (4 pages)**

| Page | Path | Description | Status |
|------|------|-------------|--------|
| CMS Content | `/admin/content` | Blog/resource/guide management | Working |
| Content Editor | `/admin/content/[contentId]` | Content authoring | Working |
| Templates | `/admin/templates` | Document template management | Working |
| Waitlist | `/admin/waitlist` | Waitlist management | Working |

**Other (3 pages)**

| Page | Path | Description | Status |
|------|------|-------------|--------|
| Purchases | `/admin/purchases` | Purchase/payment history | Working |
| Documents Hub | `/admin/documents` | Document management | Working |
| Document Detail | `/admin/documents/[documentId]` | Document detail view | Working |

### 6.2 Portal Pages (17)

**Dashboard & Navigation**

| Page | Path | Description | Status |
|------|------|-------------|--------|
| Tenant Selector | `/portal` | Choose workspace (multi-tenant users) | Working |
| Dashboard | `/portal/[slug]/dashboard` | Tenant home, recent activity | Working |

**Opportunities**

| Page | Path | Description | Status |
|------|------|-------------|--------|
| Pipeline | `/portal/[slug]/pipeline` | Scored opportunity feed | Working |
| Spotlights | `/portal/[slug]/spotlights` | Saved search buckets | Working |
| Spotlight Detail | `/portal/[slug]/spotlights/[id]` | Opportunity detail, pin/unpin | Working |

**Proposals**

| Page | Path | Description | Status |
|------|------|-------------|--------|
| Proposal List | `/portal/[slug]/proposals` | All proposals with stage badges | Working |
| Proposal Workspace | `/portal/[slug]/proposals/[id]` | Sections, stage progress, draft-all | Working |
| Section Editor | `/portal/[slug]/proposals/[id]/sections/[id]` | Canvas editor with collaboration | Working |
| Review Interface | `/portal/[slug]/proposals/[id]/review` | Color team review form | Working |

**Library & Documents**

| Page | Path | Description | Status |
|------|------|-------------|--------|
| Library | `/portal/[slug]/library` | Atom browser with search | Working |
| Library Upload | `/portal/[slug]/library/upload` | Document upload for atomization | Working |
| Library Review | `/portal/[slug]/library/review` | Review atomized content | Working |
| Documents | `/portal/[slug]/documents` | Tenant document management | Working |

**Account & Team**

| Page | Path | Description | Status |
|------|------|-------------|--------|
| Team | `/portal/[slug]/team` | Team member management | Working |
| Profile | `/portal/[slug]/profile` | Tenant profile editing | Working |
| Billing | `/portal/[slug]/billing` | Stripe billing portal | Working |
| Activity | `/portal/[slug]/activity` | Activity feed | Working |

### 6.3 Public Pages (26)

**Marketing (20 pages)**

| Page | Path | Status |
|------|------|--------|
| Home | `/` | Working |
| About | `/about` | Working |
| Features | `/features` | Working |
| Pricing | `/pricing` | Working |
| Engine | `/engine` | Working |
| Team | `/team` | Working |
| Customers | `/customers` | Working |
| Get Started | `/get-started` | Working |
| Apply | `/apply` | Working |
| How It Works | `/how-it-works` | Working |
| Value | `/value` | Working |
| The Expert | `/the-expert` | Working |
| Security | `/security` | Working |
| InfoSec | `/infosec` | Working |
| Blog | `/blog` | Working |
| Blog Post | `/blog/[slug]` | Working |
| Resources | `/resources` | Working |
| Resource Detail | `/resources/[slug]` | Working |
| Terms | `/legal/terms` | Working |
| Privacy | `/legal/privacy` | Working |
| Acceptable Use | `/legal/acceptable-use` | Working |
| AI Disclosure | `/legal/ai-disclosure` | Working |

**Auth (4 pages)**

| Page | Path | Status |
|------|------|--------|
| Login | `/login` | Working |
| Change Password | `/change-password` | Working |
| Invite Accept | `/invite/[token]` | Working |
| Post-Login Redirect | `/dashboard` | Working |

### 6.4 API Routes Summary

| Category | Total | Working | Stubs (501) |
|----------|-------|---------|-------------|
| Admin | ~42 | ~35 | ~7 |
| Portal | ~38 | ~20 | ~18 |
| Auth & System | ~14 | ~12 | ~2 |
| Public | ~10 | ~8 | ~2 |
| **Total** | **104** | **75** | **29** |

### 6.5 Canvas Editors

Three document types supported by the canvas JSON model and WYSIWYG renderer:

| Type | Format | Template Example | Nodes | Features |
|------|--------|-----------------|-------|----------|
| **Document** | Letter (8.5x11) | SBIR Phase I Technical | 42 | Headings, text blocks, lists, tables, images, captions, footnotes, TOC, page breaks |
| **Slide** | 16:9 | CSO Phase I Briefing | 35 | Positioned text boxes, bullet layouts, title slides |
| **Spreadsheet** | Tabular | SBIR Phase I Cost Volume | 4 sheets | Formulas, logical sheet tabs, auto-calculation |

**Canvas rules (per document):** format, dimensions, margins, header/footer templates with variable substitution, font defaults, line spacing, max pages/slides.

**4 presets:** `letter_standard`, `letter_sbir_phase1`, `letter_sbir_phase2`, `slide_cso`

**12 node types:** heading, text_block, bulleted_list, numbered_list, image, table, caption, footnote, toc, page_break, url, spacer

**Editor features:**
- WYSIWYG rendering with live format preview
- AI revision panel (Claude rewrites selected nodes)
- Sidebar: compliance requirements, library search, section outline
- Comments system (per-node, resolvable)
- Draft-all button (AI drafts all sections from library + RFP requirements)
- Version history via canvas_versions table
- Collaboration indicators (who is editing which section)

---

## 7. Roles & Access Control

### 7.1 Role Hierarchy

```
master_admin (rank 100)
    │
    ▼
rfp_admin (rank 80)
    │
    ▼
tenant_admin (rank 60)
    │
    ▼
tenant_user (rank 40)
    │
    ▼
partner_user (rank 20)
```

`hasRoleAtLeast(actorRole, requiredRole)` returns true when `ROLE_RANK[actorRole] >= ROLE_RANK[requiredRole]`. This means `master_admin` satisfies any role check.

### 7.2 Access Matrix

| Capability | master_admin | rfp_admin | tenant_admin | tenant_user | partner_user |
|------------|:---:|:---:|:---:|:---:|:---:|
| Railway / migrations | Yes | - | - | - | - |
| Create tenant accounts | Yes | - | - | - | - |
| Manage other admins | Yes | - | - | - | - |
| RFP triage queue | Yes | Yes | - | - | - |
| RFP curation workspace | Yes | Yes | - | - | - |
| Push curated RFPs | Yes | Yes | - | - | - |
| Customer onboarding | Yes | Yes | - | - | - |
| View system dashboard | Yes | Yes | - | - | - |
| Pipeline / agents monitoring | Yes | Yes | - | - | - |
| Source Scout management | Yes | Yes | - | - | - |
| Manage their tenant | - | - | Yes | - | - |
| Invite/manage team | - | - | Yes | - | - |
| Purchase proposals (Stripe) | - | - | Yes | - | - |
| Configure agent settings | - | - | Yes | - | - |
| View all tenant proposals | - | - | Yes | Per grant | - |
| Edit proposals | - | - | Yes | Per grant | Per stage grant |
| Comment on proposals | - | - | Yes | Per grant | Per stage grant |
| View Spotlight feed | - | - | Yes | Yes | - |
| Pin/unpin opportunities | - | - | Yes | Yes | - |
| Upload to library | - | - | Yes | Yes | - |
| Search library | - | - | Yes | Yes | - |
| View assigned proposals | - | - | - | - | Per stage grant |
| Upload to assigned sections | - | - | - | - | Per stage grant |

### 7.3 Auth Flow

```
Login (email + password)
  │
  ▼
NextAuth Credentials Provider
  ├── Verify password_hash (bcrypt)
  ├── Check is_active
  ├── Check temp_password → force change-password redirect
  │
  ▼
JWT Session Created
  ├── Encodes: id, email, name, role, tenantId
  │
  ▼
Middleware (every request)
  ├── /admin/* → requires master_admin or rfp_admin
  ├── /portal/[slug]/* → requires tenant_admin, tenant_user, or partner_user
  ├── /api/admin/* → requires master_admin or rfp_admin
  ├── /api/portal/[slug]/* → requires authenticated + tenant access
  │
  ▼
Page-Level Checks
  ├── Server component reads session
  ├── Verifies role meets page requirement
  │
  ▼
Tenant Access Verification (Portal routes)
  ├── getTenantBySlug(slug)
  ├── verifyTenantAccess(userId, role, tenantId)
  ├── EVERY query includes WHERE tenant_id = $1
```

### 7.4 Partner/Collaborator Model

- Identity: `(email)` globally, access scoped to `(email + tenant + proposal + stage)`
- Three permission tiers: view, comment, edit
- `collaborator_stage_access` table controls per-stage, per-proposal access
- Auto-revoke on stage close
- Historical roster per tenant for quick re-invitation
- Partner login shows only portals with active access grants

---

## 8. Data Flow Architecture

### 8.1 Flow: RFP Upload → Shredder → Curation → Push → Spotlight

```
Admin uploads RFP PDF(s)
  │
  ├── Frontend: store in S3 (rfp-admin/{solId}/)
  ├── Frontend: INSERT INTO solicitation_documents
  ├── Frontend: emit finder:rfp.uploaded:start + :end
  │
  ▼
Shredder Worker (Pipeline)
  ├── Dequeue shred_solicitation job
  ├── Extract text from PDF (pymupdf4llm)
  ├── Call Claude (Sonnet) for section extraction
  ├── Call Claude for compliance variable extraction
  ├── UPDATE curated_solicitations SET ai_extracted = JSONB, status = 'ai_analyzed'
  ├── INSERT INTO solicitation_compliance (pre-filled values)
  ├── Emit finder:rfp.shredding:start + :end
  │
  ▼
Admin Claims + Curates
  ├── Claim: atomic UPDATE WHERE status='new' AND claimed_by IS NULL
  ├── Workspace: PDF viewer + compliance tagging + annotations
  ├── Cross-cycle pre-fill from memory.search_namespace
  ├── Verify/edit compliance values
  ├── Build volumes + required items
  ├── Request review → second admin approves
  │
  ▼
Admin Pushes to Pipeline
  ├── Validate required fields
  ├── UPDATE curated_solicitations SET status = 'pushed_to_pipeline'
  ├── UPDATE opportunities SET is_active = true
  ├── Write procedural memory for namespace ({agency}:{office}:{type}:{phase})
  ├── Emit finder:solicitation.pushed:single
  │
  ▼
Scoring Engine
  ├── Score opportunity against all active tenant profiles
  ├── INSERT INTO tenant_pipeline_items (score, rank)
  │
  ▼
Customer Spotlight
  ├── Opportunity appears in scored feed
  ├── Customer can pin, purchase proposal, request analysis
```

### 8.2 Flow: Application → Acceptance → Tenant Creation → Workspace

```
Customer submits application (/apply)
  ├── INSERT INTO applications (status='pending')
  ├── Emit capture:application.submitted:single
  │
  ▼
Admin reviews + accepts
  ├── UPDATE applications SET status = 'accepted'
  ├── INSERT INTO tenants (slug, name, product_tier)
  ├── INSERT INTO users (email, role='tenant_admin', temp_password)
  ├── CREATE S3 prefix: customers/{slug}/
  ├── Emit capture:application.accepted:start + :end
  │
  ▼
Automation Rule: Welcome email
  ├── CMS event listener matches capture:application.accepted
  ├── Send welcome_accepted email via Gmail API
  │
  ▼
Customer logs in
  ├── Temp password → forced change
  ├── Redirect to /portal/{slug}/dashboard
  ├── Emit identity:user.logged_in:single
```

### 8.3 Flow: Proposal Create → Template → AI Draft → Edit → Review → Lock → Export

```
Customer purchases proposal via Stripe
  ├── Stripe checkout session → webhook
  ├── INSERT INTO purchases (product_type, amount_cents)
  ├── Emit capture:purchase.completed:single
  │
  ▼
Portal Provisioner (Pipeline)
  ├── INSERT INTO proposals (tenant_id, opportunity_id, stage='draft')
  ├── Clone solicitation outline → proposal_sections
  ├── Clone compliance matrix → proposal_compliance_matrix
  ├── Copy RFP docs: rfp-pipeline/{oppId}/* → customers/{slug}/proposals/{propId}/rfp-snapshot/
  ├── Emit proposal:proposal.created:start + :end
  │
  ▼
AI Draft (proposal.draft_section tool)
  ├── Load: RFP requirements + compliance matrix + library atoms + tenant profile
  ├── Call Claude (Sonnet) per section
  ├── Save canvas JSON to proposal_sections.content
  ├── Emit proposal:section.saved:single per section
  │
  ▼
Human Editing
  ├── Canvas WYSIWYG editor
  ├── AI revision panel for selected nodes
  ├── Library search + insert
  ├── Comments from collaborators
  │
  ▼
Stage Advancement: draft → review → final → submitted
  ├── Validation checks per stage gate
  ├── UPDATE proposals SET stage = next_stage
  ├── INSERT INTO proposal_stage_history
  ├── Auto-lock on final/submitted
  ├── Emit proposal:proposal.advanced:single
  │
  ▼
Export
  ├── Canvas JSON → Document Agent (DOCX/PPTX/XLSX)
  ├── Download via S3 signed URL
```

### 8.4 Flow: Source Scout → Change Detection → Draft Opportunities

```
Admin creates source profile (/admin/sources)
  ├── INSERT INTO source_profiles (url, crawl_cron)
  ├── Admin annotates regions (css_selector + guidance for Claude)
  │
  ▼
Scout Worker (Pipeline or manual trigger)
  ├── HTTP fetch source URL
  ├── Extract monitored regions
  ├── Compute content_hash, compare to last snapshot
  ├── INSERT INTO source_snapshots
  │
  ▼
If change detected:
  ├── Call Claude (Haiku) to classify significance
  ├── INSERT INTO source_diffs (diff_summary, significance)
  ├── Emit finder:source.change_detected:single
  │
  ▼
Workflow: OnSourceChangeDetected
  ├── Create draft curated_solicitations from extracted opportunities
  ├── Notify admin via email
  ├── Auto-triage if confidence > 0.9
```

### 8.5 Flow: Library Upload → Atomization → Search → Insert into Proposal

```
Customer uploads document (/portal/{slug}/library/upload)
  ├── Store in S3: customers/{slug}/library/uploads/{fileId}
  ├── INSERT INTO tenant_uploads
  ├── Emit library:file.uploaded:single
  │
  ▼
Atomization (Grinder Worker)
  ├── Extract text from document (PDF/DOCX/PPTX)
  ├── Call Claude (Haiku) to decompose into reusable atoms
  ├── Each atom: bio, past-performance, tech-approach, boilerplate
  ├── INSERT INTO library_units (content, category, tags, embedding)
  ├── Emit library:document.atomized:start + :end
  │
  ▼
Library Search (library.search_atoms tool)
  ├── Keyword search + embedding similarity (when available)
  ├── Filter by tenant_id, category, tags
  ├── Return ranked results with source anchors
  │
  ▼
Insert into Proposal
  ├── User clicks "Insert" in canvas editor sidebar
  ├── Library atom content injected as canvas node
  ├── Source provenance tracked (library_unit_id → proposal_section)
  ├── Emit library:atom.saved:single
```

---

## 9. V1 Launch Requirements

V1 is a full platform launch with automated workflows. The CMS service operates as a bridge for email delivery only.

### 9.1 Core Proposal Pipeline

| Requirement | Description |
|-------------|-------------|
| Create proposal | Purchase via Stripe, workspace auto-provisioned |
| Edit proposal | Canvas WYSIWYG editor with all 12 node types |
| AI draft | Claude drafts sections from RFP + library + compliance |
| Collaborate | Invite team members and partners with stage-scoped access |
| Review | Color team review forms, comments, score |
| Stage gates | draft → review → final → submitted → archived |
| Lock/unlock | Auto-lock on final, admin unlock with deadline |
| Export | Canvas JSON → DOCX, PPTX, XLSX via document agents |

### 9.2 Spotlight Feed

| Requirement | Description |
|-------------|-------------|
| Scoring | Score curated opportunities against tenant profiles |
| Display | Ranked opportunity feed with compliance summaries |
| Pin/unpin | Customer marks opportunities of interest |
| Purchase | Stripe checkout → proposal workspace creation |
| Filters | By agency, program type, phase, close date |

### 9.3 Library System

| Requirement | Description |
|-------------|-------------|
| Upload | Accept PDF, DOCX, PPTX from tenant users |
| Atomize | Grinder decomposes into reusable content atoms |
| Search | Keyword search with category/tag filters |
| Insert | Insert atoms into proposal sections from editor sidebar |
| Harvest | Post-submission harvest of winning content |

### 9.4 RFP Curation

| Requirement | Description |
|-------------|-------------|
| Upload | Multi-file RFP upload with PDF extraction |
| Shred | AI extracts sections + compliance variables from PDF |
| Curate | Admin workspace: annotate, tag, build volumes, set compliance |
| Multi-admin | Claim → curate → request review → approve (different admin) → push |
| Push | Publish to customer pipeline with scoring |

### 9.5 Event System

| Requirement | Description |
|-------------|-------------|
| Emit | All mutation routes emit system_events |
| Process | Workflow processor matches events to workflow triggers |
| Automate | Automation rules fire actions (email, notification, job) |
| Monitor | Admin events page with namespace filters |

### 9.6 Email Delivery

| Requirement | Description |
|-------------|-------------|
| Welcome | Email on application acceptance |
| Workspace ready | Email when proposal workspace created |
| Stage advanced | Email on proposal stage changes |
| Source alert | Email when Source Scout detects changes |
| RFP alert | Email when new RFP uploaded for curation |

### 9.7 Source Scout

| Requirement | Description |
|-------------|-------------|
| Monitor | Track federal source websites for changes |
| Detect | Content hash comparison + Claude significance classification |
| Notify | Alert admin on meaningful changes |
| Draft | Create draft opportunities from detected changes |

### 9.8 Canvas Editors

| Requirement | Description |
|-------------|-------------|
| Document | Letter-format with full node types, export to DOCX |
| Slide | 16:9 format with positioned content, export to PPTX |
| Spreadsheet | Tabular with formulas, export to XLSX |

### 9.9 Admin Monitoring

| Requirement | Description |
|-------------|-------------|
| Events | Real-time event stream with filters |
| Pipeline | Job queue depth, run history, failure rates |
| Process | Workflow instance status and step tracking |
| System | Tool metrics, capacity indicators, health checks |

---

## 10. Current to V1 Gap Analysis

This section details every component that needs work before V1 launch. Organized by area with specific gaps identified.

### 10.1 Workflow & Automation

| Component | Current Status | V1 Required | Gap | Effort |
|-----------|---------------|-------------|-----|--------|
| Workflow processor | Defined (7 workflow classes exist) | Wired to pipeline main loop | Processor polls system_events but not connected to main.py event loop | 2 days |
| OnRfpUploaded | Steps defined | Executes on RFP upload | Not triggered (processor not wired) | Included above |
| OnSolicitationPushed | Steps defined | Triggers tenant matching + digest | Not triggered (processor not wired) | Included above |
| OnApplicationAccepted | Steps defined | Sends welcome email + provisions | Not triggered (processor not wired) | Included above |
| OnProposalCreated | Steps defined | AI drafts sections + notifies | Not triggered (processor not wired) | Included above |
| OnProposalAdvanced | Steps defined | Review + notify + HITL wait | Not triggered (processor not wired) | Included above |
| OnSourceChangeDetected | Steps defined | Drafts opportunities + alerts | Not triggered (processor not wired) | Included above |
| Automation rule execution | CMS polls system_events | Rules fire email/notification actions | CMS event listener built but email delivery not end-to-end tested | 1 day |

### 10.2 AI / Shredder

| Component | Current Status | V1 Required | Gap | Effort |
|-----------|---------------|-------------|-----|--------|
| Shredder text extraction | Framework built (extractor, runner) | PDF text → Claude → compliance | Shredder worker dequeues jobs but does not invoke Claude for compliance extraction | 3 days |
| Shredder compliance mapping | compliance_mapping.py exists | Auto-populate solicitation_compliance | Not wired: Claude output not persisted to compliance rows | Included above |
| Topic auto-extraction | Heuristic (regex pattern matching) | Claude-based topic extraction from BAA text | Only regex, no Claude call for structured extraction | 1 day |
| AI section drafting | proposal.draft_section tool exists | Draft from library + RFP + compliance | Tool built but not tested end-to-end with real data | 1 day |

### 10.3 Proposal Export

| Component | Current Status | V1 Required | Gap | Effort |
|-----------|---------------|-------------|-----|--------|
| DOCX export | DocxAgent built | Canvas JSON → downloadable .docx | Export button wired in UI but HTTP endpoint not connected to agent | 2 days |
| PPTX export | PptxAgent built | Canvas JSON → downloadable .pptx | Same gap as DOCX | Included above |
| XLSX export | XlsxAgent built | Canvas JSON → downloadable .xlsx | Same gap as DOCX | Included above |
| Package route | API route stub (501) | POST generates full package | `proposals/[id]/package/route.ts` returns 501 | Included above |

### 10.4 Email Delivery

| Component | Current Status | V1 Required | Gap | Effort |
|-----------|---------------|-------------|-----|--------|
| Gmail API integration | OAuth2 built in CMS | Sends real emails | Built but not tested end-to-end (welcome → inbox) | 1 day |
| Welcome email | Template exists | Arrives on application accept | Not triggered (workflow not wired) | Included in 10.1 |
| Workspace ready email | Template exists | Arrives on proposal create | Not triggered (workflow not wired) | Included in 10.1 |
| Stage advanced email | Template exists | Arrives on stage change | Not triggered (automation rule exists, CMS execution untested) | 1 day |
| Source change email | Template exists | Arrives on scout detection | Not triggered (workflow not wired) | Included in 10.1 |

### 10.5 Portal API Routes (Stubs)

| Route | Current | V1 Required | Gap | Effort |
|-------|---------|-------------|-----|--------|
| Portal dashboard | 501 | Tenant stats, recent activity | Needs implementation | 1 day |
| Portal opportunities | 501 | Scored opportunity list | Needs implementation + scoring wiring | 2 days |
| Portal opportunity actions | 501 | Pin, thumb, pursue | Needs implementation | 0.5 day |
| Portal opportunity documents | 501 | Download RFP docs | Needs implementation | 0.5 day |
| Portal proposals list | 501 | Tenant proposal list | Needs implementation | 0.5 day |
| Portal spotlights | 501 | Spotlight CRUD | Needs implementation | 1 day |
| Portal spotlight detail | 501 | Spotlight items with scoring | Needs implementation | 0.5 day |
| Portal purchases | 501 | Purchase history | Needs implementation | 0.5 day |
| Portal uploads | 501 | File upload handling | Needs implementation | 0.5 day |
| Portal notifications | 501 | Notification feed | Needs implementation | 1 day |
| AI: draft | 501 | Trigger section draft | Needs implementation (tool exists, route is stub) | 0.5 day |
| AI: review | 501 | Trigger AI review | Needs implementation | 1 day |
| AI: compliance | 501 | Trigger compliance check | Needs implementation | 0.5 day |
| Proposal package | 501 | Generate export package | Needs implementation (agents exist, route is stub) | 1 day |
| Proposal reviews | 501 | Color team review CRUD | Needs implementation | 1 day |
| Agent memories | 501 | View tenant agent memories | Needs implementation | 0.5 day |
| Agent performance | 501 | Agent metrics | Needs implementation | 0.5 day |
| Agent config | 501 | Tenant agent settings | Needs implementation | 0.5 day |

### 10.6 Admin API Routes (Stubs)

| Route | Current | V1 Required | Gap | Effort |
|-------|---------|-------------|-----|--------|
| Admin dashboard API | 501 | Real stat aggregation | Needs real queries (page works, API is stub) | 1 day |
| Admin pipeline API | 501 | Job queue + run stats | Needs implementation | 0.5 day |
| Admin agents API | 501 | Agent monitoring data | Needs implementation | 1 day |
| Admin purchases API | 501 | Purchase management | Needs implementation | 0.5 day |
| Admin tenants CRUD | 501 | Tenant management | Needs implementation | 1 day |
| Admin waitlist API | 501 | Waitlist management | Needs implementation | 0.5 day |

### 10.7 Canvas & Editor

| Component | Current Status | V1 Required | Gap | Effort |
|-----------|---------------|-------------|-----|--------|
| Inline formatting | Defined in model (inline_formats) | Bold/italic/underline in editor + export | Export does not process inline_formats yet | 1 hr |
| Table cell merging | Not in model | rowSpan/colSpan for cost volumes | Missing from TableContent schema + export | 2 hr |
| Real TOC | Placeholder node | Auto-updating TOC in DOCX | Word TOC field code not generated | 2 hr |
| Real footnotes | Inline text approach | Proper page-bottom footnotes in DOCX | DocxAgent uses inline rather than FootnoteReferenceRun | 2 hr |
| Image embedding | Placeholder text | Embedded images in export | DocxAgent outputs `[Image: alt]` instead of actual image | 3 hr |
| Watermarks | Not implemented | "DRAFT" watermark during review stages | DocxAgent does not add watermarks | 1 hr |
| Track changes | Not implemented | Nice-to-have for V1 | Would show diff between stages in Word | 4 hr (V2) |

### 10.8 Collaboration

| Component | Current Status | V1 Required | Gap | Effort |
|-----------|---------------|-------------|-----|--------|
| Team invitation | Schema exists (invitations table) | Invite flow works end-to-end | Invite API + email + accept flow not tested e2e | 2 days |
| Stage-scoped access | Schema exists (collaborator_stage_access) | Partners see only granted sections/stages | Access enforcement in portal routes partial | 1 day |
| Auto-revoke on stage close | Designed | Access revoked when stage advances | Not implemented in stage advancement route | 0.5 day |
| Partner login experience | Designed | Partners see only active grants | Partner filtering not tested | 0.5 day |

### 10.9 Scoring & Spotlight

| Component | Current Status | V1 Required | Gap | Effort |
|-----------|---------------|-------------|-----|--------|
| Scoring engine | scoring/engine.py exists | Score opportunities against profiles | Not triggered on solicitation push | 1 day |
| Tenant pipeline items | Table exists | Scored items per tenant | No rows populated (scoring not running) | Included above |
| Spotlight filters | Table exists (spotlights) | Customer saved search buckets | API stub (501), needs implementation | 1 day |
| FOMO signals | Designed | "X companies pursuing this" indicators | Not implemented | 1 day (V2) |

### 10.10 Agent Fabric

| Component | Current Status | V1 Required | Gap | Effort |
|-----------|---------------|-------------|-----|--------|
| Agent archetypes | 10 class stubs in pipeline | Not V1 (V2 feature) | Stubs only, no implementation | V2 |
| Agent learning modules | 5 class stubs | Not V1 | Stubs only | V2 |
| Agent lifecycle modules | 4 class stubs | Not V1 | Stubs only | V2 |
| Agent task dispatcher | dispatcher.py exists | Not V1 (uses tool registry HTTP) | Skeleton, not wired | V2 |
| Context assembly | context.py exists | Not V1 | Stub only | V2 |
| Memory lifecycle (decay, GC) | Stubs exist | Not V1 | Stubs only | V2 |

### 10.11 Infrastructure

| Component | Current Status | V1 Required | Gap | Effort |
|-----------|---------------|-------------|-----|--------|
| Health check endpoint | `/api/health` exists | Returns service status | Needs real DB + S3 connectivity check | 0.5 day |
| Error monitoring | console.error logging | Structured error logging | No Sentry integration (V2) | V2 |
| Rate limiting | rate_limit_state table exists | Rate limit public endpoints | Not enforced at middleware level | 1 day |
| Stripe live mode | Test mode working | Live payments | Switch keys + test real charges | 0.5 day |

### 10.12 Gap Summary

| Category | Items | Total Effort |
|----------|-------|-------------|
| Workflow wiring (critical) | 1 blocker (processor → main loop) | 2 days |
| Shredder execution (critical) | AI extraction not invoking Claude | 3 days |
| Proposal export (critical) | UI → document agents not connected | 2 days |
| Email end-to-end (critical) | Templates → Gmail delivery | 1 day |
| Portal API stubs (critical) | 18 routes need implementation | ~8 days |
| Admin API stubs | 6 routes need implementation | ~4 days |
| Canvas export enhancements | Inline formatting, images, TOC, footnotes | ~1 day |
| Collaboration | Invite flow, stage-scoped access | ~3 days |
| Scoring engine wiring | Trigger scoring on push | ~2 days |
| Infrastructure | Health checks, rate limiting, Stripe live | ~2 days |
| **Total estimated V1 gap** | | **~28 days** |

### 10.13 V1 Launch Priority Order

```
Week 1 (Critical Path):
  Day 1-2: Wire workflow processor to pipeline main loop
  Day 2-3: Shredder worker invokes Claude for compliance extraction
  Day 3-4: Proposal export connects canvas JSON to document agents
  Day 5:   Email templates end-to-end via Gmail API

Week 2 (Portal Build-Out):
  Day 1-2: Portal API routes (dashboard, opportunities, proposals list)
  Day 2-3: Portal API routes (spotlights, actions, purchases)
  Day 3-4: Scoring engine triggered on solicitation push
  Day 5:   Portal AI routes (draft, review, compliance)

Week 3 (Collaboration + Polish):
  Day 1-2: Team invitation flow end-to-end
  Day 2-3: Stage-scoped access enforcement + auto-revoke
  Day 3:   Canvas export enhancements (inline formats, images, TOC)
  Day 4:   Admin API stubs (dashboard, pipeline, tenants)
  Day 5:   Infrastructure (health checks, rate limiting, Stripe live)

Week 4 (Testing + Launch):
  Day 1-2: Full admin E2E test (per TESTING_ADMIN_E2E.md)
  Day 2-3: Full customer E2E test (per TESTING_CUSTOMER_E2E.md)
  Day 3-4: Fix issues found during testing
  Day 5:   Stripe live mode, production seed, go-live
```

---

## Appendix A: Key Reference Documents

| Document | Location | Purpose |
|----------|----------|---------|
| CLAUDE.md | `/CLAUDE.md` | Engineering standards (binding) |
| CLAUDE_CLIFFNOTES.md | `/CLAUDE_CLIFFNOTES.md` | Schema reference, patterns, common mistakes |
| EVENT_CONTRACT.md | `/docs/EVENT_CONTRACT.md` | Event namespaces, types, workflow architecture |
| TOOL_CONVENTIONS.md | `/docs/TOOL_CONVENTIONS.md` | Tool interface, registry, dual-use patterns |
| NAMESPACES.md | `/docs/NAMESPACES.md` | Canonical namespace registry (events, tools, storage, roles) |
| AGENT_FABRIC_DESIGN.md | `/docs/AGENT_FABRIC_DESIGN.md` | Agent layers, cost model, security, archetypes |
| CANVAS_DOCUMENT_ARCHITECTURE.md | `/docs/CANVAS_DOCUMENT_ARCHITECTURE.md` | Canvas JSON model, node types, export pipeline |
| EXPORT_CAPABILITIES_ANALYSIS.md | `/docs/EXPORT_CAPABILITIES_ANALYSIS.md` | MS Office export features and low-hanging fruit |
| TESTING_ADMIN_E2E.md | `/docs/TESTING_ADMIN_E2E.md` | Admin end-to-end testing guide |
| TESTING_CUSTOMER_E2E.md | `/docs/TESTING_CUSTOMER_E2E.md` | Customer end-to-end testing guide |
| IMPLEMENTATION_PLAN_V2.md | `/docs/IMPLEMENTATION_PLAN_V2.md` | Phase-by-phase implementation plan |
| SYSTEM_STATUS_20260507.md | `/docs/SYSTEM_STATUS_20260507.md` | Last system status snapshot |
| AUDIT_PRELAUNCH_20260428.md | `/docs/AUDIT_PRELAUNCH_20260428.md` | Pre-launch audit (12 critical, all fixed) |

## Appendix B: Environment Variables

| Variable | Service | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | Frontend, Pipeline | Main Postgres connection |
| `CMS_DATABASE_URL` | CMS | CMS Postgres connection |
| `SHARED_DATABASE_URL` | CMS | Read access to Main Postgres |
| `AUTH_SECRET` | Frontend | NextAuth JWT signing |
| `AUTH_URL` | Frontend | NextAuth callback URL |
| `STRIPE_SECRET_KEY` | Frontend | Stripe API |
| `STRIPE_WEBHOOK_SECRET` | Frontend | Stripe webhook verification |
| `ANTHROPIC_API_KEY` | Pipeline | Claude API |
| `CLAUDE_MODEL` | Pipeline | Model selection (sonnet/haiku) |
| `SAM_GOV_API_KEY` | Pipeline | SAM.gov API |
| `API_KEY_ENCRYPTION_SECRET` | Frontend, Pipeline | AES-256-GCM for api_key_registry |
| `STORAGE_ROOT` | Frontend, Pipeline | Local volume mount (/data) |
| `AWS_ACCESS_KEY_ID` | Frontend, Pipeline | S3 bucket access |
| `AWS_SECRET_ACCESS_KEY` | Frontend, Pipeline | S3 bucket access |
| `AWS_REGION` | Frontend, Pipeline | S3 region |
| `AWS_ENDPOINT_URL_S3` | Frontend, Pipeline | Railway S3 endpoint |
| `GOOGLE_CLIENT_ID` | CMS | Gmail OAuth2 |
| `GOOGLE_CLIENT_SECRET` | CMS | Gmail OAuth2 |
| `GOOGLE_REFRESH_TOKEN` | CMS | Gmail OAuth2 |

---

*End of ARCHITECTURE_V6.md*
