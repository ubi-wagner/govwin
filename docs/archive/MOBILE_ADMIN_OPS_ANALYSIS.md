# Mobile Admin-Ops Gap Analysis — RFP Admin + Customer Admin operational interactions

**Goal (user):** every RFP-Admin (and customer/tenant-admin) *operational* functional requirement and
required interaction — **review progress · issue ToDos · approve · advance · complete · review→release**
— should be **mobile-friendly and easy to use**. This is the detailed analysis; the polish pass follows.

**Method.** Live dev server (owner mode, seeded `govtech_intel`), driven at **390×844 (mobile)** as
`rfp_admin` (Eric) and `tenant_admin` (Kate), opening each operational modal/form (never submitting) and
capturing the *viewport* — what actually fits on a phone. Each finding is traced to the component. Harness:
`frontend/scripts/ux-ops-mobile.mjs`. Interaction spec cross-checked against `docs/HITL_TODO_GUIDE.md` and
`lib/tasks/workflows.ts` (7 completers: review · acknowledge · read_receipt · text_memo · upload · form · thread).

## The thesis (nuanced — this is not "mobile is broken")

The **lists, cards, and ToDo completers are already mobile-ready**; the gaps are concentrated in three
shapes: **multi-column forms**, **data tables/queues**, and **modals** — plus one systemic issue,
**sub-44px tap targets** across every operational control (`text-xs` + `py-1`/`py-1.5`, desktop-first).
The portal/admin *shell* is responsive (hamburger, stat-card grids stack); the *operational widgets inside*
were not given the same treatment.

## Verdict by interaction

### RFP Admin

| Operational interaction | Component | Mobile verdict |
|---|---|---|
| **Review progress** — Admin Dashboard | `app/admin/dashboard` | ✅ **Good** — stat cards stack 2-col, ToDos stack, tables fit |
| **Review progress** — Workflow Monitor | `app/admin/workflows` | ✅ **OK** — monitor + inline forms stack single-column |
| **Review → curate → release** — Triage Queue | `components/rfp-curation/curation-workspace.tsx` | ❌ **Broken** — queue collapses to a **titles-only list**; no agency/status columns and **no per-row Claim/Review/Curate actions** — the core job is not operable on a phone |
| **Review → release** — curation review modal | `curation-workspace.tsx:736,2564…` | ⚠️ **At risk** — internal grids `grid-cols-2/3` don't collapse (`:1752/1803/2574/2819/2880`); the big `max-w-6xl` review modal (`:736`) lacks `max-h`+scroll (vertical clip); *some* modals do handle it (`:2102/:2809` have `max-h-[90vh] overflow-y-auto`) |
| **Issue ToDo / review gate** — Launch Review Gate | `app/admin/workflows` | ⚠️ Form **stacks fine**, but requires **hand-typed raw UUIDs** (Opportunity/Entity/Tenant) — painful on desktop, worse on a phone (already a P1 in the UX touch report) |
| **Complete ToDos** (content review & publish, triage) | dashboard / curation ToDo cards | ✅ **Good** — vertical cards, `Open → / Approve·Done / Dismiss` wrap cleanly |
| **Approve onboarding** — Applications | `app/admin/applications` | ◻︎ list-based, not deep-checked (likely table — verify in polish) |

### Customer (Tenant) Admin

| Operational interaction | Component | Mobile verdict |
|---|---|---|
| **Review progress** — proposal sections/readiness | `components/portal/proposal-workspace.tsx` | ◻︎ **OK-ish** — sections stack; inherits the desktop double-tab-row density (UX report P1) |
| **Issue ToDo** — "Assign a task" / To-dos drawer compose | `components/tasks/assign-task-form.tsx:149` | ❌ **Broken** — `grid-cols-3` (no responsive prefix) crams Assign-to / Completion / Due into ~110px each → selects truncate to "Everyoi", "mm/dd" — **you can't read what you're choosing** |
| **Approve & Advance** — stage control | `components/portal/stage-control.tsx:243` | ⚠️ actions row is `flex` **no-wrap** (Advance + Unlock + requirements inline → overflow risk); tap targets small — Advance `px-4 py-2` (~36px), **Mark-Met** `px-2 py-1` (~26px, a core gate-approval) |
| **Approve → next** — Proposal Studio gate | `components/portal/proposal-studio.tsx:127` | ⚠️ the 3-phase strip is `flex` with three `flex-1` children (no wrap) → **cramped slivers**; gate buttons + comment box otherwise fine |
| **Section approve / accept-AI** — admin panel | `components/portal/proposal-admin-panel.tsx:862` | ⚠️ `grid-cols-3` (non-responsive) in the panel |
| **Complete ToDos** — typed completers | `components/tasks/task-queue.tsx` | ✅ **Good** — vertical cards; text-memo box + Completed/Delegated/Not-completed and Approve/Done + Dismiss stack well |

## Cross-cutting patterns (the polish levers)

1. **Sub-44px tap targets — systemic.** Operational controls use `text-xs` + `py-0.5`/`py-1`/`py-1.5`,
   yielding ~26–36px targets (Mark-Met ~26px, Advance ~36px, per-requirement + completer buttons). Below
   the 44px iOS/Android minimum. → one shared control size scale with a ≥44px touch height on operational
   buttons.
