# Agent Roadmap — the next batches (master-side, onboarding, tenant-side)

**Companion to `docs/AGENT_WORKFORCE.md`** (the as-built 10-archetype workforce, #117 complete).
This doc is the forward plan: the **master-side (RFP-admin) agents**, a **new-customer onboarding**
agent, and the **additional tenant-side** agents that make sense — analyzed against the current
architecture so each one is an *integration*, not a reinvention.

---

## 0. The organizing spine: master → bridge → mirror

The current 10 agents almost all live on the **tenant (mirror)** side — they work a company's proposal
after an opportunity has already been curated, pushed, and provisioned. The next batch fills the **master
(platform) side** and the **seam** between them:

```
 EXTERNAL SOURCES                    OUR SCOPE (platform / RFP-admin)                 FORWARD-ONLY BRIDGE        TENANT (mirror)
 SAM/SBIR/STTR/BAA  ─▶  [Scout] ─▶ opportunities(triage)                                    │
                                       │                                                    │
   raw solicitation ─▶ [Ingest] ─▶ curated_solicitations.ai_extracted                       │
                                       │                                                    │
                            [Matrix Stager] ─▶ master proposal_compliance_matrix / molds    │
                                       │                                                    │
                          [Skeleton Builder] ─▶ master volumes/sections/templates           │
                                       │                                                    │
                admin approval ─▶ solicitation.push ═══════════════════════════════════════▶ tenant_opportunity_cards
                                                                                            │  (the 10 tenant agents
                       new customer ─▶ [Onboarding Concierge] (at provision/first-login) ───┤   work the mirror here)
```

- **Master-side agents are PLATFORM-SCOPE** — they run at *our* authority on the master
  `opportunities` / `curated_solicitations` / master matrix + molds, **before** the bridge fan-out.
  They are **NOT tenant-bound** (no tenant to bind to yet), so §3 tenant-discretion doesn't apply — but
  they still ingest **untrusted external solicitation text**, so the **injection fence is mandatory**, and
  they still run under the fabric's runaway/dead-end caps.
- **The tenant agents (already built)** work each company's mirror after the push.
- **Onboarding Concierge** sits on the seam: it cold-starts a tenant so the mirror agents have grounding
  (profile + buckets + first atoms) the moment a portal is released.

This is the coherent story for marketing and for engineering: **"agents build the master, the bridge fans
it, agents work the mirror."**

---

## 1. Batch A — Master-side (RFP-admin) agents

These four form the **admin ingestion pipeline** (the counterpart to the tenant build loop). Each maps to an
existing workflow/route so wiring is a producer or `AI_INVOKE` step, same two-move pattern as #117.

| Agent | Scope | Job | Tools (registry) | Trigger / site | Lands into | Dedup vs existing |
|---|---|---|---|---|---|---|
| **Opportunity Scout** (`opportunity_scout`) | platform | Search/poll external sources, classify & prioritize what the scout **workers** surface, dedupe against `opportunities`, draft a triage recommendation (pursue-worthy? which buckets/agencies?). | `source.fetch`, `opportunity.dedupe_check`, `opportunity.create` (triage state), `memory.search` | scheduled cron worker + `on_source_change_detected` / `on_opportunities_detected` | `opportunities` (triage) + a triage ToDo for the admin | Sits **on top of** the existing scout worker pool (#103) — workers fetch, the agent *judges*. |
| **Solicitation Ingest Analyst** (`ingest_analyst`) | platform | Parse a raw solicitation (PDF/URL) → structured fields (agency, program, deadlines, NAICS, set-aside, requirements, eval criteria, volume structure) → the curation draft. | `document.fetch`, `solicitation.extract_fields`, `solicitation.write_curated` | `on_rfp_uploaded` (`AI_INVOKE`) | `curated_solicitations.ai_extracted` | Formalizes/hardens the existing OPP ingestor (#16) as a governed agent with the fence + caps. |
| **Matrix Stager** (`matrix_stager`) | platform | From the curated solicitation, derive the **compliance matrix**: requirements → rows (item, page limit, format, volume, required forms). Builds the **master** matrix that instantiates per tenant at provision. | `solicitation.get_curated`, `matrix.upsert_item`, `mold.write` | after ingest, in the admin **curation** workflow (`AI_INVOKE`) | master `proposal_compliance_matrix` / molds | Automates the manual matrix staging (#15/#59) — advisory rows the admin confirms. |
| **Skeleton Builder** (`skeleton_architect`) | platform | From the matrix, build the **master response skeleton** (volumes → sections → template assignment + page budgets) that becomes each tenant's starting structure. | `matrix.get`, `template.match`, `skeleton.write_mold` | admin curation workflow, after Matrix Stager (`AI_INVOKE`, depends_on matrix) | master molds/outline | **Master** counterpart to the tenant `proposal_architect` (which *adapts* this skeleton per company). Clear division: builder makes the master; architect tailors the mirror. |

**Landing (§7 applies, admin-flavored):** master-side output is still **advisory → review**. It lands into an
**RFP-admin curation review queue** (not a tenant queue), gated in the curation workspace. The admin
confirms/edits before `solicitation.push`. Guardrails: schema-valid extraction, page budgets sum within
limits, every requirement mapped (reuse the architect guardrails).

**Chained as a pipeline** (this is the admin build loop):
`on_rfp_uploaded → ingest_analyst → matrix_stager → skeleton_architect → [admin review] → push`.
Each step independent/safe-skip so a failure degrades to manual curation (never dead-ends the admin flow).

---

## 2. Batch B — New-customer onboarding

| Agent | Scope | Job | Tools | Trigger | Lands into |
|---|---|---|---|---|---|
| **Onboarding Concierge** (`onboarding_agent`) | **tenant** (bound at provision) | Cold-start a new tenant so the mirror agents are immediately effective: build the initial **tenant profile** (from purchase context, website, first upload), **seed spotlight buckets**, kick the **first atomize** of any uploaded past performance, and generate a **"getting started" ToDo plan**. | `tenant.write_profile`, `bucket.seed`, `library.request_atomize`, `todo.create` | `identity.purchase.completed` / portal **release**+provision / first login (`AI_INVOKE` in the release/provision workflow) | `tenant_profiles`, `tenant_spotlight_buckets`, `agent_task_queue` (atomize), tenant ToDos |

**Why it matters:** the tenant agents (scoring, analyst, capture, architect, librarian) are only as good as the
tenant's **profile + atoms + buckets**. Today those start empty and fill manually. The Concierge makes the
workforce *useful on day one* — it's the highest-leverage single addition. **Tenant-bound** (§3 fully applies:
no `tenant_id` in schemas, bound at provision). Injection-fenced (their website/upload is untrusted).

---

## 3. Batch C — Additional tenant-side agents (ranked by leverage)

| Agent | Scope | Job | Trigger | Notes / dedup |
|---|---|---|---|---|
| **Amendment Watcher** (`amendment_monitor`) | tenant + platform | After a tenant is pursuing, watch for **solicitation amendments / Q&A**; alert + run a **compliance delta** (what changed in the matrix) and flag affected sections. | `source.change_detected` on a pursued solicitation | **High value** — amendments silently change requirements mid-build. Reuses the scout/source-watch infra; lands a ToDo + matrix delta. |
| **Outcome / Debrief Analyst** (`outcome_analyst`) | tenant | On award/loss, analyze the outcome, write **win/loss episodic memory**, and feed **scoring calibration** (so scoring_strategist gets smarter per tenant). | `on_proposal_outcome_recorded` (**workflow already exists**) | Closes the **learning loop**. Cheapest to wire — the trigger workflow is already there; just add the `AI_INVOKE` actor. |
| **Cost / Pricing Strategist** (`cost_estimator`) | tenant | Draft the **cost volume / budget narrative** from the ceiling, labor categories & the tenant's rates; flag **cost-realism** issues. | cost artifact provisioned / on-demand | Complements `capture_strategist` (win themes) with the **money** side. Grounds on the tenant's cost atoms. |
| **Past-Performance Matcher** (`pp_matcher`) | tenant | Surface the tenant's most relevant **past-performance atoms** for an opportunity, draft the PP volume, and flag **gaps** (→ feeds `partner_coordinator` for teaming). | proposal created / on-demand | Could start as a *skill* of `opportunity_analyst`; promote to its own agent if the PP-volume drafting warrants it. **Watch for overlap** — decide fold-in vs standalone before building. |

**Explicitly NOT a new agent (fold in):** a "final compliance auditor" — that is already the
`packaging_specialist`'s job (final package review). Extend it rather than duplicate.

---

## 4. Sequencing recommendation

1. **Foundation first (blocks trust-to-auto-land):** the two §7 items in `AGENT_WORKFORCE.md` — the
   `NOBYPASSRLS` agent DB role + central `app.tenant_id`, and the guardrail-gated landing helper. Do these
   **before** any agent auto-writes tenant tables.
2. **Onboarding Concierge (Batch B)** — highest single-agent leverage; makes the 10 we just woke actually
   effective on day one.
3. **Master pipeline (Batch A)** — scout → ingest → matrix stager → skeleton builder, wired as the admin
   build loop. Biggest surface, but each step is the same producer/`AI_INVOKE` move.
4. **Outcome Analyst then Amendment Watcher (Batch C)** — cheapest first (the outcome workflow already
   exists), then amendment monitoring on the scout infra. Cost/PP agents last (or fold PP into the analyst).

**Every new agent still satisfies the §8 runtime safety contract:** injection-fenced, runaway-capped,
never dead-ends, tenant-discretion (for tenant-scope) / admin-review-gated (for platform-scope),
guardrail-gated landing. Master-side agents skip tenant-discretion (no tenant) but **keep the fence** —
they read the most untrusted text in the system (raw external solicitations).

---

## 5. One-line capsules (for planning tickets)

- **opportunity_scout** — platform; judge+prioritize+dedupe what scout workers find → triage.
- **ingest_analyst** — platform; raw solicitation → structured `curated_solicitations.ai_extracted`.
- **matrix_stager** — platform; curated solicitation → master compliance matrix rows/molds.
- **skeleton_architect** — platform; matrix → master volumes/sections/templates (tenant architect tailors it).
- **onboarding_agent** — tenant; cold-start profile + buckets + first atomize + getting-started ToDos.
- **amendment_monitor** — tenant/platform; watch amendments → compliance delta + alerts.
- **outcome_analyst** — tenant; award/loss → win/loss memory → scoring calibration (workflow exists).
- **cost_estimator** — tenant; draft cost volume + cost-realism flags.
- **pp_matcher** — tenant; PP-volume drafting + teaming-gap flags (consider folding into the analyst).
