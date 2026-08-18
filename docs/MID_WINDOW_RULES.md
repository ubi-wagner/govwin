# MID_WINDOW_RULES.md — the OPP card between its two releases

**Status:** canonical rules review (2026-08-18) of the automation, the bridge, the buckets, and
the proposal pipeline as they govern the **mid-window**: after Release 1 (`solicitation.push` —
the OPP is live on every tenant's Spotlight mirror) and before Release 2 for a given buyer
(`provisionAndReleasePortal` — their private build). Verified against a 3-agent code recon +
the live 7-step drive `frontend/e2e/flex-midwindow-drive.spec.ts` (7/7). Companion to
docs/MASTER_MIRROR_OPP_DESIGN.md (lifecycle design) and docs/START_END_FRAMEWORK.md §3 (bridge map).

---

## 0. The one rule

**The master stays fully editable after push, and every edit that changes what a customer sees
must re-publish the bridge.** Editability without propagation is silent divergence (the admin
"updates" an OPP no tenant ever sees updated); propagation without editability is a frozen
catalog. The window has both, and one primitive carries the second half:
`republishIfReleased` → new `opportunity_bridge` version → `applyToTenant` per tenant —
which automatically brings **rescore** (sync fallback + `capture:card.applied` → pipeline),
**`pin_update_available`** for pinned holders, and the **watched-opp holder notification**
(RANK-8). A never-released opp is a structural no-op, so pre-push edits stay private.

---

## 1. Bridge rules (as built + as now wired)

| Rule | Where enforced |
|---|---|
| B1 · Forward-only: `opportunity_bridge` is `SELECT, INSERT` only — no row ever mutates | mig 094:45 grant |
| B2 · Full-snapshot versions: every publish writes the WHOLE card JSONB at `max(version)+1` (race-safe retry loop) | `opportunity-bridge.ts` publishToBridge |
| B3 · Forward-only apply: a mirror card only advances (`EXCLUDED.bridge_version > current`); stale applies are silent no-ops with no cursor bump and no rescore | applyToTenant |
| B4 · Safe-refresh split: an apply touches ONLY master-derived columns (`card`, `bridge_version`, `lifecycle_status`, `submission_stage`, `updated_at`, conditional `pin_update_available`). Tenant-owned state — pins, pinned_docs, pursuit, archive, bucket scores, nudge watermarks — is never clobbered | applyToTenant `DO UPDATE SET` list |
| B5 · **Every card-visible master edit republishes** (NEW): summary + expert note, compliance (baseline, topic override set/clear, preset), volumes + required items (all 5 tools), topic title/description, attach-to-existing, Ingest Studio LAND, amendment confirm, and the explicit Broadcast button — all call `republishSolicitationCards` (best-effort: a propagation failure never fails the admin's edit). **Change-gated:** a fresh snapshot equal to the bridge head (frozenAt ignored) publishes NOTHING — no junk version, no pin-nudge re-arm, no rescore storm (`unchanged` in the result). Snapshots are (re)built inside the version-retry loop, so a concurrent-publish loser can never land stale content at the head | `lib/curation/republish.ts` + `publishToBridge` |
| B6 · **Late-topic release** (NEW): a topic added after push has no bridge version, so republish can never reach it. `activateLateTopicIfReady` releases it — keyed on the BRIDGE (not `is_active`), mirroring push's W2 activation write — the moment it is date-complete. No close date → parked (`needs_close_date`), invisible to customers (the mig-128 date guard extends to late additions). A CLOSED/ARCHIVED topic is REFUSED (`not_open`, guard + CAS): retraction is a lifecycle decision a close-date edit may never undo. Wired into add_topic, bulk_add_topics, topic-file drop, topic update, and the lifecycle close-date change | `lib/curation/republish.ts` |
| B7 · Backflow stays navigational-only: nothing in the window carries tenant content up. The up-signals remain the purchase ToDo, notifications, and shadow-descent audit | docs/MASTER_MIRROR_OPP_DESIGN.md §4 |
| B8 · The card stays THIN: volumes/items/molds never ride the snapshot — only `complianceSummary` scalars (+ `provisionReady`). Structure is delivered at provision, not on the card | buildCardSnapshot |

## 2. Bucket / ranking rules

| Rule | Note |
|---|---|
| K1 · Scoring is tenant-side + event-driven: every applied bridge version rescores (sync `scoreCardForTenant` fallback + async `OnCardApplied` → `rescore.py`). B5 therefore means **mid-window summary/title edits genuinely re-rank** — they are scoring inputs | verified live: F3→F4 |
| K2 · Bucket cap (6) is framework-hard and enforced atomically in the INSERT; `can_manage_buckets` designees + tenant_admin author buckets | mig 181, RANKING_SPINE |
| K3 · Non-open cards score only into `includeClosed` buckets; scores clamp [0,100] (mig 180 floor) | all three writers |
| K4 · `update_watch` is a decoration, not a trigger: it elevates notifications on fan-outs SOMETHING ELSE caused. With B5, watching an OPP now means hearing about every mid-window edit — which is what the admin pinning intended | RANK-8 |
| K5 · The start-nudge sweep reads live `opportunities.close_date`; B5/B6 keep the card's `closeDate` in step so the nudge window and the customer-visible date can no longer disagree | lifecycle_scheduler |

## 3. Automation / event rules

| Rule | Note |
|---|---|
| A1 · Trigger events pair START/END; the END carries the payload the processor matches. Audit events are `single`. (Held by every new emitter this cycle: `topic.released`, `solicitation.broadcasted`, `curation_note.added`, `solicitation.expert_notes_updated` are audit-singles; no new triggers were introduced) | docs/EVENT_CONTRACT.md |
| A2 · Propagation tails are best-effort BY CONTRACT: they run after the business write committed, never throw (whole-body fenced), and are re-drivable (reconcile sweep, Broadcast button). The unit suite locks this (`__tests__/curation-republish.test.ts`) | lib/curation/republish.ts |
| A3 · Automation may never publish what a human hasn't founded: the Ingest Studio land gate (auto-land refuses blockers) and the deliberately-human portal release are unchanged by this pass. The Broadcast button and auto-republish only re-deliver already-landed master state | INGEST_STUDIO_DESIGN §never-auto |

## 4. Proposal-pipeline rules (the window's two ends)

| Rule | Note |
|---|---|
| P1 · **Fresh-at-release, universally:** provisioning reads compliance (topic-resolved), volumes + required items, molds (`document_templates.canvas_document`), cost forms, and required docs LIVE at release time. Nothing is snapshotted at purchase — every mid-window revision lands in the released portal (proven: Vol 3 added mid-window appeared in the provisioned build) | provision-proposal.ts |
| P2 · **Amendment replay** (NEW): `confirmAmendment` fans flags to existing proposals AND republishes the mirror (pre-purchase reach); `replayConfirmedAmendments` runs at provision so a buyer whose amendment landed mid-window opens their portal with the flag + bell already present — and the tenant amendments GET **reconciles missing flags on read** (idempotent), so even a transiently-failed replay self-heals. The window can no longer swallow an amendment | lib/amendments.ts + release-portal.ts + the tenant amendments route |
| P3 · **Amendments carry their document** (mig 190): `solicitation_amendments.document_id` → admin links the announcing file when logging; tenants open it via a flag-gated signed URL (`…/amendments/[a]/document` — the flag IS the grant; no generic read into the admin document store) | verified live: F7 |
| P4 · Post-release (portal live), the channels narrow by design: amendments (formal, acknowledgeable) + card refresh (informational). Master compliance/volume/mold edits do NOT rewrite a live build — structural change reaches a released proposal only as an amendment a human acts on | recon C |
| P5 · Molds: live-read at provision (mid-window edits free); the template-stable lane fans only on explicit Push (`update_available`) and is not solicitation-linked — per-OPP template curation is `volume_required_items.template_id`. `collaboration` is now a first-class `template_type` for collaboration-product molds | TEMPLATE_BRIDGE_DESIGN |
| P6 · **Curation notes** (mig 190): the master card's internal margin — append-only (grant-level: no UPDATE/DELETE), platform-scope, never customer-visible, mounted in the workspace AND the provisioning cockpit so the 72h-window conversation lives on the record. Customer-facing text remains: expert note (rides the card) + amendments (formal) | curation_notes |

## 5. Residual gaps (tracked, deliberate, or follow-on)

1. ~~Readiness bar baseline-blind~~ **FIXED (sweep)**: the bar is now scope-agnostic AND
   accepts the curator's `custom_variables.submission_format`, matching the resolver + push gate.
2. ~~`resolveTopicCompliance` silent degradation~~ **FIXED (sweep)**: an errored resolve returns
   `degraded:true` and `provisionProposalForPortal` REFUSES to provision a default skeleton off it.
3. **`pushed_to_pipeline` stays terminal** (no un-push). Deliberate: retraction of a
   customer-visible OPP is a lifecycle `close`/`archive`, not a status rewind.
3b. **Fan-out cost ceiling (monitored):** a genuinely-changed solicitation-wide republish walks
   every activated opp × every tenant sequentially (~73 queries/opp at 4 tenants; a 30-topic BAA
   ≈ 2.2k queries per changed edit). The change-gate removes all no-op storms and bounds repeated
   saves; truly-changed bulk edits on very large topic sets remain synchronous by design (the
   admin's save IS the delivery). Revisit with batched applies if tenant count grows 10×.
4. **`build_complete` never un-sets** — provisionReady can only go true. Acceptable while release
   is human-gated; revisit if auto-release ever lands.
5. **`amendment_monitor` agent output has no writer** into `solicitation_amendments`
   (source `'amendment_monitor'` is reserved, unused) — amendments are hand-logged today.
6. Stale doc lines corrected this cycle: START_END_FRAMEWORK §3b "proposal-ready nudge not built"
   (it is — mig 182 + cockpit) and the watch route docstring's event name
   (`capture:opportunity.updated`, not `update_available`). MASTER_MIRROR's in-tx `autoScoreCard`
   references were already struck by its as-built header.
