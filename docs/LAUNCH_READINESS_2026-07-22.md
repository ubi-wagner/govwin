# GovWin — Launch-Readiness Assessment (2026-07-22)

Evidence-based, four-dimension review (customer-journey friction, multi-tenant security,
ops/deploy + open-gaps, real value delivery). **Excludes** the automation + AI-agent layer
(assessed separately / next). File:line evidence lives in the review transcripts; this is
the durable synthesis + the ranked fix-list.

## Bottom line

Architecturally sound; the **middle of the funnel is genuinely strong** (identity/multi-
tenancy, the build loop draft→atom-pick→lock→compliance roll-up→harvest, and the exporters).
Not clean-hands ready for cold self-serve traffic. Gaps cluster at three places: **one hard
security blocker**, **the two commercial hinges** (get in the door / get money in), and
**operational hygiene** (migration-tracking drift + silent-failure surfaces).

**Posture:** a warm, hand-held **founding-cohort launch is viable within ~a day's work**
(comp codes, walk past the card button, unlock-on-request). Cold self-serve is not ready.
Neither is safe until the credential blocker is fixed.

## 🔴 Hard blocker (fix before any prod exposure)

- **Committed production admin password.** `db/migrations/051_reset_admin_launch.sql` seeds
  `master_admin` `eric.c.wagner@gmail.com` with `GovWin2026!` via `ON CONFLICT DO UPDATE`
  (re-clobbers on re-apply), ungated (runs in prod). `master_admin` = god-view over every
  tenant (`lib/db.ts:57`). Same family seeds `*.test` accounts with known passwords
  (`041_seed_test_accounts.sql`). One repo-readable credential owns all tenant data.
  **Fix:** neutralize the committed credential (force-reset), deactivate the `.test` seed
  accounts, and ensure no re-clobber (a later migration wins the order).

## 1. Functional readiness — works, not clean-hands operable

**Strong:** slug-derived tenant resolution → `verifyTenantAccess` → `WHERE tenant_id` on
every portal route (none scope off the JWT); parameterized SQL; bcrypt 12; fail-safe
paywall; the revenue spine (comp-code → curation → release → provision) is real and fully
Stripe-free; the admin console runs the business (the "V1 TODO" headers are stale comments,
not stubs); migrations are idempotent + fail-fast at boot.

**Gaps:** migration-tracking drift (schema at 123, tracker at 114 — 115–123 hand-applied,
never proven through `migrate.mjs`); RLS is `ENABLE`/`FORCE`d but inert in prod (owner role
bypasses) so isolation rests entirely on the `WHERE tenant_id` predicates (consistent today,
zero backstop); invite token = raw collaborator UUID that sets a password, non-expiring,
over-exposed; silent-failure surfaces (non-fatal CMS migration, env-gated nudge emails,
`ANTHROPIC_API_KEY` boots green while dead, best-effort purchase side-effects can strand a
paid $0 portal with no admin ToDo); one staff panel reads the retired `tenant_pipeline_items`.

## 2. Frictionless readiness — the weak pillar (commercial hinges)

- **Purchase CTA dead-ends on "Internal server error"** — Stripe descoped throws; the modal
  renders the generic 500 instead of its intended "use an access code" fallback.
- **Free bypass:** the Builds "Open portal" form provisions a full unlocked build with **no
  purchase and no curation** (revenue leak + business-model mismatch). → replaced by an
  **RFP-Admin approval** that mints a $0 purchase + curation (audits as purchased).
- **Post-submit dead-end:** advancing to final auto-jumps to `submitted` + locks; the
  "Unlock for Edit" button is gated on `stage === 'final'` (never true at `submitted`), so
  the customer can't self-unlock to fix a typo (the API supports it; no button reaches it).
- **`tenant_user` cold-start** is a redirect-trap checklist (steps point at routes that
  redirect them away; copy never says "wait for your admin").
- Purchase entry buried, UUID hand-entry, price copy drift, multi-membership collaborator
  deep-link loses the target proposal.

## 3. Value-added readiness — real engine, narrower + less proven than the demos imply

**Real:** the section drafter makes a live Claude call and **enforces a hard page/word
budget** (the hardest SBIR constraint); the three exporters are submission-grade; the atom-
reuse loop is coherently tagged + context-ranked; /review reflects true lock state.

**Thin / overstated:** every captured "example output" is **hand-authored** (`provenance:
manual`) — AI prose quality is untested in-repo; the cost `.xlsx` is a **static table**, not
a live formula model (despite the claim); compliance "satisfied" = **a human locked the
section**, not verification (and the /review page-count stat measures JSON length, not
prose); content matching is **substring + exact-tag, never semantic** (embeddings default-off,
wired only to agent memory); the SBIR-defining signals (**TRL, prior-funding**) are stubs.

## Ranked pre-launch fix-list

**Must-fix:** (1) neutralize the committed admin credential + deactivate `.test` accounts;
(2) reconcile migration tracking + make CMS migration fatal/alarmed; (3) purchase-CTA
fallback copy; (4) close the free "Open portal" bypass → RFP-Admin-approved audited-as-
purchased; (5) launch-env assertion (`PORTAL_BASE_URL`, matching `API_KEY_ENCRYPTION_SECRET`,
real `ANTHROPIC_API_KEY`; leave `FOUNDING_COHORT_BYPASS` unset) + a "paid portal, no ToDo"
monitor.

