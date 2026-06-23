# Phase 0.5 Verification Report

**Branch:** `claude/analyze-project-status-KbAhg`
**Base:** `clean-build-v2` @ `704f737`
**Date:** 2026-04-08

This document records the local verification results for the Phase 0.5
hardening work and the manual steps required to finish verifying on
Railway after the branch merges.

---

## What Phase 0.5 Added

Eight commits, each on a separate concern:

| # | Title | Purpose |
|---|---|---|
| 1 | `docs: establish Phase 0.5 decision record and storage layout` | DECISIONS.md (D001–D005) + STORAGE_LAYOUT.md + PHASE_0_5_CHECKLIST.md |
| 2 | (skipped) | No schema migration — 001_baseline.sql already has the 5-role CHECK, temp_password, last_login_at, audit_log |
| 3 | `feat(storage): add canonical path helpers for S3 object keys` | paths.ts + paths.py + 40 unit tests |
| 4 | `feat(storage): wire S3 clients for frontend and pipeline` | s3-client.ts + s3_client.py + AWS_* env var convention |
| 5 | `feat(auth): wire NextAuth v5 credentials flow and master_admin seed` | auth.ts + login + change-password + master_admin seed |
| 6 | `feat(auth): enforce 5-role hierarchy in middleware` | middleware.ts + rbac.ts + 13 rbac tests |
| 7 | `feat(health): real /api/health with DB + S3 probes` | health/route.ts + pipeline/health.py |
| 8 | `docs: Phase 0.5 verification report and Phase 1 handoff` | (this commit) |

---

## Local Verification — PASS

### TypeScript type-check

```
cd frontend && npx tsc --noEmit
```

Exit: **0**, zero errors.

### Frontend unit tests

```
cd frontend && npx vitest run __tests__/
```

Result: **33 passed**

- `__tests__/storage-paths.test.ts` — 20 tests
  - rfpAdminInboxPath / rfpAdminDiscardedPath: path traversal
    rejection, UTC date formatting, extension lowercasing
  - rfpPipelinePath: source/text/metadata/shredded/attachment kinds,
    UUID validation
  - customerPath: upload, proposal-section, library-unit,
    library-asset variants; tenant slug regex rejections
    (uppercase, slash traversal, too-short)
  - assertKeyBelongsToTenant: admin keys rejected,
    cross-tenant keys rejected
- `__tests__/rbac.test.ts` — 13 tests
  - Every pairwise hierarchy comparison
    (master_admin > rfp_admin > tenant_admin > tenant_user > partner_user)
  - isAdmin / isMasterAdmin / canManageTenant predicates
  - requiredRoleForPath including "/administrator" false-positive guard

### Pipeline unit tests

```
cd pipeline && pytest tests/test_storage_paths.py
```

Result: **20 passed**

The Python path helpers mirror the TypeScript helpers 1-to-1. Any
future change to paths.py or paths.ts must update both sides and both
test files.

---

## Railway Verification — TODO (manual, post-merge)

### Preconditions

1. **`INITIAL_MASTER_ADMIN_PASSWORD`** must be set on the pipeline
   service before the first boot after this merge. Value is
   `!Wags$$` per D004. This env var should be **unset** after the
   first successful seed.

2. **`AWS_*` env vars** must exist on BOTH services. Confirmed via
   screenshot on govtech-frontend:
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `AWS_DEFAULT_REGION` (`auto`)
   - `AWS_ENDPOINT_URL` (`https://t3.storageapi.dev`)
   - `AWS_S3_BUCKET_NAME` (`rfp-pipeline-prod-r8t7tr6`)

   Verify the same five vars exist on the pipeline service before
   watching the deploy.

### Sequence

1. Push the branch. Railway auto-deploy picks it up.
2. Watch the pipeline service logs during boot for:
   - `[migrate] All migrations complete`
   - `[seed] master_admin bootstrapped for eric@rfppipeline.com`
3. `curl https://app.rfppipeline.com/api/health` → expect:
   ```json
   {
     "ok": true,
     "version": "...",
     "uptimeMs": 12345,
     "db": { "ok": true },
     "s3": { "ok": true, "detail": "bucket=rfp-pipeline-prod-r8t7tr6" }
   }
   ```
4. Browser: `https://app.rfppipeline.com/login`
   - Email: `eric@rfppipeline.com`
   - Password: `!Wags$$`
   - First login should redirect to `/change-password`
   - After setting a new 12+ char password, should land on `/portal`
5. Unset `INITIAL_MASTER_ADMIN_PASSWORD` on Railway (reboot pipeline
   service to pick up the change).
6. Smoke-test the S3 path (one-time, from a Railway shell):
   ```bash
   # Pipeline service shell:
   python -c "
   from src.storage.s3_client import put_object, get_object_bytes
   key = 'rfp-admin/inbox/2026/04/08/manual-upload/smoke-test.txt'
   put_object(key=key, body=b'hello', content_type='text/plain')
   print(get_object_bytes(key))
   "
   ```

---

## Phase 1 Handoff

With Phase 0.5 complete, Phase 1 (RFP Curation) can start cleanly.
Phase 1 owns the following areas that were intentionally deferred:

1. **Pipeline healthz HTTP server.** `pipeline/src/health.py` has
   `full_health()` ready to be wrapped in aiohttp or starlette for
   Railway's healthcheck probe.
2. **RFP Curation workflow.** Admin UI under `/admin/rfp-curation`
   for triaging inbox uploads and promoting them to the published
   opportunity pool. Uses `rfpAdminInboxPath` and `rfpPipelinePath`
   from the storage helpers.
3. **Additional rfp_admin users.** D004 deferred the
   invitation-for-rfp_admin flow to Phase 1. Build under
   `/admin/users` once Eric needs to onboard a second curator.
4. **SAM.gov / SBIR.gov / Grants.gov ingestion.** The stubs in
   `pipeline/src/ingest/` need real implementations. The ingestion
   pipeline writes directly to `rfp-admin/inbox/...` via the helpers.
5. **Tenant onboarding.** First customer needs a tenant row, a
   slug, a tenant_admin user, and the `customers/{slug}/` prefix
   implicitly created on first upload (S3 creates prefixes on PUT).
6. **Proposal workspace.** The whole Build phase is out of scope
   for Phase 0.5; `/portal/[tenantSlug]` is still a stub.

### Files to reuse in Phase 1

- `frontend/lib/storage/paths.ts` — canonical path generators
- `frontend/lib/storage/s3-client.ts` — `putObject`, `getObjectBuffer`,
  `getSignedGetUrl`, `pingS3`
- `frontend/lib/rbac.ts` — `hasRoleAtLeast`, `requiredRoleForPath`
- `frontend/auth.ts` — `auth()` server helper to get the session in
  server components and route handlers
- `frontend/lib/db.ts` — `sql` tagged template, `verifyTenantAccess`,
  `auditLog`
- `pipeline/src/storage/paths.py` and `pipeline/src/storage/s3_client.py`
  — mirror helpers for workers

### Files to revisit

- `frontend/lib/storage.ts` — the legacy `/data/` filesystem helpers.
  Kept for backward compatibility but marked deprecated per D003.
  New code MUST use `lib/storage/paths.ts` + `lib/storage/s3-client.ts`.
  When all callers are migrated, delete this file.
