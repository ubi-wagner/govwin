# P2R_BUILD_SWEEP.md — purchase→release + build/collaboration adversarial sweep (2026-08-18)

Two full adversarial passes over the customer spine, each with a committed live drive:
**purchase → release** with per-volume template validation (`e2e/p2r-template-drive.spec.ts`, 4/4)
and **build + collaboration** (`e2e/build-collab-drive.spec.ts`, 8/8). Three independent
adversary agents (template-resolution · purchase→release · build+collab) produced 34 proven
findings; every HIGH/CRITICAL and most MEDIUMs are FIXED this pass. Companion to
docs/MID_WINDOW_RULES.md (the mid-window contract) and docs/TENANT_WORKFLOW_SETUP_DESIGN.md.

## The headline hidden bug (caught by the drive, root-caused in the DB)

**The V0 strawman drafter destroyed every provisioned mold seconds after release.** Provision
loaded molds correctly (slide deck, tech mold, computed cost workbook), but 17s later the
`section_drafter` fan-out published 1-node letter strawmen over 11/12 sections —
`publish_section_draft`'s landable set (`empty`,`ai_drafted`) could not tell "previously
auto-drafted" from "provisioned from an authored mold" (both `status='ai_drafted'`).

**Fix (the provenance split):** provisioning stamps `content_source='template'` on every
section it fills (mold / computed workbook / registry template); `draft_v0`'s selection AND
`publish_section_draft`'s gate both exclude it — the provisioned canvas IS the intended V0.
Blank slide items now get an EMPTY `slide_16_9` envelope (status stays `empty`) and the
drafter adopts a section's existing canvas envelope, so a deck is never re-authored as a
letter doc. DB-proven: fresh release carries `slide_16_9|20` decks, the mold docs, the
computed workbook, `max_pages`/`max_slides` stamped from the item limits, zero strawman
overwrites.

## Fixed this pass (by area)

**Template selection / provisioning** (`lib/provision-proposal.ts`, `lib/templates/index.ts`,
`lib/proposal/cost-forms.ts`, `lib/compliance-resolver.ts`, volume tools):
- `interpolateTemplate` JSON-splices safely (quotes/backslashes/newlines in tenant names or
  topic titles used to corrupt the parse and fail the whole release; structural injection
  closed; locked by `__tests__/template-interpolation.test.ts`).
- Item limits are provision truth: `item.pageLimit`/`slideLimit` stamp `canvas.max_pages`/
  `max_slides` on the provisioned canvas, and `page_allocation` now rides export assembly as
  `layout.page_budget`, making the floor's `section_over_budget` check live.
- Link-time validation: a dangling OR empty (`{}`-body) `templateId` is a clean 422 at
  authoring (`volume.add/update_required_item`) — and because the tools run in platform
  context, RLS already restricts master items to platform molds every buyer can load.
- Cost precedence: a non-cost mold linked on the cost data item no longer displaces the
  COMPUTED workbook; a second spreadsheet item in a cost volume no longer receives the static
  registry cost sheet alongside it.
- `resolveCostForm` tokens match canonical `program_type` values (underscore normalization —
  `nsf_sbir_phase_1` now resolves SF-424A, not the DoD fee-bearing waterfall) and the curated
  `cost_volume_format` is passed through.
- Registry coverage: `'text'`-typed narrative items resolve the technical mold (several
  shipped masters type prose items `text` and provisioned blank).
- Metadata-less molds no longer crash the release; unusable linked molds log loudly before
  falling back. Volume typing: bare `commercial` no longer mis-types "Commercialization Plan"
  volumes as forms (page gate + font floor apply again).
- Umbrella arm: `resolveTopicCompliance` + provisioning fall back through
  `curated_solicitations.opportunity_id`, so an umbrella purchase provisions the AUTHORED
  master (not a default skeleton) and the proposal is stamped with its solicitation
  (amendment fan-out + replay reach it).

**Purchase → release** (`purchase/route.ts`, `release-portal.ts`, `release route`,
`complete.ts`, `automation/triggers.ts`, `project-collaboration.ts`):
- Automation-rule ToDos INSERT under `runInTenant` — the 'Purchase needs curation' admin ToDo
  was silently RLS-rejected on every purchase under production wiring.
