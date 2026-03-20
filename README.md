# GovWin

**Multi-Tenant Government Opportunity Intelligence Platform**

GovWin is a B2B SaaS platform that ingests federal contract opportunities from SAM.gov, scores them against each customer's company profile using a multi-factor algorithm enhanced by Claude AI analysis, and surfaces a ranked, actionable pipeline through a tenant-isolated web portal. A master admin operates the platform, onboards customer companies (tenants), configures their scoring profiles, and monitors data pipeline health — while each tenant gets a private portal showing only the opportunities relevant to their NAICS codes, keywords, set-aside qualifications, and agency priorities.

---

## Technical Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | Next.js 14 (App Router), TypeScript, Tailwind CSS | Admin console + tenant portal |
| **Auth** | NextAuth.js v5 (Auth.js), JWT + Credentials provider | Role-based access with tenant isolation |
| **Database** | PostgreSQL 16 + pgvector, postgres.js | Schema, views, job queue, rate limiting |
| **Pipeline** | Python 3, asyncpg, asyncio | SAM.gov ingestion, scoring engine |
| **AI** | Anthropic Claude API | LLM analysis for high-scoring opportunities |
| **Deployment** | Docker Compose (local), Railway (production) | Standalone builds, Dockerfile per service |
| **Testing** | Vitest (unit + integration), Playwright (E2E), pytest (pipeline) | 3-layer test suite with 1-touch runner |

---

## Architecture

```
                         ┌──────────────────────────────┐
                         │         PostgreSQL 16         │
                         │     (single source of truth)  │
                         └──────────┬───────────────────┘
                    ┌───────────────┼───────────────┐
                    │               │               │
             ┌──────▼──────┐ ┌─────▼──────┐ ┌──────▼──────┐
             │  Next.js 14  │ │  Pipeline   │ │  LISTEN /   │
             │  Frontend    │ │  Worker     │ │  NOTIFY     │
             │              │ │  (Python)   │ │  (PG-native)│
             │  Admin UI    │ │             │ └─────────────┘
             │  Portal UI   │ │  SAM.gov    │
             │  API Routes  │ │  Ingester   │
             │  Middleware   │ │  Scoring    │
             │              │ │  Engine     │
             │  :3000       │ │  Claude LLM │
             └──────────────┘ └─────────────┘
```

### Key Design Decisions

- **Global opportunities, per-tenant scoring** — One canonical `opportunities` record per SAM.gov notice. The `tenant_opportunities` junction table scores each opportunity against each tenant's profile independently. An amendment update propagates to all tenants instantly with zero duplication.

- **Postgres as control plane** — Job queue (`pipeline_jobs`), scheduling (`pipeline_schedules`), rate limiting (`rate_limit_state`), feature flags (`system_config`), and health monitoring (`source_health`) all live in Postgres. No Redis, no external queue. The pipeline worker uses `LISTEN/NOTIFY` + `FOR UPDATE SKIP LOCKED` for atomic job pickup.

- **Middleware-first security** — Next.js middleware enforces route protection before any page renders. API routes apply a second layer of tenant isolation via `verifyTenantAccess()`. The `tenant_pipeline` view is the only way tenant data reaches the portal — it's scoped by `tenant_id` at the SQL level.

---

## Database Schema

### Migrations

| # | File | Purpose |
|---|------|---------|
| 001 | `auth_tenants.sql` | Auth tables (NextAuth), tenants, users, tenant_profiles, download_links, uploads, audit_log |
| 002 | `control_plane.sql` | system_config, pipeline_jobs/runs/schedules, rate_limit_state, source_health, notifications_queue |
| 003 | `opportunities.sql` | opportunities, tenant_opportunities, tenant_actions, documents, amendments, views |
| 004 | `knowledge_base.sql` | past_performance, capabilities, key_personnel, boilerplate_sections (Phase 2) |
| 005 | `seed_test_data.sql` | Test personas, tenants, opportunities, scores, actions for development |

### Core Tables

