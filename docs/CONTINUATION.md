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
# DB is already running on :5433 (postgres role 'claude', db govtech_intel)
export DATABASE_URL='postgresql://claude@127.0.0.1:5433/govtech_intel'

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
- **#111 — apply migration 111 to staging/prod + backfill.** The identity code reads
  `user_memberships` + JWT `membershipPinned`; mig 111 is applied to SANDBOX ONLY.
  Without it in prod, `verifyTenantAccess` errors → everyone denied. Apply `psql -f`,
  confirm the backfill, smoke-test one multi- + one single-membership login.

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
