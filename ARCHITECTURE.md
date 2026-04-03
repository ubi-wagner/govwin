# RFP Pipeline — Architecture & Capabilities Document

**Last updated:** April 3, 2026
**Branch:** `claude/fix-crash-issue-Oj6Td` (commit `5c64d2d`)

---

## 1. System Overview

RFP Pipeline is a full-stack SaaS platform for small businesses pursuing SBIR/STTR and federal R&D funding. The platform has three major subsystems:

| Layer | Stack | Hosting |
|-------|-------|---------|
| **Frontend** | Next.js 15.5, React 19, Tailwind CSS 3.4, TypeScript 5.9 | Railway |
| **Pipeline** | Python 3, asyncpg, asyncio, LISTEN/NOTIFY | Railway (worker) |
| **Database** | PostgreSQL with pgvector, 34 migrations, 52+ tables | Railway (managed) |

**Positioning:** "The Operating System for Non-Dilutive Funding" — powered by the SBIR Engine.

**Pricing:** $199/mo Pipeline Engine + $999/Phase I Build + $2,500/Phase II Build.

---

## 2. Frontend Architecture

### 2.1 Routing & Layouts

```
app/
├── layout.tsx                    # Root layout (Inter font, base meta)
├── (marketing)/                  # Route group — no path prefix
│   ├── layout.tsx                # SiteHeader + SiteFooter wrapper
│   ├── page.tsx                  # / — Landing page (server)
│   ├── about/page.tsx            # /about (server)
│   ├── engine/page.tsx           # /engine — SBIR Engine product page (server)
│   ├── features/page.tsx         # /features — Feature grid (server)
│   ├── pricing/page.tsx          # /pricing — Redirects to /get-started (server)
│   ├── get-started/page.tsx      # /get-started — Pricing & onboarding (server)
│   ├── customers/page.tsx        # /customers — Customer stories (server)
│   ├── team/page.tsx             # /team (server)
│   ├── happenings/page.tsx       # /happenings — Content hub (server)
│   ├── tips/page.tsx             # /tips (server)
│   ├── announcements/page.tsx    # /announcements (server)
│   └── legal/                    # /legal/* — Terms, privacy, etc. (server)
├── (auth)/
│   ├── login/page.tsx            # /login (client)
│   └── change-password/page.tsx  # /change-password (client)
├── admin/                        # /admin/* — Master admin (client components)
│   ├── layout.tsx                # AdminNav sidebar, role gate
│   ├── dashboard/                # Overview stats + charts
│   ├── tenants/                  # CRUD tenants & users
│   ├── pipeline/                 # Pipeline run management
│   ├── events/                   # Event log viewer
│   ├── sources/                  # Data source config
│   ├── automation/               # Automation rule editor
│   ├── content/                  # CMS editor + preview
│   ├── templates/                # SBIR proposal template management
│   ├── purchases/                # Purchase tracking
│   └── compliance/               # Legal doc management
├── portal/[tenantSlug]/          # /portal/:slug/* — Tenant portal (client)
│   ├── layout.tsx                # PortalNav sidebar, tenant resolution
│   ├── dashboard/                # Tenant dashboard
│   ├── pipeline/                 # Opportunity pipeline
│   ├── proposals/                # Proposal list + detail + editor
│   ├── spotlights/               # SpotLight saved searches
│   ├── library/                  # Content library
│   ├── documents/                # Document management
│   ├── team/                     # Team + invitations
│   └── profile/                  # Scoring profile config
└── api/                          # ~50+ API routes (all server-side)
```

### 2.2 Auth System

- **NextAuth v5** (beta.30) with JWT strategy, credentials provider only
- **Roles:** `master_admin`, `tenant_admin`, `tenant_user`, `partner_user`
- **Session:** `{ user: { id, name, email, role, tenantId, tempPassword }, expires }`
- **Middleware** gates all routes: marketing pages are public; `/admin/*` requires `master_admin`; `/portal/[slug]/*` requires matching tenant; unauthenticated users redirect to `/login`

### 2.3 Shared Components

