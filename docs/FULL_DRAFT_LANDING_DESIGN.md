# Full-Draft Landing — design (the "land-or-review" step)

**Status:** designed, not yet built. This is the one punchlist item that is a **cross-service
architectural change** (pipeline + frontend) touching the **agent-write safety boundary**, so it
is scoped here to be built + verified in the two-service env rather than rushed. Everything else in
the 2026-08-08 quick-win pass (doc hygiene, canvas TOC/page-count, compliance-floor enforcement)
shipped green.

## The gap (verified in code)

The admin **"Run full draft"** doorbell and the tenant Draft-Manager fire `OnFullDraftRequested{ModeA,
B,C}` — the whole `formatter`/`stylist`/`section_drafter`/G-gate cohort runs end to end. But each agent
returns a **staged, un-persisted** result:

- `pipeline/src/agents/archetypes/formatter.py:367` — *"Staged, NOT persisted. A wired review step lands
  this as a canvas_versions row."* → returns `{ persisted: False, staged_for_review: True, source:
  'ai_revision', canvas: <CanvasDocument> }`.
- `stylist.py:291` — *"returns a canvas_versions-shaped proposal (source='ai_revision')."*
- `processor.py:304` — the engine *"Never writes to business tables — all output is advisory."*

There is **no step** that takes those staged canvases and writes them anywhere the builder can see, so
`canvas_versions` shows **0** `ai_revision` rows after a full-draft run. The marquee feature produces
output the customer never sees. (The *live* `draft_v0` path is different — `section_drafter` has
read-only tools and the **frontend** tool persists it; the Mode A/B/C cohort has no such landing.)

## The safe design (preserves the invariant)

Land each staged canvas as a **proposed version** in history, not as live content — a human then
reviews and restores it. This keeps the agent invariant intact: *the agent never writes a business
table; a deterministic **ACTION** step lands a proposed `canvas_versions` row; the human applies it.*

```
OnFullDraftRequested{ModeA,B,C}
  … agent steps (reformat / restyle / draft_sections / gates) → staged canvases in step_results …
  land_ai_revisions   (NEW — StepType.ACTION, deterministic)     ← writes canvas_versions
  stage_review / review_gate  (existing TODO — the HITL gate)     ← human reviews + restores
