# The Optimized Merge — visual-first authoring, structure-as-overlay

**The ask (verbatim intent):** design the hybrid so the **human-visual view is the highest-priority
default**, while structure stays available — *toggle section breaks and atom-primitive outlines on/off* —
and **collaboration views are just certain sections**. Merge **full functionality** with **human
visualization + interaction at the highest order of priority.** This doc is the map (design only); no code
moves until it's signed off. It supersedes the instinct behind the recent nav-sectioning, which is reverted
as Step 0.

## 1. The direction is already ours — finish it, don't reinvent

`docs/CANVAS_FLUID_REDESIGN.md` (signed off 2026-08) *is* this design: **document-first · structure-as-overlay
· selection-as-verb.** "The section/mold structure is scaffolding for compliance + agent targeting, **not the
layout**." Built so far:

- **F0/F1 shipped** — a fluid whole-proposal document (`fluid-document-view.tsx`): one continuous render, a
  left **outline rail**, sections as inline title boundaries, and a **selection toolbar** (Atomize + Annotate
  on any span). But: **read-only, opt-in behind a "Document" tab, admin-only.**
- **F2 partial** — regenerate / reuse / compliance-check on a span not yet wired into the fluid mount.
- **F3 NOT built** — the toggleable **overlay layers** (Structure / Provenance / Compliance) — i.e. the exact
  "toggle section breaks and atom-primitive outlines" you described.

So the "compartmentalization" you flagged is the **default** proposal surface (the section-list + the
`Manage` tab bar), which the fluid model was already meant to replace. The merge = **make fluid the primary,
build F2+F3, and fold every compartment into an overlay / lens / selection-verb / slim action-bar** — with
zero data migration (the `sections → groups → nodes` model and `proposal-access.ts` stay exactly as-is).

## 2. What is visual vs. compartment today (the honest split)

| | Visual (keep + elevate to primary) | Compartment (fold into the visual) |
|---|---|---|
| **Proposal** | Fluid Document view (`fluid-document-view.tsx`); selection toolbar; canvas renderer | Section-list default ("All/My Sections"); the `Manage` tab-row (Artifacts/Team/Compliance/AI/Seed); one-section-one-canvas editor; the workspace tab-rows |
| **Portal** | Cockpit (proposal cards + IndicatorRail tiles → drawers) | The 17-item left menu — and my recent **sectioning of it** (Step 0 revert) |

## 3. The merged surface — one document, layered

The proposal opens as **one fluid, editable document** (default · all roles · human-visual). Everything else
is *summoned on top of it*, never a place you navigate to:

- **A · Overlay toggles (F3).** A quiet chip bar, **all off by default** (clean document):
  `Sections` · `Atoms/Primitives` · `Compliance` · `Provenance` · `Budget`. Each paints a togglable layer —
  section boundaries + their inline affordances; atom/node outlines + lineage; per-requirement coverage
  heatmap; AI/library/manual/reuse source heatmap; inline page/length gauges.
- **B · Selection-as-verb.** Highlight any span → floating menu: **Atomize · Regenerate · Annotate · Reuse ·
  Compliance-check** (finish F2/F4). One gesture replaces the scattered node- and section-scoped action trays.
- **C · Edit in place.** Editing happens *in* the fluid doc; the owning section (via `sectionOf`) stays the
  save-scope under the hood (`.../sections/{id}/save`) — the model is untouched, only the surface changes.
- **D · Collaboration lens.** A `Scope: [All ▾ | My sections]` control filters the **same** document to a
  contributor's assigned/commentable sections (`proposal-access.ts` → `editable/commentable/viewableSections`).
  A collaborator sees a clean document of *only their part*; permissions drive edit vs. comment vs. view. This
  is "collaboration views = certain sections," done as a lens, not a separate compartment.
- **E · Whole-proposal action bar.** A slim persistent bar over the doc: **Stage** (advance/lock/gates) ·
  **Studio** (Draft/Refine/Compliance) · **Download** (docx/pdf/zip) · **Assign task** · **⋯** (Archive,
  Save-as-template). Not tabs — always-present controls.
- **F · The `Manage` tab-row dissolves.** Artifacts → the **Sections overlay** + inline affordances; Team &
  Access → a summoned **panel**; Compliance → the **Compliance overlay** + a summoned checklist; AI & Library →
  the AI actions as **selection-verbs** + a summoned panel; Library Seed → a summoned panel.

## 4. Full-functionality preservation matrix (nothing is dropped)

Every function from the live inventory, and where it lands in the merged model. (Verified `file:line` in the
inventory that produced this table.)

