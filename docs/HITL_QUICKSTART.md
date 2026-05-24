# HITL Test Quick-Start Guide

**Last updated:** 2026-05-24
**Full test plan:** [HITL_TEST_PLAN_V2.md](./HITL_TEST_PLAN_V2.md)

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
NEXTAUTH_SECRET=...
NEXTAUTH_URL=http://localhost:3000
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
S3_BUCKET=rfp-pipeline-prod-r8t7tr6
ANTHROPIC_API_KEY=...
FOUNDING_COHORT_BYPASS=true
RESEND_API_KEY=...
```

## 3. Seed the Database

Ensure migrations through 047 are applied. Migration 041 seeds the test accounts:

```bash
# Verify migration status
psql $DATABASE_URL -c "SELECT MAX(version) FROM schema_migrations;"
# Should return >= 47
```

## 4. Test Accounts

```
+----------------+---------------------------+-------------------+----------+
| Role           | Email                     | Password          | Tenant   |
+----------------+---------------------------+-------------------+----------+
| master_admin   | eric.c.wagner@gmail.com   | TestAdmin2026!    | System   |
| rfp_admin      | (create via accept flow)  | (generated)       | System   |
| tenant_admin   | admin@apexdefense.test    | TestCustomer2026! | Apex     |
| tenant_user    | james@apexdefense.test    | TestEmployee2026! | Apex     |
| partner_user   | partner@techalliance.test | TestPartner2026!  | Apex     |
+----------------+---------------------------+-------------------+----------+
```

**Tenant:** Apex Defense Solutions (slug: `apex-defense`, tier: grinder)
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
| 4 | Proposal Purchase + Workspace | 90 min | tenant_admin, tenant_user, partner_user |
| 5 | Pipeline + Workflow Monitoring | 30 min | master_admin |
| 6 | Edge Cases + Error Handling | 30 min | All roles + unauthenticated |
| 7 | CMS Content Pipeline | 45 min | master_admin |
| **Total** | | **~6 hours** | |

Sessions are ordered by dependency (1-6 must be sequential). Session 7 can run independently.

## 8. Quick Smoke Test (15 min)

If you only have 15 minutes, run these critical-path tests:

1. **Login:** Navigate to `/login`, sign in as master_admin (eric.c.wagner@gmail.com / TestAdmin2026!)
2. **Admin Dashboard:** Verify `/admin/dashboard` renders 8 stat cards
3. **Customer Login:** In incognito, sign in as tenant_admin (admin@apexdefense.test / TestCustomer2026!)
4. **Portal Dashboard:** Verify `/portal/apex-defense/dashboard` renders with company name
5. **Profile:** Navigate to `/portal/apex-defense/profile`, verify profile editor loads with seeded NAICS/keywords
6. **CMS:** Navigate to `/admin/content`, verify content manager loads
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
| Login fails for seeded accounts | Migration 041 not applied | Run migrations through 047 |
| Dashboard shows "unavailable" | DATABASE_URL not set or wrong | Check `frontend/.env.local` |
| AI features fail | ANTHROPIC_API_KEY not set | Add key to env (optional for non-AI tests) |
| S3 uploads fail | AWS credentials not set | Add AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY |
| Proposal creation requires payment | FOUNDING_COHORT_BYPASS not set | Set `FOUNDING_COHORT_BYPASS=true` in env |
| Portal shows wrong tenant | Slug mismatch | Use `apex-defense` for seeded tenant |
| Blog post not visible after publish | ISR cache delay | Wait up to 60s, or restart dev server |
