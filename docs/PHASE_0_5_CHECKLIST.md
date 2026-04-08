# Phase 0.5 Checklist

Tracks the hardening work between the V2 skeleton and Phase 1 (RFP
Curation). See `docs/DECISIONS.md` D005 for scope and exit criteria.

Mark each item `[x]` as it lands. PR/commit references in parentheses.

---

## Documentation

- [x] `docs/DECISIONS.md` created — 5-role hierarchy, bucket layout,
      volumes policy, master admin seed, Phase 0.5 scope
- [x] `docs/STORAGE_LAYOUT.md` created — full bucket layout reference
- [x] `docs/PHASE_0_5_CHECKLIST.md` (this file)

## Storage

- [x] `frontend/lib/storage/paths.ts` — path helpers for all three
      prefixes with slug/id validation (20 unit tests)
- [x] `frontend/lib/storage/s3-client.ts` — `S3Client` singleton +
      `BUCKET` constant + put/get/presign/ping helpers
- [x] `pipeline/src/storage/paths.py` — Python mirror of the TS
      helpers (20 unit tests, identical coverage)
- [x] `pipeline/src/storage/s3_client.py` — `boto3` client (lazy) +
      `BUCKET` constant + put/get/head/ping helpers
- [x] `pipeline/requirements.txt` — `boto3>=1.34.0` added (also
      bcrypt>=4.1.0 for the seed)
- [x] `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` added to
      `frontend/package.json` (resolved 3.1026.0)

## Auth

- [x] `frontend/auth.ts` at app root — real NextAuth v5 credentials
      provider with JWT sessions. `frontend/lib/auth.ts` is a
      re-export shim so existing `@/lib/auth` imports keep working.
- [x] `frontend/lib/rbac.ts` — single source of truth for ROLES,
      Role type, and hierarchy helpers (13 unit tests)
- [x] `frontend/app/api/auth/[...nextauth]/route.ts` — real handler
- [x] `frontend/app/(auth)/login/page.tsx` — real server-action
      login form with error states
- [x] `frontend/app/api/auth/change-password/route.ts` — real handler
      (12-char min, current-password verification, flips
      temp_password=false)
- [x] `frontend/app/(auth)/change-password/page.tsx` +
      `components/auth/change-password-form.tsx` — real form
- [x] `pipeline/src/seeds/master_admin.py` — idempotent seed for
      `eric@rfppipeline.com` reading `INITIAL_MASTER_ADMIN_PASSWORD`
- [x] `pipeline/src/main.py` — invokes the seed after migrations
- [x] `frontend/middleware.ts` — 5-role hierarchy enforcement via
      requiredRoleForPath + hasRoleAtLeast, with temp_password
      redirect guard

## Health

- [x] `frontend/app/api/health/route.ts` — returns
      `{ ok, version, uptimeMs, db, s3 }` with real parallel checks
- [x] `pipeline/src/health.py` — async DB ping + S3 head-bucket
      check exposed as importable helpers (HTTP wrapping deferred
      to Phase 1)

## Verification — local

- [x] `npx tsc --noEmit` from `frontend/` passes cleanly
- [x] `vitest run __tests__/` from `frontend/`: 33 passed
      (storage-paths 20 + rbac 13)
- [x] `pytest tests/test_storage_paths.py` from `pipeline/`:
      20 passed

## Verification — Railway (post-deploy, do by hand after merge)

- [ ] Set `INITIAL_MASTER_ADMIN_PASSWORD` on pipeline service env
- [ ] Verify `AWS_*` env vars exist on BOTH govtech-frontend AND
      pipeline services (screenshots from govtech-frontend only so
      far)
- [ ] Push this branch → Railway auto-deploy
- [ ] Confirm pipeline logs show
      `[seed] master_admin bootstrapped for eric@rfppipeline.com`
- [ ] `curl https://app.rfppipeline.com/api/health` returns 200 with
      `{ ok: true, db: { ok: true }, s3: { ok: true } }`
- [ ] Eric logs in at `/login`, sees the change-password screen on
      first login, sets a real password, lands on `/portal`
- [ ] Unset `INITIAL_MASTER_ADMIN_PASSWORD` on Railway
- [ ] Manual Railway shell test in both services: put + get
      roundtrip through the storage helpers
