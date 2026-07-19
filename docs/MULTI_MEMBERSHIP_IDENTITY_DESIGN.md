# Multi-membership identity — design

**Status:** proposed (design-first; implement in phases).
**Problem it solves:** a person is **email + company + role**, but one email can hold
**many** of those at once. A consultant is a scoped collaborator at Acme *and* at
Beacon; one of our employees is an RFP admin on the platform *and* a tenant_admin
of their own company *and* a collaborator inside a customer's proposal. These
businesses work with each other, so the same identity legitimately spans tenants —
which is exactly why tenant scope must be **enforced**, never inferred.

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
4. A **"Switch"** control re-selects among active memberships without re-auth.

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