**Should-fix:** (6) post-submit unlock button; (7) `tenant_user` onboarding copy; (8) invite-
token model; (9) RLS enforcement (NOBYPASSRLS app role) or documented single-layer rigor;
(10) repoint the admin "who's interested" panel off the retired table; (11) value honesty —
live cost formulas (or drop the claim), page-count via `countWords`, capture a real AI-drafted
sample.

**Known-descoped (intentional, not blockers):** live Stripe self-serve (comp-code stands in),
semantic search, SBIR TRL/funding signals, CMS social posting, shadow-grant hard cutoff.

## Resolution log (2026-07-22 — blocker-kill pass)

Knocked out in this pass (verified `tsc` 0 / vitest 729 / live-schema drive-test):

- **✅ (1) Credential blocker** — `db/migrations/124_launch_security_rotate_seed_credentials.sql`
  rotates `master_admin` off the committed `GovWin2026!` to a new random password (bcrypt hash
  only in source; `temp_password=true`), deactivates + hash-invalidates the `.test` seeds, and
  archives the `apex-defense` test tenant. Sorts after 041/051 so it wins any ON-CONFLICT re-apply.
  Verified: `GovWin2026!` no longer authenticates, new password does; `.test` accounts `is_active=f`.
- **✅ (2a) Migration tracking reconciled** — `migrate.mjs` applied 115–124; `_migration_history`
  head is now `124_…`. **(2b) CMS migration made fatal** — `services/cms/Dockerfile` CMD now
  fails-fast (crashes loudly) on a migration error instead of `|| echo warn` booting stale.
- **✅ (3) Purchase-CTA fallback** — `stripe/checkout` (and `stripe/portal`) catch a
  "not configured" Stripe error and return a friendly `STRIPE_NOT_CONFIGURED` message so the
  modal shows "use an access code" instead of a raw 500.
- **✅ (4) Free "Open portal" bypass closed** — `POST /api/portal/[slug]/portals` is now gated to
  `rfp_admin+` and records a **$0 completed `purchases` row** (`metadata.grant='admin'`) + emits
  `capture:purchase.completed`, so an RFP-Admin-approved free portal **audits exactly as a
  purchase**. The Builds create-form is hidden from non-experts and relabeled "RFP-Admin · approve
  a free portal". Drive-tested: the $0 insert + jsonb readback is correct against the live schema.
- **✅ (6) Post-submit unlock** — `stage-control.tsx` treats `submitted` (not just `final`) as the
  terminal gate, so the "Unlock for Edit" button renders post-submit (the dead-end is gone).
- **✅ (7) `tenant_user` cold-start** — the dashboard "Get started" checklist (which pointed a base
  user at admin-only routes that redirect them away) now shows only to those who can act; a base
  member sees an honest "you're on the team — ask your admin / check your to-dos" card.

Integrity/leak/deadstop scan (live sandbox): **0** portals past `guardrails_pending` missing a
purchase-audit row, **0** `submitted`-but-unlocked proposals, **0** stranded provisioned-locked
builds. RLS confirmed inert-by-owner (`claude` role `rolbypassrls=t`); the `rfp_agent` NOBYPASSRLS
role exists but is unused by the app — single-layer isolation via `WHERE tenant_id` stands (item 9).

**Live click-through** (Playwright against a seeded instance, `frontend/e2e/zzblockers.tenant.spec.ts`,
5/5 green; shots in `frontend/blocker-shots/`): (1) the RFP-Admin "approve a free portal" form —
approving minted a `guardrails_pending` portal AND a real `amount_cents=0, status=completed,
metadata.grant=admin` purchases row + a `capture:purchase.completed` event (audited-as-purchased,
proven end-to-end through the UI); (2/2b) admin sees the actionable checklist, a base `tenant_user`
sees the honest "you're on the team / ask your admin" card; (3) the post-submit "Unlock for Edit"
button renders at `stage=submitted`; (4) the purchase modal shows "Card checkout is not available
yet — use an access code below." instead of a 500.

**Still open (deferred with automation/agents next):** (5) launch-env assertion + "paid portal, no
ToDo" monitor; (8) invite-token model; (9) RLS enforcement via the app using `rfp_agent`; (10)
repoint the retired-table admin panel; (11) value-honesty items (live cost formulas, `countWords`
page count, a real AI-drafted sample). Budgets = Claude-cost rollups (± Railway DB / S3) land with
the agent/spend-cap work.

## Verdict

A real product with a strong spine and a small, surgical gap list — not a systemic one. Fix
the one blocker + the two commercial hinges + reconcile migrations (roughly a focused day)
and a confident hand-held founding-cohort launch is viable this week. The depth items
(semantic matching, verified compliance, proven AI prose, live cost models) are what turn a
hand-held launch into a defensible self-serve product — and line up behind the automation +
agent work next.
