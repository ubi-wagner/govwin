# V1 Locked Architecture — end-to-end design, sweep, and greenfield-vs-reuse (2026-07-01)

The locked design on top of the greenfield spine (mig 094–097). Two rivers joined by
one bridge; the existing workflow/task/event machinery reused where it fits, the
experimental bloat deprecated. Grounded in a full-codebase sweep (three audits).

## 1. The shape — two rivers, one bridge
- **RFP river (admin, immutable):** Scout → temp bucket → **intake queue** → RFP-admin
  review (AI *helps* summarize topics/AOIs + scan sections; **never runs**) → summary +
  metadata + compliance matrix **anchored to the RFP docs** → **release**.
- **The bridge (release = the join):** release publishes a forward-only card version to
  `opportunity_bridge`; the customer-side spotlight processor subscribes and fans a thin
  card to every subscribed tenant. **Sole admin→customer coupling** = the shard seam.
- **Customer river (per tenant, RLS):** onboarding (backfill) → pin (full copy) →
  spotlight buckets (rank local pipeline) → purchase a portal → **accept guardrails at
  launch** → execute (per-portal workflow) → closeout. **All state on the card.**

## 2. Event taxonomy — KEEP the 7 namespaces (a CHECK constraint enforces them, mig 069;
`admin`/`cms`/`spotlight` are forbidden). "Redo as needed" = new **types**, not new
namespaces (that IS the coding standard). New/confirmed types for the locked flow:

| Namespace | Types (the river) |
|---|---|
| **finder** (RFP river) | `rfp.uploaded`, `source.change_detected`, `opportunities.detected`, `solicitation.reviewed`, **`card.published`**, **`card.updated`**, **`card.closed`** (release = the bridge post) |
| **capture** (customer) | `application.accepted`, **`card.mirrored`**, **`card.pinned`**, **`bucket.created`**, **`bucket.ranked`**, **`portal.purchased`**, **`portal.launched`**, `plan.changed` (planned, not built) |
| **proposal** (execute) | `proposal.created`, `section.saved`, `proposal.advanced`, `outcome.recorded` |
| **library** | `unit.created/approved/archived`, `atom.refined` |
| **identity** | `user.logged_in` (⚠ currently referenced but never emitted — see §6), `invite.created`, `consent.given` |
| **system** | `workflow.*`, `automation.*`, `notification.*` |
| **tool** | `tool.invoke.start/end` (audit; tools are pull-driven AI-tool = API) |

The bridge handoff is `finder:card.published/updated` → the capture-side processor. The
river (`system_events`) is the one immutable log; nothing gets its own parallel queue.

## 3. Card-carries-all — `card_activity` projection (recommended over a customer queue)
NEW `card_activity` (tenant-scoped, RLS, append-only; `tenant_id, opportunity_id,
portal_id?, actor, event_type, summary, ref, at`). The spotlight/portal processors append
to it from the river — the per-opportunity audit trail **through proposal closeout**. One
source of truth (`system_events`), one per-opportunity projection for frictionless UI +
automation. **Do not** build a separate per-tenant all-event queue (redundant with the river).

## 4. End-to-end flow → REUSE / GREENFIELD / REWIRE
| Stage | Mechanism | Verdict |
|---|---|---|
| Scout find + alert | `source_scout.py` (crawl + Claude diff → `extracted_opportunities`) exists | **REUSE** + wire a cron trigger (§6) |
| Intake → admin review | `rfp.uploaded → shred → extract_compliance → notify` (CLOSED); `curated_solicitations.status` machine | **REUSE** + build the **admin review QUEUE** (missing) |
| Doc-anchored matrix | `solicitation_annotations` + compliance/volumes; the atom rail | **REUSE** (already wired this session) |
| Release = bridge | `solicitation.push` now calls `publishAndFanOut` (increment 2) | **GREENFIELD (done)**; retire the legacy Python `on_solicitation_pushed`→`tenant_pipeline_items` path |
| Onboard → mirror | `OnApplicationAccepted` (library defaults) | **REUSE** + add **backfillTenant** step (missing) |
| Pin = full copy | `pinCard` (increment 3) | **GREENFIELD (done)** |
| Spotlight buckets | `tenant_spotlight_buckets` + `rankBucket` (increment 4) | **GREENFIELD (done)**; retire global buckets + `score_tenants` bucket code |
| Purchase → portal | `proposal_portals` + `assumeShadowAdmin` + `acceptGuardrails` (increment 5) | **GREENFIELD (done)**; wire into the real Stripe purchase |
| Execute (per-portal workflow) | instantiate a `process_instance` from the accepted `guardrail_config`; TODO steps → the customer ToDo queue; nudges | **REUSE** the workflow/task/nudge engine, driven by the portal's frozen guardrails |
| Closeout | `outcome.recorded → attribution`; contract spin-off; harvest → `outcome_score` | **REUSE** (solid) + surface outcome on the card |