```
TENANTS & AUTH                     OPPORTUNITIES (GLOBAL)
─────────────────                  ────────────────────────
tenants                            opportunities
  id, slug, name, plan, status       id, source, source_id, title
  uei_number, cage_code              description, agency, agency_code
  features (JSONB)                   naics_codes[], set_aside_type
                                     opportunity_type, posted_date
tenant_profiles                      close_date, estimated_value_min/max
  primary_naics[], secondary_naics[] solicitation_number, content_hash
  keyword_domains (JSONB)            raw_data (JSONB), status
  is_small_business, is_sdvosb,
  is_wosb, is_hubzone, is_8a      documents
  agency_priorities (JSONB)          opportunity_id, filename, url
  min_surface_score,                 download_status, document_type
  high_priority_score
                                   amendments
users                                opportunity_id, change_type
  id, email, role, tenant_id         old_value, new_value
  password_hash, is_active

PER-TENANT SCORING                 CONTROL PLANE
──────────────────                 ─────────────
tenant_opportunities               pipeline_jobs
  tenant_id, opportunity_id          source, run_type, status
  total_score (0-100)                triggered_by, result (JSONB)
  naics/keyword/set_aside/
  agency/type/timeline_score       pipeline_schedules
  llm_adjustment, llm_rationale     source, cron_expression, enabled
  matched_keywords[], domains[]
  pursuit_status, priority_tier    source_health
  key_requirements[]                 source, status, consecutive_failures
  competitive_risks[]
                                   rate_limit_state
tenant_actions                       source, requests_today, daily_limit
  tenant_id, opportunity_id,
  user_id, action_type             system_config
  value, score_at_action             key (TEXT), value (JSONB)
```

### Views

| View | Purpose |
|------|---------|
| `tenant_pipeline` | Main portal query — joins opportunities + tenant scores + reactions + deadline status |
| `tenant_analytics` | Per-tenant summary stats (counts, averages, trends) |
| `opportunity_tenant_coverage` | Admin view — how many tenants see each opportunity |
| `tenant_opportunity_reactions` | Aggregated thumbs/comments/pins per tenant per opp |
| `api_key_status` | API key expiry status with days-until-expiry calculation |

### Functions & Triggers

| Function | Purpose |
|----------|---------|
| `dequeue_job(worker_id)` | Atomic job pickup with `FOR UPDATE SKIP LOCKED` |
| `get_system_status()` | Single call returns full admin dashboard snapshot |
| `get_remaining_quota(source)` | Rate limit check with auto-reset on window rollover |
| `notify_pipeline_worker()` | Trigger: `NOTIFY` on `pipeline_jobs` INSERT |
| `set_updated_at()` | Trigger: auto-update `updated_at` on all tables |

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

LLM analysis (when triggered) returns: score adjustment, rationale, key requirements, competitive risks, and questions for RFI — all stored in `tenant_opportunities`.

---

## Services

### Frontend (Next.js 14)

#### Route Structure

```
PUBLIC
  /login                              Email/password login (NextAuth Credentials)

ADMIN (master_admin only)
  /admin/dashboard                    System overview, source health, tenant stats
  /admin/tenants                      Tenant list with plan/status/user counts
  /admin/tenants/[tenantId]           Tenant detail: profile, users, scores
  /admin/pipeline                     Job queue, run history, trigger jobs
  /admin/sources                      API source config, key management, schedules

PORTAL (tenant users + master_admin)
  /portal                             Router: redirects to tenant's dashboard
  /portal/[tenantSlug]/dashboard      Scored opportunity feed, summary stats
  /portal/[tenantSlug]/pipeline       Full filterable/sortable scored pipeline
  /portal/[tenantSlug]/profile        Company profile (read-only, future: self-service)
  /portal/[tenantSlug]/documents      Admin-curated download links and resources
```

#### API Routes

| Route | Methods | Auth | Purpose |
|-------|---------|------|---------|
| `/api/health` | GET | Public | Health check |
| `/api/auth/[...nextauth]` | GET, POST | Public | NextAuth handlers |
| `/api/opportunities` | GET | Tenant+ | Filtered, paginated tenant pipeline |
| `/api/opportunities/[id]/actions` | GET, POST | Tenant+ | Thumbs, comments, pins, status changes |
| `/api/tenants` | GET, POST | Admin | List/create tenants |
| `/api/tenants/[id]` | GET, PUT | Admin | Tenant detail/update |
| `/api/tenants/[id]/users` | GET, POST | Admin | List/create tenant users |
| `/api/pipeline` | GET, POST | Admin | List jobs / trigger new job |
| `/api/pipeline/schedules` | GET, PUT | Admin | View/update cron schedules |
| `/api/system` | GET | Admin | `get_system_status()` snapshot |
| `/api/portal/[slug]/profile` | GET | Tenant | Tenant profile for portal display |
| `/api/portal/[slug]/documents` | GET | Tenant | Download links for tenant |

#### Middleware