| Component | Type | Purpose |
|-----------|------|---------|
| `site-header.tsx` | Client | Marketing nav — SBIR Engine, Features, Pricing, About + Resources dropdown |
| `site-footer.tsx` | Server | Footer with Product/Company/Resources links, mini CTA, trust badges |
| `page-sections.tsx` | Client | Reusable blocks: Section, SectionHeader, FeatureCard, StatHighlight, CtaSection, LogoCloud, TestimonialCard, PricingCard |
| `consent-gate.tsx` | Client | Blocking modal for legal consent (terms, privacy, AI, authority) |
| `notification-center.tsx` | Client | Bell icon with unread count, polls every 60s |
| `proposal/section-editor.tsx` | Client | Tiptap rich text editor with auto-save, word count, status badges |
| `proposal/dissector-view.tsx` | Client | Drag-and-drop (dnd-kit) library-to-proposal section mapping |

### 2.4 Key Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `next` | 15.5.14 | App Router framework |
| `react` / `react-dom` | 19.2.4 | UI |
| `next-auth` | 5.0.0-beta.30 | Authentication |
| `postgres` (postgres.js) | 3.4.3 | Primary DB client (camelCase transform) |
| `pg` (node-postgres) | 8.11.3 | Auth.js adapter pool |
| `@tiptap/*` | 3.20.6 | Rich text editing |
| `@dnd-kit/*` | 6.3/10.0 | Drag & drop |
| `recharts` | 2.15.4 | Dashboard charts |
| `googleapis` | 171.4.0 | Google Drive integration |
| `lucide-react` | 0.577.0 | Icons |

### 2.5 Styling

- **Tailwind CSS 3.4** with custom `brand` (blue), `navy` (dark blue), `surface` (gray), `accent` color scales
- **11 custom animations** (fade-in, slide-up, shimmer, gradient-x, particle-float, etc.)
- **Custom shadows** (glow, card, elevated) and background patterns (hero-mesh, grid, dot)
- **Font:** Inter via `next/font/google`

---

## 3. Pipeline Architecture

### 3.1 How It Runs

The pipeline is a **long-running async Python process** with two entry points:

1. **`main.py`** — Cron ticker + job dequeue loop
   - Reads `pipeline_schedules` every 60s, inserts due `pipeline_jobs`
   - Dequeues jobs via atomic `dequeue_job()` Postgres function
   - Listens on Postgres `NOTIFY pipeline_worker` for immediate dispatch

2. **`workers/runner.py`** — Event-driven worker process
   - Listens on `opportunity_events` and `customer_events` NOTIFY channels
   - Dispatches to registered `BaseEventWorker` subclasses by namespace

### 3.2 Data Ingesters

| Ingester | Source | Auth | Schedule | Coverage |
|----------|--------|------|----------|----------|
| `SamGovIngester` | SAM.gov Opportunities API v2 | API key | Daily 5 AM UTC | DoD SBIR/STTR, BAAs, OTAs, contracts |
| `SbirGovSolicitationIngester` | SBIR.gov API | None | Daily 6 AM UTC | All SBIR/STTR solicitations per-topic |
| `SbirGovAwardIngester` | SBIR.gov API | None | Daily 6:30 AM UTC | Historical award data for competitive intel |
| `SbirGovCompanyIngester` | SBIR.gov API | None | Daily 7 AM UTC | SBIR company profiles for teaming |
| `GrantsGovIngester` | Grants.gov REST API | None | Daily 6 AM UTC | HHS/NIH, DOE, NSF, USDA, NASA, DOC grants |

All ingesters use **SHA-256 content hashing** (16 chars) for change detection and deduplication.

### 3.3 Scoring Engine

Scores every active opportunity against every active tenant profile. **100-point base + LLM adjustment:**

| Component | Max | Logic |
|-----------|-----|-------|
| Technology/Topic match | 30 | research_areas + technology_focus vs opp content |
| NAICS match | 15 | Primary NAICS = 15, secondary = 10 |
| Agency alignment | 15 | target_agencies + past SBIR award history |
| Program type fit | 15 | SBIR/STTR = 12-15, BAA/OTA = 8, challenge = 5 |
| Set-aside eligibility | 10 | Exact match (SDVOSB, WOSB, HUBZone, 8a) |
| Timeline urgency | 10 | <=7 days = 10, <=14 = 7, <=30 = 4 |
| TRL alignment | 5 | Tenant TRL vs expected for program phase |
| LLM adjustment | +/-15 | Claude analysis for scores >= 50 |

Also scores **SpotLight buckets** (saved searches per tenant) via the `spotlight_scores` table.

