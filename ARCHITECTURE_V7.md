# RFP Pipeline Portal — V7 System Architecture & Master Index

**Date:** 2026-05-21
**Status:** Authoritative — supersedes V6 for all V1 baseline decisions
**Branch:** claude/analyze-project-status-KbAhg (merged to main)
**Audience:** Engineering, DevOps, Claude Code sessions, onboarding

---

## How to Use This Document

This is the **master index** for the entire platform. It provides:
1. Current system architecture summary
2. Complete tech stack reference
3. CI/CD and deployment process
4. Linked sub-documents for deep-dive reference
5. Document catalog with revision history

**For Claude Code sessions:** Start here. Read the linked docs as needed for specific tasks.
**For humans:** This is the card catalog. Every decision, schema, and contract is linked.

---

## 1. System Overview

RFP Pipeline is a multi-tenant SaaS platform for government contractors to discover,
score, and build proposals for federal opportunities (SBIR, STTR, BAA, OTA, CSO).
An AI agent workforce assists at every lifecycle stage.

### Three-Service Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  FRONTEND (Next.js 15)              Port 3000 / www.rfppipeline.com │
│  Portal UI + Admin UI + Auth + All API Routes                       │
│  ├── Marketing site (public pages, blog, resources)                 │
│  ├── Admin panel (/admin/*)                                         │
│  ├── Portal (/portal/[tenantSlug]/*)                                │
│  └── API routes (/api/*)                                            │
├─────────────────────────────────────────────────────────────────────┤
│  PIPELINE (Python 3.12)             Background worker               │
│  Ingestion + Scoring + Shredding + Workflows + Agents               │
│  ├── Job queue (LISTEN/NOTIFY on pipeline_jobs)                     │
│  ├── Ingesters (SAM.gov, SBIR.gov, Grants.gov, DSIP)               │
│  ├── Shredder (document decomposition)                              │
│  ├── Scoring engine (tenant-opportunity matching)                   │
│  ├── Workflow processor (multi-step event-driven chains)            │
│  └── Health endpoint (:8080/health)                                 │
├─────────────────────────────────────────────────────────────────────┤
│  CMS/CRM (FastAPI)                  Port 8000 / internal            │
│  Email Automation + Content Pipeline + Event Listener               │
│  ├── React SPA at /cms/ (admin console)                             │
│  ├── Email engine (campaigns, drip, HITL outbox, Gmail API)         │
│  ├── Content pipeline (generate → edit → review → publish)          │
│  ├── Social media posting (LinkedIn, Twitter)                       │
│  ├── Event listener (polls system_events, triggers automation)      │
│  └── 6 background workers                                          │
└─────────────────────────────────────────────────────────────────────┘
```

### Two Databases

| Database | Connection Var | Used By | Tables |
|----------|---------------|---------|--------|
| **Main Postgres** (govtech_intel) | `DATABASE_URL` | Frontend, Pipeline, CMS (read via `SHARED_DATABASE_URL`) | ~70 tables: tenants, users, proposals, opportunities, system_events, automation_rules, cms_content, pipeline_jobs, etc. |
| **CMS Postgres** | `CMS_DATABASE_URL` | CMS service only | ~20 tables: email_*, cms_posts, cms_generations, social_*, admin_todos, drip_* |

**Cross-database bridge:** CMS service connects to Main Postgres via `SHARED_DATABASE_URL` for:
- Reading `system_events` and `automation_rules` (event listener)
- Writing to `cms_content` (content bridge on publish)
- Reading `tenants`, `users`, `proposals` (profile resolution for email templates)
- Writing to `automation_log` (rule execution tracking)
- Writing to `system_events` (event emission from CMS)

---

## 2. Full Tech Stack

### Frontend
| Component | Technology | Version |
|-----------|-----------|---------|
| Framework | Next.js (App Router) | 15.5.x |
| Runtime | Node.js | 20 |
| Auth | NextAuth v5 (Credentials + JWT) | 5.0.0-beta.25 |
| Database client | postgres.js | ^3.4 |
| Editor | TipTap + ProseMirror | 3.22.x |
| Drag & Drop | @dnd-kit | ^6.1 |
| Export | docx, pptxgenjs, exceljs, pdfjs-dist | various |
| Payments | Stripe | ^17 |
| Email (frontend) | googleapis (OAuth2 refresh token) | ^144 |
| Testing | Vitest + Playwright | ^3.1 / ^1.50 |
| CSS | Tailwind CSS | 4.x |

### Pipeline
| Component | Technology | Version |
|-----------|-----------|---------|
| Runtime | Python | 3.12 |
| Database | asyncpg | ^0.29 |
| AI | Anthropic SDK (Claude) | ^0.91 |
| HTTP | httpx | ^0.27 |
| Storage | boto3 (S3-compatible) | ^1.35 |
| Testing | pytest + pytest-asyncio | ^8.0 / ^0.23 |

### CMS/CRM
| Component | Technology | Version |
|-----------|-----------|---------|
| Framework | FastAPI | ^0.110 |
| Server | Uvicorn | ^0.27 |
| Database | asyncpg | ^0.29 |
| AI | Anthropic SDK (Claude) | ^0.91 |
| Email | Google Workspace Gmail API (service account + domain-wide delegation) | ^2.100 |
| Templates | Jinja2 (autoescape enabled for HTML, text mode for subjects) | ^3.1 |
| Frontend | React 18 + Vite + TipTap + Tailwind | various |
| Testing | pytest + pytest-asyncio + httpx (ASGI transport) | various |

### Infrastructure
| Component | Technology |
|-----------|-----------|
| Hosting | Railway (3 services + 2 Postgres) |
| CI/CD | GitHub Actions |
| Container | Docker (multi-stage builds) |
| Storage | S3-compatible (Railway volume + object storage) |
| Domain | www.rfppipeline.com |
| DNS/CDN | Railway edge |

---

## 3. CI/CD & Deployment Process

### GitHub → Railway Flow

```
Developer pushes to feature branch
  → PR created against main
  → GitHub Actions CI runs:
    ├── frontend: tsc --noEmit → next lint → vitest → npm run build
    ├── pipeline: pip install → pytest tests/
    ├── crm: py_compile → pytest tests/ → npm ci && npm run build (SPA)
    └── migrate-crm: spin up Postgres → run CMS migrations → verify tables
  → PR review + merge to main
  → Railway detects changes per service watch paths:
    ├── frontend/* → rebuild govtech-frontend
    ├── pipeline/* → rebuild govtech-pipeline
    └── services/cms/* → rebuild govtech-crm
  → Each service: Docker build → deploy → health check → traffic shift
```

### Migration Runners

| Service | Runner | Trigger | Script |
|---------|--------|---------|--------|
| Frontend | `db/migrations/migrate.mjs` | Entrypoint (`entrypoint.sh`) before Next.js starts | Node.js, reads `_migration_history`, runs pending .sql files in order |
| CMS | `services/cms/db/run.sh` | Dockerfile CMD before uvicorn starts | Bash + psql, reads `_cms_migrations`, runs pending .sql files |
| Pipeline | None (shares Main Postgres) | N/A | Relies on frontend migrations |

**Migration safety:**
- All migrations use `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` for idempotency
- Tracked in `_migration_history` (Main) / `_cms_migrations` (CMS) tables
- `set -e` / `ON_ERROR_STOP=1` halts on failure
- CMS Dockerfile: migration failure is non-fatal (service starts, health endpoint reports DB status)

### Railway Health Checks

| Service | Path | Timeout | Behavior |
|---------|------|---------|----------|
| Frontend | `/api/health` | default | Returns DB connectivity status |
| CMS | `/health` | 120s | Always 200 (liveness), reports DB status as detail |
| Pipeline | `:8080/health` | none configured | Minimal asyncio HTTP server |

---

## 4. Document Catalog

All reference documents live in `/docs/`. This section is the master index — update it on each major deploy.

### Architecture & Design

| Document | Purpose | Last Updated | Status |
|----------|---------|-------------|--------|
| [ARCHITECTURE_V7.md](./ARCHITECTURE_V7.md) | **This file.** Master index and system overview | 2026-05-21 | Current |
| [ARCHITECTURE_V6.md](docs/ARCHITECTURE_V6.md) | V1 launch baseline architecture | 2026-05-20 | Superseded by V7 |
| [ARCHITECTURE_V5.md](ARCHITECTURE_V5.md) | Original 5-service vision architecture | 2026-04-05 | Historical |
| [ARCHITECTURE_DAY365.md](docs/ARCHITECTURE_DAY365.md) | Day-365 vision document | 2026-04 | Vision |
| [AGENT_FABRIC_DESIGN.md](docs/AGENT_FABRIC_DESIGN.md) | Agent system architecture | 2026-04 | Design spec |
| [CANVAS_DOCUMENT_ARCHITECTURE.md](docs/CANVAS_DOCUMENT_ARCHITECTURE.md) | Proposal canvas editor architecture | 2026-05 | Current |

### Database & Schema

| Document | Purpose | Last Updated |
|----------|---------|-------------|
| [DB_SCHEMAS.md](docs/DB_SCHEMAS.md) | Complete table/column/type reference for both databases | 2026-05-21 |
| [CLAUDE_CLIFFNOTES.md](CLAUDE_CLIFFNOTES.md) | Quick-reference schema + common mistakes + audit fixes | 2026-05-20 |

### Event System & Workflows

| Document | Purpose | Last Updated |
|----------|---------|-------------|
| [EVENT_CONTRACT_V2.md](docs/EVENT_CONTRACT_V2.md) | Namespace dictionary, event type catalog, processor reference, state machine | 2026-05-21 |
| [EVENT_CONTRACT.md](docs/EVENT_CONTRACT.md) | Original event contract (V5 era) | 2026-04 |
| [NAMESPACES.md](docs/NAMESPACES.md) | Original namespace definitions | 2026-04 |
| [WORKFLOW_REFERENCE.md](docs/WORKFLOW_REFERENCE.md) | Pipeline workflows, email automation flows, how to build new workflows | 2026-05-21 |

### API & Integration

| Document | Purpose | Last Updated |
|----------|---------|-------------|
| [API_REFERENCE.md](docs/API_REFERENCE.md) | Complete API endpoint reference (Frontend + CMS) | 2026-05-21 |
| [API_CONVENTIONS.md](docs/API_CONVENTIONS.md) | API design standards and patterns | 2026-04 |
| [TOOL_CONVENTIONS.md](docs/TOOL_CONVENTIONS.md) | Agent tool interface standards | 2026-04 |

### Development Standards

| Document | Purpose | Last Updated |
|----------|---------|-------------|
| [DEVELOPMENT_STANDARDS.md](docs/DEVELOPMENT_STANDARDS.md) | Consolidated code quality, security, testing, error handling rules | 2026-05-21 |
| [CLAUDE.md](CLAUDE.md) | Claude Code session instructions (SOPs, engineering reference) | 2026-05-20 |
| [ERROR_HANDLING.md](docs/ERROR_HANDLING.md) | Error handling patterns per service | 2026-04 |
| [DEFINITION_OF_DONE.md](docs/DEFINITION_OF_DONE.md) | Definition of done for features | 2026-04 |
| [TESTING_STRATEGY.md](docs/TESTING_STRATEGY.md) | Testing approach and coverage goals | 2026-04 |

### Operations & Deployment

| Document | Purpose | Last Updated |
|----------|---------|-------------|
| [RAILWAY.md](RAILWAY.md) | Railway deployment configuration | 2026-05 |
| [MIGRATIONS_RUNBOOK.md](docs/MIGRATIONS_RUNBOOK.md) | Database migration procedures | 2026-04 |
| [STORAGE_LAYOUT.md](docs/STORAGE_LAYOUT.md) | File storage paths and conventions | 2026-04 |
| [FOLDER_STRUCTURE.md](docs/FOLDER_STRUCTURE.md) | Project directory structure | 2026-04 |

### Planning & Status

| Document | Purpose | Last Updated |
|----------|---------|-------------|
| [IMPLEMENTATION_PLAN_V2.md](docs/IMPLEMENTATION_PLAN_V2.md) | Clean build implementation plan | 2026-04-07 |
| [CRM_CMS_PHASE1.md](docs/CRM_CMS_PHASE1.md) | CRM/CMS Phase 1 design | 2026-05 |
| [V1_AUDIT_TODO.md](docs/V1_AUDIT_TODO.md) | V1 pre-merge audit findings (all resolved) | 2026-05-21 |
| [SYSTEM_STATUS_20260507.md](docs/SYSTEM_STATUS_20260507.md) | System status snapshot | 2026-05-07 |
| [CHANGELOG.md](CHANGELOG.md) | Release changelog | 2026-05 |

### Testing & QA

| Document | Purpose | Last Updated |
|----------|---------|-------------|
| [TESTING_ADMIN_E2E.md](docs/TESTING_ADMIN_E2E.md) | Admin E2E test scripts | 2026-04 |
| [TESTING_CUSTOMER_E2E.md](docs/TESTING_CUSTOMER_E2E.md) | Customer E2E test scripts | 2026-04 |
| [AUDIT_PRELAUNCH_20260428.md](docs/AUDIT_PRELAUNCH_20260428.md) | Pre-launch security audit | 2026-04-28 |
| [CODE_REVIEW_V1.md](docs/CODE_REVIEW_V1.md) | V1 code review findings | 2026-05 |

### User-Facing

| Document | Purpose | Last Updated |
|----------|---------|-------------|
| [CUSTOMER_ONBOARDING_GUIDE.md](docs/CUSTOMER_ONBOARDING_GUIDE.md) | Customer onboarding flow | 2026-04 |
| [RFP_ADMIN_OPERATIONS_GUIDE.md](docs/RFP_ADMIN_OPERATIONS_GUIDE.md) | Admin operations manual | 2026-04 |
| [DOCUMENT_BUILDER_GUIDE.md](docs/DOCUMENT_BUILDER_GUIDE.md) | Document builder user guide | 2026-05 |

---

## 5. Roles & Access Control

| Role | Access | UI |
|------|--------|-----|
| `master_admin` | Full system: all admin pages, Railway, migrations, system health | Admin panel (full) |
| `rfp_admin` | RFP triage/curation, customer onboarding, CRM | Admin panel (most), CMS SPA |
| `tenant_admin` | Manages their tenant: team, proposals, billing, profile | Portal (full) |
| `tenant_user` | Per-admin grant: all proposals or per-proposal | Portal (limited) |
| `partner_user` | Stage-scoped per-proposal access | Portal (proposals only) |

---

## 6. Key Data Flows

### Application → Tenant → Welcome Email
```
Visitor submits application (POST /api/applications)
  → Admin reviews in /admin/applications
  → Admin accepts → tenant + user created → event: capture.application.accepted
  → CMS event listener matches automation rule
  → send_email action renders welcome template with profile vars
  → Email queued in outbox for HITL review
  → Admin approves → Gmail sends via service account
```

### Content Created → Published → Public Page
```
CMS admin creates post in /cms/content/new (TipTap editor)
  → AI revision panel polishes content
  → Submit for review → Approve → Publish
  → Event: content_pipeline.post.published
  → automation rule triggers publish_content action
  → CMS reads cms_posts, upserts to Main Postgres cms_content
  → Next.js ISR picks up on next revalidation (60s)
  → Public blog/page updated
```

### Email Sent → Reply → Auto-Response → HITL
```
Campaign/drip sends email with trigger flags embedded
  → Gmail API sends via service account
  → Reply arrives in inbox
  → Sweep worker (every 5 min) detects reply
  → Extracts trigger flags (base64 HTML comment)
  → Classifies reply via Claude (sentiment + intent)
  → Maps classification to response template
  → Resolves customer profile from Main Postgres
  → Renders response with Jinja2
  → Queues in email_outbox for HITL review
  → Admin reviews/revises/releases
  → Emits {namespace}.{type}.reply_received event
```

### Opportunity Ingested → Scored → Tenant Feed
```
Pipeline ingests from SAM.gov/SBIR.gov
  → Creates/updates opportunity + curated_solicitation
  → Event: finder.opportunity.ingested
  → Workflow: shred → extract_compliance → match_tenants
  → Scoring: NAICS overlap + keyword match + agency preference
  → Upserts tenant_pipeline_items with score
  → Tenant sees scored feed in /portal/[slug]/spotlights
```

---

## 7. Revision History

| Version | Date | Summary |
|---------|------|---------|
| V5 | 2026-04-05 | Original 5-service vision architecture |
| V6 | 2026-05-20 | V1 launch baseline: 3 services, 2 databases, event-driven |
| **V7** | **2026-05-21** | **Post-audit baseline: 49+ bugs fixed, all stubs implemented, security hardened, comprehensive doc system** |

### V7 Changes from V6
- CMS React SPA with TipTap editor, AI revision, visual stage pipeline
- Closed-loop email automation with trigger flags and auto-response
- Multi-input content generation (5 source types)
- All 20+ portal/admin 501 stubs implemented with real queries
- All pipeline workflow actions implemented (shred, score, compliance, etc.)
- 3 audit passes: 49+ bugs fixed across all services
- Security: CSP, HSTS, timing-safe auth, bcrypt 12, session 8hr, prompt injection defense
- CI: pytest suite for CMS (17 tests), SPA build in CI
- Deployment: multi-stage Dockerfile, health checks, non-fatal migrations
- Navigation: active-state sidebars, partner restrictions, mobile menu
- Auth: forgot/reset password flow with stateless HMAC tokens
- Documentation: this master index + 5 linked reference documents
