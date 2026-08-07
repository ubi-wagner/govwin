# Partner‑Manager Actor — Canonical Design

**Status:** as‑built spec (V1). Supersedes the create‑only slice in `docs/ECONDEV_PARTNER_ADMIN.md`
(which remains the origin note for the `partner_admin` role + `tenants.owner_id`). Read that first
for the role/rank rationale; this doc is the full actor.

**Actor:** the **partner‑manager** — an Economic‑Development operator (role `partner_admin`, RBAC
rank 50) who runs a **stable** of client companies as tenants and is *themselves* a higher‑order
tenant (their own org, for grants etc.). The canonical instance is Paul Jackson
(`pjackson@ecinnovates.com`) of the **Entrepreneurs’ Center** (legal: *Miami Dayton Entrepreneurs’
Center*, https://ecinnovates.com).

The partner is **not** an RFP admin. It never reaches `/admin` (denied by rank), never sees another
partner’s stable, and every company it creates goes through the **same RFP‑admin approval** a public
applicant does — the partner is a *privileged front door for onboarding*, not an approver.

---

## 1. Locked decisions (the six forks)

| # | Decision | Choice |
|---|---|---|
| D1 | "Manager" representation | A **`tenant_admin` membership** with **`source='partner_manager'`**. Acting power comes from the tenant_admin rank (reuses the whole tested portal); the source flag marks it as an external‑manager grant for UI/audit/removal. **No new role.** |
| D2 | Descend / ascend | **Scoped smooth‑pin + "Exit to partner console."** Reuse `/api/enter`’s pin; relax the singular‑session `/go` re‑login gate **only** for tenants the partner owns/manages. An explicit exit un‑pins back to `partner_admin` + `/partner`. |
| D3 | New‑company path | **Approval‑gated** via the existing `applications` pipeline (partner‑tagged). This **replaces** today’s instant‑create in `/api/partner/tenants` POST. |
| D4 | Partner’s own org | **Provision a home org tenant** per partner (`kind='partner_org'`). Paul → Entrepreneurs’ Center; it becomes his `users.tenant_id` home + a `home` membership. |
| D5 | "Unique tenant email" | Unique = **no existing *active* `home` or `partner_manager` membership** with that email (not already a company’s owner/admin login). The **same email may** be a `collaborator`/`partner_user` elsewhere. |
| D6 | Name‑collision threshold | `pg_trgm similarity(name) ≥ 0.45` (tunable via `PARTNER_NAME_MATCH_THRESHOLD`) flags review; a normalized‑exact match forces the existing‑tenant branch. |

---

## 2. Data model (mig 158, additive + idempotent)

```
user_memberships.source  += 'partner_manager'      -- external manager grant (CHECK extended)
tenants.kind             TEXT NOT NULL DEFAULT 'standard'
                           CHECK (kind IN ('standard','partner_org'))   -- 'partner_org' = a partner's own org
applications.source      TEXT NOT NULL DEFAULT 'public'
                           CHECK (source IN ('public','partner'))       -- partner registration variant
CREATE INDEX idx_tenants_name_trgm ON tenants USING gin (name gin_trgm_ops);  -- fuzzy name match
```

- The partner’s **own org** = the tenant with `kind='partner_org'` AND `owner_id=partner`.
- A **client company** in the stable = a tenant with `owner_id=partner` (created) OR a
  `partner_manager` membership for the partner (granted), and `kind='standard'`.
- `applications.metadata.partnerId` (UUID) attributes a partner registration; `metadata.partnerNotes`
  carries the partner’s free‑text notes. No new columns for phone/description — the `applications`
  row already carries `contact_phone`, `company_*`, `tech_summary`, `motivation`, `metadata`.

Nothing is destructive; every existing tenant keeps `kind='standard'`, every existing application
`source='public'`.

---

## 3. Surfaces

### 3a. `/partner` console (higher‑order home)
- **Own‑org card** — the partner’s `partner_org` tenant: quick stats + "Open my org workspace"
  (a normal tenant‑admin portal where they run buckets, portals, grant proposals).
- **Stable** — one **rollup card per company** they own or manage: name, **admin POC**
  (the tenant’s `tenant_admin`/`home` user), **# buckets**, **# pins (cards)**,
  **# pipelines (portals/proposals)** + status mix, and **Open workspace →** (descend).
- **Add company** button → the precheck + 3‑branch flow (§4).
- Owner‑scoped: the console reads only `owner_id = me ∪ partner_manager memberships of me`.

### 3b. Descend / ascend (D2)
- **Descend:** `POST /api/partner/enter` (or `/api/enter` extended) verifies the target is in the
  partner’s scope, then pins the session as `tenant_admin` at that tenant (`source` of the pin is
  the real membership). No `/go` gate between the partner’s own tenants. The JWT carries
  `partnerHomeRole:'partner_admin'` so ascend can restore identity.
- **Act:** inside the tenant they are a normal `tenant_admin` — **zero new in‑portal authz surface**.
- **Ascend:** a persistent **"Exit to partner console"** chrome affordance →
  `POST /api/partner/exit` un‑pins (role→`partner_admin`, clears `tenantSlug`) → `/partner`.
- **Banner:** while descended, the portal shows *"Managing <Company> as Entrepreneurs’ Center — Exit."*

### 3c. Authorization invariants (unchanged spine)
- `verifyTenantAccess` still gates every tenant route: admins short‑circuit; everyone else is
  membership‑based with fail‑closed role‑capping. The partner passes **only** where they hold an
  active `tenant_admin` (`source` ∈ `home`/`partner_manager`) membership. Owning a tenant without a
  membership grants **no** portal access — creation/approval always writes the membership too.
- `partner_admin` (rank 50) never satisfies the `/admin` guard (rank 80). The `/partner` +
  `/api/partner` prefixes require `partner_admin`; handlers re‑check `canManagePartnerTenants` **and**
  ownership/scope on every row.

---

## 4. Add a company — precheck then 3‑branch

**Step 1 (always):** partner enters **company name + admin name + admin email**.
`POST /api/partner/tenants/precheck` returns:
- `similar[]` — tenants with `similarity(name) ≥ threshold` (D6),
- `exactExistingTenant?` — normalized‑exact tenant match,
- `emailInUseAsAdmin?` — the email already holds an active `home`/`partner_manager` membership (D5).

**Branch A — looks new (no collision, email free):** → thin onboarding form, pre‑filled with the
three fields + phone, company info, description, **partner notes** → `POST /api/partner/registrations`:
- inserts `applications(source='partner', status='pending', metadata.partnerId=me)`,
- emits `capture:application.submitted` (partner variant),
- `createTask({assigneeRole:'rfp_admin', taskType:'partner_registration_triage', entityType:'application'})`.
- **RFP admin accepts** (existing `/admin/applications/[id]/accept`, partner‑aware branch): provisions
  tenant+user+buckets+cards+library **and** sets `tenants.owner_id = partnerId` + a `partner_manager`
  membership for the partner → the company lands in the stable, fully provisioned.

**Branch B — matches an existing tenant** (exact, or partner confirms a `similar[]` row *is* the same
company): → **request manager**. `POST /api/partner/manager-requests`:
- `createTask({assigneeUserId:<that tenant’s admin>, taskType:'manager_request', entityType:'tenant', entityId})`
  + `finder:partner.manager_requested`. Guarded against a duplicate/existing membership.
- The **company admin** sees the ToDo in their portal → **approve** grants the partner a
  `partner_manager` membership (reusing the team‑add membership insert) + `finder:partner.manager_granted`;
  **decline** closes it + `finder:partner.manager_declined`. This is the request‑side of the *same*
  grant a company makes when it **directly** adds a manager (§5).

**Branch C — similar but partner confirms new:** an audited override
(`finder:partner.company_dedup_reviewed {decision:'confirmed_new'}`) → proceeds as Branch A.

---

## 5. Company‑initiated manager grant (the existing‑companies path)

A tenant company can already add people via `/portal/[slug]/team` (direct add: tenant_admin →
user + `home` membership + invite email). This design adds a **"manager"** grant option there: the
company admin adds the partner’s email as a manager → a `partner_manager` membership (not `home`) +
`finder:partner.manager_granted`. This is the **same terminal grant** as Branch B’s approval — the
two paths (partner requests / company offers) converge on one membership write, so the company always
consents. `partner_user` collaboration (today’s cross‑company invite) is unchanged and orthogonal.

---

## 6. Events / audit (namespaces per CLAUDE.md)

| Event | When |
|---|---|
| `finder:partner.company_dedup_reviewed` | precheck decision (new / existing / confirmed‑new) |
| `capture:application.submitted` (`metadata.partnerId`) | partner registration submitted |
| `capture:application.accepted` (existing) | RFP admin approves (partner branch sets owner) |
| `finder:tenant.created` (existing, `via:'econdev_partner'`) | provisioning on accept |
| `finder:partner.manager_requested` / `.manager_granted` / `.manager_declined` | handshake lifecycle |
| `finder:partner.entered` / `.exited` | descend / ascend (audited, tenantId set) |

Admin events `tenantId=null`; portal/tenant events carry the real tenant UUID (CLAUDE.md SOP: Events).

---

## 7. Test plan (Phase 6)

- **Unit:** name‑match (trgm + exact + threshold), precheck (all three signals), registration submit
  (partner dedup, not domain‑based), accept‑with‑owner (owner_id + membership set; public accept
  unchanged), manager‑request create + approve/decline, partner scope guards (denies out‑of‑scope
  tenants), rollup counts.
- **E2E (Playwright):** (1) partner login → console cards → **new company → RFP approve → appears in
  stable → descend → build a proposal → ascend**; (2) **name collision → manager request → company
  approves → appears**; (3) **company directly adds the partner as manager**.
- **Backbone:** `tsc` 0 · `vitest` · `migrate --check` · `next build` · E2E green.

---

## 8. Invariants (non‑negotiable)

1. **Consent:** a partner never gains access to a company it didn’t create without that company’s
   admin approving (Branch B / §5). Creation always routes through RFP‑admin approval (D3).
2. **Isolation:** owner‑scoped everywhere; a partner sees only its stable. No `/admin` reach.
3. **Reuse over rebuild:** provisioning = the accept route’s helper stack; grant = the team‑add
   membership insert; descend = the existing pin + tested tenant portal. New code is thin glue.
4. **Nothing hard‑deleted:** manager removal revokes a membership (never‑delete); declines close tasks.
