# Multi-membership identity — design

**Status:** proposed (design-first; implement in phases).
**Problem it solves:** a person is **email + company + role**, but one email can hold
**many** of those at once. A consultant is a scoped collaborator at Acme *and* at
Beacon; one of our employees is an RFP admin on the platform *and* a tenant_admin
of their own company *and* a collaborator inside a customer's proposal. These
businesses work with each other, so the same identity legitimately spans tenants —
which is exactly why tenant scope must be **enforced**, never inferred.

## First principle: a session's authorization is SINGULAR

The membership **set** is many; the **active authorization is always exactly one
`(company, role)`**. No session ever spans tenants simultaneously — that is the hard
tenant-isolation guarantee, and it is why scope must be enforced off the *selected*
membership, never inferred. Switching companies is a **deliberate re-scope** (a fresh
active membership), not concurrent access.

- **Anyone other than an RFP Pipeline (employee) account is strictly singular AND
  cannot switch in-session.** They pick one membership at login and are pinned to it
  for the whole session. To act at a *different* company they must **log out and log
  back in** and select that membership. A customer employee logs out to re-log in as
  a collaborator elsewhere; a consultant on proposals at several companies can only
  be logged into **one company at a time**. There is no in-session switch UI for them.
- **RFP Pipeline (employee) accounts are the ONLY accounts that role-switch within a
  single session.** They log in at the platform (god-view for cross-customer triage)
  and may **descend** into any customer — becoming a **singular `tenant_admin`** in
  that one company (never `rfp_admin` carried down) — then **ascend** back to the
  platform. See the controlled-transition rules below.

### RFP-admin in-session transitions (down / up) — tightly controlled

Because it's the one place a session's scope changes without a re-login, it is
guarded hard:

1. **Audit + emit on every transition, both directions.** Descending into a customer
   and ascending back each write an `identity`-namespace event (e.g.
   `identity:shadow.descended` / `identity:shadow.ascended`) carrying `{ actorEmail,
   fromScope, toScope: {tenantId, role} }` — so the platform log and the customer's
   own queue both show exactly when staff entered/left their space.
2. **Popup acknowledgment on transition.** A modal confirms the move — *"You are now
   acting as Company Admin in **Immobileyes**. Everything you do here is logged to
   their audit trail."* on the way down, and *"You're back on the RFP Pipeline
   platform."* on the way up — so the employee is never unsure which space they're in.
3. **Server-authoritative re-scope.** The active membership in the server session is
   rewritten (not a client toggle); RLS + route authz immediately read the new
   singular membership; tenant caches drop.

Everything below serves this: memberships enumerate the *choices*; the session pins
exactly one; RLS + route authz read that one.

## Why the current model can't do it

`users` is identity **and** membership fused into one row:

- `users.email` is **UNIQUE** (`users_email_key`) — one row per person.
- `users.tenant_id` (single, nullable FK) + `users.role` (single) — one company,
  one role.

So inviting an already-existing email as a collaborator at a *second* company would
**overwrite** their first company/role (the `ON CONFLICT (email)` path in the
collaborator route sets `tenant_id = EXCLUDED.tenant_id`). The multi-company case is
not merely unsupported — it silently clobbers.

## The model

Split **identity** from **membership**.

```
users            -- pure identity (global)
  id, email (unique), name, password_hash, is_active

user_memberships -- one row per (person, company, role) they may act as
  id, user_id -> users.id,
  tenant_id  -> tenants.id,   -- ALWAYS a real company, incl. OUR org (see below)
  role        (master_admin|rfp_admin|tenant_admin|tenant_user|partner_user),
  status      (active|invited|revoked),
  scope       (jsonb — e.g. partner_user section grants live here or via
               proposal_collaborators, keyed by membership),
  created_at, created_by
  UNIQUE (user_id, tenant_id)     -- at most one membership per company per person
```

