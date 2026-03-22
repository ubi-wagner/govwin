# GovWin

**Multi-Tenant Government Opportunity Intelligence Platform**

GovWin is a B2B SaaS platform that ingests federal contract opportunities from SAM.gov, scores them against each customer's company profile using a multi-factor algorithm enhanced by Claude AI analysis, and surfaces a ranked, actionable pipeline through a tenant-isolated web portal.

A master admin operates the platform, onboards customer companies (tenants), configures their scoring profiles, and monitors data pipeline health — while each tenant gets a private portal showing only the opportunities relevant to their NAICS codes, keywords, set-aside qualifications, and agency priorities.

---

## Architecture

```
                         ┌──────────────────────────────┐
                         │         PostgreSQL 16         │
                         │  pgvector · pgcrypto · trgm   │
                         │   26 tables · 4 views · 7 fn  │
                         └──────────┬───────────────────┘
                    ┌───────────────┼───────────────┐
                    │               │               │
             ┌──────▼──────┐ ┌─────▼──────┐ ┌──────▼──────┐
             │  Next.js 14  │ │  Pipeline   │ │  Event      │
             │  Frontend    │ │  Worker     │ │  Workers    │
             │              │ │  (Python)   │ │  (Python)   │
             │  Admin UI    │ │             │ │             │
             │  Portal UI   │ │  SAM.gov    │ │  Finder     │
             │  API Routes  │ │  Ingester   │ │  Reminder   │
             │  Middleware   │ │  Scoring    │ │  (Binder)   │
             │              │ │  Engine     │ │  (Grinder)  │
             │  :3000       │ │  Claude LLM │ └─────────────┘
             └──────────────┘ └─────────────┘

      LISTEN/NOTIFY event bus ←→ pipeline_worker · opportunity_events · customer_events
```

### Key Design Decisions

- **Global opportunities, per-tenant scoring** — One canonical `opportunities` record per SAM.gov notice. The `tenant_opportunities` junction table scores each opportunity against each tenant's profile independently. An amendment update propagates to all tenants instantly.

- **Postgres as control plane** — Job queue, scheduling, rate limiting, feature flags, health monitoring, event bus, and encrypted API key storage all live in Postgres. No Redis, no external queue. `LISTEN/NOTIFY` for real-time event dispatch + `FOR UPDATE SKIP LOCKED` for atomic job pickup.

- **Event-driven architecture** — Append-only event tables (`opportunity_events`, `customer_events`) drive automation. Workers wake on NOTIFY, process events, and emit downstream events. Everything is auditable.

- **Middleware-first security** — Next.js middleware enforces route protection before any page renders. API routes apply a second layer via `verifyTenantAccess()`. The `tenant_pipeline` view scopes data at the SQL level.

- **Local-first storage** — Documents stored on Railway persistent volumes at `/data`. DB tracks metadata in `stored_files`. Designed for future R2 backup.

---

## Technical Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | Next.js 14 (App Router), TypeScript, Tailwind CSS | Admin console + tenant portal |
| **Auth** | NextAuth.js v5 (Auth.js), JWT + Credentials provider | Role-based access with tenant isolation |
| **Database** | PostgreSQL 16 + pgvector + pgcrypto | Schema, views, event bus, job queue, encrypted key store |
| **Pipeline** | Python 3, asyncpg, asyncio | SAM.gov ingestion, scoring engine, event workers |
| **AI** | Anthropic Claude API (claude-sonnet-4) | LLM analysis for high-scoring opportunities |
| **Storage** | Local filesystem (Railway volume at `/data`) | RFP documents, tenant files, proposal artifacts |
| **Encryption** | AES-256-GCM (Node.js crypto) | API keys encrypted at rest in DB |
| **Deployment** | Docker Compose (local), Railway (production) | Standalone builds, Dockerfile per service |
| **Testing** | Vitest (unit + integration), Playwright (E2E), pytest (pipeline) | 3-layer test suite |

---

## Product Tiers

