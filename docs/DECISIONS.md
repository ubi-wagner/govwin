# Project Decisions Log

Canonical record of architectural and operational decisions. Append-only.
Each entry is dated and numbered. Future decisions that supersede a prior
one should reference it by number, not delete it.

---

## 2026-04-08

### D001 — Five-role hierarchy (final for V1)

**Decision:** V1 ships with exactly five roles, nested such that higher
roles implicitly hold the privileges of lower roles.

| Role | Inherits | Scope |
|---|---|---|
| `master_admin` | — | Full system: migrations, Railway ops, all tenants, all RFPs, all users. |
| `rfp_admin` | (peer to master for RFP curation) | Triage, curate, and publish solicitations to the opportunity pool. Customer service. Onboard new customers. |
| `tenant_admin` | — | Manages a single tenant: invite team, purchase proposals, grant access. |
| `tenant_user` | — | Access within a tenant per grant (all proposals or per-proposal). |
| `partner_user` | — | Stage-scoped access on a single proposal (view/comment/edit). Revoked on stage close. |

**Hierarchy enforcement rule:** `master_admin` is a superset of every
other role's capabilities. A single user row with `role = master_admin`
is sufficient to act as `rfp_admin`, `tenant_admin`, `tenant_user`, or
`partner_user` in any middleware check. Middleware uses an ordered role
list `[master_admin, rfp_admin, tenant_admin, tenant_user, partner_user]`
and a check like `hasRoleAtLeast(user.role, required)`.

**Why nested instead of composite:** V1 has exactly one user
(`eric@rfppipeline.com`) playing multiple hats. A single
`role = master_admin` row is the simplest representation; no role-join
table or array column is needed until V2.

**Schema state:** The CHECK constraint on `users.role` in
`db/migrations/001_baseline.sql:44` already enumerates all five roles.
No schema migration is needed.

**Supersedes:** None.

---

### D002 — Single-bucket, three-folder storage layout

**Decision:** V1 uses exactly ONE Railway-managed S3-compatible bucket
(`rfp-pipeline-prod-r8t7tr6`) with three top-level prefixes representing
the three access domains.

```
s3://rfp-pipeline-prod-r8t7tr6/
├── rfp-admin/                 # Staging area for rfp_admin curation
│   └── inbox/{yyyy}/{mm}/{dd}/{source}/{external_id}.{ext}
├── rfp-pipeline/              # Canonical artifacts for PUBLISHED opportunities
│   └── {opportunity_id}/
│       ├── source.{ext}       # Original document
│       ├── text.md            # Normalized text
│       ├── metadata.json      # Extracted fields
│       └── shredded/          # Section-by-section breakdown
└── customers/                 # Per-tenant isolated storage
    └── {tenant_slug}/
        ├── uploads/           # Raw customer uploads
        ├── proposals/{proposal_id}/
        │   ├── sections/
        │   ├── attachments/
        │   └── exports/
        └── library/           # Reusable content units
```

**Why three folders not three buckets:** Railway bucket provisioning is
per-service and each bucket is billed/managed separately. Three prefixes
in one bucket give the same isolation for V1 purposes (enforced in code
at path-generator layer) without tripling ops complexity. When V2 needs
true cross-AZ replication or per-tenant encryption keys, migrating a
prefix to its own bucket is a straight `aws s3 sync` + path-helper swap.

**Access control:** The S3 credentials are shared across both services
(frontend + pipeline). Path generators in
`frontend/lib/storage/paths.ts` and `pipeline/src/storage/paths.py`
are the ONLY places that construct object keys. Application code never
builds S3 paths from raw strings — it calls
`customerPath({ tenantSlug, ...})` or `rfpPath({ opportunityId, ...})`.
This makes tenant-leakage bugs easy to spot in review (any file that
imports `BUCKET` or uses `.putObject` outside the storage helpers is
suspect).

**Env vars (on both govtech-frontend and pipeline services, Railway-injected):**

| Env Var | Value on Railway | How code reads it |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | (secret) | AWS SDK auto-reads |
| `AWS_SECRET_ACCESS_KEY` | (secret) | AWS SDK auto-reads |
| `AWS_DEFAULT_REGION` | `auto` | AWS SDK auto-reads |
| `AWS_ENDPOINT_URL` | `https://t3.storageapi.dev` | AWS SDK v3+/boto3 auto-reads |
| `AWS_S3_BUCKET_NAME` | `rfp-pipeline-prod-r8t7tr6` | Explicit `process.env` / `os.environ` |