Route protection enforced before rendering:
- `/login` — public (redirects authenticated users to their home)
- `/admin/**` — `master_admin` only
- `/portal/[slug]/**` — tenant users matching slug, or `master_admin`
- `/**` — authenticated users only
- API routes excluded from middleware; enforce auth independently

#### Auth Flow

1. Admin creates a tenant user via `POST /api/tenants/[id]/users`
2. User receives credentials (temp password, email pending Resend integration)
3. User logs in at `/login` → NextAuth Credentials provider → bcrypt verify
4. JWT issued with `{ id, role, tenantId, tempPassword }`
5. Middleware routes to `/admin/dashboard` or `/portal/[slug]/dashboard`
6. Session includes role + tenantId; every API call verifies tenant access

### Pipeline Worker (Python)

Standalone process — no HTTP server. Communicates via PostgreSQL only.

```
main.py
  ├── LISTEN pipeline_worker (PG channel)
  ├── dequeue_job() — atomic pickup
  ├── Execute based on source + run_type
  ├── Write pipeline_runs + update source_health
  └── Graceful shutdown on SIGTERM

ingest/sam_gov.py
  ├── Fetch from SAM.gov public API (paginated, rate-limited)
  ├── Content-hash deduplication (SHA256)
  ├── Upsert opportunities + detect amendments
  └── Stub mode for development (USE_STUB_DATA=true)

scoring/engine.py
  ├── Load all active tenant profiles
  ├── Score each opportunity against each profile
  ├── 6-factor deterministic scoring (0-100)
  ├── Claude LLM analysis for scores >= 50
  └── Upsert tenant_opportunities with full breakdown
```

---

## User Roles & Operations

### Master Admin

| Operation | Route/API | Description |
|-----------|-----------|-------------|
| View system status | `/admin/dashboard` | Tenant counts, pipeline health, source status |
| Manage tenants | `/admin/tenants` | Create, update plan/status, view profiles |
| Configure scoring | `/admin/tenants/[id]` | Set NAICS, keywords, set-asides, agency tiers |
| Create tenant users | `POST /api/tenants/[id]/users` | Assign role (tenant_admin / tenant_user) |
| Monitor pipeline | `/admin/pipeline` | View/trigger jobs, check run history |
| Manage sources | `/admin/sources` | API key status, schedule config, health |
| Access any portal | `/portal/[any-slug]/*` | View any tenant's pipeline as them |

### Tenant Admin

| Operation | Route/API | Description |
|-----------|-----------|-------------|
| View dashboard | `/portal/[slug]/dashboard` | Scored opportunities, summary stats |
| Browse pipeline | `/portal/[slug]/pipeline` | Filter by score, agency, type, status, search |
| React to opps | Actions API | Thumbs up/down, comment, pin, change pursuit status |
| View profile | `/portal/[slug]/profile` | Company profile (read-only; self-service planned) |
| Download resources | `/portal/[slug]/documents` | Admin-curated links and templates |

### Tenant User

Same as Tenant Admin except: cannot manage other users (future feature).

---

## Testing

### Test Architecture

Three layers, each independently runnable:

| Layer | Tool | What it tests | DB Required |
|-------|------|--------------|-------------|
| **Unit** | Vitest + pytest | Auth guards, middleware logic, scoring math, SAM.gov parser | No |
| **Integration** | Vitest + test DB | Schema integrity, query correctness, tenant isolation, auth flows | Yes (PostgreSQL) |
| **E2E** | Playwright | User journeys, cross-tenant access, UI flows | Yes + running server |

### Running Tests

```bash
# 1-touch: run everything available
./scripts/test-all.sh

# Unit tests only (no DB needed)
./scripts/test-all.sh --unit-only

# Include E2E tests (requires running server on :3099)
./scripts/test-all.sh --e2e

# CI mode (all layers)
./scripts/test-all.sh --ci
```

Or from `frontend/`:

```bash
npm test                   # All Vitest tests (unit + integration)
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests (needs test DB)
npm run test:e2e           # Playwright E2E (needs running server)
npm run test:all           # Full suite via shell script
```

Pipeline tests:

```bash
cd pipeline && python -m pytest tests/ -v
```

### Test Data

Migration `005_seed_test_data.sql` provides:

| Entity | Count | Details |
|--------|-------|---------|
| Tenants | 2 | TechForward Solutions (SDVOSB IT), ClearPath Consulting (8a mgmt) |
| Users | 4 | admin, alice (TF admin), bob (TF user), carol (CP admin) |
| Opportunities | 8 | 7 active + 1 closed; cloud, cyber, DevSecOps, PMO, training, data, presol |
| Scored opps | 8 | 6 for TechForward, 2 for ClearPath — different scores per profile |
| Actions | 6 | Thumbs up, comments, pins, status changes |
| Pipeline jobs | 4 | completed, failed, pending states |

