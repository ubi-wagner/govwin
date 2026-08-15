# Provisioning Workspace & Demand-Triggered Build-Out (2026-08-15)

> **✅ AS-BUILT (PV-1..6, shipped + proven).** mig 182 `build_complete`; `lib/provisioning/{readiness,
> complete,release-portal}.ts`; cockpit `/admin/provisioning/[portalId]` (page + `release-panel.tsx`);
> admin route `POST …/provisioning/[portalId]/release` (two-outcome) + standalone `…/rfp-curation/[solId]/
> complete-buildout`; purchase `proposal_setup` ToDo → `entityType:'portal'` → cockpit deep-link
> (`taskHref` `case 'portal'`). Latent fix: the provision best-effort tail is `runInTenant`-scoped so a
> cross-tenant admin caller no longer trips RLS on `tasks`/`library_seed_jobs`. Proven: `frontend/scripts/
> drive-provisioning-cockpit.mts` (23/23, both outcomes + events + `cardsRefreshed`) + a Playwright browser
> drive (`shot-provisioning-cockpit.mjs`); tsc 0 · vitest 1116. Commits `a9cbcd6·2ff1fd9·49053ff·3506823·b54a370`.

The **build-side capstone**: complete a master OPP's build-out on demand (purchase-triggered, 72h
SLA), **bank it at the master**, broadcast the completion to **all** mirror cards, and **provision the
purchaser's portal** + kick off their workflow. This completes the documented two-release master-mirror
model (`docs/MASTER_MIRROR_OPP_DESIGN.md`), whose "proposal-ready signal on completion" was explicitly
marked ⚠ not-built. Scouted 2026-08-15 (5 parallel reads); the spine is **~80% built** — this pass adds
four wires and the cockpit that ties the existing authoring surfaces together.

## Owner-confirmed decisions
1. **Built-out signal = explicit flag + readiness bar.** An rfp_admin "Mark build-out complete" action
   sets a flag, gated by a check (compliance authored + ≥1 volume + ≥1 required item).
2. **Release gate = advisory + confirm.** Show a readiness checklist; release below the floor is allowed
   only via an explicit "release anyway" confirm (the degenerate provision fallback still works).
3. **Reuse = fast-track confirm.** The 2nd+ buyer of an already-built OPP gets a lightweight admin glance
   (optionally tweak overlay/templates for this buyer), not a fresh 72h build.

## As-is (what already runs)
- **Release 1 (discovery):** the rfp-curation workspace drives `curated_solicitations` through its state
  machine → `solicitation.push` (gates ONLY on submission_format + spotlight_summary + close_date) →
  `publishAndFanOut` → thin mirror cards to all active/trial tenants. OPPs routinely push **bare**.
- **Release 2 (master build-out, "any time in advance"):** authored in the same workspace —
  compliance → `solicitation_compliance` (baseline `topic_id IS NULL` + per-topic override); the matrix
  *definition* → `solicitation_volumes` + `volume_required_items`; template molds →
  `document_templates.canvas_document` linked onto items via `volume_required_items.template_id`
  (+ expert_notes; bodies authored in Template Studio); the overlay variant → a `guardrail_templates`
  pick, frozen as `guardrail_config` on the portal at release. **Partial-able only implicitly** (row
  presence); only per-row `verified_by/at`; **no aggregate flag**.
- **Purchase → 72h → gate → release → provision → workflow:** purchase writes `proposal_portals`
  `curation_pending` (`curation_due_at = now()+72h`) + a `proposal_setup` gate ToDo (→ rfp_admin,
  `entity_type='opportunity'`, deep-links to the generic `/admin/rfp-curation` queue). Release (rfp_admin)
  → `provisionProposalForPortal` (`proposals is_locked=false` + artifacts + sections +
  `proposal_compliance_matrix` + `guardrail_config`) → emits `proposal:proposal.created:end` →
  `OnProposalCreated` → `draft_v0`. **Per-portal idempotent; EVERY purchase runs the full gate.**
- **Card + seam:** the mirror card is THIN (`OppCard` snapshot: discovery metadata + a 4-number
  `complianceSummary` gated by `hasMatrix`) — never templates/matrix/artifacts. Re-publishing `'updated'`
  re-fans a fresh snapshot to all tenants (forward-only). Broadcast (`fanOutBridgeEvent`, all tenants) vs
  provision (`provisionProposalForPortal`, one purchaser) seam = the **`opportunity_id` spine key**.

## The four missing wires (the whole build)
1. **Explicit master built-out flag** — `curated_solicitations.build_complete` (+ `_at`/`_by`) + an
   `isBuildComplete(solId)` readiness helper. Drives the reuse fast-track and the card's provision-ready signal.
2. **Completion → re-publish → mirror update** — the "Mark complete" action sets the flag, re-publishes
   every activated opp of the solicitation `'updated'` (mirror cards refresh `complianceSummary` +
   a new `provisionReady` signal), and emits a **bracketed** `finder:opportunity.build_completed` (start/end).
3. **Demand-gate branch** — the purchase route reads `build_complete`: **built** → fast-track (a
   lightweight confirm gate, not 72h); **not built** → the existing 72h `proposal_setup` gate.
4. **The provisioning cockpit** — `/admin/provisioning/[portalId]`, the `proposal_setup`/fast-track ToDo's
   destination: re-composes the rfp-curation authoring components (VolumesPanel · TopicComplianceManager ·
   template picker · compliance matrix · `guardrail_templates` picker) scoped to the purchased OPP's
   solicitation/topic, + a **readiness panel** (advisory bar) + **"Complete & Release"** (sets the flag if
   first build → re-publishes → provisions the purchaser's portal → `releaseFromCuration` → workflow kicks
   off). Completing the ToDo = release.

## Invariants (segregation + continuity)
- **Segregation:** the master OPP build-out is shared + broadcast to all; the tenant portal is private +
  per-purchaser. The card update is all-tenants; the provision is one.
- **Continuity:** the forward-only bridge carries the completion forward; the purchaser's portal continues
  off the completed master via the `opportunity_id` spine key.
- **Reuse-not-waste:** build once at the master; the flag + fast-track make the 2nd+ purchase near-instant;
  the broadcast banks the effort for every holder + future buyer.
- **RLS:** master reads/writes via `sqlBypass` (admin, cross-tenant, platform tables); portal provision
  under `withTenant`. **Events:** the completion fan-out is a start/end-bracketed process; completion +
  release audit.

## Phased plan
- **PV-1** Migration: `curated_solicitations.build_complete/_at/_by`; `isBuildComplete(solId)`; the
  `OppCard.provisionReady` snapshot signal.
- **PV-2** Completion action + event: "Mark build-out complete" (readiness-gated flag → re-publish
  `'updated'` → bracketed `finder:opportunity.build_completed`).
- **PV-3** The provisioning cockpit page (re-compose curation authoring + readiness panel + overlay picker
  + "Complete & Release").
- **PV-4** Demand-gate branch in the purchase route (built → fast-track confirm gate; not-built → 72h) +
  point the `proposal_setup` ToDo at the cockpit.
- **PV-5** Surface the 72h SLA in the cockpit (countdown from the existing gate) + the reuse fast-track UX.
- **PV-6** Verify: green backbone (tsc/vitest/pytest) + live drive under forced-RLS `govtech_app`
  (bare → build → complete → broadcast → provision → workflow; + fast-track reuse) + docs.

## Verify — PENDING
