# SECURITY_AND_SAFETY.md — Canonical Security & Agent-Safety Posture

**Date:** 2026-07-22 · **Status:** Authoritative consolidation of the as-built security &
safety posture at launch readiness. This doc is the single **map**; it does **not** duplicate
the binding rules — it cites them.

**Binding sources (do not restate; follow these):**
- **CLAUDE.md** — the binding engineering SOPs (`SOP: Security`, `SOP: Code Quality`,
  `SOP: Data Layer`, `SOP: Events`). Every rule below traces to one of them.
- **docs/AGENT_WORKFORCE.md** — the agent safety contract + the wake-one-at-a-time plan.
  **That doc owns the agent invariants**; §5 here is a pointer, not a fork.
- **docs/RLS_CUTOVER.md** — the authoritative as-built RLS cutover record (mig 136 policies/grants/
  context layer, the cross-tenant-read caveat, and the one-op prod `DATABASE_URL` flip that remains).
- **docs/DEPRECATION_CLEANUP_2026-07-22.md** — the "empty ≠ dead" drop rule.
- **docs/LAUNCH_READINESS_2026-07-22.md** — launch-readiness items #9 (RLS) and the paywall.

---

## 1. Credential hygiene — no committed production secrets (mig 124)

Prior seed/reset migrations committed **known plaintext passwords** into git and re-clobbered
them via `ON CONFLICT DO UPDATE` (`051_reset_admin_launch` set master_admin
`eric.c.wagner@gmail.com` = `GovWin2026!`; `041_seed_test_accounts` set the `*.test` accounts).
Because master_admin is unconditional god-view over every tenant (`lib/db.ts verifyTenantAccess`),
a repo-readable password was a full multi-tenant compromise.

**`124_launch_security_rotate_seed_credentials.sql` neutralizes this** — and sorts **after**
041/051 so it wins any fresh-apply `ON CONFLICT` race, idempotently:
1. **master_admin rotated** to a new strong random password; **only the bcrypt hash is in source**
   (one-way), plaintext delivered out-of-band. `temp_password=true` **forces a change on first login**.
2. **`*.test` seed accounts deactivated** (`is_active=false`) and their hashes **invalidated** to a
   non-bcrypt string that can never match — never hard-deleted (access off, history kept).
3. The **`apex-defense` test tenant archived** (`archived_at`), so it drops out of company/login lists.

**Rule:** no plaintext credential ever lands in a migration or the repo. Seeds carry bcrypt hashes
+ `temp_password=true`; test fixtures are deactivated-by-default, not live.

---

## 2. Tenant isolation & RLS — forced; app-side cutover BUILT + APPLIED; single-layer in effect until the prod `DATABASE_URL` flip

**Model.** Tenant-scoped tables (`proposals`, `proposal_sections`, `tenant_profiles`, `atom_tags`,
agent memory, …) have RLS **ENABLEd + FORCEd** (mig 116 forced RLS on `episodic_memories`;
mig 117 forces it across the core tenant tables and defines the policies keyed on
`current_setting('app.tenant_id')`; **mig 136_rls_cutover** completes the app-side cutover — see below).
Portal routes additionally enforce access **in the app**: every tenant query verifies membership
(`verifyTenantAccess`) — **never query by ID alone** (CLAUDE.md `SOP: Code Quality`).

**Single-layer caveat (in effect today).** The app still connects as the database **owner** role
(sandbox: `claude`, `rolbypassrls=t`), which **bypasses RLS**. So *in effect* today isolation rests on
the **application layer** (`WHERE tenant_id` + `verifyTenantAccess`); the FORCEd policies are correct
but not yet load-bearing **only because the app connects as the owner** — not because they are unbuilt.
This is a deliberate, documented state — not a gap that bites at current scale.

