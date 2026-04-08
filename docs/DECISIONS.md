# Project Decisions Log

Canonical record of architectural and operational decisions. Append-only.
Each entry is dated and numbered. Future decisions that supersede a prior
one should reference it by number, not delete it.

---

## 2026-04-08

### D001 — Five-role hierarchy (final for V1)

**Decision:** V1 ships with exactly five roles, nested such that higher
roles implicitly hold the privileges of lower roles.

| Role | Inherits | Scope |
|---|---|---|
| `master_admin` | — | Full system: migrations, Railway ops, all tenants, all RFPs, all users. |
| `rfp_admin` | (peer to master for RFP curation) | Triage, curate, and publish solicitations to the opportunity pool. Customer service. Onboard new customers. |
| `tenant_admin` | — | Manages a single tenant: invite team, purchase proposals, grant access. |
| `tenant_user` | — | Access within a tenant per grant (all proposals or per-proposal). |
| `partner_user` | — | Stage-scoped access on a single proposal (view/comment/edit). Revoked on stage close. |

**Hierarchy enforcement rule:** `master_admin` is a superset of every
other role's capabilities. A single user row with `role = master_admin`
is sufficient to act as `rfp_admin`, `tenant_admin`, `tenant_user`, or
`partner_user` in any middleware check. Middleware uses an ordered role
list `[master_admin, rfp_admin, tenant_admin, tenant_user, partner_user]`
and a check like `hasRoleAtLeast(user.role, required)`.

**Why nested instead of composite:** V1 has exactly one user
(`eric@rfppipeline.com`) playing multiple hats. A single
`role = master_admin` row is the simplest representation; no role-join
table or array column is needed until V2.

**Schema state:** The CHECK constraint on `users.role` in
`db/migrations/001_baseline.sql:44` already enumerates all five roles.
No schema migration is needed.

**Supersedes:** None.

---

### D002 — Single-bucket, three-folder storage layout

**Decision:** V1 uses exactly ONE Railway-managed S3-compatible bucket
(`rfp-pipeline-prod-r8t7tr6`) with three top-level prefixes representing
the three access domains.

```
s3://rfp-pipeline-prod-r8t7tr6/
├── rfp-admin/                 # Staging area for rfp_admin curation
│   └── inbox/{yyyy}/{mm}/{dd}/{source}/{external_id}.{ext}
├── rfp-pipeline/              # Canonical artifacts for PUBLISHED opportunities
│   └── {opportunity_id}/
│       ├── source.{ext}       # Original document
│       ├── text.md            # Normalized text
│       ├── metadata.json      # Extracted fields
│       └── shredded/          # Section-by-section breakdown
└── customers/                 # Per-tenant isolated storage
    └── {tenant_slug}/
        ├── uploads/           # Raw customer uploads
        ├── proposals/{proposal_id}/
        │   ├── sections/
        │   ├── attachments/
        │   └── exports/
        └── library/           # Reusable content units
```

**Why three folders not three buckets:** Railway bucket provisioning is
per-service and each bucket is billed/managed separately. Three prefixes
in one bucket give the same isolation for V1 purposes (enforced in code
at path-generator layer) without tripling ops complexity. When V2 needs
true cross-AZ replication or per-tenant encryption keys, migrating a
prefix to its own bucket is a straight `aws s3 sync` + path-helper swap.

**Access control:** The S3 credentials are shared across both services
(frontend + pipeline). Path generators in
`frontend/lib/storage/paths.ts` and `pipeline/src/storage/paths.py`
are the ONLY places that construct object keys. Application code never
builds S3 paths from raw strings — it calls
`customerPath({ tenantSlug, ...})` or `rfpPath({ opportunityId, ...})`.
This makes tenant-leakage bugs easy to spot in review (any file that
imports `BUCKET` or uses `.putObject` outside the storage helpers is
suspect).

**Env vars (on both govtech-frontend and pipeline services, Railway-injected):**

