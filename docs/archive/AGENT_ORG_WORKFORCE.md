# Our-Org Agent Workforce — RFP-Pipeline's own agents (POD 1–4)

**Companion to `docs/AGENT_WORKFORCE.md`** (customer + master workforce) and `docs/AGENT_ROADMAP.md`.
Those agents serve the *customers'* proposals and the *master* ingestion pipeline. This doc is the
**our-org** workforce — agents that run **RFP Pipeline the business** (market → sell → onboard →
support → operate), at **our authority** (master_admin / rfp_admin), mostly on the CMS + admin
surface. **POD 4 (RFP-admin ops) and the CMS content pod are built, plus the scout expansion +
crawl infrastructure.** The fabric now registers **24 archetypes across 4 pods**.

![Agent Workforce roster — 24 archetypes across 4 pods](./agent-workforce/img/org-workforce-roster.png)

---

## The admin-side automation pattern (why POD 4 needed NEW workflows)

Most of our automation workflows are **tenant-side** — they fire on proposal lifecycle events
(`proposal.created`, `proposal.advanced`, `collaborator.invited`, …). The **admin/ops side** had far
fewer. POD 4 deliberately adds admin-side automation, and it surfaced the two workflow *shapes* we were
missing:

1. **Event-with-condition on an existing admin event** (no new emit needed).
   `curation_qa` fires on the EXISTING `finder:solicitation.triaged` event, gated by
   `condition: toState == "review_requested"` — i.e. only the *request_review* transition (curation
   done, pre-push). This is the cheapest way to add an admin gate: find the state-machine event that
   already fires and attach a conditional workflow.
2. **Scheduled (cron-shaped) trigger** — on the SHARED cron manager.
   The workflow engine is **event-only** (`EventTrigger` = namespace/type/phase, no cron), so scheduled
   work rides the existing cron: a `run_type='event'` row in **`pipeline_schedules`** (source
   `namespace:type`) is ticked by **`ingest.dispatcher.tick_schedules`**, which emits the `system_event`
   → the normal event→workflow→agent path runs it. One time manager, one event bus, one audit — no
   bespoke scheduler. **UTC canonical** end-to-end (schedules, cron math, audit — microsecond precise);
   each admin picks a **display timezone** (`users.timezone`) the UI renders in. Scheduled triggers are
   `phase='single'` forward-only postings, so audit + actions stay in sync by construction. Adding a new
   scheduled agent (ops digest, update-scan, content resurface, social, a future mailing-list scout) is a
   single `pipeline_schedules` row.

Both keep every #117/#120 invariant: advisory → guardrail → land-or-review, injection fence where any
untrusted text is read, runaway caps, and **independent** steps so a failed/skipped agent never
dead-ends the admin flow.

---

## POD 4 — RFP-Admin Ops (BUILT)

| Agent | Scope | Job | Trigger → workflow | Lands as |
|---|---|---|---|---|
| **curation_qa** | platform | Pre-release QC of a curated solicitation: completeness, compliance-matrix + master-skeleton sanity, customer-readiness | `finder:solicitation.triaged` (toState=review_requested) → **`OnSolicitationReviewRequested`** | advisory QA report → reviewer (notify) before push |
| **ops_digest** | platform | Scheduled health digest: workforce usage, pipeline health, SLA breaches, alerts | `system:ops.digest_requested` (scheduler) → **`OnOpsDigestRequested`** | advisory digest → NOTIFY master_admin |

Both are **platform-scope** (our-org QC / ops), so they read master + cross-tenant aggregates at our
authority. Per the #120 fabric rule, platform-scope agents (tenant_id=None) run on the **bypass**
connection — NOT the NOBYPASS agent pool — because an empty `app.tenant_id` would make RLS deny the
cross-tenant rows `ops_digest` legitimately needs. `curation_qa` keeps the injection fence (raw
solicitation text); `ops_digest` reads AGGREGATE COUNTS only (no untrusted free text → no injection
surface).

### Admin considerations

- **Oversight:** both appear in `/admin/agents` → **Agent Workforce**, under the *Our-org — RFP-admin
  ops* pod (roster + live queue stats + per-tenant rollup). The roster is the tuning/monitoring surface.
- **Curation QA gate routing:** the QA report is **advisory** — it never changes status or pushes. When
  an admin submits curation for review, the reviewer gets a `curation_qa_ready` notification and reviews
  the findings before approving/returning/pushing. If the agent is unavailable, the review still proceeds
  (independent notify).
