# CONTINUATION — spin up exactly here

**Last updated:** 2026-07-19 (end of the multi-membership identity sprint)
**Branch:** `claude/nice-hamilton-kBqtD`  •  **HEAD:** `ecaaad9`
**This file is the durable "start here tomorrow" memory.** It's committed to git on
purpose — the sandbox container is ephemeral and gets reclaimed; git is the layer that
survives. Read this first, then `docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md`.

---

## 1. What just shipped (this sprint = multi-membership identity, DONE + verified)

One email → many `(company, role)` memberships; pick one at login; the session is
**singular** and enforced. Commits on the branch, newest last:

| Commit | What |
|---|---|
| `cf3989a` | P1 — `user_memberships` table (mig 111) + backfill; `verifyTenantAccess` reads it |
| `42c8b3b` | P2 — `/select-company` selector when >1 membership |
| `d8a3937` | Collaborator visibility — withhold unassigned sections server-side |
| `7935ab7` | Universal upload+atomizer (dashboard + collaborator view) |
| `7662779` | RFP-admin shadow descend/ascend — banner + ack modal + audited |
| `bab99b7` | **Singular ENFORCEMENT** — active membership pinned in the JWT (`unstable_update`) |
| `ecaaad9` | **P3** — collaborator invite → membership (multi-company works) + uuid[] fix + login copy |
| `be5eb82` | launch-hardening — run.sh glob footgun fix; Immobileyes shadow flow verified; #116 sweep clean |
| `465a47a` | **Never hard-delete a user** — collaborator soft-delete + reactivate (mig 112); fixes removal 500 |
| `d09c348` | membership-ify all user-creation paths (team invite + onboarding accept) |
| `836353f` | **Company ARCHIVE** (license slumber) — third state (mig 113); reversible + lossless |
| `74f1f10` | **#115** retire legacy users.tenant_id access read-through — access is now membership-pure |
| `f1d1fb3` | **#118** team-member deactivate/reactivate (never delete) + dispatcher redirect-loop fix |
| `5d54174` | RFP-admin **create company + admin POC** (was a stub) + "New Company" admin UI |
| `994aa41` | **Notification deep-link** — /go + /api/enter land recipients directly in their company queue |

**Admin/RFP capability set (all done + verified):** tenant_admin adds/(de)activates users
(`team/[userId]`) + collaborators (invite/soft-delete/reactivate); a shadow rfp_admin passes the same
tenant_admin gate, audited. RFP-admin creates companies+POC (`POST /api/admin/tenants`), archives/
restores companies, and shadows in to help upload+atomize.

**Notification deep-link foundation (`c2ee5b8`) — for ALL external nudging.** Emails from
platform@rfppipeline.com (`GOOGLE_WORKSPACE_EMAIL`+Gmail API) link to `/go?task=<id>` or
`/go?tenant=<slug>`. `/go` is the orchestrator: checks link freshness (task completed/cancelled/expired,
proposal archived/submitted → "already done" note), then routes by session state — in the target company
→ "you're in X" confirm → the task; in a DIFFERENT company → `DeepLinkGate` "Switching companies" (sign
out + re-login, singular session, NO silent switch); unpinned multi-membership → `/api/enter` pins the
target (first pick); admins straight in. `/api/enter` never silently cross-switches (hands to `/go`).
So email = the nudge; completion happens in-platform, auditable.
Regression scripts: `scripts/drive-pin.mts` (15), `drive-p3-lifecycle.mts` (13).

**Migrations added this stretch:** 111 (user_memberships), 112 (proposal_collaborators.revoked_at),
113 (tenants.archived_at), 114 (rfp-pipeline tenant + staff memberships). All idempotent +
auto-applied on deploy via `entrypoint.sh → migrate.mjs`. Verify post-deploy.

**#112 "including us" DONE (`c7c00f7`):** RFP Pipeline is a real tenant; staff hold tenant_admin home
memberships; **Our Workspace** admin-nav link → `/portal/rfp-pipeline` gives us the upload/atomizer +
whole portal like any customer (atomize into our own library_atoms). Portal layout: `isShadowAdmin =
admin AND not-a-member`, so no shadow banner on our own tenant; customer tenants still show it.
**Identity/lifecycle/admin model is now essentially COMPLETE.** Remaining: #111 (deploy-verify, auto),
#114 (shadow role-rewrite — likely already satisfied by the audited model; low priority), and the
NON-identity gaps #117 (dormant agents), #77/#69/#18 (curation/template features).

**Identity state ladder (user directive) — active · inactive · archived, all reversible + auditable, nothing destroyed:**
- **active / inactive** = per-USER (never hard-delete; mark inactive, keep history, re-invite reconstitutes
  the same row auditably). Collaborators DONE (revoked_at + reactivate). Tenant_users/admins = gap #118.
