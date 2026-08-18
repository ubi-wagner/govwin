# PATTERN_AUDIT.md — full-system pattern audit (2026-08-18)

Three parallel adversarial auditors swept the whole system against three contracts:
(1) **event patterning** — every process bracketed `start/end` with intrastep audit singles,
(2) **extensibility** — new workflows/extensions ride declarative seams, not copy-paste,
(3) **the manual↔AI dial** — full-manual UX at one extreme, full-AI-with-HITL at the other,
on both the RFP-admin and tenant sides. Every finding below is file:line- or live-DB-proven
(orphan-start queries against `system_events`). Companion docs: EVENT_CONTRACT · AUTOMATION_SPINE_MAP ·
AGENT_WORKFORCE · TENANT_WORKFLOW_SETUP_DESIGN.

## Verdict

The **substrate is right**: a new workflow is a file (auto-discovery + boot `validate()` hard
gates), the tool registry brackets every invocation on all exits, provision/release/broadcast/
package are exemplary brackets, the draft/build family has the complete dial on BOTH sides
(canvas → section assist → Mode A/Studio approve-gates → Mode C/doorbell full-auto), and agent
output is genuinely advisory→guardrail→land-or-review everywhere it lands. Scores: **admin dial
≈ 4.5/5, tenant dial ≈ 3.5/5**. The debt is at the *periphery*: hand-maintained registries that
drift silently, a handful of routes that leak event brackets on error exits, and two dial stops
that are built but dark.

## Fixed during this session (from these audits + the live Immobileyes ingest)

- `atomize-package` bracket leak in the outer catch → closed (hoisted startId, error end).
- `library:package.atomized` single → full start/end bracket; DSIP deconstructs audit as
  intrastep singles (live-verified: 5/5 pairs, 0 orphans).
- Tenant onboarding + hard-delete migrated onto system paths with full brackets
  (`lib/tenants/create-tenant.ts`, `hardDeleteProposalCascade`) — see commit 7df32820.
- Real-data fixes from the four live DSIP downloads: STTR cost-form/CCR anchors
  (`S[BT]IR` missed two-T STTR), page-grain primitives (V1 no longer exhausts the atom
  budget), `MAX_FILES` 12→20 (a real DSIP package is 14 files).
- `ai/draft` NOT_FOUND exits close their start events (earlier this session).

## Closure wave 1 (2026-08-18, same session — all verified green)

CLOSED: HIGH-1 (QA workflow retargeted onto the tool's `solicitation.review_requested:single`
— it can now actually fire) · HIGH-2 (shredder steps 5–8 wrapped: any throw closes the
`rfp.shredding` bracket with an error end; both `compliance.extracted` dangling exits closed)
· HIGH-3 (LAND matrix rewrite is ONE `sql.begin` transaction) · HIGH-4 (TW-8 AUTO gate now
requires a PASSED review — zero advisory notes — and the sweep audits as `systemActor`, not a
synthetic user; assisted mode unchanged) · HIGH-5 (audit-coverage moat excludes auth.ts's
vacuous signal; the exposed business writers — library/canvas create, seed-job select/decide,
extract-topics — now emit domain events; 7 read-side/advisory routes allowlisted with reasons)
· MED-8 partial (compliance-route catch + both triage exits close their brackets) · MED-9
(amendment confirm opens its bracket BEFORE the CAS and closes on every exit incl. fan-out
failure; log/dismiss are honest singles) · MED-10 (`finder:cards.republish_failed` singles
from both propagation fences) · MED-11 (processor fans out to ALL matching workflows —
first-match-wins drop eliminated). Plus: sidecar attach-to-existing-cocoon
(`context.attachToCocoonId`) for late-arriving DSIP package files.

STILL OPEN (wave 2): MED-8 remainder (`ai/compliance` ~10 exits + `supporting-docs` exits
need the fail() helper), MED-7 ingest_actions raw-emit pairing + trigger-liveness test +
rule 'preview' badging, MED-6 shapes backfill (5 workflows) + drift tests, MED-12 triage
ladder collapse, LOW 8/9/13–18 (incl. lock-harvest single, Studio-complete event, TW-8
deploy env `AGENT_GATE_SWEEP_URL`, discovery digest, tenant launcher parity).

## Ranked backlog (all proven; smallest-fix noted in the audit transcripts)

**HIGH**
1. Curation-QA review workflow has NEVER fired — trigger/producer mismatch
   (`on_solicitation_review_requested.py:58` watches the route's `solicitation.triaged:end`;
   the live UI invokes the TOOL which emits `solicitation.review_requested:single`). One-line
   trigger change.
2. Shredder leaks orphan starts on unhandled failures — 36 live `rfp.shredding.start`
   orphans; wrap runner steps 5–8 in try/finally end (+ close two `compliance.extracted` exits).
3. Ingest LAND is non-atomic + unbracketed (`materialize.ts:140-172` DELETE→INSERT outside
   `sql.begin`); wrap in one transaction + bracket.