- **Ops digest delivery + tuning:** delivered to **master_admin** via `ops_digest_ready`. Cadence is
  tunable with the **`OPS_DIGEST_INTERVAL_HOURS`** env (default 24h, floored at 5 min); the scheduler
  sleeps the interval first, so a deploy restart never triggers a digest storm. Single-replica assumption
  (the processor dedups by trigger_event_id).
- **Updating a POD-4 agent:** prompt/guardrail/model live per-archetype in the pipeline
  (`pipeline/src/agents/archetypes/{curation_qa,ops_digest}.py`); the roster surfaces them for oversight,
  and the per-agent tuning editor (edit prompt/guardrails/model, pause) is the shared next increment.

---

## CMS content pod (BUILT) — find-to-repost + generate + schedule

CMS (not CRM): our own web + social content, all on `content_pages` (in govtech_intel) + the crawl
findings store. All platform-scope, all **advisory → human-approve-before-publish** (brand-voice +
no-fabricated-claims). The scheduled ones email the curated output to the team inbox
(`eric@rfppipeline.com`) via an independent NOTIFY.

| Agent | Job | Trigger → workflow |
|---|---|---|
| **content_generator** | Draft NEW web/social copy from a brief, in our published voice | `library:content.requested` → `AI_INVOKE` in `OnCmsContentRequested` |
| **content_curator** | The social/web content SCOUT: curate the crawler's findings into repost drafts (w/ attribution) | `library:content.resurface_requested` (scheduled) → `OnContentResurfaceRequested` |
| **social_scheduler** | PUBLISHER: draft a week of social posts from published content | `system:social.schedule_requested` (scheduled) → `OnSocialScheduleRequested` |

## Scout expansion (BUILT) — better find / analyze / look-for-updates

- **opportunity_scout** now reads BOTH the ingested triage queue AND the crawler's opportunity findings
  (`scout_findings`), analyzes deeper (agency/program/set-aside), and flags **possible updates/amendments**
  so the admin re-checks compliance instead of double-curating.
- **`OnSolicitationUpdateScan`** (scheduled, every 6h) — a proactive WATCHER loop that re-scans for
  compliance-affecting amendments by **reusing the `amendment_monitor` agent** (no new archetype). The
  proactive counterpart to the reactive `OnSourceChangeDetected → amendment_monitor` path.

## Crawl architecture (anticipated) — sources → findings → agents, with history + outcomes

The content_curator and opportunity_scout consume what a **crawler worker** discovers — the content/
opportunity analog of how the ingesters populate `opportunities`:

- **`scout_sources`** — the crawl targets (org websites / social handles / RSS, `purpose` = content /
  opportunity / both; `enabled` + optional per-source cron). An admin adds + enables sources.
- **`scout_findings`** — candidate items the crawler writes (title/url/snippet/author), deduped by
  `dedup_hash` (idempotent re-crawls). Each finding carries an **OUTCOME**: new → reviewed →
  reposted/pursued/dismissed.
- **`scout_runs`** — uniform RUN HISTORY for **scouts, watchers, and publishers** (role + kind + counts +
  outcome + timings). One model for all three: "scouts have history and outcomes, and so do publishers
  and watchers."
- **`workers/content_crawler.py`** — reads enabled sources, fetches via a **pluggable fetcher**, upserts
  findings + logs a `scout_runs` row. The fetcher is injected: on deploy it is an RSS/HTML/social fetcher
  (outbound HTTPS via the agent proxy, robots + rate-limit aware); in tests it's a stub, so the DB
  write/dedup/history loop is verified without network. Runs on the shared cron via a scheduled crawl
  event + an ACTION step. New source kinds (a **mailing-list scout**) are a new fetcher, not a new pipeline.

## Still forward (CS / Sales) — descoped this run

Per direction (CMS-first, not CRM), the Customer-Success and Sales agents (`activation_watcher`,
`support_triage`, `lead_qualifier`, `nurture_drafter`) are the remaining forward plan, on the same
architecture.

---

## Verify

```
cd pipeline/src && PYTHONPATH=. python3 -m pytest ../tests/test_pod4_wiring.py ../tests/test_cms_agents_wiring.py \
  ../tests/test_scout_expansion_wiring.py ../tests/test_content_crawler.py ../tests/test_agents.py \
  ../tests/test_cron_next_run.py -q
```
Drive-tested end-to-end: `tick_schedules` emits `system:ops.digest_requested` (actor=cron) and advances
`next_run` from the cron (UTC); the crawler writes deduped `scout_findings` + a `scout_runs` history row
with outcome; the QA gate matches `finder:solicitation.triaged` only when `toState==review_requested`.
Fabric registers **24 archetypes**. LLM reasoning runs on deploy (Railway key).