**Supersedes:** None.

---

### D003 — Railway volumes remain for NextAuth pg adapter state only

**Decision:** The Railway persistent volumes attached to
`govtech-frontend` and `pipeline` services are NOT used for application
data in V1. All user-generated content (RFP documents, proposal
artifacts, tenant uploads) lives in S3 per D002. Volumes are retained
for:

1. Next.js `.next/cache` (frontend, transient)
2. Python wheel cache (pipeline, transient)
3. Future local fallback if S3 is unreachable (not implemented V1)

**Why:** Volumes are per-service, not shared. Any state we want both
services to read (e.g., uploaded RFP PDFs that pipeline must shred and
frontend must preview) MUST live in S3 or Postgres. The legacy
`frontend/lib/storage.ts` helpers that write to `/data` are kept for
backward compatibility but marked deprecated; new code uses the S3 path
helpers.

**Supersedes:** None.

---

### D004 — Master admin seed

**Decision:** Exactly one initial admin is seeded on first boot:

- **Email:** `eric@rfppipeline.com`
- **Role:** `master_admin`
- **Initial password:** Read from `INITIAL_MASTER_ADMIN_PASSWORD` env
  var at seed time, bcrypt-hashed before insert, **never logged**.
- **`temp_password` flag:** Set to `true` — user is redirected to
  `/change-password` on first successful login.
- **Idempotent:** Seed is a no-op if ANY user with
  `role = master_admin` already exists. Safe to run on every boot.

**Operational note:** After the first successful boot,
`INITIAL_MASTER_ADMIN_PASSWORD` should be unset on Railway. The seed
code logs a warning if the env var is still present after a
master_admin already exists in the DB.

**Additional rfp_admin users:** NOT seeded in Phase 0.5. V1 starts with
Eric alone holding both `master_admin` and `rfp_admin` capabilities (via
the role hierarchy in D001). New `rfp_admin` users are invited via the
admin panel in Phase 1 (RFP Curation).

**Supersedes:** None.

---

### D005 — Phase 0.5 scope and exit criteria

**Decision:** "Phase 0.5" is a hardening phase between the V2 skeleton
(current state at commit `704f737`) and Phase 1 (RFP Curation). Its job
is to make the skeleton actually bootable on Railway with working auth,
working storage, and working health checks — nothing more.

**In scope:**
1. Bucket storage wired end-to-end (frontend + pipeline)
2. Auth scaffold: login page, NextAuth config, master_admin seed
3. Middleware enforces the 5-role hierarchy
4. `/api/health` reports DB connectivity AND S3 connectivity
5. Documentation: DECISIONS.md (this file), STORAGE_LAYOUT.md, PHASE_0_5_CHECKLIST.md

**Out of scope (deferred to Phase 1+):**
- RFP ingestion logic
- Opportunity scoring
- Tenant onboarding flows
- Any proposal workspace features
- Agent execution

**Exit criteria:**
1. `npx tsc --noEmit` passes from `frontend/` with zero errors
2. `pytest --collect-only` passes from `pipeline/` with zero errors
3. Eric can log in at `https://app.rfppipeline.com/login` using the
   initial seeded credentials
4. `/api/health` returns `{ db: "ok", s3: "ok" }`
5. A manual put/get roundtrip through the S3 helpers works from a
   Railway shell session in both services

**Supersedes:** The prior "Phase 1" charter in `.plan.md` implicitly —
which is wider in scope.

---

# Phase 1 Decisions (added 2026-04-09)

The following decisions are made up-front for Phase 1 (RFP Ingestion & Expert Curation) so the implementation is bound rather than improvised. All Phase 1 commits must reference and respect these decisions; deviation requires a new decision record amending the relevant entry.

## D-Phase1-01: Ingesters live in pipeline, not as tools

