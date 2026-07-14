# Section Spine — Templates ⟷ Meta ⟷ Atoms ⟷ Canvas ⟷ Collaboration

Full mapping + gap analysis of the section authoring loop, grounded in code (4 parallel
reviews). The organizing idea: **the section is a spine the way the opportunity card is a
spine** — one keyed record (`proposal_id, section_id`) that carries all its metadata from
template → placement → fill → accept → lock, visible-or-not, and every stage reads that same
self-describing record instead of re-deriving it.

```
 TEMPLATE            SECTION INSTANCE            CANVAS                ATOMS                COLLAB
 (mold blueprint) →  (self-contained meta)  →   (WYSIWYG surface) ←   (meta-tagged fill) → (edit→accept→lock)
  role, format_mode,  copied onto the row:       flow (DOCX) or        matched to the       N collaborators
  budget, allowed-    format_mode, budget,       absolute (PPT)        section's meta,       accept a version,
  elements, required  regen_prompt, atom_        by format_mode        AI regens INTO        admin locks,
  subsections, eval,  affinity, access_roles                          the budget            stage advances
  regen_prompt,       ↑ the AI regen reads       ↑ layout_mode         ↑ scored selector     ↑ tasks + audit
  version/lineage     everything from HERE       drives which          (pre-vector today)    (like the card)
```

The mold defines what fits; the atoms are the fill; the canvas is where they meet; collaboration
governs acceptance. Three of these already have a working half (structured canvas, guardrail
enforcement, admin lock); the standardization + the "fill" + free-form + multi-accept are the gaps.

---

## 1. Template / section meta-tag standard (the full rundown)

**Today metadata is fragmented across FIVE homes** — matrix (`solicitation_compliance` / `solicitation_volumes` / `volume_required_items`), template (`document_templates` + in-code `lib/templates/*`), frozen artifact (`proposal_artifacts.format_spec`/`compliance_spec`), section instance (`proposal_sections` + `meta`), and canvas (`CanvasRules` inside `content`). The freeze (`lib/artifact-spec.ts`) **drops** eval-criteria and any regen guidance en route. The target is ONE self-describing "section-template" record, copied onto `proposal_sections.meta` at placement, that every downstream stage reads.

### Target meta-tag set (each copied template→section so the section is self-contained)

| Group | Meta-tag | Status | Where today / gap |
|---|---|---|---|
| **Identity** | `section_type` (key, e.g. `technical.overview`) | **EXISTS** | `proposal_sections.section_type` (mig 075:33) + `section_standards` taxonomy |
| | `section_role` (narrative/tabular/graphic/form/bio/cost) | **NEW** | approximated by `category`; no explicit semantic role |
| | `template_id` + `template_version` + `parent_template_id` | **PARTIAL** | `volume_required_items.template_id` (086:21) exists; **`document_templates` has no version/parent lineage column** |
| **Mold / format** | `format_mode` (document \| slide \| sheet) | **NEW (normalized)** | re-derived every time from `item_type`(012:92) / `artifact_type`(083:16) / `CanvasRules.format`(canvas:23) — no single enum |
| | `layout_mode` (flow \| absolute) | **MISSING** | canvas is flow-only (see §2); no discriminator |
| | `page_limit` / `slide_limit` | **EXISTS** | `volume_required_items` 012:100-101; `CanvasRules.max_pages/max_slides` |
| | `word_budget` | **PARTIAL** | computed at runtime (`lib/section-budget.ts`, shipped) but **not persisted** |
| | `byte_budget` / `max_file_size` | **MISSING** | no file-size ceiling anywhere |
| | `font_family/size` · `min_font_size` · `line_spacing` · `margins` | **EXISTS** | 012:102-105, 084:17; `CanvasRules.font_default` |
| | `images_allowed` / `tables_allowed` / `slides_allowed` | **PARTIAL** | images+tables **bundled** in `images_tables_allowed` (001:244); need split; `image_max_width/height` in the type but not persisted |
| **Content** | `required_subsections[]` | **EXISTS** | 012:110 / 001:248 / `ComplianceSpec.required_sections`; also `section_standards.parent_key` |
| | `evaluation_criteria[]` (at section scope) | **PARTIAL** | only matrix-level (001:250); **NOT in `ComplianceSpec` → dropped at freeze**; workspace never passes it |
| **AI regen** | `regen_prompt` / `generation_guidance` (structured) | **MISSING** | only generic `expert_notes` (086:22) + transient `instruction` + historical `canvas_versions.ai_instruction` |
| | `topic_context_hook` (feed topic summary / RFP excerpt) | **WIRING GAP** | drafter accepts `rfpExcerpt` but `proposal-workspace.tsx:320` passes **only `pageLimit`** |
| | `atom_affinity` (which atom kinds/types feed this section) | **NEW** | drives atom selection (§3); implied by `section_type` today |
| **Collab / access** | `visibility` / `access_roles` (admin-only vs collaborator) / `namespace` | **MISSING (on sections/templates)** | only `library_units.visibility` (atoms, 093:20); admin gating is **UI-only** (`proposal-workspace.tsx:319`) |
| | `assigned_collaborators` | **PARTIAL** | `proposal_collaborators.assigned_sections[]` (029:33); scalar `assigned_to` is **dead** |
| | `acceptance_policy` (quorum / all-required) | **MISSING** | single admin accept only (§4) |
| **Provenance** | `plucked_from` (template id+version+curator) | **PARTIAL** | node-level provenance only; section-level thin |
| | `status` (empty→ai_drafted→in_review→accepted→locked) | **EXISTS** | `proposal_sections.status` + `is_locked` (074) |

