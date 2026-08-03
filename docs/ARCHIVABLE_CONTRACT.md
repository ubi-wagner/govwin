# Archivable Artifacts — the canonical contract

**Standing policy:** every user-sortable artifact gets an **archive action**. Archive is a *soft,
reversible* state for **sorting + visibility** — it hides the artifact from active views but keeps the
row in indexed Postgres. It is **not** a delete and **not** cold storage. Moving archived rows out of
indexed Postgres ("when it gets huge") is a separate, later sweep, out of scope here.

Reference implementation: **proposals** — `frontend/lib/proposal-archive.ts` +
`frontend/components/portal/archived-proposals.tsx` + `app/api/portal/.../proposals/[p]/archive/route.ts`.

## The five rules (every archivable artifact MUST satisfy)

1. **State** — a nullable `archived_at TIMESTAMPTZ` (mig 148 added it to process_instances,
   tenant_opportunity_cards, library_atoms, contracts; proposals/tenants already had it). Archived ⇔
   `archived_at IS NOT NULL`. Never a hard delete.

2. **Actions** — `archive` sets `archived_at = now()` (compare-and-swap: `WHERE ... AND archived_at IS
   NULL`); `restore` sets `archived_at = NULL`. Both idempotent, both guarded by the artifact's normal
   auth (tenant-scoped artifact → tenant_admin+ with tenant access; platform artifact → rfp/master admin).

3. **Filter EVERY active-view query** — this is the load-bearing rule. Every query that lists/counts the
   artifact for an *active* view MUST add `AND archived_at IS NULL` (or an explicit `show_archived`
   opt-in). A missed query = archived rows leak back into active views. When implementing, enumerate
   **all** the artifact's list/count query sites and filter each; the verifier will ask for that list.

4. **Audit** — emit `<namespace>:<artifact>.archived` and `.restored` (start/end, or single) via
   `lib/events`, tenant-scoped where the artifact is. Namespaces: `proposal`/`capture`/`library`/`finder`
   /`system` per docs/NAMESPACES.md — pick the one that owns the artifact. Never `admin`/`cms`/`spotlight`.

5. **Surface** — an archive button on the artifact + a way to *see* archived ones (a collapsible
   "Archived (N)" section or a filter toggle) with a **restore** action. Archived items stay retrievable.

## Per-artifact map (this pass)

| Artifact | Table | Namespace | Active-view query sites to filter | Archive surface |
|---|---|---|---|---|
| Proposal | proposals | proposal | proposals list ✓ | Archived section ✓ (done) |
| **Workflow** | process_instances | system | admin workflow monitor list + counts | admin monitor: Archive action + Archived filter |
| **Opportunity card** | tenant_opportunity_cards | capture | /cards list + rollup views + card counts | card Archive action + Archived filter |
| **Library atom** | library_atoms | library | atom library list + selection queries + counts | atom Archive action + Archived filter |
| **Contract** | contracts | capture | admin contract rollup/count (admin/opportunities) | Archive action on closed/terminated contracts |

## Retention / cold storage (LATER — not this pass)
A future sweep may move rows archived beyond a window out of indexed Postgres. `archived_at` is the
watermark it will read. Do not build the purge here; archive is for sorting/visibility now.