**Status:** accepted
**Decision:** External-API polling (SAM.gov, SBIR.gov, Grants.gov) is implemented as Python ingester classes in `pipeline/src/ingest/` and runs on cron via `pipeline/src/main.py`. Ingesters are NOT registered in the tool registry. They emit `finder.opportunity.ingested` events; everything downstream (triage, curation, shredder dispatch) uses tools.
**Rationale:** Agents shouldn't be able to trigger polling of upstream rate-limited APIs as a side-effect of `memory.search` or any other tool call. The cron path is the only path. Manual admin-triggered ingest is exposed via the `ingest.trigger_manual` tool which inserts a `pipeline_jobs` row — that goes through the same dispatcher.
**Consequences:** ingesters can't be invoked from the frontend test suite directly; they're tested via stub upstreams in Python unit tests. Frontend tests assume opportunities exist via DB seed.

## D-Phase1-02: Shredder is dual-callable

**Status:** accepted
**Decision:** The shredder runs (a) as a pipeline worker on `released_for_analysis` events (full path: PDF download → text extraction → Claude → DB writes), AND (b) as a synchronous extractor invokable by the curation UI via the `compliance.extract_from_text` tool (text fragment → Claude → return suggestions, no DB writes). Both paths share the prompt files and the LLM client, but only the worker path persists.
**Rationale:** Humans need a fast "preview suggestions" loop in the workspace when they highlight a chunk of text. Agents (Phase 4) need a durable async path that retries on failure and writes to DB. Sharing the prompts ensures the human and the agent see the same extraction logic.
**Consequences:** the shredder module exposes two entry points (`runner.shred_solicitation` async + DB-writing, `sync_extract.extract_compliance_from_text` sync + return-only). The shredder MUST be tested via both entry points.

## D-Phase1-03: Curation is admin-scoped, not tenant-scoped

**Status:** accepted
**Decision:** `curated_solicitations`, `solicitation_compliance`, `solicitation_annotations`, and `triage_actions` are visible to all `rfp_admin` users regardless of tenant. The `tenant_id` column is null on these tables. Phase 1 tools that read or write these tables have `tenantScoped: false`.
**Rationale:** Opportunities are global — the same SAM.gov solicitation is the same solicitation for every customer. Curation work (compliance variable extraction, annotation, push) is performed by the platform team (`rfp_admin` role), not per-tenant. Only the customer-facing scoring + portal layers (Phase 2) become tenant-scoped, where each tenant gets a personalized opportunity feed sorted by their fit score.
**Consequences:** RLS (Row-Level Security) is NOT enforced on the curation tables. Access is gated entirely by the `rfp_admin` role check in middleware and tool authorization. Phase 2 customer portal tools will have `tenantScoped: true` and enforce per-tenant isolation when reading the SAME opportunity rows.

## D-Phase1-04: Memory namespace key format

**Status:** accepted
**Decision:** Cross-cycle memory keys use the format `{agency}:{program_office}:{type}:{phase}` (4 parts), with a 3-part variant `{agency}:{type}:{phase}` allowed for sources that don't expose a program office (NSF, NIH). Documented canonically in `docs/NAMESPACES.md` §"Memory namespace keys".
**Rationale:** The `(agency, program_office, type, phase)` tuple is the natural primary key for "this kind of solicitation" in the federal contracting world. Two AFWERX SBIR Phase I solicitations from different fiscal years are 90%+ similar in compliance requirements; using this as the namespace lets cross-cycle pre-fill work without ML.
**Consequences:** the key MUST be computed identically in Python (`pipeline/src/shredder/namespace.py compute_namespace_key`) and TypeScript (`frontend/lib/memory/agency-key.ts computeAgencyKey`). Cross-language drift is verified by `frontend/__tests__/lib/memory/cross-lang-agency-key.test.ts`.

## D-Phase1-05: Shredder prompts are versioned files

**Status:** accepted
**Decision:** Claude prompts live at `pipeline/src/shredder/prompts/v{N}/{name}.txt`. Each prompt has a version number that gets stamped into `system_events` payloads (`prompt_version: 1`) so future quality regressions can be attributed to specific prompt versions. New prompt versions ship as new files (`v2/section_extraction.txt`); the old version stays in git for comparison.
**Rationale:** Prompt drift is the #1 cause of LLM regression. Without versioning, a prompt change made for one solicitation type can silently degrade quality on a different type and we have no audit trail. Versioning is the only way to attribute regressions.
**Consequences:** every prompt change is a new file (additive), not an in-place edit. The golden fixture suite (`pipeline/src/shredder/golden_fixtures/`) is the regression canary that catches quality drops between versions.

