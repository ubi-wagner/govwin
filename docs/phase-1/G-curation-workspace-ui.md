# Phase 1 §G — Admin Curation Workspace UI

**Mini-TODO scope:** The two pages an `rfp_admin` actually clicks: `/admin/rfp-curation` (triage queue list) and `/admin/rfp-curation/[solId]` (curation workspace with PDF viewer + annotation tools + compliance picker + state-transition buttons).

**Depends on:** §F (the API routes the UI calls)
**Blocks:** §J (e2e walks the UI)

## Why this section exists

This is the only place in Phase 1 where a human is in the loop. Everything before §G is invisible plumbing; §G is where the rfp_admin sees the queue, picks a solicitation, reads the document, marks compliance variables, and clicks "Push to Pipeline." Quality of curation depends on the UI being friction-free. Unfriendly UI → admins skip hard variables → bad data flows downstream.

## Items

### Triage queue page

- [ ] **G1.** `frontend/app/admin/rfp-curation/page.tsx` — server component, reads session, renders the triage queue:
  - Top: tab strip — `Unclaimed | My Work | Review Requested | All`
  - Middle: filterable table of curated_solicitations with columns: Title, Agency, Source, Posted, Close Date, Status, Claimed By, Actions
  - Bottom: cursor pagination (50 per page)
  - Each row has action buttons depending on state: `Claim` (when unclaimed), `Open Workspace` (when claimed by self), `Dismiss` (when unclaimed)
  - Server-fetches via `fetch('/api/admin/rfp-curation?...')` (or via `auth() + invokeTool('solicitation.list_triage', ...)` for slightly less indirection — your choice)
  - Replaces the current 8-line stub at this path

- [ ] **G2.** `frontend/components/admin/rfp-curation/TriageTable.tsx` — client component for the table itself
  - Receives serialized data from the server component as props
  - Renders the rows + handles row-level click handlers
  - Optimistic UI for `Claim` action (rolls back on error)

- [ ] **G3.** `frontend/components/admin/rfp-curation/TriageFilters.tsx` — client component for the filter bar
  - Status multi-select, source filter, agency search, "my work" toggle
  - URL-synced state (so filters survive page reload)

### Curation workspace page

- [ ] **G4.** `frontend/app/admin/rfp-curation/[solId]/page.tsx` — server component, layout shell:
  - Three columns: left (document viewer), middle (annotation toolbar + compliance variable picker), right (state machine action buttons + audit timeline)
  - Server-fetches initial data via `solicitation.get_detail` tool
  - Replaces the current 8-line stub at this path

- [ ] **G5.** `frontend/components/admin/rfp-curation/DocumentViewer.tsx` — client component, PDF rendering
  - Use `react-pdf` (or `pdf.js` directly) to render pages
  - Page navigation controls
  - Text selection events bubble up to the parent for the compliance picker
  - Highlight overlays for existing annotations
  - **Dependency:** add `react-pdf` to `frontend/package.json` (one new top-level dep)

- [ ] **G6.** `frontend/components/admin/rfp-curation/CompliancePicker.tsx` — client component, the "highlight text → assign compliance variable" UI:
  - Triggered when the user releases a text selection in `DocumentViewer`
  - Shows a popup near the selection: list of master compliance variables (from `compliance.list_variables`), filtered by category, with a search box
  - "Add new variable" link → opens a modal that calls `compliance.add_variable`
  - On selection: calls `solicitation.save_annotation` with `kind = 'compliance_tag'` AND `compliance.save_variable_value`
  - Optionally calls `compliance.extract_from_text` first to pre-suggest a value (the §D8 sync extractor)

- [ ] **G7.** `frontend/components/admin/rfp-curation/AnnotationToolbar.tsx` — client component, the annotation tools row
  - Buttons: `Highlight`, `Text Box`, `Compliance Tag`
  - Active mode is reflected in the cursor + DocumentViewer interaction mode

