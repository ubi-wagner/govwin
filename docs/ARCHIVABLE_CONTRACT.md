# Archivable Artifacts — the canonical contract (corrected model)

Archive is a **soft, reversible** state for **sorting + visibility**: it hides an entity from active
views but keeps the row in indexed Postgres. **Nothing is ever hard-deleted.** When indexed Postgres
gets large, archived rows are bulk-moved to **S3 cold storage** (pointed to as needed) by a future
sweep — `archived_at` is the watermark it reads. Do not build a delete/purge.

## Archive ACTIONS live on exactly three entities — nothing else

| Entity | Table | Actor | Action + cascade |
|---|---|---|---|
| **Portal / pipeline** (a proposal build) | `proposals` | tenant_admin+ | Archive the proposal → **cascade** its workflow instances (same tenant+opportunity). Restore un-archives both. |
| **Library atom / foundational doc** | `library_atoms` | tenant_admin+ | Archive an atom → it drops out of the library + **draft selection** (`archived_at IS NULL` on every list/count/selection query). Atoms are **copied forward** into proposals, so archiving breaks nothing downstream and needs **no cascade** — it just means "can't be selected unless unarchived." Restore re-enables selection. |
| **Tenant** | `tenants` | rfp_admin+ | Archive a tenant (license slumber) → **cascade** its workflow instances (`process_instances.archived_at`). Every proposal + tenant-scoped surface goes dark at the `verifyTenantAccess` gate, which reads `tenants.archived_at` — so no per-proposal write is needed. Restore lifts the gate + un-archives the workflows it cascaded (except those under a still-archived portal). |

**Workflows (`process_instances`) are instantiated templates — NO archive action of their own.** They
archive *because* their parent pipeline or tenant was archived. Keep the `archived_at IS NULL` filters
on every active-view process_instances query (so cascade-archived workflows drop out), but never a
standalone archive button/route.

**Opportunity cards are NOT an archive target.** (Reverted.)

## The rules for the three archivable entities

1. **State** — nullable `archived_at TIMESTAMPTZ` (mig 148). Archived ⇔ `archived_at IS NOT NULL`. Soft only.
2. **Archive action** — `archived_at = now()` (compare-and-swap `WHERE ... AND archived_at IS NULL`),
   plus **cascade** to children the parent owns (workflow instances for a portal/tenant). An atom is
   **per-item** — copied-forward into proposals, so **no cascade** (archiving only excludes it from
   library + draft selection). Restore NULLs `archived_at` and un-cascades. Idempotent; 409 on no-op.
3. **Filter every active-view query** — the entity AND its cascaded children filter `archived_at IS
   NULL` in every active list/count. A missed query leaks archived rows back in. Enumerate all sites.
4. **Audit** — `<namespace>:<entity>.archived` / `.restored` via `lib/events`, tenant-scoped where the
   entity is (proposal/library/finder per docs/NAMESPACES.md). Never `admin`/`cms`/`spotlight`.
5. **Surface + restore** — an archive action on the entity + an Archived view with restore. Retrievable.

## Reference implementation
Portal: `frontend/lib/proposal-archive.ts` (`archiveProposal`/`restoreProposal` + workflow cascade),
`app/api/portal/.../proposals/[p]/archive/route.ts`, `components/portal/archive-portal-button.tsx`,
`components/portal/archived-proposals.tsx`.