```
                    ┌──────────┬──────────┬──────────┬──────────┐
                    │  FINDER  │ REMINDER │  BINDER  │ GRINDER  │
                    │  (base)  │ (tier 2) │ (tier 3) │ (tier 4) │
┌───────────────────┼──────────┼──────────┼──────────┼──────────┤
│ Opp Scoring       │    ✓     │    ✓     │    ✓     │    ✓     │
│ Search/Filter     │    ✓     │    ✓     │    ✓     │    ✓     │
│ Reactions         │    ✓     │    ✓     │    ✓     │    ✓     │
│ Pipeline Snapshot │    ✓     │    ✓     │    ✓     │    ✓     │
│ Curated Summaries │    ✓     │    ✓     │    ✓     │    ✓     │
├───────────────────┼──────────┼──────────┼──────────┼──────────┤
│ Deadline Nudges   │          │    ✓     │    ✓     │    ✓     │
│ Amendment Alerts  │          │    ✓     │    ✓     │    ✓     │
├───────────────────┼──────────┼──────────┼──────────┼──────────┤
│ Project Folders   │          │          │    ✓     │    ✓     │
│ Req Matrix        │          │          │    ✓     │    ✓     │
│ PWin Assessment   │          │          │    ✓     │    ✓     │
│ Company Profile   │          │          │    ✓     │    ✓     │
├───────────────────┼──────────┼──────────┼──────────┼──────────┤
│ AI Proposal Draft │          │          │          │    ✓     │
│ Compliance Matrix │          │          │          │    ✓     │
│ Exec Summary Gen  │          │          │          │    ✓     │
├───────────────────┼──────────┼──────────┼──────────┼──────────┤
│ Max Active Opps   │    10    │    10    │    10    │    10    │
│ (+10 per $99)     │    ✓     │    ✓     │    ✓     │    ✓     │
└───────────────────┴──────────┴──────────┴──────────┴──────────┘
```

---

## Scoring Engine

Opportunities are scored on a 0-100 scale with six deterministic factors plus an optional AI adjustment:

| Factor | Weight | Logic |
|--------|--------|-------|
| **NAICS match** | 0-25 | Primary NAICS = 25, secondary = 15, none = 0 |
| **Keyword match** | 0-25 | Domain-weighted: 3+ domains = 25, 2 = 18, 1 = 10 |
| **Set-aside match** | 0-15 | Exact (SDVOSB/WOSB/HUBZone/8a) = 15, partial SB = 8 |
| **Agency priority** | 0-15 | Tier 1 = 15, Tier 2 = 10, Tier 3 = 5 |
| **Opportunity type** | 0-10 | Solicitation = 10, sources sought = 5, presol = 3 |
| **Timeline urgency** | 0-10 | <=7 days = 10, <=14 = 7, <=30 = 4, >30 = 1 |
| **LLM adjustment** | -20 to +20 | Claude analysis for scores >= 50 (configurable) |

**Pursuit recommendation**: `pursue` (>= 75), `monitor` (>= min+10), `pass` (below threshold)

LLM analysis returns: score adjustment, rationale, key requirements, competitive risks, and questions for RFI — all stored in `tenant_opportunities`.

---

## Project Structure

```
govwin/
├── frontend/                    # Next.js 14 application
│   ├── app/
│   │   ├── (auth)/login/        # Login page
│   │   ├── admin/               # Master admin dashboard (client components)
│   │   │   ├── dashboard/       # System overview, health, stats
│   │   │   ├── tenants/         # Tenant management + scoring profiles
│   │   │   ├── pipeline/        # Job queue, run history, triggers
│   │   │   └── sources/         # API key management, schedules
│   │   ├── portal/              # Tenant portal (server layout, client pages)
│   │   │   └── [tenantSlug]/    # Per-tenant scoped views
│   │   │       ├── dashboard/   # Scored opportunity feed
│   │   │       ├── pipeline/    # Full filterable pipeline
│   │   │       ├── profile/     # Company profile
│   │   │       └── documents/   # Download links, resources
│   │   ├── api/                 # API routes (all server-side)
│   │   ├── error.tsx            # App error boundary
│   │   └── global-error.tsx     # Root error boundary
│   ├── lib/
│   │   ├── auth.ts              # NextAuth config, JWT, authorize()
│   │   ├── db.ts                # Database connections + helpers
│   │   ├── crypto.ts            # AES-256-GCM encryption for API keys
│   │   ├── storage.ts           # Local filesystem storage layer
│   │   └── google-drive.ts      # Google Drive integration (deferred)
│   ├── components/              # Shared UI components
│   └── types/index.ts           # Shared TypeScript types
├── pipeline/                    # Python data pipeline
│   └── src/
│       ├── main.py              # Job worker (LISTEN/NOTIFY)
│       ├── ingest/sam_gov.py    # SAM.gov ingestion + dedup
│       ├── scoring/engine.py    # 6-factor + LLM scoring
│       └── workers/runner.py    # Event-driven workers
├── db/
│   └── migrations/              # 13 SQL migrations (001-013)
├── scripts/
│   └── seed_admin.ts            # Admin account + first tenant seeder
├── docker-compose.yml           # Local dev: Postgres + Frontend + Pipeline
├── Makefile                     # Dev shortcuts
├── SETUP.md                     # Deployment & configuration guide
├── RAILWAY.md                   # Railway-specific deployment steps
├── ARCHITECTURE.md              # Full system architecture documentation
└── CLAUDE.md                    # Engineering standards (error handling, code quality)
```