| Env Var | Value on Railway | How code reads it |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | (secret) | AWS SDK auto-reads |
| `AWS_SECRET_ACCESS_KEY` | (secret) | AWS SDK auto-reads |
| `AWS_DEFAULT_REGION` | `auto` | AWS SDK auto-reads |
| `AWS_ENDPOINT_URL` | `https://t3.storageapi.dev` | AWS SDK v3+/boto3 auto-reads |
| `AWS_S3_BUCKET_NAME` | `rfp-pipeline-prod-r8t7tr6` | Explicit `process.env` / `os.environ` |

**Supersedes:** None.

---

### D003 — Railway volumes remain for NextAuth pg adapter state only

**Decision:** The Railway persistent volumes attached to
`govtech-frontend` and `pipeline` services are NOT used for application
data in V1. All user-generated content (RFP documents, proposal
artifacts, tenant uploads) lives in S3 per D002. Volumes are retained
for:

1. Next.js `.next/cache` (frontend, transient)
2. Python wheel cache (pipeline, transient)
3. Future local fallback if S3 is unreachable (not implemented V1)

**Why:** Volumes are per-service, not shared. Any state we want both
services to read (e.g., uploaded RFP PDFs that pipeline must shred and
frontend must preview) MUST live in S3 or Postgres. The legacy
`frontend/lib/storage.ts` helpers that write to `/data` are kept for
backward compatibility but marked deprecated; new code uses the S3 path
helpers.

**Supersedes:** None.

---

### D004 — Master admin seed

**Decision:** Exactly one initial admin is seeded on first boot:

- **Email:** `eric@rfppipeline.com`
- **Role:** `master_admin`
- **Initial password:** Read from `INITIAL_MASTER_ADMIN_PASSWORD` env
  var at seed time, bcrypt-hashed before insert, **never logged**.
- **`temp_password` flag:** Set to `true` — user is redirected to
  `/change-password` on first successful login.
- **Idempotent:** Seed is a no-op if ANY user with
  `role = master_admin` already exists. Safe to run on every boot.

**Operational note:** After the first successful boot,
`INITIAL_MASTER_ADMIN_PASSWORD` should be unset on Railway. The seed
code logs a warning if the env var is still present after a
master_admin already exists in the DB.

**Additional rfp_admin users:** NOT seeded in Phase 0.5. V1 starts with
Eric alone holding both `master_admin` and `rfp_admin` capabilities (via
the role hierarchy in D001). New `rfp_admin` users are invited via the
admin panel in Phase 1 (RFP Curation).

**Supersedes:** None.

---

### D005 — Phase 0.5 scope and exit criteria

**Decision:** "Phase 0.5" is a hardening phase between the V2 skeleton
(current state at commit `704f737`) and Phase 1 (RFP Curation). Its job
is to make the skeleton actually bootable on Railway with working auth,
working storage, and working health checks — nothing more.

**In scope:**
1. Bucket storage wired end-to-end (frontend + pipeline)
2. Auth scaffold: login page, NextAuth config, master_admin seed
3. Middleware enforces the 5-role hierarchy
4. `/api/health` reports DB connectivity AND S3 connectivity
5. Documentation: DECISIONS.md (this file), STORAGE_LAYOUT.md, PHASE_0_5_CHECKLIST.md

**Out of scope (deferred to Phase 1+):**
- RFP ingestion logic
- Opportunity scoring
- Tenant onboarding flows
- Any proposal workspace features
- Agent execution

**Exit criteria:**
1. `npx tsc --noEmit` passes from `frontend/` with zero errors
2. `pytest --collect-only` passes from `pipeline/` with zero errors
3. Eric can log in at `https://app.rfppipeline.com/login` using the
   initial seeded credentials
4. `/api/health` returns `{ db: "ok", s3: "ok" }`
5. A manual put/get roundtrip through the S3 helpers works from a
   Railway shell session in both services

**Supersedes:** The prior "Phase 1" charter in `.plan.md` implicitly —
which is wider in scope.