```

### 1. New pipeline ACTION — `land_ai_revisions`
- A deterministic engine action (NOT an agent tool), so writing a business table is allowed.
- Reads the staged `{ section_id, canvas, source:'ai_revision' }` payloads from the prior steps'
  `process_instances.step_results`.
- For each, INSERT a `canvas_versions` row reusing the canonical shape already used by
  `lib/proposal-advance.ts:305` / `lib/proposal/lock-section.ts:111`:
  `(section_id, version_number, content, snapshot_reason, source, created_by)` with
  `source='ai_revision'`, `snapshot_reason='full_draft_mode_<x>'`, `created_by='agent:<archetype>'`,
  and `version_number = MAX(version_number)+1` per section (compare-and-swap / ON CONFLICT-safe).
- Tenant-scoped write; verify each `section_id` belongs to the instance's proposal/tenant (never trust
  a staged id). Injection-fence any text already applies upstream.
- Best-effort per row; a bad row is logged and skipped (never dead-ends the workflow — the safe-skip
  invariant).

### 2. Wire it into the three workflows
Add the `land_ai_revisions` ACTION step to `on_full_draft_requested.py` Mode A/B/C, depending on the
draft/refine/restyle steps, **before** the review TODO. Register the action in
`processor.py` (`TOOL_ACTION_TO_ARCHETYPE` is for AI_INVOKE; an ACTION dispatches via the engine's
action table — mirror an existing ACTION like `advance_phase`).

### 3. Review surface — already built
`app/api/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/versions/route.ts` already
lists `canvas_versions` with `source`, and the version-history UI already renders `ai_revision` rows
with a restore action. So once the rows land, **review + apply is already possible** — no new UI.
(Optional polish: a "N AI revisions proposed" badge on the section from the full-draft run.)

### 4. Update the workflow visualization
Add the `land_ai_revisions` node to the Mode A/B/C shapes in
`frontend/app/admin/workflows/workflow-shapes.ts` so the new Workflow Map / instance graphs show it.

## Test plan (why this needs the two-service env)
- **Pipeline pytest** — the landing action: staged→rows, version_number increment, wrong-tenant
  section rejected, empty/no-staged safe-skip, malformed-row skip. *These need `DATABASE_URL` + the
  pipeline test env (the sandbox has the known PyO3/cryptography env issue on 8 tests).* 
- **Frontend vitest** — the versions route already surfaces `ai_revision`; add a case asserting an
  `agent`-authored `ai_revision` version lists + restores.
- **Live drive** — run the doorbell full-draft against a seeded proposal in the app+pipeline env
  (`E2E_WITH_PIPELINE=1`), then confirm the section's version history shows the proposed AI revisions
  and a restore applies one. *Needs the pipeline worker running alongside the app.*

## Guardrails checklist (non-negotiable)
- Agent output stays advisory — the ACTION lands a **proposed version**, never overwrites live
  `proposal_sections.content`.
- Tenant-bound: every `section_id` validated against the instance's proposal/tenant.
- Runaway-safe: bounded to the run's sections; per-row best-effort; never dead-ends the workflow.
- Audited: emit `proposal:ai_revision.landed` (add to the EVENT_CONTRACT catalog) with the count.

## Lift
Pipeline action + 3 workflow wirings + shapes update + tests ≈ **M–L**, gated on the two-service test
env for green verification. Build as a focused piece, not a session-tail rush.

---

## ⚠️ UPDATE 2026-08-08 — the pipeline-ACTION approach is ARCHITECTURALLY BLOCKED

I built the `land_ai_revisions` ACTION above and wired it into Mode A/B/C. The **engine's own
invariants (verified by its test suite) reject it** — and correctly so. Two invariants combine to
make it structurally impossible for a pipeline ACTION to consume an agent's staged output:

1. **no-dead-end** (`test_workflow_no_deadend_emission.py`): a non-AI_INVOKE step must **never**
   `depends_on` an AI_INVOKE agent — *"an advisory agent must never gate a hard step"* (an agent can
   skip/fail; a hard step behind it would strand).
2. **input-map-ancestor** (`Workflow.validate()`): an `input_map` that references `step.X.result`
   requires **X to be a transitive `depends_on` ancestor** — *"its result may not be ready"* otherwise.

Together: to READ `step.reformat.result` an ACTION must depend on `reformat` (inv 2), but `reformat`
is an AI_INVOKE, so depending on it violates inv 1. **An ACTION therefore cannot legally read an
agent step's result.** The moat is deliberately preventing a deterministic step from consuming
advisory agent output. (A direct `SELECT step_results` from within the action doesn't help either —
the action isn't handed its own `instance_id`, and mid-workflow `step_results` may be incomplete.)

**The `land_ai_revisions` ACTION + its wiring + tests were reverted** (they fail `validate()` + 3
suite tests; shipping them would break the boot invariant). The pipeline is back to green baseline.

### The correct architecture — FRONTEND read-on-review (recommended)

The invariant-clean landing lives **outside the pipeline**, human-triggered:

- A frontend route `POST /api/portal/[slug]/proposals/[p]/land-proposed-revisions` (tenant_admin+)
  reads the proposal's latest `OnFullDraftRequested%` `process_instances.step_results`, recursively
  scans for the staged `{section_id, canvas, source:'ai_revision'}` shapes (the exact nesting is
  `result → result → tool_results[] → output`), validates each section belongs to the proposal, and
  writes a **proposed** `canvas_versions` row (`source='ai_revision'`) per section — reusing the
  existing version-write path. The existing version-history UI already surfaces + restores
  `ai_revision` rows, so review needs no new surface.
- Trigger: a button on the proposal workspace ("Apply AI-proposed revisions", shown when a completed
  full-draft instance has staged output), or land-on-open of the Mode A/B/C review TODO.
- **Why this is clean:** nothing in the pipeline consumes agent output (invariants untouched); the
  landing is human-initiated (the strongest advisory posture); fully vitest-verifiable with synthetic
  `step_results` (no live LLM/DB needed). Est. **M** (route + extract + a UI trigger + tests).

### Alternative — agent-tool-lands (rejected)

Make the formatter/stylist tool WRITE the proposed `canvas_versions` row itself and return
`persisted:true`. Smaller, but it has the agent auto-write a business table — murky against the
*"agents never auto-write business tables"* invariant (even for a proposed-only version). The
frontend approach keeps that line bright; prefer it.

**Net:** the naive "wire a landing step into the pipeline" is a dead end — the engine forbids it by
design. Build the frontend read-on-review as a focused piece. (Save-side compliance — the other
follow-on — shipped green: commit `7373c98`.)
