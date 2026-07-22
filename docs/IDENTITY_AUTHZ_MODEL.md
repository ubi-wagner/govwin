# Identity, Roles & Cross-Company Authorization — the as-built model

**Status:** verified end-to-end against a live schema (migrations 001→109) on 2026-07-16.
This is the authoritative reference for how RFP Pipeline models *who someone is*, *which
company they belong to*, and *how one person can act across companies* — the spine under
customer admins, internal collaborators, external collaborators, RFP-Engine shadow admins,
and EconDev appointed expert-admins.

> **Companion docs:** `docs/MASTER_MIRROR_OPP_DESIGN.md` (the two-spine OPP model + shadow/ToDo
> flow), `docs/archive/API_REFERENCE.md` (route contracts), `docs/archive/DB_SCHEMAS.md` (full schema).

---

## 0. The two-key answer (read this first)

**The login key is `email` ALONE**, not `(email, company)`.

- `users.email` carries a single-column `UNIQUE` (`users_email_key`); the login lookup is
  `WHERE u.email = $1 LIMIT 1` (`frontend/auth.ts:40-48`). One email = **one** user row = **one**
  password = **one** home company (`users.tenant_id`, a single nullable FK) + **one** global role.
- There is **no** `(email, tenant_id)` composite unique and **no** membership/junction table.
  (An earlier "phantom `tenant_memberships`" table was deliberately collapsed to `users.tenant_id`
  — see `docs/archive/SESSION_HANDOFF_NEXT.md:61`, `docs/archive/LAUNCH_READINESS_AND_10DAY_PLAN_2026-07-04.md:385`.)

So "**email + company is the unique key**" is *not* how login works — but the **outcome it's
meant to guarantee is still the design**: one person can be **admin at their own company AND an
authorized collaborator on another company's proposal**. That is achieved by layering **grants**
on top of the single identity, not by minting a second login:

| Mechanism | Table | Scope | Who it serves |
|---|---|---|---|
| Home membership | `users.tenant_id` + `role` | the whole tenant | customer admin, internal collaborator |
| Per-proposal collaboration | `proposal_collaborators` (`UNIQUE(proposal_id, email)`) | one proposal | external + internal collaborators |
| Section/stage scoping | `collaborator_stage_access` | stage × artifact × view/comment/edit | any collaborator |
| Portal shadow access | `shadow_admin_grants` (`source ∈ {t_and_c, invite}`) | one portal | RFP shadow admin, EconDev appointee |

**Verified:** the same email can be `tenant_admin` of Company A and a `reviewer` collaborator on
Company B's proposal, as **one** user row (harness P3.2–P3.5, below). The data models it correctly.
**One runtime bug blocks it** — see §4 and gap **G1**.

---

## 1. The identity spine (tables & constraints)

### `users` — `db/migrations/001_baseline.sql:40-57`
- `email TEXT UNIQUE NOT NULL` (`:42`) — the sole login key, lowercased/trimmed by trigger
  (`006_normalize_user_emails.sql`).
- `tenant_id UUID REFERENCES tenants(id)` (`:45`) — **one** home company (NULL for platform staff).
- `role TEXT CHECK (role IN ('master_admin','rfp_admin','tenant_admin','tenant_user','partner_user'))` (`:44`).
- `password_hash`, `temp_password`, `is_active` — credential + first-login + soft-disable.

### `tenants` — `db/migrations/001_baseline.sql:23-36`
- `slug TEXT UNIQUE NOT NULL` (`:25`) — the only business key; builds `/portal/<slug>/…` URLs.

### `proposal_collaborators` — `db/migrations/001_baseline.sql:343-354` (+ `029_proposal_portal.sql:33-35`)
- `user_id UUID REFERENCES users(id)` **nullable** + `email TEXT NOT NULL`; `UNIQUE(proposal_id, email)`.
- `role TEXT DEFAULT 'contributor'` (API accepts `contributor` | `external`), `assigned_sections UUID[]`.
- The **cross-company bridge**: an email can collaborate on *any* proposal in *any* tenant. A row can
  exist before the person has an account (`user_id` NULL), though the current invite path always
  populates `user_id` (§3).

### `collaborator_stage_access` — `db/migrations/001_baseline.sql:356-368`
- `(collaborator_id, proposal_id, stage, artifact_types[], permission CHECK ('view','comment','edit'))`.
- The fine-grained scope a collaborator actually gets, per stage.

### `shadow_admin_grants` — `db/migrations/097_portals_shadow_guardrails.sql:41-63`
- `admin_user_id` (nullable — NULL = role-based) / `admin_email`, `tenant_id`, `portal_id`,
  `source CHECK ('t_and_c','invite')`, `active` + `revoked_by/at`. **RLS forced** (tenant_isolation).