- **archived** = whole COMPANY (license lapsed): `tenants.archived_at`, orthogonal to per-user state so
  renewal restores everyone to their exact prior state for free. Archived companies vanish from the login
  list (`getActiveMemberships` filters them); admins can still enter to renew. Admin control on the tenant
  page. DONE + verified (`scripts/drive-archive.mts`). Every user-creation path now writes a membership.
See the identity design's "Never hard-delete" + "third state: ARCHIVED" sections.

**As-built mechanism (don't re-derive):**
- The active `(role, tenantId, tenantSlug)` + a `membershipPinned` flag live in the
  **session JWT**. `auth.config.ts` `jwt` callback: sets them false on login, and on
  `trigger === 'update'` copies them from `unstable_update` data and sets pinned=true.
- `/select-company` posts to `selectCompanyAction` (`app/actions/auth-actions.ts`) →
  validates the tenant is one of the caller's memberships → `unstable_update` rewrites
  the JWT → redirects. So the active **role follows the selected company** (a
  tenant_admin-at-home becomes partner_user when they enter a company where they're a
  collaborator). This is what reaches all ~40 portal routes without editing each one.
- Re-pick-proof: once pinned, `/select-company` + dispatcher forward to the active
  company; the portal layout redirects any other tenant back. Logout clears the JWT
  (= clears the pin) → "log out to switch" is a hard guarantee.
- **Fail-closed safety net:** `verifyTenantAccess` (lib/db.ts) also caps a non-admin's
  active role to the role actually granted at that tenant
  (`hasRoleAtLeast(membershipRole, sessionRole)`), so even if the rewrite didn't take,
  routes deny — never escalate.
- RFP/master admins are **exempt** (they re-scope in-session via shadow descend/ascend).
- P3 invite: `proposal_collaborators` route also INSERTs an active
  `(tenant, partner_user|tenant_user, source='collaborator')` membership,
  `ON CONFLICT (user_id,tenant_id) DO NOTHING`, **without touching users.tenant_id**
  (home preserved, no clobber).

**Verified:** `frontend/scripts/drive-pin.mts` (12/12: pin, role-rewrite, hop-denied,
re-pick-proof, single-membership + admin controls) and `frontend/scripts/drive-p3-invite.mts`
(cross-company invite → two memberships, home preserved). tsc clean; vitest 701/701.

---

## 2. Spin up the sandbox (exact commands + gotchas)

```bash
export DATABASE_URL='postgresql://claude@127.0.0.1:5433/govtech_intel'

# The disk PERSISTS across idle (git repo, node_modules, .next build, AND the
# postgres data dir at /tmp/pgs_gov/data all survive) — but the postgres + next
# PROCESSES are stopped when the container goes idle. So on resume you usually
# only need to RESTART both, not rebuild/reseed.

# 1. Start postgres on the surviving data dir (PG16; runs as 'claude', NOT root):
rm -f /tmp/pgs_gov/data/postmaster.pid            # clear the stale pid from last run
mkdir -p /tmp/pgs_sock && chown -R claude:claude /tmp/pgs_gov /tmp/pgs_sock
su claude -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pgs_gov/data \
  -o '-p 5433 -k /tmp/pgs_sock' -l /tmp/pgs_gov/log start"
psql "$DATABASE_URL" -tAc "SELECT count(*) FROM tenants"   # sanity: expect 3

# If /tmp was ALSO wiped (full reclaim, data dir gone): initdb a fresh cluster
# (--auth=trust -U claude), createdb govtech_intel, then run every migration
# `for f in db/migrations/0*.sql 1*.sql; do psql "$DATABASE_URL" -f "$f"; done`
# (skip 000_drop_all.sql) and re-run the seed scripts (scripts/seed_dev_accounts.mjs,
# frontend/scripts/seed-cuas-immobileyes.mts, seed-demo-*.mts).

cd /home/user/govwin/frontend
# Build (takes ~90s; the 2-min default Bash timeout WILL cut it off — use timeout 600000)
NEXT_TELEMETRY_DISABLED=1 npm run build

# Start the server (production build; http, so NextAuth non-secure cookies work)
setsid env DATABASE_URL="$DATABASE_URL" \
  AUTH_SECRET='dev-screenshot-secret-000' AUTH_TRUST_HOST='true' \
  NEXTAUTH_URL='http://localhost:3000' ANTHROPIC_API_KEY='sk-noop' \
  NODE_ENV=production node node_modules/next/dist/bin/next start -p 3000 \
  >/tmp/next-app.log 2>&1 < /dev/null &
disown
until curl -s -o /dev/null http://localhost:3000/login; do sleep 1; done
```

**GOTCHAS learned the hard way this sprint (save yourself the time):**
- **Restarting the server:** `pkill`/`kill next-server` often returns exit 144
  (cosmetic) BUT the old server can keep serving the OLD in-memory build while a new
  one fails to bind :3000. ALWAYS verify with
  `ps -eo pid,etime,cmd | grep next-server` — if `etime` isn't ~seconds, you're on the
  stale build. Force it: `pkill -9 -f next-server; fuser -k 3000/tcp; sleep 2` then
  start fresh and re-check the pid age. Next.js `start` serves the `.next` from
  **startup time** — a rebuild does nothing until you restart.
- **Background wait-loops:** `until ! pgrep -f "next build"` matches its **own**
  command line (which contains "next build") → infinite loop that never fires the
  build. Match a narrower string or check for the node process, not the bash wrapper.
- Playwright drive-tests must live under `frontend/` (else `playwright` won't resolve).
  Chromium: `executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`.
- `GET /api/auth/session` (public path) returns the JWT-derived session incl. our
  custom `role/tenantId/tenantSlug/membershipPinned` — the fastest way to assert the
  active membership in a drive-test.

**Demo accounts** (password `DemoPass123!` unless noted):

| Email | Home | Memberships | Use for |
|---|---|---|---|
| `expert@beacon-labs.test` | tenant_admin @ beacon-labs | +partner_user @ acme | THE multi-membership case |
| `admin@acme-navy.test` | tenant_admin @ acme-navy-systems | 1 | acme admin / invites |
| `teammate@acme-navy.test` | tenant_user @ acme-navy-systems | 1 | single-membership control |
| `eric@rfppipeline.com` | master_admin (no tenant) | 0 | admin / shadow control |

Acme proposal `3b0e7f8b-7ca2-4570-91d9-48326add00ff`; sections
`dc8a44af-…` (Assigned) / `26a41b25-…` (Unassigned). Comp code `rfppipelinetest`.

---

## 3. Rebuilt gap list (tasks carry the detail; here's the map)

**Deploy-gating (do before/at deploy):**
- **#111 — migration 111 to staging/prod.** DE-RISKED 2026-07-19: production applies
  migrations automatically via `entrypoint.sh` → `db/migrations/migrate.mjs` (glob
  `^\d{3}.*\.sql$`, so it DOES pick up 100–111), and mig 111 is idempotent
  (`CREATE TABLE IF NOT EXISTS` + backfill `ON CONFLICT DO NOTHING`) — verified by
  running it through the tracked runner (no-op on re-run, data intact). Action is now
  just **verify post-deploy**: `user_memberships` exists + backfilled, and one multi-
  + one single-membership login work. NOTE: `db/migrations/run.sh` (manual dev tool)
  had a `0*.sql` glob that silently skipped 100–111 — FIXED to `[0-9][0-9][0-9]*.sql`.

**Identity model follow-ons (natural next phases):**
- **#112 — our-org-as-a-tenant + platform upload/atomizer** ("including us"): make our
  org a real `tenants` row so staff hold customer memberships; add UploadAtomizeCard to
  `/admin`.
- **#113 — collaborator removal → revoke the 'collaborator' membership** (only when no
  proposal collaborations remain at that tenant; never touch home/manual memberships).
- **#114 — shadow descend rewrites session role to tenant_admin** (currently stays
  rfp_admin in-session; use the same `unstable_update` mechanism for true company-admin
  parity + data-integrity).