- [ ] **G8.** `frontend/components/admin/rfp-curation/StateActions.tsx` — client component, the workflow action buttons in the right column
  - Renders different buttons based on current state: `Claim` (when new), `Release for Analysis` (when claimed), `Request Review` (when curation_in_progress), `Approve` / `Reject` (when review_requested AND viewer is not the curator), `Push to Pipeline` (when approved)
  - Each button calls the corresponding API route, shows loading state, on success refreshes the page or routes to the next solicitation

- [ ] **G9.** `frontend/components/admin/rfp-curation/AuditTimeline.tsx` — client component, the audit log
  - Renders triage_actions for the current solicitation in reverse-chrono order
  - Each entry: actor avatar/name, action verb, timestamp, optional notes

- [ ] **G10.** `frontend/components/admin/rfp-curation/ComplianceMatrix.tsx` — client component, the structured metadata panel
  - Reads from `solicitation_compliance` (via `solicitation.get_detail`)
  - Renders fields grouped by category: Format, Content, Cost, Eligibility, Dates, Eval Criteria
  - Each field: input control matching its data type (text, number, select, multiselect, boolean), value, source location (page/excerpt), confidence indicator if from shredder
  - On change: debounced call to `compliance.save_variable_value`

### Layout + nav

- [ ] **G11.** Verify `/admin/rfp-curation` is in the admin sidebar nav (it already shows in the screenshot from earlier — the user saw "RFP Curation" in the sidebar). No nav changes needed; just verify the link target is correct.

### Tests

- [ ] **G12.** Component tests for the client components — `frontend/__tests__/components/admin/rfp-curation/*.test.tsx`. Use vitest + `@testing-library/react`:
  - `TriageTable`: renders rows, `Claim` button calls fetch with right URL
  - `CompliancePicker`: opens on selection, search filters variables, save calls fetch
  - `StateActions`: shows the right buttons for each state
  - At least 4 component tests
  - **Dependency:** add `@testing-library/react` + `@testing-library/jest-dom` to dev deps if not already present

- [ ] **G13.** E2E test (Playwright if available, else a JSDOM-based fallback) — `frontend/__tests__/e2e/curation-workspace.test.ts`
  - Sign in as eric@rfppipeline.com
  - Navigate to `/admin/rfp-curation`
  - See at least one triage row
  - Click `Claim`
  - Navigate to the workspace
  - Verify document viewer renders
  - Click a compliance tag, save a value
  - Click `Push to Pipeline` (after going through release → curate → review → approve states; can be simulated by a fixture preloading)
  - Verify the redirect lands on `/admin/dashboard` with a success toast

## Anti-patterns from Phase 0.5

- ❌ **Don't put business logic in the page component.** Pages render. Tools mutate. The page calls the API which calls the tool. If you find yourself querying a DB inside `page.tsx`, you're doing it wrong (one exception: server components can call `await sql\`SELECT 1\`` for a simple read like the dispatcher in `/portal/page.tsx` — but anything mutating goes through the tool path).
- ❌ **Don't ship a UI without optimistic updates for the common path.** `Claim` is the most-clicked button; it should feel instant. The optimistic state rollback on error is non-negotiable.
- ❌ **Don't render PDF.js without virtualization for long docs.** A 200-page solicitation should render the visible page only and lazy-load the rest, or scroll performance dies.
- ❌ **Don't skip the loading + error states.** Every fetch in the workspace needs a skeleton and an error toast. The 0.5b login flow trauma was caused by silent failures; the same lesson applies to the workspace.

## Definition of Done for §G

- All 13 items checked
- `npx vitest run __tests__/components/admin/rfp-curation/` passes
- `npx vitest run __tests__/e2e/curation-workspace.test.ts` passes (or skipped with a `// test:skip: e2e infra not yet wired` if Playwright isn't available, with the test scaffolded for the next pass)
- `npx tsc --noEmit` exits 0
- `npx next build` exits 0
- Manual click-through: log in as eric, navigate to `/admin/rfp-curation`, see real data (after seeding via §C ingester run), claim a row, open the workspace, see the PDF, save a compliance variable
- Commit message: `feat(phase-1-G): admin curation workspace UI + 10 components`
- `docs/PHASE_1_PLAN.md` Section completion tracker has §G ticked
