# HITL Test Quick-Start Guide

**Last updated:** 2026-07-15
**Full test plan:** [HITL_TEST_PLAN_V2.md](./archive/HITL_TEST_PLAN_V2.md)

> **Current canonical end-to-end.** The up-to-date single-operator HITL script is
> [`ALPHA_HITL_RUNBOOK.md`](./ALPHA_HITL_RUNBOOK.md) + [`HITL_IMMOBILEYES_CLICKPLAN.md`](./HITL_IMMOBILEYES_CLICKPLAN.md)
> -- the **comp-code purchase → curation → release → V0→V1** loop over the opportunity-**card** spine
> (design: [`MASTER_MIRROR_OPP_DESIGN.md`](./MASTER_MIRROR_OPP_DESIGN.md)). This quick-start's setup is
> current; where its later steps say Spotlight/pipeline/Stripe, defer to the runbook + click-plan.

---

## 1. Prerequisites

| Component | Version | Check |
|-----------|---------|-------|
| Node.js | 20+ | `node --version` |
| Python | 3.12+ | `python3 --version` |
| PostgreSQL | 15+ | `psql --version` |
| AWS CLI | 2.x | `aws --version` |
| Browser | Chrome 120+ or Firefox 120+ | DevTools available |

## 2. Environment Variables

Copy to `frontend/.env.local`:

```
DATABASE_URL=postgresql://...
AUTH_SECRET=...
NEXTAUTH_SECRET=...                              # = AUTH_SECRET
AUTH_URL=http://localhost:3000
NEXTAUTH_URL=http://localhost:3000               # = AUTH_URL
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
AWS_S3_BUCKET_NAME=rfp-pipeline-prod-r8t7tr6     # absence 500s any storage route at import
ANTHROPIC_API_KEY=...
FOUNDING_COHORT_BYPASS=true                      # gates only the LEGACY direct proposals/create path
RESEND_API_KEY=...
```

> **Purchase model.** The founding cohort now buys via the **comp code `rfppipelinetest`** (a $0
> recorded purchase → `curation_pending` → admin release), not `FOUNDING_COHORT_BYPASS`. The bypass
> flag only governs the older `POST /api/portal/[slug]/proposals/create` path. See
> [`HITL_IMMOBILEYES_CLICKPLAN.md`](./HITL_IMMOBILEYES_CLICKPLAN.md).

## 3. Seed the Database

Apply **all migrations through 108**, then seed dev accounts:

```bash
# Apply migrations (tracked in _migration_history)
node db/migrations/migrate.mjs

# Verify high-water mark
psql "$DATABASE_URL" -c "SELECT max(filename) FROM _migration_history;"
# Should return 108_patch_live_marketing_content.sql (or later)

# Seed dev accounts (2 tenants + admins; idempotent)
SEED_DEV_ACCOUNTS=true node scripts/seed_dev_accounts.mjs
# Optional: sync marketing pages from code
SEED_PAGE_CONTENT=true node scripts/seed_page_content.mjs
```

The `rfppipelinetest` comp code is seeded by migration 105 (`promo_codes`).

## 4. Test Accounts

Created by `scripts/seed_dev_accounts.mjs` (grinder tier — nothing feature-gated):

```
+----------------+-----------------------+----------------------------------+------------+
| Role           | Email                 | Password (env override)          | Tenant     |
+----------------+-----------------------+----------------------------------+------------+
| master_admin   | eric@rfppipeline.com  | RFPAdmin2026!   ($RFP_ADMIN_PW)   | System     |
| tenant_admin   | eric@ubihere.com      | UbihereAdmin    ($UBIHERE_PW)     | Ubihere    |
| tenant_admin   | eric@lighthouse.com   | LighthouseAdmin ($LIGHTHOUSE_PW)  | Lighthouse |
+----------------+-----------------------+----------------------------------+------------+
```

**Legacy demo fixtures** (migration-seeded; removed by `PURGE_DEMO=1`): the `apex-defense` tenant
(`admin@apexdefense.test`, `james@apexdefense.test`) + `partner@techalliance.test`.
**All passwords will be changed before production launch.**

## 5. Start the Application

```bash
# Terminal 1: Frontend
cd frontend && npm run dev

# Terminal 2: Pipeline (needed for Sessions 2 and 5)
cd pipeline && python -m src.main
```

## 6. Browser Setup

- **Window A:** Admin session (master_admin login)
- **Window B:** Incognito/private (customer and public testing)
- DevTools Console open in both windows

## 7. Test Sessions at a Glance

| Session | Focus | Time | Key Login |
|---------|-------|------|-----------|
| 1 | Admin Foundation | 45 min | master_admin |
| 2 | Source Scout + RFP Ingestion | 60 min | master_admin |
| 3 | Customer Onboarding + Spotlight | 45 min | tenant_admin (admin@apexdefense.test) |
| 4 | Proposal Purchase (comp code) + Workspace | 90 min | tenant_admin, tenant_user, partner_user |
| 5 | Pipeline + Workflow Monitoring | 30 min | master_admin |
| 6 | Edge Cases + Error Handling | 30 min | All roles + unauthenticated |
| 7 | CMS Content Pipeline | 45 min | master_admin |
| **Total** | | **~6 hours** | |

Sessions are ordered by dependency (1-6 must be sequential). Session 7 can run independently.

## 8. Quick Smoke Test (15 min)

If you only have 15 minutes, run these critical-path tests:

1. **Login:** Navigate to `/login`, sign in as master_admin (eric@rfppipeline.com / RFPAdmin2026!)
2. **Admin Dashboard:** Verify `/admin/dashboard` renders 8 stat cards
3. **Customer Login:** In incognito, sign in as tenant_admin (eric@ubihere.com / UbihereAdmin)
4. **Portal Dashboard:** Verify `/portal/ubihere/dashboard` renders with company name
5. **Cards:** Navigate to `/portal/ubihere/cards`, verify the opportunity-card feed loads (`/spotlights` redirects here)
6. **CMS:** Navigate to `/admin/site`, verify content manager loads
7. **Public Site:** Navigate to `/`, verify homepage renders
8. **Auth Guard:** In incognito (logged out), navigate to `/admin/dashboard` -- verify redirect to `/login`

## 9. Reporting Results

Use the results template in the full test plan. For each test:

```
Test {session}.{number}: {name}
Status: PASS / FAIL / BLOCKED / SKIPPED
Notes: {observations}
Defect: {defect ID if FAIL}
```

## 10. Common Issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Login fails for seeded accounts | Migrations not applied or dev seed not run | Apply migrations to 108, then `SEED_DEV_ACCOUNTS=true node scripts/seed_dev_accounts.mjs` |
| Dashboard shows "unavailable" | DATABASE_URL not set or wrong | Check `frontend/.env.local` |
| AI features fail | ANTHROPIC_API_KEY not set | Add key to env (optional for non-AI tests) |
| S3 uploads fail | AWS credentials not set | Add AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY |
| Purchase/portal not opening | Comp code not seeded | Verify `promo_codes` has `rfppipelinetest` (migration 105); buy via the comp code, not `FOUNDING_COHORT_BYPASS` (that flag only affects the legacy direct-create path) |
| Portal shows wrong tenant | Slug mismatch | Use `ubihere` or `lighthouse` for the seeded dev tenants |
| Blog post not visible after publish | ISR cache delay | Wait up to 60s, or restart dev server |
