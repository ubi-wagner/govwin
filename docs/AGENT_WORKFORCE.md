# The Agent Workforce — wiring, oversight, tenant-discretion (#117)

**Audience:** RFP-admin ops (setup + monitoring), engineering (wiring), marketing (how to talk about it).
**As-built:** the pipeline `AgentFabric` registers **10 archetypes**. This doc is the pattern for
waking the dormant ones, the tenant-isolation rules they run under, and the RFP-admin oversight surface.

---

## 1. The workforce (what the agents are)

Ten specialist AI agents, each a role with its own prompt, tools, and trigger:

| Agent | Scope | Wakes on | Status | What it does |
|---|---|---|---|---|
| **Section Drafter** | tenant | Section draft requested (build) | live | Drafts a section grounded on the tenant's library atoms. |
| **Compliance Reviewer** | tenant | Compliance check (inline) | live | Checks a draft against the compliance matrix. |
| **Color Team Reviewer** | tenant | Review requested (advance) | live | Red/gold-team review before a stage advance. |
| **Librarian** | tenant | Package atomized / document locked | **wired (#117)** | Catalogs, scores, dedupes & assesses freshness of new atoms. |
| **Scoring Strategist** | tenant | Opportunity card pushed | dormant | Scores & ranks opportunities into the tenant's buckets. |
| **Opportunity Analyst** | tenant | Opportunity card pushed | dormant | Assesses fit of a new opportunity for the tenant. |
| **Proposal Architect** | tenant | Proposal provisioned | dormant | Shapes the response skeleton from the solicitation. |
| **Packaging Specialist** | tenant | All sections locked | dormant | Assembles & formats the final submission package. |
| **Capture Strategist** | tenant | Portal purchased | dormant | Drafts a capture/win strategy for the pursuit. |
| **Partner Coordinator** | tenant | Collaborator invited | dormant | Coordinates teaming partners & their sections. |

---

## 2. The wiring pattern (integration, not reinvention)

Waking an archetype is two moves — the capabilities already exist as tools:

1. **Realign the archetype to the current spine.** The dormant agents were written against the
   retired `library_units` model. Greenfield them onto `library_atoms` + `atom_tags` (the taxonomy),
   `proposal_sections`, `tenant_opportunity_cards`, `tenant_bucket_scores`. Memory is plain DB text
   (`episodic_memories`, ILIKE) + S3 as needed — **no vector search** for cataloging/patterning.
2. **Wire the producer.** Enqueue the agent's task at the lifecycle point with
   `requestAgentTask({ tenantId, agentRole, taskType, input })` (`frontend/lib/agent-client.ts` →
   `agent_task_queue`). The pipeline's `process_task_queue` dequeues and runs it. (The live
   `section_drafter` is invoked directly by its workflow; `color_team` and the rest use the queue.)

**Reference implementation:** the **Librarian** (`pipeline/src/agents/archetypes/librarian.py`) — modern
`library_atoms`/`atom_tags` tools (SQL verified against the live schema), producer in the
atomize-package route, wiring proven by `pipeline/tests/test_librarian_wiring.py` (7/7). The agent's
LLM reasoning runs live on deploy (Railway key); in-sandbox we verify routing + producer + tool SQL.

**Tools go through the canonical registry.** Agent actions map to the frontend tool registry
(`POST /api/tools/:name` — `library.save_atom`, `proposal.draft_section`, `solicitation.*`, …), which is
role-scoped, tenant-scoped, and audited (one `tool.invoke.start`/`end` per call).

---

## 3. Tenant-discretion (the isolation rule) — non-negotiable

**Platform-scope agents** (ingest, triage, scouting) run at our scope. **Tenant-space agents** (Librarian,
Section Drafter, …) are **role-bound to their assigned tenant — tenant_user authority, nothing more.**

- The agent's `tenant_id` is fixed by the **trusted task context** (the `agent_task_queue` row the
  frontend enqueues), **never chosen by the model**.
- The model-facing tool schemas expose **no `tenant_id`** field, so the LLM literally cannot reference
  another tenant (locked by a test in `test_librarian_wiring.py`).
- Every query is tenant-scoped; the agent can't do admin-only things (force-advance, curation, cross-tenant).

---

## 4. The bridge invariant (forward-only data; bidirectional control)

Agent oversight is part of the **master + mirror forward-only bridge** (see
`docs/MASTER_MIRROR_OPP_DESIGN.md`):

- **Info conveyed forward only.** Usage **metadata** (counts, status, timing) rolls up to the RFP admin
  for oversight — **never tenant content**.
- **Control is bidirectional.** The admin can tune or pause an agent (down); usage flows up.
- **Tenant data stays in the tenant.** To inspect an agent's actual **output** for a company, the admin
  **descends into its RLS space (shadow)** — the only backflow. The rollup query selects **aggregate
  counts only**, never content.

---

## 5. RFP-admin oversight (Admin → System → Agents)

`/admin/agents` → **Agent Workforce**:

- **Roster** — every agent with scope (🔒 tenant-bound vs platform), trigger, live/wired/dormant status,
  and 30-day queue stats (pending·running·done·failed + last run).
- **Usage by tenant** — per-company totals (agents used, runs, done, active, failed, last activity) — who
  is working the agents and where failures cluster.

![Agent Workforce roster](./user-guides/img/admin-agent-workforce.png)
![Usage by tenant rollup](./user-guides/img/admin-agent-usage-by-tenant.png)

**Tuning (next increment).** Prompts, guardrails, and model per archetype live in the pipeline and are
surfaced here for oversight; an inline per-agent tuning editor (edit prompt/guardrails/model, pause) is the
next build, gated to rfp_admin — the "bidirectional control" leg.

---

## 6. Continuation — the other six agents (apply §2)

Each: realign to the spine, enqueue at the producer site. All tenant-scoped ⇒ tenant-bound (§3).

| Agent | Producer site (enqueue `requestAgentTask`) | taskType | Modern tools |
|---|---|---|---|
| **scoring_strategist** | card push / spotlight scoring (`solicitation.push` fan-out; `tenant_opportunity_cards` insert) | `score` | read cards + `tenant_bucket_scores`/`tenant_spotlight_buckets`; write scores |
| **opportunity_analyst** | card push (per tenant) | `analyze_fit` | read card + tenant profile (library dist + proposal focus); emit fit assessment |
| **proposal_architect** | proposal provision (`proposals/create`) | `architect` | read solicitation volumes/matrix; propose skeleton (→ `volume.add_required_item`) |
| **packaging_specialist** | all sections locked (proposal lock roll-up) | `assemble` | read locked sections; assemble/export (artifact-export) |
| **capture_strategist** | portal purchased (`proposal_portals` curation_pending) | `capture_plan` | read opp + tenant profile; draft capture plan (memory) |
| **partner_coordinator** | collaborator invited (`proposals/[id]/collaborators` POST) | `coordinate` | read collaborators + stage access; coordinate sections |

Verify each like the Librarian: a `test_<agent>_wiring.py` (registered, handles trigger, modern tools, tool
schemas expose no `tenant_id`) + the producer enqueue. LLM reasoning runs live on deploy.
