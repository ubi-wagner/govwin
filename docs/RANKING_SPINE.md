# Opportunity Ranking Spine (2026-08-15)

The discovery→provision ranking spine: **bucket authoring → cap → OPP-push rescore →
new-bucket reshuffle → one mirror-OPP list with a per-bucket score array → admin
pin-for-updates → notifications + nudges → provision a proposal build.** This doc is the
canonical map for that whole chain and the RANK-1…10 hardening pass that completes it.

Scouted 2026-08-15 (five parallel reads). The headline: **~70% already exists** — the
spine is built; this pass closes named gaps and wires the last-mile capabilities.

## Product decisions (owner-confirmed)

1. **Designee** — a tenant_admin delegates bucket authoring to a chosen team member via
   an audited, revocable per-membership grant (`user_memberships.can_manage_buckets`).
2. **Cap** — global default raised **12 → 6**; keep all 6 seeded defaults; enforce the cap
   (rfp_admin tunes it globally later at `/admin/automation-framework`).
3. **Admin pin** — rfp_admin arms **OPP-level** update tracking that fans out to every
   tenant holding the mirror card, **pre-purchase** (today's amendment engine only reaches
   opps that already have a proposal).
4. **Start-nudge** — a hot + unpursued + soon-closing card **nudges** the customer to start
   a proposal (in-app + email via the live nudge engine).

## As-is (what exists) vs. the gaps (what this pass adds)

### ① Bucket authoring + cap + designee
- ✅ Page `/portal/[tenantSlug]/buckets` (tenant_admin-gated) — create/delete/rank; full
  CRUD API (create/edit/delete tenant_admin; read/rank tenant_user); `seedDefaultBuckets`
  seeds **6** on tenant creation; the global cap `automation_framework.max_buckets_per_tenant`
  **exists** with an rfp_admin UI + help text — but **inert** (nothing reads it; default 12).
- ❌ **RANK-2** cap enforcement; **RANK-3** designee grant + loosen the authoring gates;
  **RANK-4** the missing **edit UI** (PATCH exists, never called → editing = delete+recreate).

### ② OPP-push rescore + ③ new-bucket reshuffle
- ✅ New OPP → `solicitation.push` → bridge fan-out → `capture:card.applied` →
  `OnCardApplied` → `rescore_tenant_card` scores the card against **all** active buckets.
  New/edited bucket → sync `rankBucket` (immediate) + `capture:buckets.updated` →
  `OnBucketsUpdated` → `rescore_tenant` (all open cards × all active buckets). TS↔Python
  scorer in parity (bucket lock-down, mig 180).
- ❌ **RANK-6** OPP-push has **no synchronous fallback** (worker down = unscored cards, unlike
  provisioning + bucket-create). **RANK-7** bucket create/edit **double-scores** (sync
  `rankBucket` + a full async re-score of every unchanged bucket — `rescore_tenant` ignores
  the payload `bucketId`); two tiny scorer parity edge-cases; lifecycle-filter divergence
  across the three writers.

### ④ One mirror-OPP list + Buckets-1:N score array
- ✅ `tenant_opportunity_cards` is the single list; the `/cards` route already assembles a
  per-card `rankings: [{bucketId, name, score}]` across all active buckets + a best-bucket
  scalar (`topScore`); order is `is_pinned DESC, top_score DESC, updated_at DESC`.
- ❌ **RANK-5** the array is **display-only** — no bucket-selector to re-rank the one list by a
  chosen bucket; it's score-sorted + sparse, not a stable positional 1..N vector. Make it a
  stable per-card vector aligned to the tenant's bucket list + add the selector ("rank per
  bucket serially by OPP, parallel across buckets").

### ⑤ Pin for updates by admin
- ✅ Customer pin (`is_pinned`/`pinned_docs`, `pin_update_available`→"Resync") = doc-copy
  convenience; admin **amendment tracking** (`solicitation_amendments`→`proposal_amendment_flags`).
