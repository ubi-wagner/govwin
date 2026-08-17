# VALUE_ROADMAP.md — highest value ÷ user-effort investments

**Date:** 2026-08-16 · **Migration head:** 185 · **Method:** four parallel user/admin perspective
sweeps (tenant build · discovery→activation · admin/platform ops · cross-cutting UX & dormant agents),
each grounded in the real routes/files, every load-bearing claim re-verified against source (one
mis-cite caught + flagged, item 14).

Ranks the refactors and greenfield efforts with the best **value ÷ user-effort** — i.e. maximum
capability delivered for minimum human toil.

---

## The pattern under everything: wire the last mile

The 36-agent workforce + the AI pipeline already **produce** the high-value work — win themes, teaming
gaps, a personalized onboarding plan, opportunity fit, amendment deltas, a daily ops digest. It just
**never reaches a screen.** The single highest-leverage investment isn't new capability; it's
delivering the capability already built. Two mirror-image failure modes:

- **Mode A — runs, nothing renders it** (the agent fires; no UI shows its output):
  `capture_strategist` · `pp_matcher` · `proposal_architect` · `onboarding_agent` ·
  `rfp_ingest_manager` · `curation_qa` · `ops_digest`.
- **Mode B — renders, nothing produces it** (the read surface exists; no producer fires the agent):
  `opportunity_analyst` (the card "AI fit" chip reads an ~always-empty table) · `librarian` (upload
  still shredded by hand) · `amendment_monitor` (no `scout_source` registered at provision).

The cheapest value in the system is closing these gaps: wiring outputs you already pay to compute.

---

## Do these five first

The best value ÷ effort across the funnel (discovery → activation → build → admin). Three of five are
pure last-mile delivery.

| # | Do first | Kind | V | E | Why |
|---|----------|------|---|---|-----|
| 1 | **Strategy panel** in the build workspace | 🔌 last-mile | H | S–M | deliver `capture_strategist`/`pp_matcher`/`proposal_architect`/research output that's generated then discarded |
| 2 | **Kill the 72h post-purchase dead-zone** (instant strawman + admin fast-path) | 🔧 refactor | H | M | the single biggest activation killer — up to 72h of zero progress right after they pay |
| 3 | **Personalize at birth** (land the onboarding concierge) | 🔌 last-mile | H | M | removes manual profile/bucket setup; day-one relevance vs generic DoD defaults |
| 4 | **One-click "draft & land the whole proposal"** | 🔧 refactor | H | M | replaces a fragile client `for`-loop + 4-step manual landing + polling |
| 5 | **Release & SLA board** (cross-tenant, admin) | 🌱 greenfield | H | M | kills per-tenant shadow-descent per sale + surfaces the invisible 72h revenue clock |

---

## Full board — all 17, ranked by value ÷ effort

Kind: 🔌 last-mile (deliver an already-built agent) · 🔧 refactor (restructure a flow) · 🌱 greenfield
(new surface). V/E = value / engineering-effort (S small · M medium). Every item *reduces* human effort.

### Tier 1 · Quick wins — high value, S–M effort, mostly last-mile

| # | Opportunity | Kind | V | E | Role | Saves | Anchors |
|---|-------------|------|---|---|------|-------|---------|
| 01 | Strategy panel in the build workspace | 🔌 | H | S–M | User·build | win-theme/teaming/research work generated then thrown away | `app/portal/[t]/proposals/[p]/**`; strategy archetypes; `agent_task_queue` |
| 02 | Land the onboarding concierge | 🔌 | H | M | User·activation | manual profile+bucket typing; day-one irrelevance | `pipeline OnApplicationAccepted`; `tenant_profiles`; `lib/spotlight/default-buckets.ts` |
| 03 | Wake `opportunity_analyst` per tenant | 🔌 | H | M | User·discovery | an uninterpretable 0–100 → "strong fit because…, do X" | `app/api/portal/[t]/cards/route.ts` (already reads it); needs a per-tenant producer |
| 04 | Surface `ops_digest` into the admin cockpit | 🔌 | H | S | Admin | the daily hand-sweep of 4 lanes + workforce + workflows + SLA | cron (mig 118); `on_ops_digest_requested.py`; `/admin/command` System lane |
| 05 | Auto-tag atoms on ingest | 🔧🔌 | H | M | User·library | hours of hand-tagging 5+ dims/atom; lifts all draft retrieval | `lib/atomize-package.ts` (`CATEGORY_TO_VOL/KIND`) → manual/capture atomizers + `librarian` |
| 06 | Auto-atomize on upload (wake `librarian`) | 🔌 | M–H | M | User·library | hand-shredding every doc → a review-only step | `app/api/portal/[t]/atoms/upload/route.ts`; `librarian` → existing review queue |

### Tier 2 · Bigger bets — high value, M effort, structural / revenue