- `t_and_c` = customer opt-in at purchase; `invite` = appointed EconDev expert (hook only, §2.5).

---

## 2. The five personas

### 2.1 Customer admin
- **Identity:** `users` row, `role='tenant_admin'`, `tenant_id` = their company.
- **Born from:** application → admin **Accept** (`.../applications/[id]/accept/route.ts:94-155`) creates
  the tenant + this user + a temp password.
- **Login:** email + temp password → forced `/change-password` (middleware) → sets a real password.
- **Reach:** `/portal/<slug>/…` — passes `verifyTenantAccess` because `users.tenant_id == tenant`.

### 2.2 Internal collaborator (same company)
- **Identity:** `users` row, `role='tenant_user'`, `tenant_id` = the **same** company.
- **Added via:** the team route (`/api/portal/[slug]/team`) creates the user in this tenant; and/or the
  proposal `collaborators` route adds a `proposal_collaborators` row + `collaborator_stage_access`.
- **Reach:** tenant-wide (`verifyTenantAccess` passes); section-level edits scoped by `resolveUserAccess`.

### 2.3 External collaborator (a different company)
- **Two sub-cases** (chosen by whether the email already has an account — `collaborators/route.ts:288-322`):
  - **No prior account →** a `users` row is created **inside the owner's tenant** as
    `partner_user` (`:296-302`). `verifyTenantAccess` passes. **Works today**, but the person is now
    represented as belonging to the *owner's* company, and the global `email` unique blocks them from
    ever having an account at their *own* company.
  - **Already an admin at their own company →** their existing `users` row is linked by `user_id`,
    auto-accepted, `tenant_id` **unchanged**. This is the case your requirement names — and it is
    currently **blocked at runtime** (gap **G1**, §4): the tenant pre-gate 403s them before the
    cross-tenant-capable resolver runs.
- **Scope (intended):** `resolveUserAccess` (`frontend/lib/proposal-access.ts:44`) matches the
  collaborator by `user_id`+`accepted_at` (`:129-141`) and intersects `assigned_sections` ×
  `collaborator_stage_access` per stage — never requiring their `tenant_id` to equal the proposal's.

### 2.4 RFP-Engine shadow admin
- **Identity:** `role='rfp_admin'` (or `master_admin`), `tenant_id` NULL (platform staff).
- **Reach:** `verifyTenantAccess` returns `true` unconditionally for these roles (`frontend/lib/db.ts:52`) —
  a **global "god-view"** into any tenant. On purchase, a `shadow_admin_grants` row (`source='t_and_c'`)
  is written (`purchase/route.ts:110-113`) as an **audit + revocation record**.
- **Caveat (G3):** the grant is *not* the enforced gate today; the god-view is. Revoking a grant does
  **not** cut off route access. The scoped check `portalAdminAccess` (`portal-launch.ts:66-76`) is dead code.

### 2.5 EconDev appointed expert-admin
- **Intended:** an external Economic-Development professional appointed by us *or* a customer, entering a
  **single** customer's portal via `shadow_admin_grants.source='invite'`, receiving only the intermediary
  ToDos that route them into the tenant's RLS shadow context.
- **As-built:** **DB hook only.** No distinct RBAC role, no invite UI, and no code path writes
  `source='invite'` (every runtime write uses `t_and_c`). Tracked future — gap **G4**.

---

## 3. Account lifecycle (verified)

```
apply (PUBLIC /api/applications)  ──►  admin Accept  ──►  temp-pw login  ──►  forced change-pw  ──►  real login
   status='pending'                    tenant + tenant_admin              middleware /change-password
```

- **"RFP admin creates a customer by applying for them":** there is **no** admin-side create route/UI.
  The *only* application INSERT is the public, unauthenticated `POST /api/applications`. So the admin
  fills the public `/apply` form with the customer's details (contact email = T&C signature), then
  Accepts in `/admin/applications`. It works, but it's not a first-class admin action — gap **G5**.
- **Accept** upserts the user with `ON CONFLICT (email) DO UPDATE SET tenant_id = EXCLUDED.tenant_id`
  (`accept/route.ts:135-141`) — see gap **G2**: re-accepting an email that already belongs to someone
  **relocates their home company**.
- **Collaborator invite acceptance** (`/api/invite`, `frontend/app/invite/[token]/page.tsx`): the token is
  the `proposal_collaborators.id`; POST sets the password **only if `user_id` is set** (`invite/route.ts:150-157`).

---

## 4. Authorization — the two-layer gate (and the bug)

Every portal request passes two layers:

1. **Role floor** — middleware `requiredRoleForPath` (`frontend/lib/rbac.ts:89-110`): `/portal` needs
   ≥ `partner_user`, `/admin` needs ≥ `rfp_admin`, etc.