**Everyone is email + a real company — including us.** Our organization is a
first-class `tenants` row (e.g. "RFP Pipeline"), not a NULL/platform special case,
because our people are customers too. So:

- **Our employee** → membership `(our tenant, rfp_admin/master_admin)` — and, being
  a customer as well, they can *also* hold `(our tenant, tenant_admin)` build access
  and `(some customer tenant, partner_user)` collaborator access.
- **Customer owner** → membership `(their tenant, tenant_admin)`.
- **Cross-company collaborator** → one membership per company `(tenant, partner_user)`.
- The same email can hold all of the above simultaneously; each is a separate,
  independently-revocable row.

> **Events-convention note.** Today "admin events → `tenantId = null`" (CLAUDE.md).
> Once our org is a real tenant, a platform-admin action can be attributed to *our
> tenant* instead of null. Decision to lock before P2: keep `null` for genuinely
> platform-wide/cross-tenant admin actions (triage across all customers) and use our
> tenant only when the action is scoped to our own company. (Least-ripple: keep the
> `null` convention for cross-tenant admin surfaces; attribute in-company actions.)

## RFP-admin default: shadow-admin-as-company-admin (the T&C floor)

For now — and as the **default written into the customer terms & conditions** —
**every RFP-admin identity is an admin + shadow admin in *every* customer tenant.**
Rather than materialize an `(admin × tenant)` row per customer, this is a **derived
membership**: any `rfp_admin`/`master_admin` identity is offered a shadow membership
in every active tenant.

The critical rule (data integrity, as previously agreed): **when an RFP admin moves
down into a tenant's space, they always assume the `tenant_admin` (company-admin)
role — never `rfp_admin`.** So inside a customer, an employee is indistinguishable
from a real company admin for the purposes of RLS, authorization, and business
rules; the only trace that it was staff is the audit actor (email@ours) on the
company's queue. There is no elevated "admin acting" mode that could bypass a
company-level constraint — the shadow admin *is* a company admin while down there.

Concretely: the derived shadow membership an RFP admin selects at login (or via the
existing shadow-admin ToDo hop) resolves to `{ tenantId: <customer>, role:
'tenant_admin' }`. This is the membership form of today's `assumeShadowAdmin`
(`shadow_admin_grants`) — now a first-class option in the membership selector.

## Login → membership selection

