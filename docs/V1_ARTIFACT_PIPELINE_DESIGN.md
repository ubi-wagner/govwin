# V1 Artifact / Compliance / V0 Pipeline — Design & Gap Analysis

**E2E Priority #1.** The unified canvas-as-artifact pipeline: ingest → expert-curated
volumes/specs/compliance → staged V0 → copy-on-purchase → 3-source agent strawman → expert
finishing pass → gold-team across all artifacts → final lock → package download.

> Status legend: 🟢 built & verified · 🟡 partial · 🔴 missing. Every "built" claim below was
> verified against source on 2026-06-27 (a 5-agent sweep over-reported ~12 missing items that
> actually exist; this doc reflects the corrected, verified state).

---

## 0. Verdict

**~70% built. The work is connect + author + enforce, not greenfield.** The canvas spec model,
all three exporters, the whole-proposal package route, the V0 copy-on-purchase, the live agent
queue, and the AI write-back already exist. The missing pieces are (1) an **artifact container**
to group sections into a lockable/downloadable unit, (2) an **expert authoring UI** for
volumes/required-items/specs, (3) **structured specs + enforcement**, and (4) feeding the
**strawman** all three data sources + giving agents **artifact/proposal scope**.

---

## 1. Current State (verified)

### Canvas / spec model 🟢
- `frontend/lib/types/canvas-document.ts` — `CanvasRules` carries `format` (letter/slide_16_9/
  slide_4_3/custom/spreadsheet), `width`/`height`, 4-side `margins`, `header`/`footer` (template +
  height + font), `font_default`, `line_spacing`, `max_pages`, `max_slides`, `watermark`. Node
  types cover heading/text/lists/image/table/caption/footnote/toc/page_break/url/spacer.
- `CanvasDocument.metadata` carries `volume_id`/`required_item_id`/`proposal_id`/`solicitation_id`
  **as loose labels** (no FK, no structure).
- **Missing fields:** `min_font_size`, `images_allowed`, image dimension limits.

### Export / download 🟢
- `frontend/lib/export/{docx,pptx,xlsx}-exporter.ts` (via `docx` / `pptxgenjs` / `exceljs`) — honor
  margins, fonts, header/footer, line-spacing, slide layout, cell styling. **Do not render images
  (placeholder)** and **do not validate** against limits.
- Routes: admin + portal **single-section export**, and a **whole-proposal `package`** route
  (`portal/[tenantSlug]/proposals/[proposalId]/package/route.ts`). *(Agent C wrongly said this was
  missing; verified present.)*

### Upstream compliance + artifact schema 🟡 (rich but under-filled)
- `solicitation_compliance` — wide flat matrix: `page_limit_technical/cost`, `font_family`,
  `font_size` (TEXT), `margins` (TEXT), `line_spacing` (TEXT), `images_tables_allowed`,
  `slides_allowed`, `slide_limit`, `required_sections`/`required_documents`/`evaluation_criteria`
  (JSONB), budget/PI/security rules, `custom_variables` (JSONB), `verified_by/at`.
- `solicitation_volumes` (mig 017) + `volume_required_items` (mig 012) — per-artifact specs
  (`page_limit`, `slide_limit`, fonts, margins **as TEXT**, `required` bool, `required_sections`/
  `format_rules`/`custom_fields` JSONB, `applies_to_phase`).
- `document_templates` (mig 017) — `canvas_preset` JSONB (a `CanvasRules` object) keyed by
  `template_type`.
- `compliance_presets` + `apply-preset` route — the **only** path that currently writes
  `solicitation_volumes`/`volume_required_items`.

### Ingestion 🟢
- `pipeline/src/shredder/*` — extracts text (pymupdf4llm, 200K cap), 2 Claude passes (sections +
  per-section compliance), writes `solicitation_compliance` (named cols + `custom_variables`) and
  `curated_solicitations.ai_extracted`; emits `finder.rfp.shredding.{start,end}`.
- **The shredder does NOT populate `volume_required_items`** — the structured artifact hierarchy
  only comes from `apply-preset`.