## D-Phase1-06: Golden fixture suite is mandatory

**Status:** accepted
**Decision:** Phase 1 §D ships at least 5 real RFPs with hand-verified expected extractions in `pipeline/src/shredder/golden_fixtures/`. A regression test (`pipeline/tests/test_shredder_regression.py`) runs the shredder against them on every Phase 1 commit. Coverage matrix:
- 1 SAM.gov SBIR Phase I
- 1 SAM.gov SBIR Phase II
- 1 SBIR.gov Phase I (different source format)
- 1 Grants.gov NOFO
- 1 BAA (structurally different from SBIR)
**Rationale:** A free-form LLM extractor with no ground truth is a quality time bomb. The fixtures are the only signal that a prompt change didn't silently break something. Phase 4 agents will rely on the same fixtures for their training feedback loop.
**Consequences:** every Phase 1 PR that touches the shredder must pass the regression suite. The fixtures are checked into git (PDFs are public RFPs with no copyright concerns). When the suite fails, the PR is blocked until the prompt change is fixed or the expected JSON is updated to reflect a deliberate change.

## D-Phase1-07: State transitions are guarded by the tool, not the API route

**Status:** accepted
**Decision:** Every `solicitation.*` tool that mutates the `curated_solicitations.status` column runs an atomic UPDATE with a WHERE clause on the source state — no "select then update" race windows. The API route is a thin adapter and has zero state-machine logic. The state-machine table lives in `frontend/lib/curation/transitions.ts` and is the single source of truth.
**Rationale:** Two admins claiming the same solicitation at the same time is a real concurrency case. SELECT-then-UPDATE has a TOCTOU race window where both reads succeed before either UPDATE. Atomic UPDATE-WHERE is race-safe by construction. Putting the logic in the tool (not the route) means Phase 4 agents invoking the same tool get the same race safety automatically.
**Consequences:** Every state-changing tool tests the race case (two concurrent invocations) and the wrong-state case (invocation from a state that doesn't allow the transition). The universal state-machine matrix test in §I11 runs ~50 cases covering every (from_state, action) combination.

## D-Phase1-08: Migration 009 is additive only

**Status:** accepted
**Decision:** `db/migrations/009_phase1_curation_extensions.sql` adds columns + tables + indexes + constraints but NEVER drops or alters existing data. Idempotency is verified by applying twice against a throwaway PG16 — second apply must be a no-op (zero rows affected).
**Rationale:** The 0.5b debugging cycle had a `pipeline_schedules` migration that silently inserted duplicates because of an ON CONFLICT bug. The lesson: every migration is empirically verified idempotent before commit, not assumed from `IF NOT EXISTS` syntax.
**Consequences:** Phase 1 §B mini-TODO has explicit checkboxes B2 + B3 for the first-apply and second-apply tests against throwaway PG. Future Phase 2+ migrations follow the same pattern.

## D-Phase1-09: Two-admin requirement is enforced at the tool layer, not the data layer

**Status:** accepted
**Decision:** The curator-cannot-self-approve rule (`approved_by != curated_by`) is enforced inside the `solicitation.approve` tool via the WHERE clause `AND curated_by != ${ctx.actor.id}`, NOT via a CHECK constraint or trigger on the `curated_solicitations` table.
**Rationale:** The CHECK constraint approach would require the two columns to be NOT NULL when the constraint is checked, which conflicts with the natural lifecycle (curated_by is null until first edit, approved_by is null until approval). Trigger-based enforcement is harder to test and harder to reason about. Tool-layer enforcement is in the obvious place.
**Consequences:** if a future tool tries to UPDATE `curated_solicitations.status = 'approved'` directly (bypassing `solicitation.approve`), the rule isn't enforced. Mitigation: only `solicitation.approve` is allowed to write `status = 'approved'`, and this is verified by the universal state-machine matrix test in §I11.

## D-Phase1-11: DoW (Department of War) aliases to DOD in the memory namespace

**Status:** accepted
**Decision:** `shredder/namespace.py::_AGENCY_ALIASES` maps `Department of War`, `Dept of War`, and `DoW` to canonical `DOD`. The resulting memory namespace for post-rename solicitations is `DOD:...`, indistinguishable from pre-rename solicitations.
**Rationale:** DoW is the 2025-09 organizational rename of DoD. Compliance rules, proposal templates, and historical curation data are all continuous across the rename — segmenting the memory namespace would throw away a year of accumulated compliance knowledge for no benefit. The regression test fixture `dow_2026_sbir_baa` in `pipeline/src/shredder/golden_fixtures/` specifically guards this invariant: its `expected.json` expects namespace `DOD:unknown:SBIR:Phase1`, and the mock-mode regression test fails if the alias regresses.
**Consequences:** Future renames follow the same pattern — add aliases in `_AGENCY_ALIASES`, add a golden fixture covering the post-rename source, add a DECISIONS entry with rationale. If the rules DIVERGE post-rename (unlikely but possible), we'd open a new decision to split the namespace and migrate historical memory to the new key.

## D-Phase1-12: CSO solicitations use `:Open` phase, not `:Phase1`

**Status:** accepted
**Decision:** Commercial Solutions Opening (CSO) contract vehicles stamp their memory namespace with `phase=Open`, even when the underlying PDF is titled "Phase I CSO". The namespace for `af_x24_5_cso` is `USAF:unknown:CSO:Open`, not `USAF:unknown:CSO:Phase1`.
**Rationale:** CSO is a single-phase open call. It does not carry the Phase I → Phase II → Phase III funding-progression semantics that SBIR and STTR do. Using `:Open` for all CSOs means memory search across CSO solicitations from the same agency surfaces all relevant historical cycles without artificial phase segmentation. The "Phase I" label on some CSOs is boilerplate borrowed from the SBIR program, not a meaningful phase distinction.
**Consequences:** §H `memory.search_namespace` queries with prefix `USAF:unknown:CSO:` surface every AF CSO regardless of marketing label. Ingester logic does not need to parse "Phase I" out of CSO titles — the namespace module collapses CSO to `:Open` in `_normalize_phase`. If a CSO ever DOES carry multi-phase semantics (unlikely), we'd introduce a new program_type (`cso_phase_1` analogous to `sbir_phase_1`) rather than changing the namespace module.

## D-Phase1-13: Shredder token budget raised to 150K input tokens / ~$0.45 per run

**Status:** accepted
**Decision:** `shredder/runner.py::MAX_INPUT_TOKENS_PER_RUN = 150_000`. The pre-flight token estimate uses `chars/4 * 1.25`, not the original `chars/4 * 2`.
**Rationale:** Spec §D4 originally specified 50K input tokens, sized for typical per-topic SBIR proposals. Real DoD umbrella BAAs are 200K+ chars (capped by the extractor) of dense text — ~50K tokens per pass alone. With per-section compliance calls adding ~20% overhead, a realistic shredding run for a full DoD BAA is 60-100K tokens. 150K gives 1.5× headroom for edge cases without burning runaway cost (~$0.45 per run at Sonnet pricing). The old ×2 estimate multiplier was defensive but wildly inaccurate — per-section compliance calls ship only 500-char excerpts, not the whole doc, so real per-section token cost is ~1-2K tokens regardless of document size.
**Consequences:** Golden-fixture regression tests in `pipeline/tests/test_shredder_regression.py` now pass against real 200K-char DoD BAA extractions. If future spec work requires running against even larger docs (Component Instruction Appendices — 500K+ chars), we'd consider either (a) pre-slicing the doc to procedural sections only before section extraction, or (b) using Haiku for section extraction + Sonnet only for compliance. Re-evaluate if/when we start seeing `budget_exceeded` events in prod.

## D-Phase1-10: Phase 1 e2e is the tag gate

**Status:** accepted
**Decision:** Phase 1 cannot be tagged `v1.0-curation-complete` until `frontend/__tests__/scenarios/phase-1-full-curation-e2e.test.ts` (§J1) passes against the throwaway PG. The test walks ingest → triage → claim → release → shred → curate → review (by a second admin) → approve → push and asserts every state transition + every event emission.
**Rationale:** Section-by-section tests catch unit bugs; the e2e catches integration bugs where two correct sections disagree on a contract. The 0.5b login disaster was an integration bug that no unit test would have caught. Phase 1 closes with a real e2e gate.
**Consequences:** Phase 2 cannot start until the §J e2e is green. Anyone who proposes to skip §J for "we'll add it later" should be reminded that the 0.5b login flow took ~2 days to debug because there was no e2e gate.