1. Authenticate the **identity** (email + password) — unchanged.
2. Load the person's **active memberships**.
   - 0 active → deny ("no active access").
   - 1 active → auto-select (today's behavior, zero friction).
   - \>1 active → show a **"Continue as…" selector**: *RFP Admin · Platform* /
     *Admin · Acme Navy Systems* / *Collaborator · Beacon Labs*.
3. The chosen membership becomes the session's **active membership**:
   `{ userId, email, name }` (identity) + `{ membershipId, tenantId, role }` (active).
4. **In-session switching is RFP-admin-only.** A customer/collaborator has no switch
   control — their membership is pinned until logout (change company = log out + log
   back in). Only RFP-admins get the descend/ascend control, and it follows the
   controlled-transition rules above (audit + emit + ack modal + server re-scope).
   Everyone's session holds exactly one active membership at all times.

## Enforcement (the tight part)

Everything scopes off the **selected membership**, never `users.tenant_id`:

- **RLS:** the `app.tenant_id` GUC (`withTenant`) is set from
  `session.active.tenantId`.
- **Route auth:** `verifyTenantAccess(userId, tenantId)` becomes a **membership
  lookup** — an `active` row for `(userId, tenantId)` — and the role check uses
  `session.active.role`. A user with a valid identity but no active membership for
  the requested tenant is denied, even though the person exists.
- **Middleware landing:** routes to the home surface of the *active* role.

## Audit attribution

Every event already carries `actor {id, email}` + `tenant_id`. Under this model the
`tenant_id` is the **active company** and we add the **active role** to the actor/
payload, so every row reads **"email · role · company"** — including an employee
acting inside a customer's space (email@ours → partner_user · Customer Y). This is
the same audit spine from #109/#100, now fully attributed. (Ties to task #110.)

## Reconciliation with the as-built model

`docs/IDENTITY_AUTHZ_MODEL.md` documents today's deliberate choices, which this
design **intentionally revisits**:

- **Login is `email` alone**; an earlier `tenant_memberships` table was *collapsed*
  into `users.tenant_id`. This design **re-introduces** that junction (as
  `user_memberships`) — the earlier collapse was for simplicity when one company
  per person was assumed; that assumption no longer holds.
- Three separate mechanisms exist that `user_memberships` **unifies** into one
  login-selectable concept:
  1. **Home membership** = `users.tenant_id` + `role` → a `(tenant, role)` membership.
  2. **RFP shadow admin** = `shadow_admin_grants (source='t_and_c')` (god-view into
     any tenant) → the **derived** `(every tenant, tenant_admin)` shadow membership.
  3. **Cross-company collaborator** = `proposal_collaborators` (+ `partner_user`) →
     a `(that tenant, partner_user)` membership, with the per-section grants staying
     in `collaborator_stage_access`.
- This also closes the documented §4 gap (routes that check tenant membership but
  not per-section `resolveUserAccess`): with the active membership explicit in the
  session, the coarse gate and the fine-grained scope resolve off the same source.

**Coexistence, not big-bang.** `proposal_collaborators` / `collaborator_stage_access`
/ `shadow_admin_grants` remain the source of the *grant*; `user_memberships` is the
**materialized, login-selectable projection** of them (+ the home row). P1 backfills
it from all three; later phases can make the grant-writers also write the membership.

## Migration / rollout (compatible, phased)

- **P1 — schema + backfill (no behavior change).** Create `user_memberships`;
  backfill one membership per existing user from their current `(tenant_id, role)`.
  Point `verifyTenantAccess` at memberships. With exactly one membership each, the
  system behaves identically to today.
- **P2 — session + selector.** Session carries the active membership; login shows
  the selector only when >1 active; RLS + route auth read the active membership.
- **P3 — collaborator invites become memberships.** The proposal-collaborator
  invite path INSERTs a `(tenant, partner_user)` membership instead of overwriting
  `users.tenant_id` — the multi-company case now works.
- **P4 — retire the fused columns.** `users.tenant_id` / `users.role` become
  deprecated (read-through during transition), then dropped once all callers read
  the active membership.

Each phase is independently shippable and screenshot-verifiable (the login selector
and the "switch company" flow are the customer-facing manual pieces).

## Implemented so far (as-built)

- ✅ **P1 foundation** — `user_memberships` (mig 111) + backfill; `verifyTenantAccess`
  reads memberships (legacy read-through). Isolation verified.
- ✅ **P2 selector** — one login → `/select-company` when >1 active membership;
  single-membership + admins go straight through. Drive-tested.
- ✅ **Collaborator scoping** — a scoped collaborator only *receives* their granted
  sections (server-side withhold); pricing/unassigned never leak.
- ✅ **Universal upload + atomizer** — an "Add content" card on the customer dashboard
  AND the collaborator view; collaborators atomize to *offer content up*
  (`atoms/atomize-package` now allows `partner_user`, membership-gated).
- ✅ **RFP-admin shadow descend/ascend** — banner + first-entry acknowledgment modal;
  `identity:shadow.descended` / `.ascended` audited both directions.
- ✅ **Singular ENFORCEMENT** — the active membership is pinned in the **session JWT**,
  not a side cookie. Picking a company at `/select-company` calls `unstable_update`
  (`app/actions/auth-actions.ts`) to **rewrite the token's `role` + `tenantId` +
  `tenantSlug` to the SELECTED membership** and set `membershipPinned = true`. So the
  session doesn't merely pin a *tenant* — it pins a **(company, role)**, and every
  downstream reader (portal layout, all ~40 portal API routes, middleware) authorizes
  off that one membership. Concretely:
  - **Role follows the company.** A `tenant_admin`-at-home who is only a
    `partner_user` elsewhere is dropped to `partner_user` on selecting that company —
    no home-company powers carry across. (JWT-rewrite is what makes this reach the
    routes without touching each one.)
  - **Re-pick-proof.** Once `membershipPinned`, `/select-company` forwards to the
    active company instead of re-offering the list; the dispatcher skips the selector;
    the portal layout redirects any tenant ≠ the pinned one back. No in-session switch.
  - **Logout resets it.** The pin lives in the JWT, so signing out drops it and a
    fresh login starts unpinned (that's how "log out to switch" works).
  - **Fail-closed safety net.** `verifyTenantAccess` now also caps a non-admin's
    active role to the role they were actually granted at that tenant (`db.ts`
    `hasRoleAtLeast(membershipRole, sessionRole)`), so even if the rewrite ever didn't
    take, routes deny (never escalate) rather than leak cross-tenant privilege.
  - **RFP/master admins are exempt** — they are the only accounts that re-scope
    in-session (the shadow descend/ascend flow), so the layout never pins them.

  Verified end-to-end (`scripts/drive-pin.mts`): a multi-membership user picking a
  company where they're only a collaborator is rewritten to `partner_user`, pinned,
  cannot hop to their home tenant, and `/select-company` is re-pick-proof; a
  single-membership user and an admin are unaffected. tsc clean, 701/701 unit tests.
- ✅ **P3 — collaborator invite → membership.** The proposal-collaborator invite path
  now INSERTs an `active` `(tenant, partner_user|tenant_user, source='collaborator')`
  membership (`ON CONFLICT (user_id, tenant_id) DO NOTHING`, never downgrading an
  existing one) **without touching `users.tenant_id`** — so a cross-company
  collaborator's home is preserved *and* they can actually reach the inviting tenant's
  portal (the singular-session gate is membership-based; their `users.tenant_id` points
  at their own company). This is what makes the multi-company collaborator case work
  for real invites, not just seeded data.

## Never hard-delete a user — deactivate, keep history, reconstitute (auditable)

**A person IS their email** (email is the person-UUID; email+company is the membership
key). Over time an org accumulates many deactivated users who may later come back, and
that whole arc must stay auditable. So **no user or membership is ever hard-deleted** —
removal is a soft, reversible, audited state:

- **`users.is_active`** = the account on/off. **`user_memberships.status`**
  (`active|invited|revoked`) = a specific (company, role) on/off.
  **`proposal_collaborators.revoked_at`** (mig 112) = a specific proposal grant on/off.
- **Removal marks inactive; the row stays.** Access-granting reads filter the inactive
  state (`revoked_at IS NULL` / `status='active'` / `is_active=true`), so a removed
  person loses access immediately — but history views still show them, badged inactive
  (the Team Members list keeps a removed collaborator; the Access Matrix drops them).
- **Re-inviting reconstitutes the SAME row** (`revoked_at → NULL`, `status → active`);
  the event trail records `reactivated: true` — a reconstitution, not a new identity.
- **As-built for collaborators** (2026-07-19): mig 112 `revoked_at`; the remove endpoint
  soft-revokes the collaborator + its stage access + (if it was their last active
  collaboration at the tenant) the `collaborator` membership; the invite endpoint
  reactivates a revoked row instead of erroring/duplicating; the accept link is dead once
  revoked; all six collaborator access reads filter `revoked_at`. Verified end-to-end
  (`scripts/drive-p3-lifecycle.mts`): the row persists as revoked, still shows in history,
  and re-invite revives it.
- **Audited: no code path hard-deletes a user or membership** (swept 2026-07-19). The
  general deactivate/reactivate surface for higher roles (tenant_users/admins via
  `users.is_active` + `user_memberships.status`, plus an inactive-members view) is the
  next step — same pattern, tracked as a gap (#118).
