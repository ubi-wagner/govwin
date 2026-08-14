# EconDev Partner-Admin — owner-scoped tenant partition

The model for Economic-Development groups (the Entrepreneurs' Center, other EDOs) that run a
**stable of client companies** on the platform: a partner creates + owns those companies as tenants,
gets them auto-provisioned (buckets + pipeline + starter library) with **no Stripe**, and sees **only
their own stable** — never another partner's or another customer's data.

## The role: `partner_admin` (fail-closed)
A new base RBAC role at **rank 50** — deliberately **below `rfp_admin` (80)**. Because every existing
`/admin` and `/api/admin` route is gated at `rfp_admin`, `partner_admin` is **denied the global
god-view by rank** (fail-closed): even if a route were missed, a partner cannot reach it. It reaches
only:
- **`/partner` + `/api/partner`** — the owner-scoped surface (guarded at `partner_admin`; handlers also
  re-check `canManagePartnerTenants` + `owner_id = self`).
- **`/portal/*` for tenants it holds a membership on** — the normal, tested, tenant-scoped portal.

`rfp_admin`+ also satisfy `canManagePartnerTenants` (platform operators oversee everything).

## Ownership: `tenants.owner_id`
Nullable FK `tenants.owner_id → users(id)`. `NULL` = platform-owned (every pre-existing tenant is
unchanged). A `partner_admin` who creates a company gets `owner_id = self`, and the `/partner` list is
scoped `WHERE owner_id = me` — so two EconDev partners never see each other's stables.

## Create flow (`POST /api/partner/tenants`)
1. Insert the tenant with `owner_id = partner`.
2. Grant the **partner** a `tenant_admin` **membership** on it → they enter + build via the normal
   portal (no global power; the tested membership-scoped path).
3. Optional founder POC (`adminEmail`) → seeded `tenant_admin` + membership ("he staffed them").
4. Auto-provision: `seedDefaultBuckets` + `backfillTenant` (opportunity pipeline/cards) +
   `copyStarterSetToTenant` (starter library). **No Stripe** — the comp/bypass model for EconDev clients.

## Why this is safe to ship
- **Fail-closed by rank:** a new role denied every existing admin route; no cross-customer exposure
  even if a scoped route is incomplete.
- **Additive schema:** `owner_id` is nullable; existing tenants and roles are untouched.
- **Reuses tested paths:** in-tenant work happens through the existing membership-scoped portal.

## Not yet (future)
- Auto-landing `partner_admin` on `/partner` after login (today they navigate there; middleware allows it).
- A partner-facing team/invite UI inside each owned company (today: the founder POC on create + the
  existing portal invite).
- A vault-style `owner_id` RLS policy (belt-and-suspenders atop the rank/handler scoping; the
  `govtech_app` RLS layer is already live).

## Seeded partner
Paul Jackson (Entrepreneurs' Center), `pjackson@ecinnovates.com`, seeded `partner_admin` in mig 157
with a temp password (forced reset), owning **Foundation** as his first company.
