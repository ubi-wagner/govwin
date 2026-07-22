# End-to-End Alignment Sweep — Session Close-Out

**Date:** 2026-06-24 · **Branch:** `claude/nice-hamilton-kBqtD`
**Scope:** the new code introduced this session (agent-pipeline wiring, migrations 065–070, context-binding/embeddings, M1–M3, the launch fix-pass) audited for **alignment**, not just unit-correctness, across four dimensions.

**Method:** four parallel read-only audits (automation pipeline · API-AGENT-Tool architecture · schema/CRUD · UI-UX completeness), each cross-referencing the new code against `ARCHITECTURE_V9` + the baseline inventories. The sweep caught real integration bugs that `tsc`/`lint`/mocked-tests structurally cannot (runtime-only, DB-shape, cross-service).

---

## 1. Fixes applied (this commit)

| Sev | Finding | Fix |
|-----|---------|-----|
| **P0** | **Migration 070 (`proposal_sections.content` TEXT→JSONB) breaks ~15 readers** across frontend + pipeline (`JSON.parse(content)`, `content.length`, `content[:N]`, `json.loads`) — postgres.js/asyncpg return JSONB as a parsed object, not a string. Crashes save/compliance/package/review + the agent context-binding. | **Reverted:** deleted `070`, added **`071`** → `content` back to `TEXT` (USING content::text, safe whether or not 070 ran). All 15 readers work as-is. FE-20 (JSONB semantics) re-filed: requires updating every reader first. |
| **P1** | **Migration 069 namespace CHECK could fail the deploy** — `ADD CONSTRAINT` scans existing rows; any legacy/dev row with a non-canonical namespace aborts the migration. | `069` now adds the CHECK **`NOT VALID`** (enforces new inserts, doesn't scan legacy data). |
| **P1** | **`POST /api/events` passes raw `body.namespace`** to the INSERT with no allowlist → raw CHECK violation (500) after 069. | Added a 7-namespace allowlist → clean **422** (`frontend/app/api/events/route.ts`). |
| **P1** | **`memory.py::write_procedural` INSERT names non-existent columns** `confidence` + `last_accessed` → fails at runtime against real Postgres (mocked tests missed it). | `confidence`→`success_rate`; removed `last_accessed` (and its placeholder). |
| **P2** | Dead `import asyncio` in `embeddings.py::_embed_openai`. | Removed. |
| **P2 (doc)** | `ARCHITECTURE_V9 §4.5` said "32 tools", listed 3 phantom tools, misnamed `source-scout`. | Corrected to 33; removed phantoms; `finder.scout_source`; pointer to `lib/tools/index.ts`. |

---

## 2. Verified aligned (no change needed)

- **Removed routes (FE-14/16/19):** zero dangling UI fetches; nav-link consolidation renders for both admin + portal layouts.
- **Automation:** AI_INVOKE→archetype map resolves (all 10 archetypes registered); only one AI_INVOKE step exists and maps correctly; no `finder:topics.expanded` double-emit; both new workflows discovered + `validate()`; consumer gathered with fabric.
- **API-AGENT-Tool:** ToolRegistry enforces role→allowlist→tenant(from context)→schema; 8 spot-checked routes honor `{data}`/`{error,code}` auth-first; all 33 frontend tools resolve; invite event-type fix confirmed.
- **Schema/CRUD:** migrations 065/066/067/068 clean; all `context.py` context-binding columns valid (proposal_sections, solicitation_compliance, `ai_extracted`, library_units); embeddings `vector(1536)` + `<=>` cosine all schema-valid; runtime emitters all use the 7 canonical namespaces.
- **UI-UX:** AI **Draft** + AI **Compliance** complete end-to-end (synchronous, rendered inline); M1 import-topics, M2 triage ToDos, M3 Spotlight scoring all complete.

---

## 3. Documented follow-ups (not launch-blocking)

| Item | Why deferred | Where it belongs |
|------|--------------|------------------|
| **AI Review output surfacing** — the "Run AI Review" button requests a review but `color_team_reviewer` output lands in `agent_task_results` with **no UI reader** (`getAgentTaskResult` exists, unused). User sees "requested" then nothing. | This is the *autonomous-agent UI layer*; the synchronous Draft/Compliance already serve users. Needs a tenant-isolated `GET …/agent-results` route + a polling panel. | HITL plan VH-20; build as next increment. |
| **PIPE-15 `section.saved` enrichment** — DiffAnalyzer runs on empty diffs because the event lacks the before/after content. | Correct fix is to have `analyze_section_diff` read the last two `canvas_versions` snapshots (keeps the event bus light) — a small follow-up, and it's the advisory *learning flywheel*, not user-facing. | HITL plan VH-22. |
| `ingest/base.py::_emit_event` unconstrained `namespace` param (latent); `event_listener.py` dead `trigger_bus` branch + test (post-068); migration 019 `trigger_namespace='identity'` for capture events. | All P2, no runtime impact today. | Cleanup backlog. |

---

## 4. Net launch posture

The session's new code is **aligned and deploy-safe** after the fixes above: the two deploy-blockers (070 column break, 069 migration abort) are resolved, the one runtime DB bug (`write_procedural`) is fixed, and the agent pipeline is wired + context-bound + injection-hardened + tenant-isolated with advisory output. Remaining items are documented follow-ups (the autonomous-agent UI + learning-loop enrichment), to be validated/built post-deploy — consistent with the HITL plan's verify-on-deploy list.
