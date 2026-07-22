# TODO — Full System Punch List

Generated from end-to-end audits across canvas editors, pipeline architecture,
event system, automation engine, and deployment infrastructure.

Organized by priority tier, then by area. Each item includes the file(s) affected
and a rough effort estimate.

---

## P0 — Blocking / Data Integrity

### Canvas Editor

- [ ] **Auto-generate TOC from headings** — TOC node currently shows placeholder text.
      Scan doc.nodes for heading types, build numbered list of H1/H2/H3 with page
      estimates, render in canvas and export to DOCX as actual heading references.
      Files: `canvas-renderer.tsx`, `docx-exporter.ts`, `pptx-exporter.ts`
      Effort: Medium

- [ ] **Drag-and-drop node reorder** — currently Move Up/Down buttons only. Add
      drag handles on each node, use HTML5 drag-and-drop or a library (dnd-kit)
      to reorder nodes visually. Must work for document and slide editors.
      Files: `canvas-renderer.tsx`, `canvas-editor.tsx`
      Effort: Medium

- [ ] **Unsaved changes warning on navigation** — no `beforeunload` handler.
      Users lose work when navigating away without saving.
      Files: `canvas-editor.tsx`, `sheet-editor.tsx`
      Effort: Small

- [ ] **Undo/Redo** — no undo capability. Implement a simple history stack
      (snapshot doc state on each updateDoc call, limit to ~50 entries).
      Ctrl+Z / Ctrl+Shift+Z keyboard shortcuts.
      Files: `canvas-editor.tsx`, `sheet-editor.tsx`
      Effort: Medium

### Pipeline Architecture

- [ ] **CMS event bridge writes to wrong table** — `content_events` instead of
      `system_events`. CMS-originated events are dead-lettered. Fix the bridge
      to write to `system_events` so pipeline workflows can react to CMS events.
      Files: `services/cms/src/models/events.py`
      Effort: Small

- [ ] **automation_log never written** — rules execute but no audit trail. Add
      INSERT to `automation_log` in `_execute_rule()` for every execution
      (success or failure).
      Files: `services/cms/src/event_listener.py`
      Effort: Small

- [ ] **Duplicate email risk** — both workflow NOTIFY steps and automation rules
      react to same events (e.g., `application.accepted`). Deduplicate by either
      removing the automation rule when a workflow handles it, or adding a
      `dedup_key` check in the CMS email sender.
      Files: `db/migrations/028_*.sql`, `services/cms/src/event_listener.py`
      Effort: Small

---

## P1 — High Impact UX / Functionality

### Canvas Editor — Node Editing

- [ ] **Inline editing for all node types when double-clicked** — currently must
      click node then edit in selected mode. Add double-click to jump straight
      to edit mode on any node.
      Files: `canvas-renderer.tsx`
      Effort: Small

- [ ] **Multi-line cell editing in tables** — table cells use `<input type="text">`
      which only supports single lines. Switch to `<textarea>` for cells that
      contain multi-line content.
      Files: `canvas-renderer.tsx`
      Effort: Small

- [ ] **Table cell style editing in document canvas** — cell bg color, bold,
      alignment are rendered in view mode but have no edit UI in the document
      canvas (only in spreadsheet editor). Add a mini format bar or use the
      sidebar when a table cell is focused.
      Files: `canvas-renderer.tsx`
      Effort: Medium

- [ ] **Delete column in document canvas tables** — the renderer has `deleteCol`
      function but verify the button renders correctly (audit found it may be
      missing from some code paths).
      Files: `canvas-renderer.tsx`
      Effort: Small (verify)

### Canvas Editor — Formatting

- [ ] **Text color as inline format** — currently color is node-level only
      (whole paragraph). Add `color` to the `InlineFormat.format` union type
      so users can color individual words. Needs: type change, toolbar color
      picker, renderer update, docx export update.
      Files: `canvas-document.ts`, `canvas-renderer.tsx`, `docx-exporter.ts`
      Effort: Medium

