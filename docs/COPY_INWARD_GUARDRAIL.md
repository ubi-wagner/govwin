# Copy-inward-only sharing — no cross-tenant shared objects (#118)

**Invariant:** every "share" duplicates content **into** the recipient's own space (a new row carrying the
recipient's `tenant_id`); there are **no objects referenced across a tenant boundary** and no object owned
by two tenants. Reuse = copy, never a live cross-tenant link. This is a hard data-segregation guardrail.

## Enforced in code (copy = new row, target tenant)

Every copy/reuse/seed path writes a fresh row scoped to the **target** tenant:
- **system_starter → new tenant** (`lib/library/foundation.ts`, `starter-set.ts`, `starter-offer.ts`):
  builds each grain via `createAtom(targetTenantId, { …fresh content… })` — the atom is CREATED with the
  target tenant's id and fresh content; it does not reference the source (system) tenant's rows. All reads
  filter `WHERE tenant_id = ${targetTenantId}`.
- **reuse a past proposal** (`lib/documents/duplicate-past-proposal.ts`), **seed-job** mapper, **atom harvest**
  (`lib/proposal-atom-harvest.ts`): all write into the actor's **own** tenant; a named target must belong to
  the actor's tenant (createTask / verifyTenantAccess), and cross-tenant is refused.
- The Canvas redesign deliberately **deferred a shared *atom* library** (docs/CANVAS_BUILD_LOG.md) — there is
  no shared-object store by design; each tenant holds its own copies.

## Proven in data (0 cross-tenant references)

Live integrity sweep of every tenant-scoped source pointer:
- `library_atoms.origin_proposal_id` → a proposal in a **different** tenant: **0**.
- `library_atoms.origin_section_id` → a section under a different tenant's proposal: **0**.
- `canvas_versions.parent_version_id` crossing sections: **0**.
- `proposal_sections` content referencing another tenant's atoms (`sourceAtomIds`): **0**.

So no atom, version, or section points across a tenant boundary — the copies are self-contained.

## Isolation backstop (already proven live)

- **C1 (#108):** seed-job reuse — own-tenant allowed, **cross-tenant denied** (live drive).
- **EMB-6 (#145):** `atom_embeddings` tenant-isolated; hybrid retrieval ranks own-tenant atoms only.
- **KEEP+COPY (#71):** the eager starter copy into a new tenant proven isolated (both provisioning paths).
- **RLS cutover (mig 136/137, docs/RLS_CUTOVER.md):** `library_atoms` + friends are FORCE-RLS with a
  `tenant_isolation` policy; the app-layer `WHERE tenant_id` is backed by RLS: the app runs
  as the `govtech_app` non-owner role, so the `tenant_isolation` policy enforces.

## Verdict
Sharing is copy-inward only. No cross-tenant shared objects exist (0 in data), the copy paths create
target-tenant rows, and cross-tenant access is refused at the app layer with an RLS backstop behind it.
Guardrails / data segregation intact.