2. **Access** — one of:
   - **Tenant-wide:** `verifyTenantAccess(userId, role, tenantId)` (`frontend/lib/db.ts:50-59`) —
     `rfp_admin`/`master_admin` ⇒ `true`; else strict `users.tenant_id == tenantId`.
   - **Per-proposal (cross-tenant capable):** `resolveUserAccess(userId, proposalId, tenantId)`
     (`frontend/lib/proposal-access.ts:44`) — admin fast-path, else the collaborator match by `user_id`.

**The bug (G1):** proposal-scoped routes run the **tenant-wide** gate *first* and redirect/403 on
failure, *before* the per-proposal resolver ever runs
(`proposals/[proposalId]/page.tsx:37-38` then `:123`). An external collaborator whose home tenant ≠ the
proposal's tenant is bounced at step (1)-of-layer-2, so the resolver that *would* grant them scoped
access is never reached. **Scope:** of 32 proposal-scoped route/page files, **25 gate on tenant
membership only**; only **7** already also call `resolveUserAccess` (and even those run the tenant
gate *first*, so they carry the same ordering bug). This is a known gap cluster
(`docs/archive/baseline/UI_UX_V1_AUDIT.md:93,148`, `docs/archive/baseline/GAP_ANALYSIS.md`).

---

## 5. Verified evidence (replay harness)

**Method:** PostgreSQL 16 + pgvector, migrations 001→109 applied by the repo runner
(`db/migrations/migrate.mjs`); a Node script replays the **exact SQL** of the accept, login
(`findUserByEmail` + `bcrypt.compare`), change-password, collaborator-insert, and shadow-grant paths,
plus replicas of `verifyTenantAccess` and the `resolveUserAccess` collaborator match. All assertions PASS:

| Persona / concern | Checks | Result |
|---|---|---|
| **Customer admin** — apply→accept→temp-pw login→forced change-pw→re-login | P1.1–P1.11 | ✅ all pass |
| **Internal collaborator** — same-company `tenant_user` + collaborator + stage access | P2.1–P2.2 | ✅ |
| **External collaborator** — one email = `tenant_admin`@A **and** `reviewer`@B | P3.2–P3.5 | ✅ data models it |
| ↳ resolver **would** grant scoped access (collab matched by `user_id`) | P3.6 | ✅ |
| ↳ **but** `verifyTenantAccess` pre-gate **denies** the external admin | P3.7 | ✅ **bug reproduced** |
| ↳ re-accept **relocates** home tenant (`ON CONFLICT (email)`) | P3.8 | ✅ **risk reproduced** |
| **RFP shadow** (`t_and_c`) + **EconDev** (`invite`) grants accepted by schema | P4.1, P5.1–P5.2 | ✅ |

*(Harness: `verify_identity.mjs` — kept in the session scratchpad; not a repo test as it needs a live DB.)*

---

## 6. Gap register (precise, with fixes)

| # | Sev | Gap | Fix |
|---|---|---|---|
| **G1** | P0 | Cross-company existing-user collaborator is 403'd — tenant pre-gate runs before `resolveUserAccess` on 26/32 proposal routes | Introduce `verifyProposalAccess(user, role, tenantId, proposalId)` = tenant member **or** accepted collaborator on that proposal; adopt it per-route **at the correct access level** (view/comment/edit) so a view-only reviewer can't `advance`/`lock`/`stage`. Scoped, security-sensitive, per-route. |
| **G2** | P1 | Accept relocates an existing user's home company (`ON CONFLICT (email) DO UPDATE tenant_id`) | Reject Accept when the email already belongs to an active user in another tenant (surface it to the admin), or attach without moving `tenant_id`. |
| **G3** | P1 | Shadow grants not enforced — `verifyTenantAccess` god-view overrides; `portalAdminAccess` dead | Honor `shadow_admin_grants` at the gate; retire the god-view (tracked ToDo #8). |
| **G4** | P2 | EconDev appointed-shadow unbuilt — only the `source='invite'` enum exists | Add the role + invite UI + a route that writes/honors the grant. |
| **G5** | P2 | No first-class admin "apply on a customer's behalf" — admin must use the public form | Add an admin create-application action (optionally auto-accept). |
| **G6** | P3 | `invite`-accept tolerates `user_id = NULL` (no login created, silent) | Create/link the user on accept, or reject the malformed invite. |

---

## 7. Recommendation

The identity **model is correct and sufficient** for all five personas — single identity + grants, no
multi-membership table needed. The work is to make the runtime honor it: **G1** (the cross-company
collaborator gate) is the blocker for "admin in one company, collaborator on another," and **G2** protects
the multi-company world from silent home-tenant relocation. G3–G6 harden and complete the shadow/EconDev
and admin-onboarding surfaces. G1 is a per-route authorization migration and should be executed
deliberately (per-route access level), not as a mechanical swap.