- [ ] **Highlight / background color on text** — inline highlighting (like a
      highlighter pen). Add `highlight` format with color to InlineFormat.
      Files: `canvas-document.ts`, `canvas-renderer.tsx`, `docx-exporter.ts`
      Effort: Medium

### Canvas Editor — Export

- [ ] **Embed images in DOCX export** — currently placeholder text. Fetch image
      binary from S3 during export, use `docx` library's `ImageRun` to embed.
      Files: `docx-exporter.ts`, needs S3 access from export route
      Effort: Medium

- [ ] **Embed images in PPTX export** — same pattern, use PptxGenJS image support.
      Files: `pptx-exporter.ts`
      Effort: Medium

- [ ] **XLSX export per-cell number formatting** — `TableCell.number_format` and
      `cell_type` fields exist but are ignored. Apply number formats in xlsx export.
      Files: `xlsx-exporter.ts`
      Effort: Small

- [ ] **DOCX export URLs as clickable hyperlinks** — currently blue text only.
      Use `docx` library's `ExternalHyperlink` wrapper.
      Files: `docx-exporter.ts`
      Effort: Small

- [ ] **Auto-generate TOC in DOCX** — use `docx` library's `TableOfContents`
      field rather than placeholder text.
      Files: `docx-exporter.ts`
      Effort: Small

- [ ] **DOCX export node-level weight/style** — `node.style.weight` and
      `node.style.style` render in canvas but don't export. Map to TextRun
      `bold`/`italics` in the exporter.
      Files: `docx-exporter.ts`
      Effort: Small

### Canvas Editor — Slide Editor

- [ ] **Slide keyboard navigation** — Left/Right arrow keys to switch slides
      when no node is selected.
      Files: `slide-editor.tsx`
      Effort: Small

- [ ] **Drag-to-reorder slides** — reorder thumbnails via drag-and-drop.
      Files: `slide-editor.tsx`
      Effort: Medium

- [ ] **Slide duplicate** — click to duplicate a slide with all its content.
      Files: `slide-editor.tsx`
      Effort: Small

- [ ] **Slide delete confirmation** — currently no confirm dialog before deleting
      a slide and all its content.
      Files: `slide-editor.tsx`
      Effort: Small

### Canvas Editor — Spreadsheet Editor

- [ ] **Cell formulas** — `TableCell.formula` field exists but is never evaluated.
      Implement basic formula evaluation (SUM, AVERAGE, COUNT, basic arithmetic).
      Files: `sheet-editor.tsx`, `xlsx-exporter.ts`
      Effort: Large

- [ ] **Number formatting in grid** — currency ($), percentage (%), decimal places.
      `TableCell.number_format` exists but has no UI or rendering.
      Files: `sheet-editor.tsx`
      Effort: Medium

- [ ] **Column resize** — drag column borders to resize. `TableContent.column_widths`
      field exists but is unused.
      Files: `sheet-editor.tsx`
      Effort: Medium

- [ ] **Row/column freeze (freeze panes)** — freeze header row or first column
      for scrolling large sheets.
      Files: `sheet-editor.tsx`
      Effort: Medium

- [ ] **Sheet tab reorder** — drag to reorder sheet tabs.
      Files: `sheet-editor.tsx`
      Effort: Small

### Canvas Editor — Infrastructure

- [ ] **Auto-save** — save automatically after N seconds of inactivity (debounced).
      Show "Auto-saved" indicator instead of manual Save button.
      Files: `canvas-editor.tsx`, `sheet-editor.tsx`
      Effort: Small

- [ ] **Image presigned URL refresh** — URLs expire after 1 hour. Add a refresh
      mechanism (re-fetch on 403 or on a timer).
      Files: `canvas-renderer.tsx`
      Effort: Small