All test users share password: `TestPass123!`

### Adding Tests for New Features

1. **Unit test** — add to `frontend/__tests__/` (pure logic, no DB)
2. **Integration test** — add to `frontend/__tests__/integration/` (uses `testSql` helper)
3. **E2E test** — add to `frontend/e2e/` (uses Playwright `login()` helper)

The test DB helper auto-runs all migrations + seed data, so new migrations are automatically covered.

---

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.10+
- PostgreSQL 16 (or Docker)

### Local Development

```bash
# 1. Clone and configure
git clone <repo> && cd govwin
cp .env.example .env
# Fill: POSTGRES_PASSWORD, AUTH_SECRET, SAM_GOV_API_KEY, ANTHROPIC_API_KEY

# 2. Start database
docker compose up -d db

# 3. Run migrations
export DATABASE_URL=postgresql://govtech:yourpassword@localhost:5432/govtech_intel
./db/migrations/run.sh

# 4. Seed admin user
cd frontend && npm install && npx tsx ../scripts/seed_admin.ts

# 5. Start frontend
npm run dev    # http://localhost:3000

# 6. Start pipeline worker (separate terminal)
cd pipeline && pip install -r requirements.txt
python src/main.py
```

### Docker (all services)

```bash
docker compose up -d
# Frontend: http://localhost:3000
# DB: localhost:5432
# Pipeline: runs as background worker
```

### First Steps After Setup

1. Log in as admin at `/login`
2. Visit `/admin/dashboard` — check system status
3. Create a tenant at `/admin/tenants`
4. Configure their scoring profile (NAICS, keywords, set-asides, agency priorities)
5. Create a tenant user for them
6. Trigger a SAM.gov ingest from `/admin/pipeline`
7. Scoring runs automatically after ingest
8. Tenant logs in → sees their scored pipeline at `/portal/[slug]/dashboard`

---

## Environment Variables

| Variable | Service | Required | Notes |
|----------|---------|----------|-------|
| `DATABASE_URL` | Both | Yes | PostgreSQL connection string |
| `AUTH_SECRET` | Frontend | Yes | `openssl rand -base64 32` |
| `AUTH_URL` | Frontend | Prod | Public URL (e.g. `https://app.govwin.com`) |
| `SAM_GOV_API_KEY` | Pipeline | Yes | From sam.gov profile; expires every 90 days |
| `ANTHROPIC_API_KEY` | Pipeline | No | Enables LLM analysis; scoring works without it |
| `CLAUDE_MODEL` | Pipeline | No | Default: `claude-sonnet-4-20250514` |
| `USE_STUB_DATA` | Pipeline | No | Set `true` for development without API key |
| `AUTH_RESEND_KEY` | Frontend | No | For magic link emails (Resend) |
| `EMAIL_FROM` | Frontend | No | From address for emails |

---

## Deployment (Railway)

The project is configured for Railway with:
- `railway.json` — Dockerfile builder, restart-on-failure policy
- `next.config.mjs` — `output: 'standalone'` for minimal builds
- `docker-compose.yml` — local development reference

Three Railway services:
1. **Frontend** — Next.js standalone, port 3000
2. **Pipeline** — Python worker, no port (background process)
3. **Database** — Railway Postgres plugin (auto-injects `DATABASE_URL`)

```bash
make railway-vars   # Print required environment variables per service
```

---

## Roadmap

**Currently implemented:**
- Multi-tenant auth with role-based routing
- Admin console (dashboard, tenant management, pipeline, sources)
- Tenant portal (dashboard, pipeline, profile, documents)
- SAM.gov ingestion with deduplication and amendment detection
- 6-factor scoring engine with Claude LLM enhancement
- Tenant actions (thumbs, comments, pins, status changes)
- Comprehensive test suite (unit, integration, E2E)

**Planned (Phase 2-3):**
- Self-service profile editing (`system_config.tenant_self_service` flag)
- Knowledge base: past performance, capabilities, key personnel (schema ready — migration 004)
- Proposal workspace with gap analysis against tenant KB
- Additional data sources: Grants.gov, SBIR, USASpending (schedules configured)
- Vector embeddings for semantic opportunity matching (pgvector extension loaded)
- Notification digests (notifications_queue table ready)
- Team management — tenant admins manage their own users
- Scoring model tuning from tenant action feedback signals
