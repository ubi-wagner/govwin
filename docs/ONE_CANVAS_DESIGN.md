# One-Canvas / Polymorphic Artifact Key — design pass (C2, 2026-08-14)

> **Status: DESIGN PASS for review — no code.** Deferred in `docs/CANVAS_BUILD_LOG.md` ("the polymorphic
> artifact key / one-canvas refactor" — explicitly scoped out of the MVP). This is the design-first pass
> the next-phase plan (`docs/NEXT_PHASE_PLAN.md` C2) calls for before committing build days. It grounds the
> refactor in the **as-built** schema, states the problem it pays down, proposes a phased non-destructive
> migration, and enumerates the invariants that will bite. It recommends a **staged build behind a flag** —
> not a big-bang.

## 1. The as-built fragmentation (why this exists)

The **CanvasDocument type is already shared** (`lib/types/canvas-document.ts`) — every surface authors the
same node model, and the compliance floor (`validateCanvasAgainstSpec` / `validateStandaloneCanvas`) already
spans all of them. What is **NOT** shared is **where the canvas is stored and how it is versioned**. Today
there are **three divergent storage+versioning models** plus two leaf stores:

| # | Entity | Canvas column | Versioning | History depth | Save/restore/autosave/accept-AI |
|---|---|---|---|---|---|
| 1 | `proposal_sections` | `content` | `version` int (CAS counter) → **`canvas_versions`** (`section_id` FK) | **Rich** — `version_number`, `source`, `ai_instruction`, `ai_model`, `parent_version_id`, `char_count`/`word_count`, `edit_summary`, `snapshot_reason` | **Full** (writable restore, autosave snapshots, Accept-AI, 409-safe overwrite) |
| 2 | `tenant_documents` (standalone portal/admin docs) | `canvas` | `version` int **inline only** | **None** — no history table | **Partial** — only the compliance floor is shared; restore/autosave/accept-AI would be re-built |
| 3 | `content_pages` (CMS) | `blocks` | `version_no` int | draft→publish→archive semantics (`content-admin.ts`), no per-edit snapshots | Own path (`lib/content-admin.ts`) |
| 4 | `library_atoms` | `canvas_nodes` | none | copied-forward (no history by design) | n/a (atoms are immutable snapshots) |
| 5 | templates (`master_templates.version`, `tenant_documents.source_template_id`) | via 1/2 | `version` int | — | via 1/2 |

**Row reality (sandbox):** `canvas_versions`=1, `tenant_documents`=2, `content_pages`=59 — i.e. the rich
history model (canvas_versions) is used by exactly one family; the other surfaces have no comparable history.

**The cost of the split.** `canvas_versions` is referenced by **12 files**. Every trust-hub capability the
Canvas build shipped for proposal sections — the writable restore path, local-draft autosave/recover, the
non-destructive 409, one-click Accept-AI, the full-draft land-on-review — is **section-shaped**. The moment a
customer wants "restore a prior version of my standalone capability statement" or "undo on a CMS page," it is
a **re-implementation**, not a prop drill-down. And each re-implementation re-encounters the same footguns
(below). This is the classic "shared type, unshared plumbing" tax: the model converged, the storage didn't.

## 2. What the refactor is

**One polymorphic canvas artifact + one generalized version history**, so any canvas-bearing entity gets the
section-grade trust hub for free.

```
canvas_artifacts            -- the single home of a live canvas
  id            uuid pk
  owner_type    text  -- 'proposal_section' | 'tenant_document' | 'content_page' | 'template' | ...
  owner_id      uuid  -- the row in that entity's table
  tenant_id     uuid  -- NULL for platform/our-org canvases (content_pages, master templates)
  canvas        jsonb -- the live CanvasDocument
  version       int   -- the CAS counter (== MAX(history.version_number), advanced on write)
  ...node_count, updated_at, last_modified_by
  UNIQUE (owner_type, owner_id)

canvas_artifact_versions    -- canvas_versions, generalized off section_id → artifact_id
  id, artifact_id (fk), version_number, content jsonb, source, ai_instruction, ai_model,
  parent_version_id, char_count, word_count, edit_summary, snapshot_reason, created_by, created_at
  UNIQUE (artifact_id, version_number)
```

The entity tables keep their business columns (a section keeps `is_locked`, `sort_index`, `volume_name`; a
`tenant_document` keeps `doc_type`, `library_foundation_id`) and gain an `artifact_id` FK; the **canvas + its
history move behind the artifact**. One save/restore/autosave/accept-AI/409/compliance path — `lib/canvas/*`
— serves all owner types; the numbering invariant is enforced in exactly one place.

**Not in scope** (deliberately): merging the *business* semantics. A proposal section's lock/advance gate,
a CMS page's draft→publish, an atom's copy-forward immutability are **different lifecycles** and stay per
owner-type. Only the *canvas storage + version history + edit plumbing* unify.

## 3. Migration — non-destructive, forward-only, flag-gated

The archive/RLS/bridge work in this repo has a house style — additive migrations, dual-write, cut reads over,
retire last — and this follows it. **Nothing is dropped until reads are proven off it.**

- **P0 · Introduce (additive).** Create `canvas_artifacts` + `canvas_artifact_versions`. FORCE-RLS +
  `tenant_isolation` on both (mirroring mig 136), with the platform/our-org rows (`tenant_id IS NULL`) handled
  by the same policy shape the CMS/admin bypass reads already use. No entity table touched yet.
- **P1 · Backfill + dual-write proposal_sections.** Backfill an artifact per section (carry `content`→`canvas`,
  copy `canvas_versions`→`canvas_artifact_versions`, preserve `version_number` exactly). Add
  `proposal_sections.artifact_id`. Writes go to **both** the section columns and the artifact (behind
  `ONE_CANVAS=shadow`), reads still off the section. Prove byte-parity in the sandbox.
- **P2 · Cut section reads over.** Flip the section save/restore/autosave/accept-AI/land-revisions paths to
  read/write the artifact (`ONE_CANVAS=on`); the section `content`/`version` columns become derived mirrors
  (kept for the export assembler until P4). The 4 trust-hub capabilities now live in `lib/canvas/*` once.
- **P3 · Fold tenant_documents + content_pages.** Point their save/export routes at the shared path; they
  **inherit** restore/autosave/accept-AI with no new code. `content_pages` keeps its draft→publish lifecycle
  on top (publish = tag an artifact version).
- **P4 · Retire the mirrors.** Once `assembleArtifactCanvas` + the exporters read the artifact, drop the
  per-model canvas/version columns (additive-then-subtractive, the mig-125 pattern) and delete the section-only
  `canvas_versions`.

Every phase is independently shippable and reversible at the flag; abandoning after P2 still leaves sections
strictly better (one code path) and the other surfaces untouched.

## 4. Invariants that WILL bite (design them in, don't discover them)

1. **The `canvas_versions` numbering CAS** (CLAUDE.md, cost us content-loss twice). `proposal_sections.version`
   MUST stay `> MAX(canvas_artifact_versions.version_number)` per artifact; a new version numbers at the
   artifact's CURRENT `version` and **advances the counter** (CAS `version = version + 1`). Generalizing the
   table does not change this — it **centralizes** it, which is the win: one writer, one place to get it right.
2. **RLS on a polymorphic table.** `canvas_artifacts` mixes tenant-scoped rows (sections, tenant_documents)
   with platform rows (content_pages, master templates, `tenant_id IS NULL`). The `tenant_isolation` policy
   must admit `tenant_id IS NULL` for the platform owner types **without** leaking tenant rows — same shape as
   the existing CMS/admin `sqlBypass` split (docs/RLS_CUTOVER.md). Get the policy predicate right in P0 or the
   whole thing is unsafe.
3. **The export assembler.** `assembleArtifactCanvas` (readiness gate + package export) reads
   `proposal_sections` in `sort_index` order. It must read the artifact's canvas transparently — keep the
   section mirror through P3 so export never breaks mid-migration; only retire it in P4 after the assembler is
   repointed.
4. **camelCase-off-toCamel** (the #1 runtime-crash class). New `sql<typeof rows>` reads of the artifact tables
   MUST declare fields camelCase (`versionNumber`, `ownerType`), matching the runtime transform.
5. **jsonb writes** via `${sql.json(canvas)}`, never `::jsonb`-stringified — the canvas is read back as an object.
6. **No cross-owner-type leakage.** The `(owner_type, owner_id)` unique + the RLS predicate must make it
   impossible for a section artifact to be fetched as a document artifact — the polymorphic key is only safe if
   every read carries `owner_type`.

## 5. Recommendation

**Build it staged, behind `ONE_CANVAS`, section-family first — do NOT big-bang.** The value is real
(every future canvas surface inherits the trust hub instead of re-implementing it, and the numbering/version
footguns collapse to one code path), but it is **internal leverage, not a customer-visible feature** — so it
should ride behind first-customer work, not block it. Ship P0–P2 (sections on the shared path) as one
increment, prove parity, then fold tenant_documents/content_pages (P3) opportunistically when a customer
actually needs versioned standalone docs or CMS undo. Retire mirrors (P4) last.

**Rough effort:** P0–P2 ≈ 3–4 D (the migration + parity proof is the bulk); P3 ≈ 1–2 D per folded surface;
P4 ≈ 1 D. Total ≈ 5–8 D, matching the plan's estimate, and **safely interruptible** at every phase.

**Open decisions for the reviewer:**
- Do standalone `tenant_documents` and CMS `content_pages` actually need version *history* soon, or is the
  section-family unification (P0–P2) enough for now? (Drives whether P3 is in this cycle.)
- Should `library_atoms`' copy-forward immutability stay outside this model (recommended) or become "an
  artifact version pinned as immutable"? (Recommend: leave atoms out — different contract.)
- Sequence vs. the CRM build-out (C3) and further agent wakes (B) — this is leverage, those are reach.