---

## Database Schema

### Migrations (13 files, run in order)

| # | File | Purpose |
|---|------|---------|
| 001 | `auth_tenants.sql` | Auth tables, tenants, users, profiles, audit log |
| 002 | `control_plane.sql` | System config, job queue, schedules, API key registry, rate limits |
| 003 | `opportunities.sql` | Opportunities, tenant scoring, actions, documents, amendments, views |
| 004 | `knowledge_base.sql` | Past performance, capabilities, key personnel (Phase 2) |
| 005 | `seed_test_data.sql` | Test personas, tenants, opportunities, scores |
| 006 | `drive_files.sql` | Drive file tracking |
| 007 | `event_bus_and_drive_architecture.sql` | Event bus tables, NOTIFY channels, dequeue functions |
| 008 | `api_key_encryption.sql` | Encrypted API key storage columns |
| 009 | `local_storage.sql` | Filesystem storage migration (drive_files → stored_files) |
| 010 | `opportunity_full_metadata.sql` | Extended opportunity fields |
| 011 | `reminder_nudges_schedule.sql` | Reminder and nudge scheduling |
| 012 | `site_content.sql` | CMS / site content tables |
| 013 | `content_library.sql` | Content library for proposals |

### Core Tables

```
TENANTS & AUTH                     OPPORTUNITIES (GLOBAL)
─────────────────                  ────────────────────────
tenants                            opportunities
  id, slug, name, plan, status       id, source, source_id, title
  uei_number, cage_code              description, agency, naics_codes[]
  features (JSONB)                   set_aside_type, opportunity_type
                                     posted_date, close_date
tenant_profiles                      estimated_value_min/max
  primary_naics[], secondary_naics[] solicitation_number, content_hash
  keyword_domains (JSONB)            raw_data (JSONB), status
  set-aside qualifications
  agency_priorities (JSONB)        documents / amendments
  min_surface_score                  stored_files (storage_path, backend)

users                              EVENT BUS
  id, email, role, tenant_id       ────────────
  password_hash, is_active         opportunity_events (append-only)
                                   customer_events (append-only)

PER-TENANT SCORING                 CONTROL PLANE
──────────────────                 ─────────────
tenant_opportunities               pipeline_jobs / pipeline_runs
  total_score (0-100)              pipeline_schedules (cron)
  6 factor scores + llm_adjustment source_health / rate_limit_state
  pursuit_status, priority_tier    system_config (JSONB)
  matched_keywords[], domains[]    api_key_registry (encrypted)
  key_requirements[]               notifications_queue
  competitive_risks[]
```

### Views & Functions

| View | Purpose |
|------|---------|
| `tenant_pipeline` | Main portal query — joins opps + scores + reactions + deadlines |
| `tenant_analytics` | Per-tenant summary stats |
| `opportunity_tenant_coverage` | Cross-tenant opp overlap (admin) |
| `tenant_active_opps` | Cap enforcement — active count vs max |

| Function | Purpose |
|----------|---------|
| `dequeue_job(worker_id)` | Atomic job pickup (`FOR UPDATE SKIP LOCKED`) |
| `dequeue_opportunity_events()` | Atomic event pickup for opp workers |
| `dequeue_customer_events()` | Atomic event pickup for customer workers |
| `check_opp_cap(tenant_id)` | Active opp cap enforcement |
| `get_system_status()` | Admin dashboard snapshot |
| `get_remaining_quota(source)` | Rate limit check with auto-reset |

---

## API Routes

### Public
| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/health` | Health check |
| POST | `/api/auth/[...nextauth]` | Login |

### Master Admin Only
| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/system` | System status snapshot |
| GET/POST | `/api/pipeline` | List/trigger jobs |
| GET | `/api/pipeline/schedules` | Cron schedule config |
| GET/POST | `/api/tenants` | List/create tenants |
| GET/PATCH | `/api/tenants/[id]` | Tenant detail/update |
| POST | `/api/tenants/[id]/users` | Add tenant user |