4. TW-8 auto stage-gate advances on "cohort RAN", not "cohort PASSED"
   (`closeAgentGate`, `portal-workflow.ts:506`): when auto, require `noteCount===0`. Also the
   sweep is env-inert in deploy (`AGENT_GATE_SWEEP_URL`) and its events use a fake `user` actor.
5. Audit-coverage moat is vacuous for authenticated routes (`audit-coverage.test.ts` counts
   `@/auth`'s own INSERT as the route's audit signal) — filter it, then audit the proven
   victims (library/canvas POST, seed-job select/decide, Studio final approve, lock-time harvest).

**MEDIUM**
6. Registry drift, sprung twice in two weeks: `/admin/workflows` Map catalog at 29 vs 34
   registered workflows (5 invisible) — add a shapes↔Python drift test + backfill; same for
   the hand-list in `task-catalog-drift.test.ts` and guide §10.
7. Trigger↔emitter liveness: no test proves an emitter exists for each workflow trigger
   (history: 3 dark workflows) and `automation_rules` are mostly decorative (3 dead rules in
   prod data; only singles evaluated; 2 of 13 action types execute) — cross-check test +
   create-time validation with 'preview' badging.
8. Bracket-leak class in routes: `compliance_value.saved` (7 live orphans), triage-route exits,
   `ai/compliance` (~10 exits, 1 live orphan), `supporting-docs` — a `fail()` helper per route;
   plus a scheduled orphan-start monitor (the audit's own query) since the per-file count guard
   can't see per-path leaks.
9. Amendment events are decorative post-hoc brackets (`confirmAmendment` can change state with
   zero ledger row on a fan-out throw) — emit start before the CAS; log/dismiss become singles.
10. Bridge propagation failures are console-only — one `finder:cards.republish_failed` single
    from the fence catches.
11. Processor is first-match-wins on shared triggers (7 shared keys; `get_all_workflows_for_event`
    exists unused) — iterate all matches (dedup index already makes it safe).
12. Triage ladder exists twice (tools vs route map) with divergent events — collapse to tools.

**LOW / follow-on**
13. Discovery notify beat is dark ('preview'): a policy-driven digest consumer for
    `capture:card.applied` on the cron sweep — the tenants' first discovery-side automation payoff.
14. Tenant launcher/monitor parity (own-tenant `launchTemplate` + force-advance + mini Map) —
    the last "super-UX on both sides" piece.
15. Structured company CONTACTS (PI / Corporate Official / Contract Negotiator) on the tenant
    profile feeding provision's `pi_name`-family template variables (today they live in
    `companySummary` text — entered live for Immobileyes).
16. Sidecar primitives keep category-guessed vol tags when present (the reference atom carries
    the authoritative filename-classified volume); prefer the hint on conflict.
17. Copy-paste drift: `CATEGORY_TO_VOL`/`FMT_OF` duplicated in `atoms/upload` (already diverged);
    a `{docType → segmenter}` map for the next deconstructor; capture path lacks the librarian hop.
18. Correlation-key list (`manager.py:1535`) — new-entity HITL waits resume promiscuously
    within a tenant; make the key declarative per Step.

## The new-workflow recipe (as it actually is)

One `on_<x>.py` (trigger + steps; auto-discovered, `validate()` boot-gates) → deterministic
actions module → a PRODUCER emitting the trigger (route/lib emit, `launchTemplate`, or a
`pipeline_schedules` seed row) → end-result payload restates what the processor matches →
gate cadence via `resolveGatePolicy` → wiring test. **Trap list nothing enforces yet** (see
backlog 6–7): workflow-shapes.ts roster · guide §10 · schedules seed · `_CORRELATION_KEYS` ·
`TASK_WORKFLOWS`/completers/taskHref for new task types · `/admin/agents` roster ·
end-restates-payload · shared-trigger condition disjointness.

## The tenant ingestion analyzer (built this session, per the front-of-flow directive)

Deterministic, NOT an agent: the DSIP deconstructor now runs three detection layers —
**page mode** (real DSIP anatomy: cover-sheet head p1 · tech anchors "Page 1 of N"/topic
header · SBIR|STTR cost-form head · CCR head · inferred remainders, every boundary citing its
page + head, `inferred:true` surfaced for HITL review), block mode (banner headings), text
mode (banner lines). Sidecars classify by DSIP's own filename taxonomy into the SAME package
cocoon. The preview gate is the user-guidance loop; corrections captured there become new
pattern-registry layers as more agencies/sources are uploaded (the "gets better and better"
path — the registry grows in `lib/library/dsip-deconstruct.ts`, unit-locked per format).
Proven on four real Immobileyes downloads (Navy SBIR I, Navy SBIR I, AFWERX CSO, AF STTR II —
merged PDFs + the 13-sidecar Navy package) ingested end-to-end through the live system as the
Immobileyes admin: preview → approve → commit → one cocoon each → 5 volume foundations each →
librarian catalog hop processed by the worker.