- [ ] **Revert action should restore content** — currently only adds a history
      entry without actually restoring previous content. Store `previous_content`
      in NodeEdit on each edit, then restore it on revert.
      Files: `canvas-editor.tsx`
      Effort: Medium

---

## P2 — Pipeline / Backend Gaps

### Workflow ACTION Steps

- [ ] **Implement pipeline.shredder.shred as importable function** — workflow
      `on_rfp_uploaded` calls this but it doesn't exist as an importable module.
      Create a thin wrapper that calls the existing shredder runner.
      Files: `pipeline/src/workflows/actions/`, new file
      Effort: Small

- [ ] **Implement pipeline.scoring.match_tenants** — workflow `on_solicitation_pushed`
      calls this. Create the tenant-opportunity matching/scoring function.
      Files: `pipeline/src/workflows/actions/`, new file
      Effort: Medium

- [ ] **Implement pipeline.library.create_default_categories** — workflow
      `on_application_accepted` calls this. Create default library categories
      for new tenants.
      Files: `pipeline/src/workflows/actions/`, new file
      Effort: Small

- [ ] **Implement pipeline.export.generate_preview** — workflow
      `on_proposal_advanced` calls this. Generate a proposal preview document.
      Files: `pipeline/src/workflows/actions/`, new file
      Effort: Medium

- [ ] **Implement finder.create_drafts_from_scout** — workflow
      `on_source_change_detected` calls this. Create draft opportunities from
      source scout diffs.
      Files: `pipeline/src/workflows/actions/`, new file
      Effort: Medium

### AI Tool Integration

- [ ] **Implement /api/portal/.../ai/draft/route.ts** — currently returns 501.
      Should call `proposal.draft_section` tool server-side.
      Files: `frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/ai/draft/route.ts`
      Effort: Medium

- [ ] **Implement /api/portal/.../ai/review/route.ts** — currently returns 501.
      Should run quality/compliance review on a section.
      Files: `frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/ai/review/route.ts`
      Effort: Medium

- [ ] **Implement /api/portal/.../ai/compliance/route.ts** — currently returns 501.
      Should check section content against compliance matrix.
      Files: `frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/ai/compliance/route.ts`
      Effort: Medium

- [ ] **Implement /api/portal/.../reviews/route.ts** — currently returns 501.
      Review rounds with per-section reviewer comments and approval tracking.
      Files: `frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/reviews/route.ts`
      Effort: Large

### Event System

- [ ] **Switch to pg_notify consumption** — the trigger exists and fires on every
      event INSERT. Replace 10-second polling in both pipeline workflow processor
      and CMS event listener with LISTEN/NOTIFY for near-instant reactions.
      Files: `pipeline/src/workflows/processor.py`, `services/cms/src/event_listener.py`
      Effort: Medium

- [ ] **Durable high-water mark** — store `last_processed_event_id` in a DB table
      instead of in-memory. Prevents missed events on restart.
      Files: `pipeline/src/workflows/processor.py`, `services/cms/src/event_listener.py`
      Effort: Small

- [ ] **Implement /api/events/route.ts** — currently returns 501. Should provide
      SSE (Server-Sent Events) stream for real-time event consumption in the
      browser (live dashboard updates).
      Files: `frontend/app/api/events/route.ts`
      Effort: Medium

### Automation Engine

- [ ] **Implement webhook action type** — defined in DB CHECK constraint, not
      in code. Add HTTP POST to configured URL with event payload.
      Files: `services/cms/src/event_listener.py`
      Effort: Small

- [ ] **Implement update_status action type** — defined in DB CHECK constraint.
      Update a target entity's status (e.g., auto-advance proposal stage).
      Files: `services/cms/src/event_listener.py`
      Effort: Small

### Proposal Pipeline

- [ ] **Implement proposal package/bulk export** — `/api/portal/.../package/route.ts`
      returns 501. Should zip all sections into a single download.
      Files: `frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/package/route.ts`
      Effort: Medium