- **#115 — Identity P4:** retire the fused `users.tenant_id/role` read-throughs once
  every caller reads the active membership and a backfill sweep is clean.

**Bug-class + platform hardening:**
- **#116 — array-column insert sweep:** audit every `sql.array(...)` binding against its
  column type (uuid[]/int[]/enum[]); non-empty text[] into a typed[] column 500s.
  Same family as the CHECK controlled-vocabulary class and the camelCase-read class.
- **#117 — wire dormant AgentFabric archetypes** (~7 registered, no producer).

**Carried over (pre-existing pending):** #18 past-proposal templify+regen, #69 Ohio
TVSF end-to-end, #77 P4b required-item→template picker in curation.

---

## 4. Durable lessons this sprint reinforced (the "checks we keep doing")

These are recurring bug-classes — treat them as a checklist, not one-offs:
1. **Controlled vocabularies (CHECK columns):** confirm a literal is in the column's
   CHECK before writing (process_instances.scope, source_health.status,
   source_visits.action, source_diffs.severity, user_memberships.source/status…).
2. **postgres.js global camelCase transform:** result rows are camelCase; JSONB column
   *contents* are not. Read camelCase in components (this bit us in atom-library).
3. **Array-column type match:** `sql.array(text[])` into a `uuid[]` column throws — cast
   `::uuid[]` and validate elements. Only shows up with a NON-empty array.
4. **Next.js start serves the startup-time build:** rebuild ≠ live; restart + verify pid
   age. `pgrep`/`until` loops can match themselves.
5. **JWT is the singular-session source of truth:** everything authz reads the active
   membership off the token; never infer tenant from `users.tenant_id`.

---

## 5. Open question for the user (non-blocking)

The "two login options (Spotlight vs Portal)" to consolidate: the codebase has a
**single** `/login` CTA (site-chrome `chrome.nav.loginHref`) and one unified sign-in
form — already the consolidated single-login → select-company flow the request
describes. If a second login CTA is seen somewhere (a specific marketing page or a CMS
override), point at it; otherwise this is considered resolved.
