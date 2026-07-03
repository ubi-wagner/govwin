# Library Convergence Status — `library_units` → `library_atoms`

**Date:** 2026-07-03 · **Branch:** `claude/nice-hamilton-kBqtD`
**TL;DR:** The greenfield atom loop is **closed and proven end-to-end** on the
single `library_atoms` surface. The legacy `library_units` library is the
**obsolete parallel** — still live, still read by admin analytics + agent tools,
so it is **deprecate-in-phases**, not rip-out-now (especially pre-HITL).

---

## 1. The two libraries (the split-brain)

| | Greenfield (CANONICAL) | Legacy (OBSOLETE) |
|---|---|---|
| Table | `library_atoms` (+ `atom_tags`, `atom_members`, `atom_lineage`, `document_cocoons`) | `library_units` |
| Customer page | `/portal/[t]/atoms` → `AtomsWorkbench` (Library + Atomize tabs) | `/portal/[t]/library` → `LibraryDashboard` |
| Upload → atomize | `atoms/upload` (register `reference` + return blocks) → POST `/atoms` (primitive/group, `source_anchor` → ref) | `library/upload` → `library/atomize` (writes `library_units` rows) |
| Mold selector | `/atoms/select` (`selectForSection`, tag-scored) | `library/similar`, `library-search-atoms` tool |
| Return on lock | `harvestSectionToAtomLibrary` → `library_atoms` (S4) | `harvestSectionToLibrary` → `library_units` |

Both fire on section lock today (`sections/[sectionId]/lock/route.ts` calls **both**
harvests). Everything the mold/draft/return loop reads and writes is `library_atoms`;
`library_units` is written but no longer feeds the canonical customer loop.

## 2. The greenfield loop is closed — proven end-to-end

`atomizer → library → mold → draft → atoms-back-in-the-library`, all on `library_atoms`:

1. **upload** (`atoms/upload`) → a `reference` atom + deconstructed blocks
2. **register** (POST `/atoms`) → a `primitive`, `source_anchor` → the reference
3. **mold** (`/atoms/select`) → ranks the primitive **and** records it as the
   section's `meta.sourceAtomIds`
4. **lock** → `harvestSectionToAtomLibrary` returns a **derivative** atom
   (`source='download_derivative'`, bound to the proposal's `document_cocoon`,
   tagged by vol, `atom_lineage` **derived_from** the source atoms) — a child that
   can become a parent for the next mold.

Idempotent by section: lock → unlock → re-lock **refreshes the one derivative in
place** (matched on `origin_section_id` + `source`); a parent's `usage_count` only
bumps when the lineage edge is newly inserted (`createAtom.idempotentBySection`).

**Regression coverage (driven against a live instance):**
- `e2e/fullloop.tenant.spec.ts` — the whole loop in one flow (upload → primitive →
  mold → lock → return-with-lineage).
- `e2e/atomloop.tenant.spec.ts` — the return leg + idempotency (re-lock never
  duplicates; source atom's lineage doesn't inflate).
- `e2e/library.tenant.spec.ts` — visibility/ownership (admin sees all; collaborator
  sees tenant-shared + own).

## 3. Legacy `library_units` surface — the obsolete inventory (24 files)

**A. Customer library UI + API (replaced by `/atoms`):**
- `app/portal/[t]/library/page.tsx`, `library/review/page.tsx`
- `app/api/portal/[t]/library/route.ts`, `library/[unitId]/route.ts`,
  `library/upload/route.ts`, `library/atomize/route.ts`, `library/similar/route.ts`
- `components/portal/library-dashboard.tsx`, `library-upload-form.tsx`,
  `bulk-upload.tsx`, `components/atomization/atom-bubble-rail.tsx`

**B. Legacy harvest (parallel to the S4 return):**
- `lib/proposal-harvest.ts` (`harvestSectionToLibrary`) + `__tests__/proposal-harvest.test.ts`
- called at `…/sections/[sectionId]/lock/route.ts` (alongside the greenfield return)

**C. Agent tools (still target `library_units`):**
- `lib/tools/library-save-atom.ts`, `lib/tools/library-search-atoms.ts`

**D. Readers that keep it alive (repoint before dropping the table):**
- `app/api/portal/[t]/dashboard/route.ts`, `dashboard/page.tsx`, `documents/page.tsx`
- `app/api/portal/[t]/proposals/[proposalId]/outcome/route.ts` (→ should use `library_atom_outcomes`)
- `app/api/portal/[t]/uploads/route.ts`
- Admin counts: `admin/analytics/page.tsx`, `admin/dashboard/page.tsx`,
  `admin/tenants/page.tsx`, `admin/tenants/[tenantId]/page.tsx`

**E. Greenfield files that only reference it in a coexistence comment:**
- `lib/proposal-atom-harvest.ts`, `…/lock/route.ts`

## 4. Phased deprecation plan

- **Phase 0 — DONE.** Greenfield loop built + proven (§2). Nothing customer-facing
  depends on `library_units` output for the mold/draft/return loop.
- **Phase 1 — redirect the legacy customer surface (low risk, high visibility).**
  Point `/library`, `/library/upload`, `/library/review` → `/atoms` (mirror the
  blessed `/spotlights`,`/pipeline` → `/cards` redirects). **Gate:** confirm
  `AtomLibrary` (the Library tab) covers the review/lineage-tree/facet browse the
  `LibraryDashboard` provided; close any parity gap first.
- **Phase 2 — converge readers.** Repoint admin analytics/dashboard library counts
  and the two agent tools (`library-save-atom`, `library-search-atoms`) and
  `outcome` tracking from `library_units` → `library_atoms` / `library_atom_outcomes`.
- **Phase 3 — retire the legacy harvest.** Drop `harvestSectionToLibrary` from the
  lock route (keep only `harvestSectionToAtomLibrary`) once nothing reads
  `library_units`-harvested content.
- **Phase 4 — drop the table.** Migration to remove `library_units` (+ dependent
  columns) after all readers/writers are gone.

## 5. Recommendation

Greenfield is the system; `library_units` is the obsolete code. Recommend doing
**Phase 1** next (the biggest visible convergence at the lowest risk) after a quick
parity pass on the `AtomLibrary` browse/review view. **Phases 2–4 touch admin
analytics, agent tools, and a destructive migration — get explicit sign-off before
each**, and hold Phase 4 until after HITL so nothing customer-visible moves under a
live evaluation.