| Current function | Lives today (compartment) | Merged home | Preserved |
|---|---|---|---|
| Open / edit a section | section-list "Open →" → one-canvas editor | **Edit in place** (C) in the fluid doc | ✅ |
| Accept & Lock / Unlock (per-section) | admin-panel row · editor ribbon | **Sections overlay** inline affordance on the boundary + selection menu | ✅ |
| Atomize section / span | admin-panel row · editor · fluid | **Selection-verb** (already in fluid) + Atoms overlay | ✅ |
| Assign section → collaborator | TeamManager invite matrix | **Team panel** (summoned) + inline "assign" on the Sections overlay | ✅ |
| Page-budget / length gauges | admin row · ribbon · sidebar | **Budget overlay** (inline gauges) | ✅ |
| Per-section compliance chip | admin row · ribbon | **Compliance overlay** + boundary chip | ✅ |
| Versions / history / restore | editor sidebar History tab | **History panel** summoned from the boundary/selection (section-scoped) | ✅ |
| Comments (section + span) | editor sidebar · fluid annotate | **Annotate selection-verb** (in fluid) + comment panel | ✅ |
| Status badges / watermark | every row · canvas watermark | **Sections-overlay chip** + document watermark (already renders) | ✅ |
| Stage advance / lock / gates | `StageControl` | **Action bar → Stage** | ✅ |
| Studio (Draft/Refine/Compliance) | `proposal-studio.tsx` (mounted) | **Action bar → Studio** (a control, not a tab) | ✅ |
| Download package (docx/pdf/zip) | admin panel | **Action bar → Download** | ✅ |
| Assign-a-task | disclosure on page | **Action bar → Assign task** (or cockpit ToDo drawer) | ✅ |
| Archive portal | page button | **Action bar → ⋯** | ✅ |
| Draft-all · bulk lock · lock-volume | workspace + admin panel | **Action bar** + Sections-overlay bulk affordances | ✅ |
| `Manage`: Artifacts | tab | dissolves → **Sections/Atoms overlays** | ✅ |
| `Manage`: Team & Access | tab | dissolves → **Team panel** (summoned) | ✅ |
| `Manage`: Compliance (check / readiness / package review / gates) | tab | dissolves → **Compliance overlay** + summoned checklist/readiness | ✅ |
| `Manage`: AI & Library (review / full-draft / land / accept-AI / reuse / research / outcome) | tab | dissolves → **selection-verbs** + a summoned **AI panel** | ✅ |
| `Manage`: Library Seed | tab | dissolves → summoned **Seed panel** | ✅ |
| Node ops (move/delete/accept-AI/revert/replace/format) | editor sidebar/toolbar | **In-place edit** + node affordance when Atoms overlay on / on selection | ✅ |
| Reuse (insert-from-library, replace-node, verbatim past-proposal) | 3 surfaces | **Reuse selection-verb** + Library drawer | ✅ |
| Collaboration scoping (assigned_sections → edit/comment/view) | "My Sections" · contributor view · server withhold | **Collaboration lens** (D) over the same doc; server still withholds unassigned | ✅ |

## 5. Phased path (each phase: green backbone + live-proven, both lenses)

0. **Revert the nav-sectioning** (undo the compartment drift; keep the flat/slim nav until the cockpit carries more).
1. **F2** — wire Regenerate / Reuse / Compliance-check into the fluid selection toolbar (props already exist).
2. **F3** — the overlay toggle bar (Sections/Atoms/Compliance/Provenance/Budget) painting togglable layers.
3. **Edit-in-fluid** — promote per-section editing into the aggregate (section stays the save-scope via `sectionOf`).
4. **Collaboration lens** — `Scope: my sections` filter driven by `proposal-access.ts`.
5. **Make fluid the default** — the section-list becomes an optional "List view" toggle, not the entry.
6. **Dissolve the `Manage` tabs** into overlays + summoned panels; retire the workspace double tab-row.

## 6. Two-lens check (the standing rule)

- **Human (highest priority):** default is a clean, readable document; structure appears only when summoned;
  one selection gesture does everything; a collaborator sees only their sections. Visualization leads.
- **Machine (correct + efficient):** the `sections → groups → nodes` model, the atomize pipeline, per-section
  AI, `sectionOf` routing, and `proposal-access.ts` permissions are **unchanged** — sections stay the
  compliance + agent-targeting scaffold; only the *surface* changes. No data migration; agents keep targeting
  sections/atoms exactly as today.

*(Grounded in: `docs/CANVAS_FLUID_REDESIGN.md` + `CANVAS_HUMAN_MACHINE_ANALYSIS.md`; the live inventory across
`proposal-workspace.tsx` · `proposal-admin-panel.tsx` · `proposal-contributor-view.tsx` · `canvas-editor*.tsx`
· `canvas-sidebar.tsx` · `stage-control.tsx` · `proposal-studio.tsx` · `team-manager.tsx` · `proposal-access.ts`
· `fluid-document-view.tsx` · `selection-toolbar.tsx`.)*