**Net gap for pluck-and-place + AI regen:** (1) a consolidated **versioned template record**; (2) three first-class fields — **`format_mode` enum, a structured `regen_prompt`, `evaluation_criteria` + access/visibility at section scope**; (3) **wire the workspace** to feed topic-summary/eval/subsections into the drafter (already accepted by the contract, not sent).

---

## 2. Canvas WYSIWYG — free-form (PPT) vs structured (DOCX)

**Ground truth:** the canvas is a **pure sequential-flow model.** `CanvasDocument.nodes` is a flat ordered `CanvasNode[]` (canvas:307) with **zero per-node geometry** (no `x/y/w/h/z/parent_id` — canvas:268-284). Pages and slides are **not objects** — they're runs of nodes split by `page_break` nodes. There's **no mode field**; the only discriminator is `CanvasRules.format` (letter/slide_16_9/slide_4_3/custom/spreadsheet), which conflates page geometry with editor selection. The "SlideEditor" is **PowerPoint chrome over the same flow renderer** (`slide-editor.tsx:249-257` reuses `CanvasRenderer`).

| Capability | Status | Detail |
|---|---|---|
| **Structured (DOCX flow)** | **EXISTS (complete)** | auto-height stacking, `space_before/after/indent/alignment`, `page_break`, margins, header/footer, word-budget fit, DOCX export (`docx-exporter.ts:314`) |
| **Node reorder (drag/move)** | **EXISTS** | but changes **sequence index only**, never position/depth (`canvas-renderer.tsx:122-171`) |
| **Image intrinsic resize** | **PARTIAL** | numeric W/H inputs only, no handles (`canvas-renderer.tsx:827-846`) |
| **Free-form (PPT absolute)** | **MISSING** | no geometry, no z-order, no drag-to-xy, no resize handles, no container/group nodes, no per-slide node ownership |
| **PPTX export at absolute coords** | **PARTIAL (reusable)** | already places at absolute inches, but from a **flow accumulator** `curY` (`pptx-exporter.ts:91-96`) — wiring real geometry in is small |

**Target (section `format_mode` drives it):** add, to `lib/types/canvas-document.ts`, (a) `canvas.layout_mode: 'flow' | 'absolute'` decoupled from page geometry; (b) an **optional** `node.geometry?: {x,y,width,height,z?,rotation?}` (percent-of-page, following the existing `AnchorRect` precedent at `source-anchor.ts:33-38`) — *optional* is what lets one node flow (geometry absent) or be placed (present); (c) a `container` node type + node ownership (`parent_id`/`slide_id`) so slides/pages become first-class. Then an **absolute rendering/interaction layer** (drag→x/y, handles→w/h, bring-to-front→z) mounted for `layout_mode='absolute'`, feed `geometry` into the PPTX sink, and container-bounds overflow detection instead of word-fill for free-form. **Structured mode is already done; free-form is the greenfield half** — and the section's `format_mode`/`layout_mode` meta-tag is the switch.

---

## 3. Atom standardization (meta/context-driven — no vectors yet)