### Expert curation 🟡
- Routes that exist: `compliance` (save variable), `outline` (free-form `solicitation_outlines.
  outline` JSONB), `topics/[topicId]/compliance` (per-topic override), `apply-preset`,
  `annotations`. *(Agents B/D mis-flagged topic-compliance + apply-preset as missing; verified
  present.)*
- **Missing:** a structured **volume/required-item/spec editor** (volumes are shown read-only;
  no CRUD UI/route beyond apply-preset).

### V0 copy-on-purchase 🟢 (but thin)
- `proposals/create/route.ts` → `resolveTopicCompliance` (topic→baseline→defaults) → reads
  `solicitation_volumes` + `volume_required_items` → creates one `proposal_sections` row per item →
  `inferSectionType` tag + `meta` → loads `document_templates` via `resolveTemplateKey` +
  interpolates merge fields → S3 snapshots (`compliance.json`, `volumes.json`, RFP docs,
  `topic.json`).
- **Sections start EMPTY** unless a template matches the item type; no customer-data-informed
  prefill at purchase.

### Strawman / agent fill 🟡
- `frontend/lib/tools/proposal-draft-section.ts` — assembles **RFP excerpt + library atoms only**
  (verified: 0 references to spotlight/customer profile). Target wants **3 sources**.
- `draft-all-sections.tsx` — client-side sequential per-section loop (not orchestrated).
- `library-picker.tsx` (C4) — section-scoped, section_type/bucket-aware retrieval.
- Agent runtime 🟢 — `requestAgentTask` → `fabric.process_task_queue` (20s loop, `main.py:83`) →
  archetypes; **review-on-advance writes back** to `proposal_comments` (`_post_section_recommendation`,
  Increment 2). *(Agents C/E wrongly said the queue is dead / no write-back; verified live.)*
- `ProposalArchitectArchetype` **exists but is unwired** to any V0/proposal event.

### Gold-team → lock → download 🟢 (section-scoped)
- `lib/proposal-advance.ts` advance gate (all sections locked), section lock + harvest, final
  auto-lock→submitted; per-section + package export.

---

## 2. Confirmed Gaps (verified)

| # | Gap | Evidence | Sev |
|---|-----|----------|-----|
| A1 | **No `proposal_artifacts` container** — sections grouped only by denormalized `volume_name` string; no lockable/downloadable artifact unit | table absent | P0 |
| A2 | **No expert volume/artifact/spec authoring UI** — volumes/required-items only writable via `apply-preset`; shredder never builds them; no editor | no CRUD route/page | P0 |
| A3 | **Format specs unstructured TEXT** (`font_size`/`margins`/`line_spacing`) — unparseable, unenforceable | mig 012/001 | P1 |
| A4 | **No compliance enforcement** at edit/save/export (exporters apply specs but never validate page/font/image limits) | exporters | P1 |
| A5 | **`CanvasRules` missing** `min_font_size`, `images_allowed`, image limits | type def | P1 |
| A6 | **Strawman fed 1 of 3 sources** — no spotlight-bucket or customer-profile assembly | draft tool (0 hits) | P0 |
| A7 | **Agents section/proposal-scoped only** — no artifact/volume-scope tasks; no orchestrated "draft/review all artifacts" pass; `ProposalArchitectArchetype` unwired | `agent_task_queue` cols | P1 |
| A8 | **Phase filtering missing** — Phase II volume items leak into Phase I proposals | `resolveVolumes` | P1 |
| A9 | **Two structure sources of truth** — `solicitation_outlines.outline` (free JSON) vs `solicitation_volumes` hierarchy | curation routes | P2 |
| A10 | **V0 drops detail** — per-item `custom_fields` not merged; expert `annotations` don't flow to V0 | create route | P2 |

---

## 3. Target Model

**One canvas == one artifact.** A proposal owns N **artifacts** (Tech Volume DOCX, Cost Volume
XLSX, 5-page PPT…); each artifact carries a **format spec** + **compliance spec** + an ordered set
of **sections** (each with section metadata). Agents and humans operate at **section, artifact, or
proposal** scope through gold-team → lock → package download.