| # | Opportunity | Kind | V | E | Role | Saves | Anchors |
|---|-------------|------|---|---|------|-------|---------|
| 07 | Instant strawman — kill the 72h dead-zone | 🔧 | H | M | Activation·revenue | up to 72h of zero-progress waiting at peak momentum | `purchase/route.ts`; `lib/portal-launch.ts`; `section_drafter` |
| 08 | One-click "draft & land the whole proposal" | 🔧 | H | M | User·build | fragile tab-bound loop + 4 manual landing clicks + polling | `components/canvas/draft-all-sections.tsx` → server full-draft + `land-revisions`/`accept` |
| 09 | Release & SLA board (cross-tenant) | 🌱 | H | M | Admin·revenue | per-tenant shadow-descent per sale; invisible 72h clock | `proposal_portals`.`curation_due_at`; reuse `releaseFromCuration` |
| 10 | Amendment auto-watch at provision | 🔌 | H | M | User+Admin | manual "did the RFP change?"; manual amendment logging | register `scout_source` at provision → existing crawl→`amendment_monitor`→`lib/amendments.ts` |
| 11 | One "needs me" feed, extended to admin & partner | 🔧 | M–H | M | All | two-places-to-check tax; admins/partners have no push signal | `notification-panel` (portal-only) + `tasks` ledger → one feed in all shells |

### Tier 3 · Follow-ons — solid, lower urgency, several compounding

| # | Opportunity | Kind | V | E | Role | Saves | Anchors |
|---|-------------|------|---|---|------|-------|---------|
| 12 | "Ingest & stage" one-click curation + show QA | 🔧🔌 | H | M | Admin | ~6 manual per-solicitation steps; blind re-doing of agent work | chain `ingest-assist`+`shred-audit`+`curation_qa`; render `curation_qa`/`rfp_ingest_manager` output |
| 13 | Post-submission outcome nudge (wake `outcome_analyst`) | 🔌 | M–H | S | User+system | dead scoring learning loop; one-click win/loss vs never | submission ToDo → outcome route → `outcome.recorded` |
| 14 | Compliance-aware section AI **⚠ verify wiring** | 🔧 | M–H | S | User·build | revision cycles; better first-pass compliance | thread `sectionCompliance` into the draft prompt — path is `components/canvas/ai-revision-panel.tsx` (was mis-cited as `components/portal/`; confirm before building) |
| 15 | Open discovery to `tenant_user` | 🔧 | M | S | User | unblocks multi-seat activation / BD delegation | relax the `tenant_admin` redirect on `/cards`,`/buckets`,`/portals` to read+pin |
| 16 | Partner cross-stable to-do feed | 🔧 | M–H | M | Partner | N per-company descents for an N-company manager | reuse admin cross-tenant to-do query scoped to `partnerScopeTenants(userId)` |
| 17 | Batch operations | 🌱 | M | S | Admin | N single retries in an outage; per-item publish toil | multi-select retry in `workflow-monitor-client.tsx`; bulk publish in CMS |

---

## Method & verification

Four independent sweeps ran in parallel, each tracing the real as-built routes/files, ranking friction,
and rating effort vs value. Every load-bearing claim was then re-checked against source and **confirmed**:
the auto-tag gap (`atomize-package.ts` has the heuristic; the manual atomizer has none); the stranded
strategy agents (zero portal reads); the empty `opportunity_analyst` table (no tenant producer — only
master-side ingest); `tenant_profiles` seeded only in the profile PATCH route (no birth seed); the
portal-only notification bell; no `scout_source` registered in `provision-proposal.ts`/`portal-launch.ts`;
and no `/admin` read of `proposal_portals`/`curation_due_at`.

**One claim did not hold** — item 14's compliance panel was cited at `components/portal/` but lives at
`components/canvas/ai-revision-panel.tsx`; the concept is sound but the exact prompt wiring must be
confirmed before building.

**Uniform caveat:** several agents only *run* in production once the pipeline's `ANTHROPIC_API_KEY` is
live (a known launch-cut item). The delivery gaps above hold regardless of that switch — they're about
wiring outputs to screens, not whether the model runs.

---

## Grounding pass — verified outcomes (2026-08-16)

All 17 items were run to ground against the code (four parallel passes; every load-bearing claim
re-verified, premises overturned where wrong). Net changes:

### Refuted / re-sized by grounding
- **#3 → SHIPPED (S, not M).** Not "wake an agent" — the pin route already enqueues `opportunity_analyst`.
  The ✨AI-fit chip was silently broken by a result-shape mismatch (`invoke_agent` nests the prose at
  `output.result.text`; the chip read a flat `output.text`). Fixed in `744c348f` (defensive read).
- **#9 → S (was M / greenfield).** Premise refuted: the per-portal cockpit `/admin/provisioning/[portalId]`
  already reads `proposal_portals` + `curation_due_at` and renders a 72h `SlaCountdown`, and a full admin
  release path exists. The only real gap is a **root list + nav link** — there is no `/admin/provisioning/page.tsx`.
