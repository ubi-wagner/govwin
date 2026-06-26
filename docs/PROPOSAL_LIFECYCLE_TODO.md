# Proposal Lifecycle — Red→Green ToDo

Companion to `docs/PROPOSAL_LIFECYCLE_V1.md`. Tasks are **interlinked**: organized into
**tracks that run in parallel**, with **serial subtasks inside each track**. A task is
🟢 **Green** only when its acceptance criteria are met *and* tsc + the relevant test(s) pass —
same discipline as our proposal stages (a section isn't "done" until accepted + locked).

**Legend:** 🟢 done/verified · 🟡 in progress · 🔴 not started · ⛔ blocked-by.
**Severity:** P0 (blocks a core flow / contradicts the model) · P1 (major) · P2 (polish/debt).
**[∥]** = parallelizable with its track siblings · **[→]** = must follow the prior subtask.

---

## 0. Already Green (this push — baseline, do not re-do)

- 🟢 Per-model AI spend pricing (`fabric.py`, admin usage route)
- 🟢 Unified spend guard + draft/compliance enforcement (`lib/ai/agent-guard.ts`)
- 🟢 Settable AI limits — tenant + platform (mig 072), admin APIs + UIs, customer read-only usage view
- 🟢 UI-UX audit fixes — partner auth cluster, route scaffolding, Spotlight convert, dual-identity cleanup
- 🟢 Canonical event-labels module → activity / notifications / dashboard / timeline
- 🟢 Section accept/lock backbone (mig 074) + workspace lock/unlock UI (Phase 1a/1b)
- 🟢 Advance gated on lock state + force-advance marking (Phase 2a)
- 🟢 Document-close + ready-to-advance events + per-section harvest (Phase 2b)

Anchor: **429 frontend tests · 524 pipeline tests · tsc clean.** Migrations 072/073/074 run on deploy.

---

## Track A — Lock↔status unification (Phase 2c) · 🟢 SHIPPED

*Status: A1–A5 shipped & green (review-page readiness now lock-based; advance UI surfaces the
gate + admin force with the blocking-section list; force-advance no longer mislabels open
sections; GET-proposal `isEditable` is lock-aware; `status='approved'` is lock-only). Tests +
HITL §6.5 updated.*

*The new lock-state truth coexists with old `status` reads that now contradict it
(`PROPOSAL_LIFECYCLE_V1.md §9`). Highest priority — these are user-visible.* A1–A4 are mostly
**parallel** (different files); A5 is the **serial capstone** that removes the root cause.

- 🟢 **A1 · P0 · [∥]** Fix "Ready for Final" inversion. `review/page.tsx` counts
  `status==='complete'`; locking sets `status='approved'`, so a fully-locked proposal reads
  "not ready." **Green:** readiness computed from `is_locked` (all sections locked ⇒ ready);
  page agrees with the advance gate; test asserts locked⇒ready.
- 🟢 **A2 · P1 · [∥]** Surface the gate + force in the advance UI. `stage-control.tsx` posts `{}`
  and hides the force path. **Green:** on `SECTIONS_NOT_LOCKED`, render `details.openSections`
  (grouped by document) inline; add an admin-only **Force advance** action (confirm dialog +
  required note) that posts `{force:true}`; button visibility keys on lock state, not the legacy
  checklist. Test: force path posts `force:true`; open-sections list renders.
- 🟢 **A3 · P1 · [∥]** Stop mislabeling forced-open sections as accepted. `advance/route.ts`
  sets `accepted_by`/`accepted_at` on still-open sections. **Green:** on force, set
  `completed_stage` only for open sections (the "marked open" record); `accepted_by` reserved
  for genuine accept+lock. Test: forced-open section has no `accepted_by`.
- 🟢 **A4 · P2 · [∥]** Align GET-proposal API `isEditable` with the lock. `route.ts:236` ignores
  `is_locked`. **Green:** `isEditable = !isLocked && (completedStage === null || === stage)`;
  matches the page. Test updated.
- 🟢 **A5 · P1 · [→ A1–A4]** Make lock authoritative, `status` derived. `save` route lets
  `status` diverge from lock. **Green:** lock/unlock is the only writer of "done"; `status` is
  computed/display-only; all readiness reads use `is_locked`; doc §9 closed.

**Track A Green = the open-to-close flow shows one consistent truth end to end.**

---

## Track B — Audit & UX completeness · parallel with A

- 🟢 **B1 · P2** Contributor lock visibility. After A5, `status='approved'` ⟺ locked, so the
  contributor "My Sections" badge now reads **"🔒 Accepted & Locked"**; the GET-proposal API also
  returns `isLocked`/`lockedAt`/`acceptedByName`. *(Full "who/when" inline is a minor polish.)*
- 🟡 **B2 · P2** Lock-aware stage history. Largely satisfied by A5: `stage_completion_snapshots
  .sections_approved` now equals the locked count (status='approved' ⟺ locked), and the advance
  event carries `sectionsLocked`. Remaining: relabel the workspace history display "approved"→
  "locked" (cosmetic).
- 🟢 **B3 · P2** Event naming. Renamed `proposal.ready_to_advance` → **`proposal.advance_ready`**
  across the emitter, `event-labels.ts`, tests, and docs.
- 🟢 **B4 · P1** Bulk **"Accept & Lock All"** — top-of-Artifacts button (admin) locks every
  unlocked, drafted section in one click (loops the per-section lock route, so each emits
  `section.locked` + harvests, and the last fires `document.locked` + `proposal.advance_ready`),
  letting the whole document clear the advance gate. Per-node **regenerate-with-prompt** also
  already ships (`ai-revision-panel.tsx` custom-instruction field + the `instruction` param on
  `proposal.draft_section`). *(One-click whole-section regen remains a minor convenience.)*

---

## Track C — Phase 3: meta-tagging keystone → library/spotlight · parallel track, internal serial

*C1 is the keystone that unblocks C2/C3/C4. C5/C6/C7 are independent and can run in parallel with C1–C4.*

- 🟢 **C1 · P1 · keystone** Section meta-tag schema — **shipped**. Migration **075**: a discrete,
  hierarchical `section_standards` taxonomy (Team→Bio, Technical→Overview/Innovation/Readiness,
  Commercialization, Facilities & Equipment, Cost→Budget, …) seeded for DOD/NSF/SBIR/STTR;
  `proposal_sections` gains `section_type` (soft ref) + `tags TEXT[]` + `meta JSONB`. Create-route
  tags each section (`inferSectionType`) + stores matrix `meta`. RFP-admin **add/remove** via
  `/api/admin/section-standards` (GET/POST) + `[id]` DELETE (soft). *Follow-up: a small admin UI to
  manage the standards list (table + API are live).*
- 🟡 **C2 · P1 · [→ C1]** Ingest shred-classification (**JSON now, vector-ready**). *Started:
  harvested library atoms now inherit the section's `section_type` as a `type:<key>` tag.* Treat
  meta-tags as classified **shreds of the uploaded docs** carrying `meta` JSONB + (later) an
  embedding: buckets = tech highlights (primary ranking), readiness level, team, tech overviews,
  commercialization, facilities & equipment, prior funding, past performance (the
  `section_standards.category` set). The ingest sets the first matrix pass and auto-generates
  solicitation-specific tagged section skeletons; RFP admin refines in V0; tenant_admin tags
  documents they create in V1+. **Green:** new-opp ingest produces tagged skeletons; harvested
  atoms inherit `section_type`/category in `meta`; embedding column added (zero-vector until Phase-4
  embeddings).
- 🔴 **C3 · P1 · [→ C1]** Tenant library seeding. Seed foundational atoms (company, collaborators,
  technologies, nested bios) the tenant_admin tags/contexts at onboarding. **Green:** seeding flow
  + tagged `library_units`.
- 🔴 **C4 · P2 · [→ C1,C3]** "Similar section" retrieval UI. Atoms have embeddings (HNSW) but no
  retrieval UI. **Green:** sortable similar-atom picker in the canvas, scoped by section_type/tags.
- 🔴 **C5 · P1 · [∥]** Spotlight bucket taxonomy + per-bucket scoring. `spotlights` is filter-only.
  **Green:** classification (technology/innovation/service-offering, readiness, capabilities,
  prior funding) + `spotlight_bucket_score` per opp×bucket; opp shows rank per active bucket.
- 🔴 **C6 · P2 · [∥]** Opportunity lifecycle: archive-on-close + reconstitution / close-date change
  / reopen (rfp admin). **Green:** lifecycle transitions + admin controls; all opps retained.
- 🟡 **C7 · P1 · [∥]** Pipeline automation + **AI-agent review tasking**. *Increment 1 SHIPPED —
  customer automation setup (mig 076 `tenant_automation_preferences` + portal API + Automation
  page). Increments 2 (AI review on advance → section context boxes) + 3 (notification/flow
  enforcement) are designed + infra-ready in `PROPOSAL_LIFECYCLE_V1.md` §C3.* Remaining at the
  workflow step-milestones: The pipeline is a workflow; hang automation off the existing step milestones +
  outcome hooks, **configured by the customer admin at portal purchase** (start there), then run
  the code through and fill gaps with the most common proposal-dev automations. Driven by
  already-emitted events: `document.locked`→collaborator "get-ready" emails;
  `proposal.advance_ready`→optional auto-advance; new-priority-opp→customer alerts.
  **AI-agent tasking (key):** on an admin **force-advance to the next stage**, task our agents
  (grammar / flow / fluidity / compliance-matrix evaluation — skill-based) to review the completed
  work and surface **recommended changes inside each section's context boxes** — the same
  prompt→regen mechanism, but *we* prompt the agents by skill. **Green:** a customer-admin
  automation-setup step at purchase + at least one agent-review task on force-advance writing
  recommendations into section context. *(This is the on-ramp for the built-but-dormant agent
  workforce — `fabric.py`/archetypes — into the customer loop.)*

---

## Track D — Hardening, tests, docs · parallel, continuous

- 🟡 **D1 · [∥]** Test coverage for the new lifecycle. **Green:** lock-gate (done), harvest
  (done), document-close/ready events (done); add unlock-path + carry-forward across-stage tests.
- 🟡 **D2 · P2** Test coverage for the unified model: added the lock-gate (`SECTIONS_NOT_LOCKED`)
  + force-advance tests (Phase 2a) and the `status='approved'`-is-ignored test (A5). Remaining:
  carry-forward-across-stage + unlock-path cases.
- 🔴 **D3 · P2 · [∥]** Integrate the design docs: add a pointer to `PROPOSAL_LIFECYCLE_V1.md`
  from `ARCHITECTURE_V9.md` + `CLAUDE_CLIFFNOTES.md` (schema/route refs). **Green:** main docs
  link the lifecycle doc; CLIFFNOTES lists the new columns/events.
- 🟢 **D4 · P1** HITL matrix for the open-to-close flow — §6.5 expanded (TU-09a/09b/09/10/10a/10b):
  accept/lock → document-close + harvest events → `SECTIONS_NOT_LOCKED` gate → advance →
  admin force-advance → lock-based review readiness. tenant_user total updated.
- 🟢 **D5** Deploy notes: migrations 072/073/074 run on deploy; set `RESEND_API_KEY` (or Google
  Workspace) before HITL for invite/reset/notification email. (Captured in `PROPOSAL_LIFECYCLE_V1.md`.)

---

## Critical path & parallelization map

```
NOW ──▶ Track A (A1∥A2∥A3∥A4) ──▶ A5 ─┐
        Track B (B1∥B2∥B3∥B4) ────────┼──▶ Track D2/D4 (verify the unified flow) ──▶ HITL-ready
        Track D (D1,D3,D4) ───────────┘
        Track C: C1 ──▶ C2∥C3 ──▶ C4        (Phase 3 — can start C5∥C6 anytime in parallel)
```

- **Immediate (this week):** Track A (Phase 2c) + B4 (regen button) + D3/D4 (docs/HITL) — the
  set that makes the customer-facing open-to-close loop consistent and HITL-testable.
- **Parallelizable now by different hands:** A1/A2/A3/A4 (distinct files), all of B, C5/C6.
- **Serial dependencies:** A5 ⛔ A1–A4 · C2/C3 ⛔ C1 · C4 ⛔ C1+C3 · C7 ⛔ C5 · D2 ⛔ A5.
- **Recommended first stomp:** A1 (inversion, P0) → A2 (force UI, P1) → A3 → A4 → A5, with B4 in
  parallel. Each lands Red→Green with its own test.
