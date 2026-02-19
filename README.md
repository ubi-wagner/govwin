# GovTech Intel v3 🎯

**Multi-Tenant Government Opportunity Intelligence Platform**
Next.js 14 · NextAuth.js · TypeScript · Postgres · Python Pipeline

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  MASTER ADMIN (you)                                         │
│  ├── Manages the platform                                   │
│  ├── Creates + curates tenant accounts                      │
│  ├── Controls all scoring configs per tenant                │
│  ├── Creates download links for tenants                     │
│  └── IS ALSO a tenant (Customer #1)                        │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  TENANTS (your customers)                                   │
│  ├── See their scored opportunity pipeline                  │
│  ├── Thumbs up/down, comment, pin, change pursuit status    │
│  ├── Upload capability docs, cut sheets, past performance   │
│  ├── Download admin-curated links and resources             │
│  └── Eventually: edit their own profile (feature flag)     │
└──────────────────────────┬──────────────────────────────────┘
                           │ All meet at Postgres
┌──────────────────────────▼──────────────────────────────────┐
│  PostgreSQL 16 + pgvector                                   │
│                                                             │
│  TENANT TABLES:    tenants, tenant_profiles,                │
│                    tenant_opportunities (scored per tenant)  │
│                    tenant_actions (reactions + comments)    │
│                    tenant_uploads, download_links           │
│                                                             │
│  GLOBAL TABLES:    opportunities (one record per source ID) │
│                    documents, amendments                    │
│                                                             │
│  AUTH TABLES:      users, sessions, accounts (NextAuth.js)  │
│                                                             │
│  CONTROL TABLES:   pipeline_jobs, pipeline_schedules,       │
│                    system_config, feature_flags             │
│                    rate_limit_state, api_key_registry        │
│                                                             │
│  FUNCTIONS:        dequeue_job() — atomic queue pickup      │
│                    get_system_status() — dashboard snapshot │
│                    get_remaining_quota() — rate limiting    │
│                                                             │
│  TRIGGERS:         NOTIFY pipeline_worker on job insert     │
│                    set_updated_at() on all tables           │
│                                                             │
│  VIEWS:            tenant_pipeline — main portal query      │
│                    tenant_analytics — per-tenant stats      │
│                    opportunity_tenant_coverage — admin view │
└──────────────────────────┬──────────────────────────────────┘
           ┌───────────────┴───────────────┐
           │                               │
┌──────────▼───────────┐      ┌────────────▼──────────────────┐
│  Next.js 14           │      │  Python Pipeline Worker        │
│  App Router + TS      │      │  (standalone process)          │
│                       │      │                                │
│  (admin)/ routes      │      │  LISTEN pipeline_worker        │
│  (portal)/[slug]/     │      │  → dequeue_job()               │
│  (auth)/login         │      │  → collect + score + analyze   │
│                       │      │  → write tenant_opportunities  │
│  API routes:          │      │  → write pipeline_runs         │
│  /api/opportunities   │      │  → update source_health        │
│  /api/pipeline        │      │  → update rate_limit_state     │
│  /api/tenants/[id]    │      │                                │
│  /api/system          │      │  No HTTP server needed.        │
└───────────────────────┘      └────────────────────────────────┘
```

---

## Multi-Tenant Design

### Opportunity Scoring is Per-Tenant
One canonical `opportunities` table shared globally.
The `tenant_opportunities` table is the join point — each opportunity is
scored against each tenant's specific profile (NAICS, keywords, agency
priorities). A single opportunity can appear in 4 tenants' pipelines with
scores of 91, 45, 67, and 12 depending on their company profile.

**Amendment update propagates instantly:** update one `opportunities` row →
all `tenant_pipeline` views reflect it immediately. No per-tenant copies.

### Feedback Loop
Every `tenant_actions` row (thumbs up/down, comment, status change) stores
the score, agency, and opportunity type at time of action. This is the data
that will eventually tune the scoring model per tenant:

```sql
-- Future: "tenant X consistently thumbs-down Army opps"
SELECT agency_at_action, COUNT(*) 
FROM tenant_actions 
WHERE tenant_id = $1 AND action_type = 'thumbs_down'
GROUP BY agency_at_action ORDER BY COUNT(*) DESC;
```

### Admin as Tenant
You have `role = 'master_admin'` AND a tenant row for your own company.
- Hit `/admin/...` to manage the platform
- Hit `/portal/my-company/...` to see your own opportunity feed
- Same code, different route group, different layout

### Progressive Self-Service
All tenant profile fields (NAICS, keywords, set-asides) live in Postgres
from day 1, marked `updated_by = 'admin'`. When you're ready to hand
control to tenants, flip `feature_flags.tenant_self_service = true`. The
portal profile page switches from read-only to editable with one flag.

---

## Route Structure

```
/login                          → Auth (NextAuth.js)
/admin/dashboard                → Cross-tenant overview + source health
/admin/tenants                  → Tenant list + create
/admin/tenants/[id]             → Tenant detail + profile + users
/admin/pipeline                 → Job queue + run history
/admin/sources                  → API source config + key management
/admin/scoring                  → Global scoring weights + thresholds

/portal/[tenantSlug]/dashboard  → Tenant opportunity feed
/portal/[tenantSlug]/pipeline   → Full filterable scored list
/portal/[tenantSlug]/documents  → Admin-curated download links
/portal/[tenantSlug]/uploads    → Tenant file uploads
/portal/[tenantSlug]/profile    → Company profile (read-only → self-service)
```

---

## Auth Flow

**Admin creates a tenant user:**
```
POST /api/tenants/[id]/users { name, email, role }
→ INSERT INTO users (temp_password = true)
→ bcrypt hash of generated temp password
→ TODO: send via Resend email (currently returned in API for dev)
→ User logs in, forced to set new password
```

**Tenant login:**
```
/login → NextAuth Credentials provider
→ bcrypt.compare(password, hash)
→ Session stored in Postgres sessions table
→ Session includes: id, email, role, tenantId
→ Middleware reads role → routes to /admin or /portal/[slug]
```

**Magic link (alternative):**
```
/login → enter email → NextAuth Resend provider
→ email sent with time-limited link
→ click → session created → redirect to appropriate home
```

---

## Database Key Decisions

### Why global opportunities + per-tenant scoring
- Amendment to one opportunity → all tenants see it instantly
- No duplicate storage of 10KB+ opportunity records × N tenants
- Score recalculation when tenant profile changes is per-tenant only

### Tenant actions as feedback signal
```sql
-- tenant_actions stores context at time of action
score_at_action    NUMERIC   -- what was the score when they reacted?
agency_at_action   TEXT      -- which agency?
type_at_action     TEXT      -- what type of opp?
```
This enables future ML-based scoring tuning per tenant.

### download_links as first-class entity
Not just URLs. Each link has:
- `link_type` — resource | template | guidance | opportunity_doc
- `opportunity_id` — optional link to specific opportunity
- `expires_at` — time-limited if needed
- `access_count` — you know what's being used
- `created_by` — audit trail

---

## Getting Started

```bash
# Clone
git clone <repo> && cd govtech-intel-v3
cp .env.example .env
# Fill: POSTGRES_PASSWORD, AUTH_SECRET (openssl rand -base64 32),
#       SAM_GOV_API_KEY, ANTHROPIC_API_KEY, AUTH_RESEND_KEY

# Start
docker compose up -d

# Migrate
export DATABASE_URL=postgresql://govtech:yourpassword@localhost:5432/govtech_intel
./db/migrations/run.sh

# Seed admin user + your tenant
cd frontend && npm install && npx tsx scripts/seed_admin.ts

# Dev
npm run dev  # → http://localhost:3000
# → Redirects to /login
# → Log in as admin → /admin/dashboard
# → Create your first real tenant from admin panel
# → Create tenant user → they get login credentials
# → They hit /portal/[slug]/dashboard
```

---

## Implementation Order

**Week 1 — Database + Auth**
1. Run all 4 migrations
2. `lib/auth.ts` — NextAuth config + session callbacks
3. `middleware.ts` — route protection
4. `app/(auth)/login/page.tsx` — login page
5. `scripts/seed_admin.ts` — create first admin + tenant
6. `app/(admin)/layout.tsx` — admin shell

**Week 2 — Admin Core**
7. `app/api/tenants/route.ts` — CRUD
8. `app/api/tenants/[id]/users/route.ts` — user creation
9. `app/(admin)/tenants/page.tsx` — tenant list
10. `app/(admin)/dashboard/page.tsx` — platform overview

**Week 3 — Pipeline**
11. `lib/db.ts` + `pipeline/src/storage/`
12. `pipeline/src/ingest/sam_gov.py`
13. `pipeline/src/main.py` — LISTEN loop
14. `app/api/pipeline/route.ts`
15. `app/(admin)/pipeline/page.tsx`

**Week 4 — Portal**
16. `app/(portal)/[tenantSlug]/layout.tsx` — portal shell
17. `app/(portal)/[tenantSlug]/dashboard/page.tsx`
18. `app/(portal)/[tenantSlug]/pipeline/page.tsx` (full filter + reactions)
19. `app/api/opportunities/[opportunityId]/actions/route.ts`
20. `app/(portal)/[tenantSlug]/documents/page.tsx`
21. `app/(portal)/[tenantSlug]/uploads/page.tsx`

---

## Environment Variables

| Variable | Used By | Notes |
|---|---|---|
| `DATABASE_URL` | Both | Postgres connection string |
| `AUTH_SECRET` | Frontend | `openssl rand -base64 32` |
| `AUTH_RESEND_KEY` | Frontend | Magic link emails |
| `SAM_GOV_API_KEY` | Pipeline | Expires every 90 days |
| `ANTHROPIC_API_KEY` | Pipeline | Claude analysis |
| `EMAIL_FROM` | Frontend | From address for magic links |

---

## Phase 3 — Customer Portal Enhancements

These are designed for but not yet built:
- **Self-service profile editing** (flip `feature_flags.tenant_self_service`)
- **In-app commenting threads** on opportunities
- **Proposal workspace** — gap analysis against their KB
- **Team management** — tenant admins add their own users
- **Notification preferences** — tenants configure their own digest schedule