- The concurrent-release loser build is archived + its ToDos expired (it was live, visible,
  and agent-driven); a link failure with no winner fails the release cleanly for a retry.
- Guardrail overlay resolves + validates BEFORE the all-tenant broadcast; seeded templates'
  `config.defaults` unwrap; unknown template id → 422 (no silent bare-default release).
- `completeBuildOut` is idempotent on the broadcast: once `build_complete`, retries stop
  re-fanning `updated` to every tenant (change-gated republish covers real edits).
- One SLA source: `curation_due_at` derives from the resolved gate policy (framework-tunable),
  matching the ToDo's due; nudge defaults `[1,3]`→`[2,1]` (days-BEFORE-due — 3 on a 72h gate
  nudged at t≈0); a failed gate launch logs its code; purchase requires the opportunity's
  mirror card (a leaked un-released opp UUID can no longer open a portal + SLA clock);
  SlaCountdown hydration warning suppressed.

**Build + collaboration** (task/process routes, `portal-workflow.ts`, `update-task.ts`,
`accept-ai-revisions`, `proposal-draft-section.ts`, save/reuse/package routes):
- CRITICAL: five tenant routes ran with NO RLS context (`tasks` GET/POST, `tasks/assign`,
  `tasks/[taskId]` PATCH, `processes/[instanceId]` + `/advance`) — under the production
  `govtech_app` posture the whole tenant ToDo queue read empty, completes 404'd, assigns
  500'd. All five now `enterTenant` in the handler frame (proven live by B1/B2).
- `editPortalWorkflow` no longer resurrects COMPLETED stage ToDos on save/rebaseline/Accept,
  resets `nudges_sent` only when timing actually changed, and CAS-guards `_setup` so a stale
  save can't silently un-accept a concurrent Accept & Start.
- `accept-ai-revisions` scans only `snapshot_reason='full_draft'` — a later click no longer
  bulk-reverts human edits to archived AI content.
- The AI section drafter actually sends the `<compliance_requirements>` block it promises.
- Per-task PATCH validates `assigneeRole` (`isRole`) + `dueAt` (422, not a vanished ToDo/500).
- The whole-proposal package (docx/pdf/zip) runs the SAME advisory compliance floor as the
  per-artifact export: per-artifact validation, `X-Compliance-Violations` header, `compliant`
  in the end event (proven by B8).
- `reuse-past` inherits the section's own canvas rules (no more false `format_floor` blockers
  on 11pt-floor programs from the hard-coded DoD preset).
- Save-route AI provenance (`ai_instruction`/`ai_model`/`edit_summary`) persists through the
  archive cycle via `meta.lastEdit`; `ai/draft`'s NOT_FOUND exits close their start events.

## Deferred (documented, deliberate)

1. Resolver breadth: `phase_type`/agency-aware registry keys (NASA/NIH/BAA/OTA/universal-form
   reach) — registry redesign, not a hotfix.
2. Mixed-volume format collapse (one preset per volume; a slide item nulls the volume's page
   cap) — needs per-item specs in `buildArtifactSpecs`.
3. Form volumes inherit the technical page cap in their spec (advisory noise only).
4. Legacy `proposals/create` route drift (dormant behind the 402 paywall).
5. Repurchase-after-abandon lockout (total UNIQUE on `(tenant,opp,label)`) — needs a partial
   unique index migration + ON CONFLICT restatements.
6. `releaseFromCuration`'s dead `releasedBy` param (no column).
7. TW-8 AI-manager auto-advance (pre-existing fast-follow).

## Verification (this pass)

`npx tsc --noEmit` 0 · `npx vitest run` 1232/1232 (+3 new interpolation locks; 2 stale
expectations updated to the new contracts) · `npx next build` clean · live drives:
`p2r-template` 4/4 (FRESH purchase→release under fixed code) · `build-collab` 8/8 ·
`flex-midwindow` 7/7 (regression) — all against the standalone server as `govtech_app`
with RLS on and the emulator standing in for Claude.