### 3.4 Event-Driven Workers

| Namespace | Worker | Trigger | Action |
|-----------|--------|---------|--------|
| `finder.ingest` | FinderOppIngestWorker | ingest.new/updated | Emit customer events for scored tenants |
| `finder.drive_archive` | FinderDriveArchiveWorker | ingest.new | Queue Drive sync for new opps |
| `finder.document_fetch` | DocumentFetcherWorker | ingest.document_added | Download pending documents |
| `reminder.deadline` | ReminderDeadlineWorker | deadline_acknowledged | 1/3/7 day deadline nudges |
| `reminder.amendment` | ReminderAmendmentWorker | ingest.updated | Alert tenants on amended opps |
| `email.trigger` | EmailTriggerWorker | reminder events | Immediate email delivery |
| `grinder.upload` | GrinderUploadWorker | library.upload_ingested | Decompose docs into library units via Claude |
| `embedder` | EmbedderEventWorker | library.atoms_extracted | Generate OpenAI embeddings |
| `rfp.parser` | RfpParserWorker | rfp.parsed | Extract structured RFP templates via Claude |
| `automation.*` | AutomationWorkers | 20+ event types | Evaluate rules, trigger actions |

### 3.5 Automation Engine

- 40+ seeded rules in `automation_rules` table (60s cache)
- Condition operators: `$gte`, `$lte`, `$gt`, `$lt`, `$eq`, `$ne`, `$contains_any`, `$first_occurrence`
- Actions: `emit_event`, `queue_notification`, `queue_job`, `log_only`
- Supports cooldown and rate limiting per rule

### 3.6 Tests

**153 tests across 4 files** — all pure-logic unit tests (no DB/HTTP mocking):
- `test_scoring.py` (~60) — All 7 scoring dimensions
- `test_sam_gov.py` (~20) — Date parsing, stub validation, content hashing
- `test_grants_gov.py` (~25) — Date/program type parsing, agency config
- `test_automation.py` (~48) — All condition operators, rule matching

---

## 4. Database Schema

### 4.1 Overview

- **34 migrations** (000a-000e baseline + 023-034 feature migrations)
- **52+ tables** with comprehensive FK relationships
- **pgvector** for semantic search on library content (1536-dim, HNSW index)
- **Full-text search** GIN index on opportunities
- **GIN indexes** on NAICS arrays and JSONB columns
- **Partial indexes** for hot queries (active opps, pending jobs, stale runs)

### 4.2 Core Table Groups

**Multi-Tenancy** — `tenants`, `tenant_profiles`, `team_invitations`, `users`

**Opportunities** — `opportunities`, `tenant_opportunities` (per-tenant scoring), `tenant_actions`, `documents`, `amendments`, `spotlight_scores`

**SBIR Intelligence** — `sbir_awards`, `sbir_companies`

**Proposal System (14 tables)** — `proposals` (Color Team stages: outline → pink → red → gold → submitted), `proposal_sections`, `proposal_section_history`, `proposal_section_units`, `proposal_personnel`, `proposal_exports`, `proposal_workspace_files`, `proposal_collaborators`, `proposal_stage_history`, `proposal_changes`, `proposal_reviews`, `proposal_comments`, `proposal_checklists`, `proposal_activity`, `proposal_notifications`, `proposal_purchases`

**Content Library** — `library_units` (vector embeddings), `library_unit_images`, `library_harvest_log`, `library_atom_outcomes`

**Knowledge Base** — `teaming_partners`, `past_performance`, `capabilities`, `key_personnel`, `boilerplate_sections`, `focus_areas` (SpotLight buckets)

**Templates** — `rfp_template_library`, `rfp_templates`, `master_templates` (6 agency templates seeded: DoD, NSF, NIH, DOE, NASA)

**Event Bus** — `opportunity_events`, `customer_events`, `content_events`

**Control Plane** — `system_config` (50+ keys), `api_key_registry` (AES-256-GCM), `pipeline_schedules` (15+), `pipeline_jobs`, `pipeline_runs`, `rate_limit_state`, `source_health`, `automation_rules` (40+), `automation_log`

**CMS & Legal** — `site_content`, `consent_records`, `legal_document_versions`

---