## 5. Deprecation inventory (from the sweep)
- **DEPRECATE (superseded):** `tenant_pipeline_items` → `tenant_opportunity_cards`;
  `spotlight_bucket_scores` → `tenant_bucket_scores`; `spotlights`. Blocked by ~12
  frontend routes + `on_solicitation_pushed`/`on_opportunities_detected` + `score_tenants`
  — rewire readers, then drop.
- **REFERENCE-ONLY:** `sbir_awards`, `sbir_companies`, `sbir_data_uploads` — CRM/BD lookup
  + abstracted program analytics (USAF CSO) only; **out of scoring**.
- **ARCHIVE:** 8 dormant agent archetypes (keep `section_drafter` + `color_team_reviewer`);
  dead config (`STORAGE_ROOT=/data`, the `/data` volume).
- **KEEP:** ~75 core tables + the greenfield spine. The workflow/event/task/tools/intake/
  onboarding/cron machinery is sound and is the reuse substrate.

## 6. Gaps + real bugs the sweep found (fix in cutover)
1. **BUG — orphaned onboarding HITL:** `OnApplicationAccepted` HITL_WAITs on
   `identity:user.logged_in:single`, **never emitted** → parks 48h then times out. Fix:
   emit `identity:user.logged_in` on first portal login, or drop the wait.
2. **`proposal.advanced` vs `proposal.stage_advanced`** name mismatch — the review/final
   workflows may not trigger. Reconcile to one type.
3. **Nudge cap:** MAX-3 not enforced (`is_final` = last of *any* schedule). Cap
   `nudge_schedule` to 3 at task creation (3rd CCs the tenant_admin — already coded).
4. **Task expiry:** no timeout→`expired` sweep; parked tasks can hang. Add it (exit =
   nudge-timeout OR admin force-accept).
5. **ToDo entry types:** map `acknowledge` / `complete_sections` / `upload_documents` onto
   `task_type` + the existing `completers.ts kind` (review/upload/form).
6. **Backfill on onboarding:** add `backfillTenant` to `OnApplicationAccepted`.
7. **Admin intake review queue:** build the "my open reviews" triage list (only per-sol
   claim routes exist today).
8. **Scout cron trigger** + **AI_INVOKE fabric threading** in `manager.execute_instance`
   (steps silently skip today).

## 7. ToDo/nudge model — CONFIRMED "mostly done" (~85%)
Tasks ledger, nudge sweep (60s, idempotent, final-nudge CCs tenant_admin), customer +
admin ToDo queues, atomic complete→resume, no save-state: all real. Only the six small
items in §6(3-5) remain. Crons are solid (10s workflow poll, 60s nudge, hourly
date-anchored + lifecycle, 20s agent, 60s ingest).

## 8. AI posture (locked)
AI **helps, doesn't run**: summarize topics/AOIs, scan sections for missed requirements,
draft V0 (advisory, HITL-landed), color-team review. Everything crosses a HITL gate
(Claude↔admin today). The dormant archetypes archive; the advisory ones stay. Future:
AI-on-one-side + HITL-clone-on-the-other debating content at the gate checks, carrying the
flow/style of prior winning downloads — the spine + guardrail_config is the substrate.

## 9. Build order (greenfield the extension, reuse the machinery)
1. **Cutover reads:** repoint the opportunity/spotlight/pin frontend routes to the cards/
   buckets (RLS `withTenant`); retire the legacy `tenant_pipeline_items` write path.
2. **Wire the joins:** backfill-on-onboarding; the release→bridge is done (verify);
   `card_activity` projection + the capture-side processor.
3. **Execute:** instantiate the per-portal `process_instance` from `guardrail_config`;
   map the ToDo entry types; cap nudges at 3; add the expire sweep; fix the login-HITL bug.
4. **Intake:** the admin review queue + the Scout cron.
5. **Deprecate:** drop the 3 legacy tables after readers are cut over; archive dormant
   archetypes + dead config; demote SBIR to reference.
6. **Activate RLS:** point the app login role at `govtech_app`; replace the god-view with
   `portalAdminAccess`.
</content>