### 3.1 Data model changes
```
proposal_artifacts                      -- NEW: the container
  id, proposal_id FK, volume_id FK?, volume_number, volume_name, artifact_type
  format_spec   JSONB   -- CanvasRules snapshot (frozen at purchase)
  compliance_spec JSONB -- ComplianceSpec (page/slide/min_font/images/required_sections)
  status, is_locked, locked_at, locked_by
proposal_sections.artifact_id  FK -> proposal_artifacts  -- group sections under an artifact
agent_task_queue.artifact_id   (nullable)                 -- artifact-scope agent tasks
volume_required_items: migrate font_size/margins/line_spacing TEXT -> canvas_preset JSONB
CanvasRules += min_font_size?, images_allowed?, image_max_width/height?
ComplianceSpec (new type) = { max_pages, max_slides, min_font_size, images_allowed,
                              required_sections[], header_required, footer_required }
```

### 3.2 Flow (target, end-to-end)
1. **Ingest** (🟢) → shredder fills `solicitation_compliance`.
2. **Curate** (🔴 authoring UI) → expert defines/edits volumes + required-items + per-artifact
   `format_spec`/`compliance_spec` + required/optional, in a structured editor (seeded from
   `apply-preset` + shredder suggestions, then hand-refined). **One source of truth** = the
   volume/required-item hierarchy (deprecate free-form outline or generate it from the hierarchy).
3. **Stage** (🟢) → push activates opp; same curated metadata powers spotlight buckets.
4. **Copy-on-purchase** (🟡→🟢) → create route also creates `proposal_artifacts` (1 per
   required-item-group) with frozen `format_spec`/`compliance_spec`; sections link to `artifact_id`.
5. **3-source strawman** (🔴) → wire `ProposalArchitectArchetype` to a `proposal.v0_requested`
   task that drafts each artifact's sections from **spotlight-bucket atoms + customer profile + RFP
   metadata/library**; results write back per section.
6. **Expert finishing pass** (🟢 mechanisms exist) → regen-with-prompt, library generate-into,
   accept/lock — now also at artifact scope.
7. **Enforcement** (🔴) → `validateCanvasAgainstSpec(doc, compliance_spec)` at save + export
   (422 with violations: page/slide/min-font/images/required-sections).
8. **Gold-team across artifacts** (🟡→🟢) → proposal-scope review task fans to all artifacts;
   findings surface as `ai_review` comments (write-back already exists).
9. **Lock + package** (🟢) → artifact-level lock gate ("all sections of artifact X locked") →
   final lock → `package` export assembles all artifacts (extend to honor per-artifact specs +
   render images).

---

## 4. What NOT to rebuild (already verified present)
CanvasRules spec fields · 3 exporters · whole-proposal `package` route · V0 copy +
`resolveTopicCompliance` + S3 snapshots · `section_standards` tagging (C1) · live agent queue +
fabric loop · AI review write-back (Increment 2) · topic-compliance + apply-preset routes ·
library-picker section-scoped retrieval (C4) · advance/lock/harvest lifecycle.

---

## 5. Open product decisions (for owner)
1. **Outline vs volumes** — confirm the volume/required-item hierarchy is the single source of
   truth and the free-form `outline` is generated from it (or retired). *(Recommended.)*
2. **Spec authoring seed** — should the shredder *propose* a volume/artifact structure (Claude
   pass) for the expert to accept, or is `apply-preset` + manual the V1 path? *(Recommended:
   preset + manual for V1; shredder-proposed structure as a fast-follow.)*
3. **Enforcement hardness** — block save/export on violation (422) vs warn-and-allow with an
   override. *(Recommended: warn on save, block on final lock.)*
4. **Strawman trigger** — auto-run the 3-source strawman at purchase, or on expert "Generate V0"
   click. *(Recommended: expert-triggered for V1 to control spend.)*

See `docs/V1_LAUNCH_READINESS.md` for the Red→Green ToDo (Track E) implementing this.