- ❌ **RANK-8** amendment tracking only reaches opps that **already have a purchased proposal**.
  Add an rfp_admin **OPP-level watch** (mig 181 `opportunities.update_watch`) that fans update
  flags + notifications to **every** mirror-card holder, pre-purchase.

### ⑥ Notifications + nudges → provision
- ✅ Email digest (score≥50, per-tenant toggle) + in-app bell (`system_events` +
  `notification_read_state`) + CC blue-dot (`command_seen_state`); a **live nudge engine**
  (`manager._sweep_task_nudges`, 60s loop, in-app + email, manager escalation); the full
  OPP→provision path (pinned card "Purchase" → `curation_pending` 72h SLA → rfp_admin
  "Release" → `provisionProposalForPortal` unlocked build + compliance matrix + molds).
- ❌ **RANK-9** nudges are **bound to post-purchase tasks** — nothing nudges a customer to
  *start* a proposal on a hot opp. Add the pre-purchase start-nudge (mig 181 watermark).

## Migration 181 (this pass)
1. `automation_framework.max_buckets_per_tenant` default 12→6 (+ move the singleton, guarded).
2. `user_memberships.can_manage_buckets BOOLEAN` (designee grant).
3. `opportunities.update_watch / update_watch_at / update_watch_by` (admin OPP pin).
4. `tenant_opportunity_cards.start_nudges_sent / start_nudged_at` (start-nudge watermark).

## Invariants held
- RLS: tenant reads via `withTenant`/`enterTenant`; admin cross-tenant + platform tables
  (`opportunities`, `automation_framework`, `user_memberships`) via `sqlBypass`/`sql` per the
  established no-RLS-global pattern.
- Advisory/idempotent: the sync scoring fallback is idempotent with the async path; nudges are
  watermark-bounded + capped by `max_nudges_per_gate`; the admin watch never auto-provisions.
- Scorer parity: every scorer change lands in BOTH `lib/bucket-ranking.ts` and
  `pipeline/.../rescore.py` with mirrored tests.

## Verify — DONE ✅
- **Green backbone:** `tsc` 0 · `vitest` **1116** (125 files — incl. the RANK-7 parity cases; event-contract +
  audit-coverage guards pass, so every new emit site is conformant) · `pytest` 17 pure scorer cases · mig 181
  applied against the sandbox (cap=6, all columns present) · `next build` clean.
- **Live under the forced-RLS `govtech_app` role** (served as `postgres://govtech_app:apppass@…`, NOBYPASSRLS —
  proven: reads **0** bucket rows without `app.tenant_id`):
  - `hitl-ranking-spine.spec.ts` — the per-bucket ranking (cards route returns the bucket catalog + per-card
    `rankings`), the **cap** (create → 409 `BUCKET_LIMIT` at the ceiling), the **edit** PATCH, and the **designee
    grant** write all pass. RANK-2/3/4/5.
  - `hitl-bucket-rls` + `hitl-cc-actors` (bucket lifecycle + all 4 CC actors) still pass on the new build — no
    regression from the gate loosening.
- **RANK-7 de-dup proven** at the resolver: `OnBucketsUpdated` input_map resolves `payload.bucketId` → `None` for
  the daily rescore (full-tenant) and → the bucket id for a create/edit/rank (targeted). Both workflows `validate()`.
- **RANK-9 proven live**: running `_run_start_nudges` against the sandbox emitted **3** in-app
  `capture:opportunity.start_recommended` + **1** grouped `start_nudge` email event and watermarked 3 cards; a
  second immediate run emitted **+0** — the spacing guard suppresses re-nudging (the anti-spam proof). The sweep
  SQL executes against real Postgres.

## Deferred (follow-on)
- Activating TRL + prior-funding signals (needs opp-TRL extraction + tenant→award linkage).
- Making the start-nudge cadence / thresholds tenant-tunable via the automation-policy editor (today they're
  code constants, hard-bounded by `max_nudges_per_gate`).
