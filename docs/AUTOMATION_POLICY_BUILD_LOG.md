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

**Not yet (lands in later phases):** recipient-set resolution + the admin-always escalation floor
(pipeline, Phase C), relative-timing anchor (Phase C), the three editing surfaces (Phase D), agent
auto-run + budget dims (Phase E).

---