- **#10 → L (was M).** Three blockers: no `solicitation ↔ source_profiles` link; `amendment_monitor` is
  advisory + `human_gate` and does not call `logAmendment`; and **no per-solicitation URL is captured
  anywhere today.** Needs a URL-capture + correlation-link design first — not a quick wire.
- **#5 → decision-gated.** `librarian` already emits `vol`/`kind`/`suggested_tags`, but the frontend parser
  (`lib/atom-review.ts`) drops them, and the manual atomizer discards the `suggestedVol` the upload route
  already computes. Minimal slice (apply that `suggestedVol` + heuristic `party_role`/`access`) is S.
- **#1 / #8** — agent output lands in `process_instances.step_results['<step>'].result.result.text` (note
  camelCase `payload->>'proposalId'` for `OnProposalCreated`); reads are RLS-safe after `enterTenant`. #8's
  land+accept **must stay browser-triggered** (the engine forbids a pipeline consumer of agent output).

### Build-now queue (verified, no product decision, ordered by value ÷ effort)
**ALL BUILD-NOW ITEMS SHIPPED (2026-08-17).** The full value ÷ effort queue is delivered; what remains
is decision-gated (#15 · #5-mode) or Large-with-design (#10 · #11) — see below.

1. ✅ **#3 AI-fit chip** — DONE (`744c348f`)
2. ✅ **#9 Release / SLA board** — DONE — `/admin/provisioning/page.tsx` lists purchased portals sorted by the 72h `curation_due_at` SLA (cross-tenant `sqlBypass`), reuses `SlaCountdown`, nav link "Releases & SLA"; one-click instant release for a built-out master (folds #7).
3. ✅ **#4 ops_digest → System lane** — DONE — `getOpsDigest()` (`lib/admin/review-queue.ts`) reads the `OnOpsDigestRequested` `ai_ops_digest` step_results → the `OpsDigestCard` in the Command-Center System lane (+ the "new" watermark dot).
4. ✅ **#17 workflow retry-all** — DONE — `retryAllFailed` in `workflow-monitor-client.tsx` loops the existing per-instance retry route over the failed-in-view set (one filtered "retry all", no new endpoint).
5. ✅ **#14 compliance-aware section AI** — DONE — `sectionId` threaded into `proposal.draft_section`; loads `proposal_compliance_matrix` and injects a fenced `<compliance_requirements>` block (one server change fixes all four callers).
6. ✅ **#1 Strategy panel (read-only)** — DONE — `GET .../strategy` reads `OnProposalCreated` step_results → the self-hiding `StrategyPanel` in the build workspace.
7. ✅ **#6 auto-atomize on upload** — DONE — opt-in `mode=auto` on `atoms/upload` reuses `atomizeDocumentIntoLibrary` + fires the `librarian` `catalog` producer; a "⚡ auto-atomize the whole doc" toggle in the Atomizer lands atoms (draft, context-tagged) → Library ▸ Review. Live-proven: 4 primitives + reference + cocoon, librarian task completed, `library.package.atomized{source:upload_auto}` audited.
8. ✅ **#12 ingest & stage + render the QA** — DONE — the ingest-assist + shred-audit actions already existed; the Mode-A gap was the unrendered `rfp_ingest_manager` plan. `GET .../assessment` reads the latest OnIngestAssessmentRequested `step_results['ai_ingest_manager']` (parsed via `lib/ingest/assessment.ts`) → an `IngestPlanPanel` in the curation workspace renders stage · readiness · agent plan · blockers · next actions, self-hiding until a real plan lands (re-fetches after Assess). `digStepText` shared out to `lib/agent-output.ts`.
9. ✅ **#13 post-submission outcome nudge** — DONE — `createOutcomeNudge` at section-lock (idempotent, tenant_admin, 30/60/90-day) + a `record_outcome` completer that POSTs the outcome route.
10. ✅ **#16 partner cross-stable to-do feed** — DONE — `getPartnerStableTodos` (scoped `sqlBypass` over the manager's stable) → the "To-dos across your stable" feed in the partner console, each row deep-linking via the descend URL.

### Decision-gated (need a product call before building)
- **#15** expose discovery to `tenant_user`? The cards API already permits it; only the page/nav block it — an access-policy choice, ready either way.
- **#5** auto-tag atoms: deterministic heuristic (A, instant/cheap) vs surface+apply `librarian`'s proposals (B, better, async, depends on #6)?
- **#7** instant strawman: rfp_admin fast-path only (build-now, M), or *also* a read-only preview build on purchase (product risk: undercuts paid curation)?
- **#8** one-click draft&land: auto-accept into live sections, or stop at staged proposed versions for a human "Accept" click (the current design's deliberate posture) + poll `process_instances` vs add a `full_draft_status` column?
- **#11** unify attention feed — L; sequence *after* #13/#16, which produce the task sources it should surface.
