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

- [ ] `frontend/lib/storage/paths.ts` — path helpers for all three
      prefixes with slug/id validation
- [ ] `frontend/lib/storage/s3-client.ts` — `S3Client` singleton +
      `BUCKET` constant + put/get/presign helpers
- [ ] `pipeline/src/storage/paths.py` — Python mirror of the TS helpers
- [ ] `pipeline/src/storage/s3_client.py` — `boto3` client singleton +
      `BUCKET` constant + put/get helpers
- [ ] `pipeline/requirements.txt` — `boto3>=1.34.0` added
- [ ] `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` added to
      `frontend/package.json`

## Auth

- [ ] `frontend/lib/auth.ts` — real NextAuth v5 config with
      credentials provider + pg adapter
- [ ] `frontend/app/api/auth/[...nextauth]/route.ts` — real handler
- [ ] `frontend/app/(auth)/login/page.tsx` — real login form
- [ ] `frontend/app/api/auth/change-password/route.ts` — real handler
- [ ] `frontend/app/(auth)/change-password/page.tsx` — real form
- [ ] `pipeline/src/seeds/master_admin.py` — idempotent seed for
      `eric@rfppipeline.com` reading `INITIAL_MASTER_ADMIN_PASSWORD`
- [ ] `pipeline/src/main.py` — invokes the seed after migrations
- [ ] `frontend/middleware.ts` — 5-role hierarchy enforcement

## Health

- [ ] `frontend/app/api/health/route.ts` — returns
      `{ db, s3, version }` with real checks
- [ ] `pipeline/src/health.py` — DB ping + S3 head-bucket check used
      by Railway healthcheck

## Verification

- [ ] `npx tsc --noEmit` from `frontend/` passes cleanly
- [ ] `pytest --collect-only` from `pipeline/` passes cleanly
- [ ] Manual: Eric logs in at prod URL using seed credentials
- [ ] Manual: `curl https://app.rfppipeline.com/api/health` returns ok
- [ ] Manual: Railway shell — put/get roundtrip in both services
- [ ] `INITIAL_MASTER_ADMIN_PASSWORD` unset on Railway after first
      successful boot