**Ground truth:** an atom (`library_units` row) is already metadata-rich — `category`, `subcategory` (= the authoritative `section_standards` bucket), namespaced `tags[]` (`agency:/org:/program:/sol:/type:`), `meta.context{agency,office,programType,namespace}`, `meta.sectionType`, `outcome_score`, `usage_count`, `confidence`, `visibility`, lineage — **but the rich meta is written on *harvest* (accept/lock → library), while *upload* atoms get almost none of it.** Embeddings are unused (the `vector(1536)` column is NULL — "Phase-4").

**The standardization gaps (this is the "we need some standardization" you called out):**

1. **FOUR overlapping category vocabularies** — `section_standards.category` (DB authoritative, 075), the `atom-review` dropdown (18 values), the import `CATEGORY_PATTERNS`, and `SECTION_CATEGORY_MAP` (title→category). They disagree — e.g. `SECTION_CATEGORY_MAP` emits **`cost_proposal`** while ingest uses **`cost_volume`**, so a cost atom silently never matches a cost section. **→ collapse to ONE canonical taxonomy (`section_standards`), map all others onto it.**
2. **Upload vs harvest parity — MISSING** — backfill `section_type`, `subcategory`, `context`, and a new `summary` onto upload atoms so uploads are eligible for matching, not just harvested atoms.
3. **`summary` field — MISSING** — the single most valuable pre-vector field (a one-line abstract for lexical matching, generated at atomize/harvest).
4. **`format_affinity` (doc/slide/sheet) — MISSING** — `ImportResult.sourceFormat` is computed but never persisted; a slide atom can't be preferred for a slide section.
5. **`content_kind` (narrative/bio/past-perf/cost/graphic/boilerplate) — PARTIAL** — `category` approximates it; no explicit semantic kind.

### The pre-vector selector (how AI picks the best memory per section, no embeddings)

A deterministic scored filter over **(topic summary + section meta + atom meta)** — reuses Path B's scope, not Path A's brittle title-slug:

1. **Hard scope (recall gate):** candidates = `status='approved'` AND (`tags && ['type:<section_type>']` OR `subcategory = <section_standards.category>`) — the compliance-bucket gate.
2. **Context boost:** overlap the section's opportunity context (agency/office/programType/namespace, already on the card) with `meta.context.*` — exact agency+program ranks above same-bucket-only.
3. **Lexical match:** token overlap between the section's `topic_context_hook`/`regen_prompt` and each atom's `summary` + `heading_text` (the cheap stand-in for semantic similarity; removes the `content ILIKE` hack).
4. **Quality/recency tie-break:** `outcome_score DESC` (awarded>pending>rejected) → `usage_count DESC` → recency → `confidence` (the existing sort).
5. **Access gate:** drop atoms the requester can't use (`visibility`/`owner_user_id`/`library_unit_shares`).

The shortlist is handed to `proposal.draft_section` as `<library_atoms>` — **enriched to show `summary | section_type | agency/program | outcome`** (not just `category | tags`) so Claude picks intelligently and regenerates them **into the section's word budget** (already enforced). Admin "pluck and place" is the same selector surfaced as the `LibraryPicker`, letting a human pin specific atoms.

**Embeddings later (the next stage) augment, don't replace:** keep steps 1–2 as the authoritative recall/compliance gate, then inside steps 3–4 add a cosine term (`w1*cosine + w2*outcome_score + …`). Nothing in the atom model changes — populate the column, add one ORDER BY term. The meta-tag standard above is what makes both the pre-vector and post-vector selection correct.

---

## 4. Collaboration — multiple collaborators edit + accept, admin locks

**Ground truth:** acceptance is a **single admin action fused with lock.** `sections/[sectionId]/lock` (admin-only) sets `status='approved'` + scalar `accepted_by` + `is_locked` in one POST. Collaborators **cannot accept**. Edit access = `proposal_collaborators` (invite accepted) + `collaborator_stage_access.permission='edit'` + section in `assigned_sections` — but the **save route doesn't re-check `assigned_sections`** server-side (any edit-collaborator can save any section). Advance gate = every required section `is_locked`; **no task is created/completed on section assign/accept/lock.**

