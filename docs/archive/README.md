# docs/archive — historical documents (NOT current truth)

Everything in this folder is **superseded, dated, or a completed-phase artifact**. It is kept for
provenance only. **Do not treat anything here as the current design.** If a live doc links here, it is
citing history.

## Where current truth lives
| Topic | Canonical doc (in `docs/` or repo root) |
|---|---|
| Engineering SOPs / bug-classes | `CLAUDE.md` · `CLAUDE_CLIFFNOTES.md` |
| As-built architecture | `ARCHITECTURE_V10.md` (+ `ARCHITECTURE_V9.md` for the retained core / namespace §8) |
| OPP → purchase → build flow | `docs/MASTER_MIRROR_OPP_DESIGN.md` |
| Automation engine + policy (#190) | `docs/AUTOMATION_SPINE_MAP.md` · `docs/AUTOMATION_DESIGN.md` · `docs/AUTOMATION_POLICY_DESIGN.md` |
| Agent workforce | `docs/AGENT_WORKFORCE.md` · `docs/AGENT_FABRIC_DESIGN.md` |
| Identity | `docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md` · `docs/IDENTITY_AUTHZ_MODEL.md` |
| Events / security / monitoring | `docs/EVENT_CONTRACT_V3.md` · `docs/SECURITY_AND_SAFETY.md` · `docs/RATE_MONITORING.md` |
| Dev process | `docs/DEVELOPMENT_STANDARDS.md` · `docs/TESTING_STRATEGY.md` · `docs/DEFINITION_OF_DONE.md` |
| Continuity ("start here") | `docs/CONTINUATION.md` |
| DB schema | `db/migrations/` (source of truth) + `CLAUDE_CLIFFNOTES.md §1` |

## The 2026-07-22 archive sweep
Migration head 125. After the doc refresh, ~76 documents were moved here in one pass. The rule applied
(same as the table-drop rule): **archive a doc when it is superseded-by-a-successor OR a dated
point-in-time snapshot OR a completed-phase plan/TODO** — keep only what is currently true. Categories:

- **Superseded architecture** — `ARCHITECTURE_V7/V8`, `ARCHITECTURE_DAY365`, the `V1_*_ARCHITECTURE` /
  `V1_*_DESIGN` set, `ALPHA_ARCHITECTURE_ASBUILT`, the two `OPPORTUNITY_CARD_*_2026-07-01` origin designs.
- **Old agent docs** — `AGENT_ROADMAP` (roadmap fully executed → 25 archetypes), `AGENT_FRAMEWORK`,
  `AGENT_ORG_WORKFORCE`, and `agent-fabric/{00,01,02,04,05,06,08}` (kept `03-MEMORY`, `07-COST` — still cited).
- **Dated audits / sweeps / reviews** — `AUDIT_PRELAUNCH_*`, `CODE_REVIEW_V1`, `BUG_EXTERMINATION_REPORT`,
  `*_SWEEP_*`, `HITL_WIRING_AUDIT_2026-07-03`, `END_TO_END_SPINE_ANALYSIS_*`, `*_GAP_*`, etc.
- **Dated plans / sprints / TODOs / status** — `MVP_DEVELOPMENT_PLAN`, the `V1_*_TODO` / `V1_TASKING`
  cluster, `*_SPRINT`, `PLAN_*`, `TODO`, `HITL_TODO`, `PROPOSAL_LIFECYCLE_TODO`, `SYSTEM_STATUS_*`,
  `LIBRARY_CONVERGENCE_STATUS_*`, `ALPHA_TODO_BACKLOG`, the whole `baseline/` recon set.
- **Superseded launch-readiness** — `LAUNCH_READINESS_REVIEW` (root), `LAUNCH_READINESS_ANALYSIS`,
  `LAUNCH_READINESS_{AND_10DAY,ZERODAY}_*`, `V1_LAUNCH_READINESS` (current: `LAUNCH_READINESS_2026-07-22`).
- **Superseded HITL / handoff / working-state** — `HITL_TEST_PLAN*`, `SESSION_HANDOFF_NEXT`,
  `WORKING_STATE_*`, `CUSTOMER_PURCHASE_TO_V1_FLOW`, `HITL_WIRING_AUDIT_RUNBOOK`, `MONDAY_RUNBOOK`.
- **Stale references** — `DB_SCHEMAS` (frozen at mig 108 → `db/migrations/`), `API_REFERENCE`
  (stale route table), `DOCUMENT_BUILDER_GUIDE` (→ `docs/user-guides/documents.md`).

Live docs that linked to any moved file were repointed to `docs/archive/…` in the same commit, so nothing
in the current set has a dangling reference.