- [ ] **SBIR Phase II template** — `dod-sbir-phase2-technical` is declared as a
      TemplateKey type but has no entry in TEMPLATE_MAP. Phase II proposals get
      empty sections.
      Files: `frontend/lib/templates/index.ts`, new template file
      Effort: Medium

- [ ] **Implement /api/portal/.../notifications/route.ts** — currently returns 501.
      User notification center.
      Files: `frontend/app/api/portal/[tenantSlug]/notifications/route.ts`
      Effort: Medium

---

## P3 — Polish / Nice-to-Have

### Canvas

- [ ] **Rich text editor (Tiptap)** — Tiptap is installed but unused. Replace the
      textarea-based text_block editor with Tiptap for true WYSIWYG inline editing
      (bold/italic as you type, not select-then-click).
      Files: `canvas-renderer.tsx`, new tiptap wrapper component
      Effort: Large

- [ ] **Real-time collaborative editing** — Tiptap collaboration extensions are
      installed. Wire up Y.js + WebSocket for multi-user editing.
      Files: new WebSocket server, tiptap collaboration setup
      Effort: Very Large

- [ ] **Table rowSpan/colSpan editor** — types support merged cells, renderer
      handles them, but no UI to merge/split cells.
      Files: `canvas-renderer.tsx`
      Effort: Medium

- [ ] **Table column widths** — `TableContent.column_widths` field exists but is
      unused in renderer and export. Add drag-to-resize columns.
      Files: `canvas-renderer.tsx`, `docx-exporter.ts`, `xlsx-exporter.ts`
      Effort: Medium

- [ ] **Nested lists (children)** — `ListContent.items[].children` field exists
      but neither renderer nor editor supports nested items. Currently indent
      is handled via `indent_level` which is sufficient for most use cases.
      Files: `canvas-renderer.tsx`, `docx-exporter.ts`
      Effort: Medium

- [ ] **Copy/paste nodes** — Ctrl+C on a selected node, Ctrl+V to paste.
      Files: `canvas-editor.tsx`
      Effort: Small

- [ ] **Keyboard shortcuts for formatting** — Ctrl+B for bold, Ctrl+I for italic,
      etc. while editing a text block.
      Files: `canvas-renderer.tsx`
      Effort: Small

### Infrastructure

- [ ] **Pipeline tool dispatcher** — currently all functions raise NotImplementedError.
      Implement the dispatch loop: dequeue from agent_task_queue, POST to
      frontend /api/tools/<name>, persist results.
      Files: `pipeline/src/tools/dispatcher.py`
      Effort: Medium

- [ ] **pg_notify agent subscribers** — Phase 4 architecture. Agents LISTEN on
      namespace channels for targeted event consumption.
      Files: new agent framework
      Effort: Large

- [ ] **Optimistic locking on save** — currently last-write-wins with no conflict
      detection. Add version check: if the saved version doesn't match the
      server version, reject with conflict error.
      Files: API routes, canvas-editor save handler
      Effort: Small

### Deployment

- [ ] **Frontend health check endpoint** — `/api/health` exists but verify it's
      configured as Railway health check.
      Files: Railway dashboard
      Effort: Small

- [ ] **Pipeline health check** — the pipeline has no HTTP server. Add a simple
      health endpoint or use Railway's TCP health check.
      Files: `pipeline/src/health.py`
      Effort: Small

---

## Summary Counts

| Priority | Count | Key Theme |
|----------|-------|-----------|
| P0 | 7 | Data integrity, dead-letter fix, dedup, TOC, drag-drop, undo |
| P1 | 24 | Canvas UX, export completeness, slide/sheet features |
| P2 | 14 | Pipeline actions, AI tools, event system, proposal pipeline |
| P3 | 11 | Rich text, real-time collab, polish, infrastructure |
| **Total** | **56** | |