| Target piece | Status | Gap |
|---|---|---|
| Multi-party acceptance store | **MISSING** | scalar `accepted_by` can't hold N accepters → add `section_acceptances(section_id,user_id,accepted_version,decision,note,accepted_at, UNIQUE(section_id,user_id))`, pinned to a `canvas_versions.version_number` (stale-accept detection) |
| Collaborators can accept | **MISSING** | accept is admin-gated → add `POST/DELETE …/sections/[id]/accept` for an assigned `edit` collaborator; enforce the assignment check the save route omits |
| Split accept from lock | **MISSING** | collaborators accept (N rows) → **quorum met** → admin lock is the final flip; lock stops being the sole "accepted" signal |
| Quorum / all-required policy | **MISSING** | derive "all `edit` collaborators assigned to the section" or reuse `stage_gate_requirements` `collaborator_signoff`, evaluated automatically per-section |
| Assignment management | **MISSING** | no post-invite route to add/remove a collaborator on a section or change `view→edit` → add PATCH; retire dead `assigned_to` |
| Tasks tie-in ("like the opp card") | **MISSING** | on accept-phase, `createTask` per required collaborator (`accept_section`, nudged); completing writes an acceptance row; quorum → admin lock task — mirrors `portal-workflow.ts:84-111` but section-scoped |
| Stage-advance wiring | **REUSABLE** | keep the `is_locked` gate; add a pre-lock "quorum met (or admin force)" guard |
| Audit | **PARTIAL** | add `section_accepted`/`section_locked` to `proposal_activity_log.activity_type` CHECK (044:24-37) + write rows (lock only emits events today) |

This is the piece that makes the section behave **like the opp-card lifecycle** — a state machine (`assigned → editing → accepted(×N) → quorum → locked → advanced`) backed by the tasks ledger + audit, instead of a single admin toggle.

---

## 5. How they bind — the section meta contract

The keystone is a single **section meta record** (a promoted, versioned template row, copied onto `proposal_sections.meta` at placement) that every stage reads:

- **Canvas** reads `format_mode` + `layout_mode` → mounts flow (DOCX) or absolute (PPT); reads budget → the fit meter (shipped).
- **Atom selector** reads `section_type` + `atom_affinity` + the opportunity context → scores atoms (§3); the admin picker surfaces the same ranking.
- **AI regen** reads budget + `required_subsections` + `evaluation_criteria` + `regen_prompt` + `topic_context_hook` + the selected atoms → generates **into the mold** (guardrail enforcement shipped; the missing inputs are the wiring gap in §1).
- **Collaboration** reads `access_roles`/`visibility` + `assigned_collaborators` + `acceptance_policy` → who edits, who must accept, when admin can lock (§4).

One record, read five ways — exactly the opp-card pattern (one card, read by admin cockpit + tenant pipeline + bucket rank + portal + proposal).

---

## 6. Consolidated gaps + build sequence

**Cross-cutting standardizations (do these first — everything else depends on them):**
- **S1 · One taxonomy:** collapse the 4 category vocabularies onto `section_standards`; fix `cost_proposal`≠`cost_volume`.
- **S2 · `format_mode` enum** as a first-class field (document/slide/sheet), replacing re-derivation.
- **S3 · The section meta record:** promote a versioned template record + copy it onto the section, carrying the full §1 tag set (adds `regen_prompt`, section-scope `evaluation_criteria`, access/visibility, split images/tables/slides, `word_budget`, `format_mode`/`layout_mode`).

**Then the tranches (each a PR, verified, with its HITL test appended):**

| Tranche | Delivers | Builds on |
|---|---|---|
| **T-A · Section meta + regen wiring** | S1–S3; wire the workspace to feed topic-summary + eval + subsections + `regen_prompt` into the drafter | the shipped word-budget/guardrail enforcement |
| **T-B · Atom fill (pre-vector)** | upload/harvest meta parity + `summary` + `format_affinity`/`content_kind`; the deterministic scored selector; enriched `<library_atoms>`; admin pluck-and-place picker unified on it | S1–S3 (section meta gives the selector its query) |
| **T-C · Canvas dual-mode** | `layout_mode` + optional node `geometry` + `container` type + absolute layer + PPTX geometry export | S2 (`format_mode` drives it) |
| **T-D · Multi-accept + admin lock** | `section_acceptances` + collaborator accept route + quorum + split accept/lock + task tie-in + audit CHECK | S3 (`acceptance_policy`, `access_roles`) |
| **T-E · Vectorize as we go** | embeddings on atomize/harvest; cosine term added to the T-B selector | T-B (slots into the same selector) |

**Already shipped (the first slice of the loop):** the section budget engine + guardrail-enforced AI generation (the AI now writes *into* the mold and self-corrects on overflow) + the canvas word-budget fit meter. T-A/T-B extend exactly that surface.