**The backstop — BUILT + APPLIED in schema; only the prod `DATABASE_URL` flip remains.**
**mig 136_rls_cutover** has landed and is applied: the current schema carries **19 force-RLS tables**
and **35 `tenant_isolation` policies**, and both non-owner **`NOBYPASSRLS`** roles now exist — **`govtech_app`**
(the application role, LOGIN-capable) and **`rfp_agent`** (the agent role, NOLOGIN group; ops attaches a
LOGIN member + points `AGENT_DATABASE_URL` at it). The **per-request context layer is built**, not merely
specified: `frontend/lib/tenant-context.ts` + `frontend/lib/db.ts` provide `enterTenant`/`enterBypass`
(a Proxy that `SET`s `app.tenant_id` per request/agent), and **mig 137_validate_namespace_check** validates
the namespace CHECK. The **one remaining step** is the prod **`DATABASE_URL` flip** off the owner role onto
`govtech_app` — a single operational change that makes RLS the **second enforced layer** (launch-readiness
item #9). This is **not done yet** (the app still connects as owner). As-built record + the flip checklist:
**docs/RLS_CUTOVER.md** (recorded there as **BUILT + PROVEN**).

**Cross-tenant-read caveat (from the 2026-07-22 repoints).** The retired-table repoints swapped
two **direct cross-tenant admin/CMS reads** onto `tenant_opportunity_cards` (RLS FORCED):
`app/admin/rfp-curation/[solId]` "Customer Interest" and `services/cms/src/templates.py`
(`matched_opportunities`). **Fine today** (owner bypasses RLS), but once the `DATABASE_URL` flips to
`govtech_app` they'd return **0** (predicate `tenant_id = NULL`) unless run on a BYPASSRLS/owner
connection (`enterBypass`) or routed through owner-views (the `v_opportunity_rollup` view is already
safe). **This is on the RLS-cutover checklist** — see docs/RLS_CUTOVER.md, not a pre-launch blocker.

---

## 3. SQL & input safety

- **Parameterized everywhere.** All SQL uses postgres.js **tagged templates** (`` sql`…${x}` ``);
  agent tools **never construct SQL** — they call typed tool functions that parameterize
  (CLAUDE.md `SOP: Security`). No string-built queries.
- **`jsonb` written as objects** via `${sql.json(x)}`, not `${JSON.stringify(x)}::jsonb` (the latter
  stores a string scalar → silent char-iteration / null-lookup bug). Read back via
  `coerceJsonb<T>` (CLAUDE.md `SOP: Data Layer`, CLIFFNOTES §4b).
- **ILIKE inputs escaped:** `input.replace(/[%_\\]/g, '\\$&')`.
- **Errors never leak internals.** Every failure response returns the shape
  `{ error: string, code: string }` — a client-safe message + a stable code, **never** a raw
  DB/stack detail. Every `await sql` is inside try/catch; server components re-throw
  `NEXT_REDIRECT` and log with a tagged prefix (CLAUDE.md `SOP: Error Handling` / `SOP: Code Quality`).

---

## 4. Prompt-injection fencing (untrusted tenant content in agent prompts)

Any tenant-authored content that flows into an agent prompt — uploaded documents, atom text,
section drafts, notes, source pastes — is **untrusted** and **clearly delimited** in the prompt so
model instructions and user data never blur (CLAUDE.md `SOP: Security`). The librarian producer
(atomize→`agent_task_queue`) is **injection-fenced** at the boundary where uploaded content becomes
agent input. Fencing is a **precondition** for waking any agent that reads tenant content
(AGENT_WORKFORCE.md).

---

## 5. Agent safety invariants (pointer — owned by AGENT_WORKFORCE.md)

The agent workforce is woken **one archetype at a time** against the current spine. Every wired
agent obeys these **non-negotiable** invariants (full contract + rationale in
**docs/AGENT_WORKFORCE.md** — do not fork it here):

1. **Tenant-bound.** Tenant-space agents run with `tenant_user` authority; tool schemas expose
   **no `tenant_id`** — the runtime binds it. An agent cannot address another tenant's rows.
2. **Advisory → guardrail → land-or-review.** Output is advisory; it passes a guardrail; then it
   either lands (if safe) or is queued for human review. Agents **never auto-write business tables**.
3. **Injection-fenced.** Untrusted tenant content is delimited (§4).
4. **Runaway-bounded.** Four caps — **round / cost / rate / budget** — bound every invocation,
   fail-closed on breach. Values + enforcement in **docs/RATE_MONITORING.md §2/§3/§6**.
5. **Never dead-ends a workflow.** A bound breach, missing key, or guardrail stop routes to
   **safe-skip**, never a hung Process Instance (EVENT_CONTRACT_V3 §3.1).

**RLS backstop for agents** is the same `rfp_agent` NOBYPASSRLS cutover as §2 (pending); today the
tenant binding is enforced in the tool layer.

---

## 6. Revenue fail-safe — the founding-cohort paywall

`lib/paywall.ts` gates the self-serve `/proposals/create` route. It is **fail-SAFE: enforced by
default.** Bypass requires an **explicit** `FOUNDING_COHORT_BYPASS=true` — a missing, empty, or
typo'd env **never gives the product away**. (The prior `env !== 'false'` logic fail-OPENed on any
unset/typo value; that was the launch-readiness audit's revenue risk, now closed.) A founding-cohort
deploy sets the flag (logged loudly at the call site); removing it at billing-go-live re-enforces the
paywall automatically. The primary access path (comp-code purchase → curation → release) provisions
the first proposal **upstream** of this route; the paywall is the future Stripe hook + the backstop.

---

## Cross-reference index

| Concern | Canonical source |
|---------|------------------|
| Binding engineering SOPs (security/quality/data/events) | CLAUDE.md |
| Agent safety contract + wake plan | docs/AGENT_WORKFORCE.md |
| RLS-cutover checklist + cross-tenant-read caveat + drop rule | docs/DEPRECATION_CLEANUP_2026-07-22.md |
| Runaway caps (round/cost/rate/budget) + observability | docs/RATE_MONITORING.md |
| Event contract + namespace rules + audit river | docs/EVENT_CONTRACT_V3.md / _V2 catalog |
| Launch-readiness items (#9 RLS, paywall) | docs/LAUNCH_READINESS_2026-07-22.md |
| bug-classes (jsonb, ON CONFLICT, ILIKE, …) | CLAUDE_CLIFFNOTES.md §4b |

*End of SECURITY_AND_SAFETY.md*