### Tenant-Scoped
| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/opportunities` | Paginated scored pipeline |
| GET/POST | `/api/opportunities/[id]/actions` | Reactions (thumbs, comments, pins) |
| GET/PATCH | `/api/portal/[slug]/profile` | Tenant profile |
| GET | `/api/portal/[slug]/documents` | Opportunity documents |

---

## Scheduled Jobs

| Time (UTC) | Source | What It Does |
|------------|--------|-------------|
| 5:00 AM | `scoring` | Re-score all opps x all tenants |
| 6:00 AM | `sam_gov` | Fetch new/updated SAM.gov opportunities |
| 7:00 AM | `tenant_snapshots` | Refresh pipeline snapshots |
| 8:00 AM | `reminder_nudges` | Deadline nudges (7d/3d/1d) |
| Every 2h | `reminder_amendments` | Amendment alerts |
| Every 4h | `refresh` | Refresh open opportunity statuses |

---

## Getting Started

### Quick Start (Local)

```bash
git clone <repo> && cd govwin
cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD, AUTH_SECRET, API keys

make up          # Start Postgres via Docker
make migrate     # Run all migrations
make seed        # Create admin account
make dev         # http://localhost:3000
```

### Docker (All Services)

```bash
docker compose up -d
# Frontend: http://localhost:3000 · DB: localhost:5432 · Pipeline: background
```

### First Steps After Setup

1. Log in at `/login` with seed admin credentials
2. Visit `/admin/dashboard` — verify system health
3. Create a tenant at `/admin/tenants`
4. Configure their scoring profile (NAICS, keywords, set-asides, agency priorities)
5. Create a tenant user
6. Trigger SAM.gov ingest from `/admin/pipeline`
7. Scoring runs automatically after ingest
8. Tenant logs in → sees their scored pipeline at `/portal/[slug]/dashboard`

### Production Deployment

See **[SETUP.md](SETUP.md)** for complete Railway deployment instructions, API key configuration, persistent storage setup, and Gmail integration guide.

---

## Testing

```bash
# Everything
./scripts/test-all.sh

# Unit only (no DB)
./scripts/test-all.sh --unit-only

# Frontend
cd frontend && npm test              # All Vitest
cd frontend && npm run test:unit     # Unit only
cd frontend && npm run test:e2e      # Playwright E2E

# Pipeline
cd pipeline && python -m pytest tests/ -v
```

Test data (migration 005): 2 tenants, 4 users, 8 opportunities, scores, actions, pipeline jobs. All test users share password: `TestPass123!`

---

## Environment Variables

See **[.env.example](.env.example)** for the complete list. Key variables:

| Variable | Service | Required | Notes |
|----------|---------|----------|-------|
| `DATABASE_URL` | Both | Yes | PostgreSQL connection string |
| `AUTH_SECRET` | Frontend | Yes | `openssl rand -base64 32` |
| `AUTH_URL` | Frontend | Prod | Public URL of the app |
| `API_KEY_ENCRYPTION_SECRET` | Both | Yes | Encrypts API keys in DB |
| `STORAGE_ROOT` | Both | Yes | `/data` (Railway volume mount) |
| `SAM_GOV_API_KEY` | Pipeline | Yes | From sam.gov; expires every 90 days |
| `ANTHROPIC_API_KEY` | Pipeline | No | Enables LLM analysis; scoring works without it |
| `CLAUDE_MODEL` | Pipeline | No | Default: `claude-sonnet-4-20250514` |

---

## Documentation

| Document | Purpose |
|----------|---------|
| [SETUP.md](SETUP.md) | Deployment, API keys, storage, Gmail setup |
| [RAILWAY.md](RAILWAY.md) | Railway-specific deployment steps |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Full system architecture, data flows, event cascades |
| [CLAUDE.md](CLAUDE.md) | Engineering standards (error handling, code quality) |

---

## Roadmap

**Currently Implemented:**
- Multi-tenant auth with role-based routing and middleware security
- Admin console (dashboard, tenant management, pipeline, sources, API key management)
- Tenant portal (dashboard, pipeline, profile, documents)
- SAM.gov ingestion with deduplication and amendment detection
- 6-factor scoring engine with Claude LLM enhancement
- Event-driven automation (LISTEN/NOTIFY, append-only event bus)
- Tenant actions (thumbs, comments, pins, status changes)
- Encrypted API key storage with admin UI rotation
- Local filesystem storage with metadata tracking
- Deadline nudge and amendment alert workers
- Site content management and content library
- Comprehensive test suite (unit, integration, E2E)

**Planned:**
- Gmail email delivery (notification queue consumer)
- Self-service profile editing
- Knowledge base: past performance, capabilities, key personnel (schema ready)
- Proposal workspace with gap analysis (Binder/Grinder tiers)
- Additional data sources: Grants.gov, SBIR, USASpending (schedules configured)
- Vector embeddings for semantic opportunity matching (pgvector loaded)
- Scoring model tuning from tenant action feedback signals
