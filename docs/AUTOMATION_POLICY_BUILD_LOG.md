# AUTOMATION_POLICY_BUILD_LOG.md — the #190 build, phase by phase

The as-built dev + test record for the global automation-policy layer (#190). Design of record:
`docs/AUTOMATION_POLICY_DESIGN.md`. Engine substrate: `docs/AUTOMATION_SPINE_MAP.md`. Every phase lists
what shipped, the files, the tests, and the verification. Built **slow and low**, inert-first, each phase
committed green.

**Sandbox:** `postgresql://claude@127.0.0.1:5433/govtech_intel`. Protocol per phase:
`tsc --noEmit` (0) → `vitest run` → `migrate.mjs` (idempotent) → `next build` for route risk → live drive.

---

## Phase A — inert foundation ✅ (commit `f1cb6e0`)

The three-level substrate, shipped INERT (nothing read it yet).

| Artifact | What |
|---|---|
| `db/migrations/126_automation_framework.sql` | **Platform** singleton (RFP-admin-tunable): `curation_sla_minutes=4320`, `default_nudge_days={1,3}`, `default_due_in_minutes=4320`, `max_buckets_per_tenant=12`, `max_nudges_per_gate=3`, `agent_monthly_budget_ceiling_usd=200`, `agent_settings`, `overlay_frameworks`. Seeded from today's constants. `GRANT SELECT` to govtech_app. |
| `db/migrations/127_tenant_automation_policies.sql` | **Tenant** grammar table — recipients×trigger×timing×escalation per `(tenant, scope, trigger_key)`. FORCE RLS + `tenant_isolation` (mig-097 pattern). |
| `db/migrations/128_opportunity_date_guard.sql` + `lib/tools/solicitation-push.ts` | Decision ⑤ — `dates_estimated` flag; push refuses to release an OPP whose activated opportunities lack `close_date` (the one intentional behavior change). |

**Tests / verify:** tsc 0 · vitest **729/729** · `migrate.mjs` applied 126–128 and idempotent on re-run
(0 applied) · framework singleton seeded (verified via psql) · RLS `relforcerowsecurity=t`. Two push-test
mocks (`tools-solicitation-review`, `scenarios-full-curation-flow`) gained the date-guard `sql` call in
their ordered mock sequences.

**Decisions honored:** ⑤ (no card without close_date), ⑦ (framework level), RLS-forced for the cutover.

---

## Phase B — the resolver ✅ (still inert; behavior identical to Phase A)

The single injection point. Every tenant rides the framework default, so no user-visible change.

| Artifact | What |
|---|---|
| `frontend/lib/automation/policy.ts` | `resolveGatePolicy({tenantId, scope, triggerKey, gateDefaults, pinnedToCurationSla})` → `{enabled, assigneeRole, nudgeDays, dueInMinutes, channel, cooldownMinutes, maxFiresPerHour, source}`. Precedence: framework-hard pin ▸ tenant policy ▸ gate defaults ▸ framework default. **Fail-safe:** any DB error → gate defaults (today's behavior). Framework caps the nudge count at `max_nudges_per_gate`; the curation SLA is a hard pin. |
| `__tests__/automation-policy.test.ts` | 7 unit tests: no-policy→defaults · tenant override · SLA framework-hard pin · nudge-count cap · `enabled=false` safe-skip · DB-error fail-safe · null-tenant admin gate. |
| Repointed call-sites | `purchase` (proposal_setup, SLA-pinned), `stripe/webhook` (proposal_setup, SLA-pinned), `proposals/create` (admin_review, SLA-pinned), `proposals/outcome` (contract_kickoff, tenant-tunable). Each guards the launch on `pol.enabled`. The raw admin `launch-collaboration` route stays the explicit-override tier — untouched. |

**Tests / verify:** tsc 0 · vitest **736/736** (+7) · `next build` (route changes). Decisions honored: ⑦
(three levels + framework-hard SLA), ② (resolver is the tenant/portal path, distinct from admin
`automation_rules`), ⑨ (framework ceiling read here; enforced on agents in Phase E), fail-safe = the inert
guarantee.

**Not yet (lands in later phases):** the three editing surfaces (Phase D), agent auto-run + budget dims
(Phase E).

---

## Phase C — the value-driver core: escalation floor + agents-do-most + pre-staged ToDos ✅

**C1 — escalation floor backstop (commit `c9f9774`).** `pipeline manager._final_notice_user_ids` now
appends the oldest active `rfp_admin`/`master_admin` as the **RFP-Pipeline shadow backstop** when a tenant
has no active admin/manager — so a final nudge never lands on nobody (decision ①: floor = admin-always +
managers + platform backstop). The build TODO gates already read the resolver via the Phase-B launch
overlays. Verify: workflow tests 18 passed / 13 skipped.

**C3 — pre-staged review ToDos, agents-do-most (this commit).** The section_drafter already drafts a V0 on
provision (`proposal.created` → `draft_v0`), so the human's job is to REVIEW. `lib/automation/prestage-todos.ts`
`preStageProposalReviewTodos()` pre-stages two **policy-resolved** review gates at provision — a **draft
review** (`section_review`, 7d default) and an **agent-assisted final review** (`final_review`, 14d,
`agentAssisted=true`) — as `tasks` rows (assignee/nudge/due from `resolveGatePolicy`, `entity=proposal`,
`params.kind='review'`). **Agent-first aware:** when the portal's `guardrail_config.agentFirst` is set, the
copy becomes "Review the AI-drafted sections" / "confirm the AI compliance + color-team pass". Wired into
`provisionProposalForPortal` (best-effort, non-fatal). Emits `proposal:review_todos.prestaged`. This is the
"agents do most — including an agent-assisted final review" model (the user's value driver).

**C2 — discovery NOTIFY (scoped per decision ⑥).** The resolver already serves the discovery side
(`resolveGatePolicy({ scope: 'discovery', … })`); the "new priority OPP" predicate = the bucket's own
parameters else company-match + time-to-close (decision ③). Per decision ⑥ the notify **delivery is
cron-digest, low-priority** ("build the regulator but not a big deal yet; just don't let anything not make
it into the DB") — so the DB-of-record ToDos land now (C3), and the batched digest delivery rides the cron
sweep in Phase F. The hook is in place; no per-event firehose.

**Tests / verify:** tsc 0 · vitest **736/736** · pipeline workflow tests 18/13 · SQL smoke of the pre-stage
insert shape (interval + jsonb params + tasks columns) green on the sandbox. Decisions honored: ① (floor
backstop), ③ (priority predicate), ⑥ (DB-first, cron delivery deferred), §13 (agent-first). Live proof of
the ToDos appearing + nudging is F1 (the drive + screenshots).

---

## Phase D — the three editing surfaces + backfill ✅

**D1 — backfill (mig 129, commit `accf4e4`).** Lossless: each configured tenant's 6 booleans → policy rows
(4 notify triggers), un-configured tenants ride the framework. Idempotent. Verified: 1 tenant → 4 rows, 0
on re-run.

**D2 — tenant grammar editor (`accf4e4`).** `lib/automation/catalog.ts` (6 governable triggers; framework-hard
gates excluded) · `app/api/portal/[tenantSlug]/automation-policies/route.ts` (GET catalog-merge + PATCH validated
upsert, RLS-scoped via withTenant) · `components/portal/automation-policies-card.tsx` (per-trigger Who/nudge/
channel + the **locked admin-floor chip**, decision ①), swapped in at both mounts. Tests:
`automation-policies.test.ts` (**8**).

**D3 — framework control plane (`25889fe`).** `app/api/admin/automation-framework/route.ts` (GET+PATCH the
singleton, RFP-admin only, bounded validation, `system:automation_framework.updated`) ·
`app/admin/automation-framework/page.tsx` (SLA, buckets, nudges, agent budget **ceiling** — decision ⑨).
Tests: `automation-framework.test.ts` (**8**).

**D4 — portal-build wizard (this commit).** `components/portal/guardrail-editor.tsx` gains the **Agent-first**
checkbox (default ON — sets `guardrail_config.agentFirst`, which C3's prestage-todos reads) and the
**RFP-Pipeline oversight** toggle (**pre-checked**; unchecking pops an explicit **opt-out modal**, decision
§13). Managers + ≤3-nudge cadence + phases already existed. `acceptGuardrails` writes the raw config, so both
flags persist to `guardrail_config`. **Pipeline honors the opt-out:** `manager._final_notice_user_ids`
suppresses the RFP-Pipeline backstop when `rfpOversight === false`. *Templated-from-last* rides the existing
`GuardrailEditor.initial` prop (pass the tenant's last completed portal config to seed it — a parent
data-fetch, follow-on).

**Tests / verify:** tsc 0 · vitest **752/752** (+16: policies 8, framework 8) · guardrail-authoring 7 ·
pipeline workflow 18/13 · manager.py parses. Decisions honored: ① (floor + opt-out), ⑦ (3 levels: framework
control plane / tenant grammar / portal wizard), ⑨ (budget ceiling), §13 (agent-first + RFP-shadow pre-checked
+ opt-out modal).

---

## Phase E + F — agent budget + the finale ✅

**E1 (commit `7665c6b`)** — the fabric now reads `automation_framework.agent_monthly_budget_ceiling_usd`
and caps a tenant's effective budget at it (decision ⑨); auto-run rides the resolver's `enabled`.
Agent tests 130/46.

**F — adversarial sweep + screenshots + retire (commits `1e5b2db`, `76f2c77`).** Two subagents hunted the
whole diff. Pipeline: clean. Frontend: **1 HIGH cross-tenant leak** (GET automation-policies had no
`WHERE tenant_id`; RLS is inert under the bypass role → returned every tenant's rows) + 2 MEDIUM (resolver
cutover-correctness via withTenant; dead framework knobs removed from the editor) + 2 LOW (recipientUsers
UUID→422; nudge-days raw-text input) + a 0-ceiling footgun (now requires >0). All fixed + tested. Retired
the orphaned prefs card. **Live screenshots** (`scratchpad/shots-190/`): the tenant grammar editor (locked
admin-floor chip, AI-capable triggers, the pre-staged draft/final review gates) and the RFP framework
control plane (SLA/buckets/nudges/agent ceiling).

**Final tally:** ~17 commits · tsc 0 · **vitest 753/753** · `next build` EXIT 0 · pipeline workflow 18/13 +
agents 130/46 · migrations 126–129 idempotent · adversarial-sweep-clean (the one live leak fixed).
Everything ships inert until a tenant edits a policy. #190 is complete.