2. **Non-responsive multi-column grids on forms.** `grid-cols-N` with no `sm:`/`md:` collapse:
   `assign-task-form.tsx:149` (3), `proposal-admin-panel.tsx:862` (3), curation modals
   (`:1752/1803/2574/2819/2880`), `agent-usage-summary.tsx:68` (**6**), and the standalone launcher pages
   `admin/workflows/launch-collaboration-client.tsx` (3/2) + `launch-content-client.tsx` (2), plus
   `new-company-form`/`create-partner-org-form`/`intake-form` (2). → add `grid-cols-1 sm:grid-cols-N`.
3. **Data tables/queues hide the work on mobile.** The RFP Triage Queue renders titles-only (row actions +
   agency/status columns gone); admin list tables truncate. → responsive table → card pattern (stack each
   row into a card carrying its metadata + primary action) below `md`.
4. **Modals: mixed.** Centered `items-center` panels need `max-h-[90vh] overflow-y-auto` + `w-full` so
   action buttons never clip on short viewports — some have it, the big review modal doesn't. → apply the
   safe modal container uniformly.
5. **Non-wrapping flex action rows.** `stage-control.tsx:243` and the studio phase strip use `flex`
   without `flex-wrap`/stacking → overflow on narrow widths. → `flex-wrap` or `flex-col` below `sm`.
6. **Content-review ToDos crowd operational queues.** Four "Content review & publish" cards sit atop both
   the RFP Curation page and the Admin Dashboard, pushing the real queue ~2 screens down on mobile. →
   route content ToDos to their own surface (also a UX-report P2).

## What's already right (keep)

Admin Dashboard review-progress (stat cards + pending-actions), the ToDo completer system (both roles —
the best-built operational surface, fully mobile-ready), the Workflow Monitor form stacking, and the whole
responsive shell (hamburger nav, stacking card grids). The polish is targeted, not a rebuild.

## Prioritized polish plan (for the next pass)

- **P1 — make the core jobs operable on a phone.** (a) RFP Triage Queue → responsive card rows with the
  Claim/Review/Curate action on each; (b) ToDo compose form → stack the Assign-to/Completion/Due grid;
  (c) Review Gate → entity pickers instead of raw UUIDs (shared with the UX-report P1).
- **P2 — the operational controls.** Global ≥44px touch target scale for operational buttons; `flex-wrap`
  on the stage-control actions row; stack the Studio 3-phase strip and the `proposal-admin-panel` grid
  below `sm`; make the big curation review modal `max-h`+scroll and its internal grids responsive.
- **P3 — the peripheral forms.** `grid-cols-1 sm:grid-cols-N` on the launcher/create forms and
  `agent-usage-summary`; route content-review ToDos off the curation/dashboard queues.

## Polish pass 1 — shipped & proven (2026-08-13)

Verified green (`tsc` 0 · `vitest` 1085 passed) and re-driven at 390×844 on the live server:

- **RFP Triage Queue → responsive cards** (`triage-queue.tsx`): the desktop table is `hidden md:block`; below `md` each row renders as a card with title + status + agency/source **and its Claim/Release/Open/Force-Release action** (shared `rowActions` helper, ≥44px targets). The core review→release job is now operable on a phone. *(proof: `scratchpad/ux/proof/p3-triage-cards.png`)*
- **ToDo compose → stacks** (`assign-task-form.tsx:149`): `grid-cols-1 sm:grid-cols-3` — Assign-to/Completion/Due are now full-width and readable on mobile. *(proof: `p2-compose-stacked.png`)*
- **Studio 3-phase strip → stacks** (`proposal-studio.tsx:127`): `grid-cols-1 sm:grid-cols-3` — Draft/Refine/Compliance are full-width cards, not slivers. *(proof: `p1-studio-strip.png`)*
- **Approve & Advance** (`stage-control.tsx`): action row is now `flex-wrap`; the Advance button is `min-h-[44px]`.
- **Peripheral form grids** made responsive (`grid-cols-1 sm:grid-cols-N`): `proposal-admin-panel.tsx` (dropboxes), `new-company-form.tsx`, `create-partner-org-form.tsx`, `intake-form.tsx`.

**Scope correction:** the earlier `-o` census over-flagged three files that were *already* responsive — `agent-usage-summary.tsx` (`grid-cols-2 md:grid-cols-3 lg:grid-cols-6`), `launch-collaboration-client.tsx`, `launch-content-client.tsx`. And `curation-workspace.tsx:736` is the page container (`max-w-6xl`), not a modal; its real modals already carry `max-h-[90vh] overflow-y-auto`. No edits needed there.

**Still open (deliberately, larger scope):** the Review Gate **entity pickers** (replacing raw-UUID entry — a UX-report P1 needing a search-select component), routing **content-review ToDos** off the operational queues, and a *global* ≥44px touch scale beyond the primary buttons touched here.

## Screenshots

Captured at 390×844 under `scratchpad/ux/ops/`: `ta-02-assign-task-open` (compose broken),
`ra-02-curation-queue` (triage titles-only), `ta-04-todos` + `ra-01-dashboard` (completer/dashboard — good),
`ra-05-workflows-forms` (review-gate UUIDs), `ta-01-proposal-top` (studio strip). Visual report published as
an artifact.