## 5. Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | Yes | JWT signing secret |
| `NEXTAUTH_URL` | Yes | App base URL |
| `SAM_GOV_API_KEY` | Yes | SAM.gov API (fallback; prefers encrypted DB value) |
| `ANTHROPIC_API_KEY` | Yes | Claude API for scoring + grinder |
| `API_KEY_ENCRYPTION_SECRET` | Yes | AES-256-GCM master key for DB-stored keys |
| `OPENAI_API_KEY` | Yes | OpenAI embeddings for library |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | For email | Base64 Google service account JSON |
| `GOOGLE_DELEGATED_ADMIN` | For email | Send-as email address |
| `STORAGE_ROOT` | No | Local file storage (default: `/data`) |
| `CLAUDE_MODEL` | No | Scoring model (default: `claude-sonnet-4-20250514`) |
| `USE_STUB_DATA` | No | Enable stub SAM.gov data for dev |

---

## 6. Known Issues & Technical Debt

### Database
1. **Missing `display_name` column on `source_health`** — Migrations 033/034 insert `display_name` but no migration adds the column
2. **Wrong column names in migration 027** — INSERT into `pipeline_schedules` uses non-existent columns
3. **Undefined `current_page_count` in view** — Migration 025 references column that doesn't exist
4. **Migration 028 not run in production** — SpotLight scoring gracefully skips but feature is disabled

### Pipeline
5. **Single DB connection** — `main.py` and event workers use one `asyncpg.Connection` (not a pool)
6. **No integration tests** — All 153 tests are pure-logic unit tests
7. **Hardcoded model in Grinder** — Uses `claude-haiku-4-5-20251001` while scoring uses configurable `CLAUDE_MODEL`
8. **Large inline stub data** — 9 SAM.gov stubs embedded in ingester could be externalized

### Frontend
9. **Unused dependency** — `@tanstack/react-query` in package.json but never imported
10. **No `loading.tsx` boundaries** — No Suspense loading states for server component navigation
11. **Duplicate DB pool** — `lib/auth.ts` and `lib/db.ts` both create connection pools (10 + 5 = 15 max)
12. **`db.ts` helpers lack internal try-catch** — `getTenantBySlug`, `verifyTenantAccess` let errors propagate

---

## 7. Immediate Path Forward

### P0: Production Readiness (blocking launch)

- [ ] **Run migration 028** in production — Enables SpotLight scoring, team invitations, seat limits
- [ ] **Fix migration column mismatches** (#1, #2, #3) — Create migration 035
- [ ] **Verify pipeline cron runs** — Confirm all 5 ingesters succeed and events flow after bug fixes
- [ ] **Configure production API keys** — SAM.gov, Anthropic, OpenAI, Google service account

### P1: Core Product (needed for $199/mo value)

- [ ] **Portal onboarding flow** — Guided profile setup (NAICS, research areas, target agencies, TRL)
- [ ] **SpotLight creation UX** — Create/manage saved search buckets from portal
- [ ] **Email notifications** — Deadline nudges, new high-match alerts, weekly digest
- [ ] **Stripe integration** — $199/mo subscription + per-proposal purchases ($999/$2,500)
- [ ] **Waitlist to trial conversion** — Self-service signup with 14-day trial

### P2: Proposal System (needed for $999/$2,500 builds)

- [ ] **Proposal creation flow** — Opportunity → template → proposal with section scaffolding
- [ ] **Library atomization** — Upload docs → Claude decomposition → embeddings → searchable library
- [ ] **Template delivery** — Admin creates from master_templates, delivers to tenant
- [ ] **Color Team review** — Stage gates (pink → red → gold → submitted) with checklists

### P3: Growth & Polish

- [ ] **`loading.tsx` boundaries** — Suspense states for all server routes
- [ ] **Adopt or remove TanStack Query** — Currently unused
- [ ] **Connection pooling** — Move pipeline to asyncpg Pool
- [ ] **Integration tests** — DB-backed tests for ingesters, scoring, workers
- [ ] **SEO** — Happenings content, sitemap.xml, structured data
- [ ] **Analytics** — Conversion tracking on marketing pages

### P4: Competitive Moat

- [ ] **Win/loss feedback loop** — Library atom outcomes (schema ready in migration 027)
- [ ] **Semantic search** — Vector similarity for library (pgvector + HNSW ready)
- [ ] **Multi-tenant benchmarking** — Aggregate win rates by agency/program
- [ ] **STTR partner matching** — sbir_companies data for teaming suggestions
