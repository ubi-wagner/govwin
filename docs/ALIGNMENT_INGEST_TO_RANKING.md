# Alignment report — ingest → ranking → build-out

**Method.** One flow, four lenses: **actor** (rfp_admin at ingest; tenant_admin, delegated member, or
shadow admin at bucket setup and monitoring), **data flow**, **automation**, **AI fabric**. A
misalignment is where the lenses disagree — the actor is asked for something the data flow does not
carry, or the automation does not fire on, or the agent that would use it is asleep.

**Measured** against the sandbox at migration head 237. Findings only.

---

## The headline

**Three of the four lenses already handle the technology signal. The data flow drops it.**

`opportunities.tech_focus_areas` is extracted by the AI shred, editable by the rfp_admin in the
curation UI, read by an agent — and carried by neither the bridge nor either scorer.

And underneath it, a second one: **the stemmed full-text search this pipeline needs has existed since
migration 001, is populated, is GIN-indexed, and is queried by nothing.**

---

## Stage 1 · Ingest — `stageIntake`, the head of the river

| Lens | State |
|---|---|
| **Actor** | rfp_admin uploads topic files, or releases a scout finding. Both funnel through `stageIntake` — one entry point, correctly |
| **Data** | writes `opportunities` (19 columns) + `curated_solicitations` (`status='new'`), then links `opportunities.solicitation_id` back |
| **Automation** | emits `opportunity.staged` and `opportunities.detected`, both `tenantId: null` (platform scope, correct) |
| **AI** | `opportunities.detected` wakes `OnOpportunitiesDetected` → `opportunity_scout` prioritises the triage backlog. `parse-solicitation.ts` extracts `techFocusAreas` **per topic** as part of the shred schema |

**F1 · The intake insert omits three ranking signals.** Its 19 columns include `description`,
`expert_notes`, `program_type`, `agency`, `office`, `org_unit` — but not `naics_codes`,
`set_aside_type`, or `tech_focus_areas`. Those arrive later, by other paths, or not at all
(`naics_codes` 0/22, `set_aside_type` 4/22).

**F2 · Topics are opportunities.** 11 of 22 carry a `topic_number`, grouped by `solicitation_id`
across 18 solicitations. This is the right granularity — `tech_focus_areas` is per-topic, and the push
fans every activated opportunity, umbrella and topics alike.

---

## Stage 2 · Curation — what the rfp_admin actually supplies

| Lens | State |
|---|---|
| **Actor** | the curation `PATCH` accepts **exactly two fields**: `spotlightSummary` and `expertNotes`. Both free text, both capped at 5,000 |
| **Data** | `spotlight_summary` averages **103 characters** against that 5,000 cap. `expert_notes`: 0 populated |
| **Automation** | the Ingest Studio phase machine (`extract → matrix → review → landed → molds → complete`) — `ingest_phase` is `not_started` on **all 18** rows |
| **AI** | `rfp_ingest_manager` assesses ingest state on demand; `compliance_reviewer` inline |

**F3 · The structured signal lives on a different surface from the required one.** `techFocusAreas` is
editable — `opportunity-update-topic.ts` accepts it, the topic page renders it — but on the **topic**
route, while the solicitation-level curation the release gate checks accepts only the two free-text
fields. The admin can supply structure; nothing in the release path asks them to.

**F4 · The cap is not the constraint.** 103 characters against a 5,000 allowance means the summary's
brevity is a workflow property, not a schema limit.

---

## Stage 3 · Release #1 — the discovery gate

| Lens | State |
|---|---|
| **Actor** | rfp_admin: `approved` → `pushSolicitation` |
| **Data** | gate = `submission_format` present **and** `spotlight_summary` non-empty. That is all — no volumes, no molds, no completed matrix |
| **Automation** | flips `opportunities.is_active`, fans out over `opportunity_bridge` |
| **AI** | none participates in the gate |

**F5 · The gate is correctly placed and under-specified.** It demands exactly one human artifact and
it is the one the ranker reads — that is right. It does not ask for any structured field, so a
solicitation can release with full technology metadata or none, and the gate cannot tell.

---

## Stage 4 · Bridge fan-out — the drop

The card carries **31 keys**. Against 52 columns on `opportunities`, these are dropped and matter:

| Dropped | Why it matters |
|---|---|
| **`tech_focus_areas`** | the technology signal — extracted by AI, edited by the admin, read by an agent |
| **`phase_type`** | Phase I vs Direct-to-Phase-II — a real discriminator for a small business |
| `topic_number` · `topic_branch` · `topic_status` | topic identity on a card that *is* a topic |
| `poc_name` · `poc_email` | who to ask |
| **`full_text_tsv`** | see stage 6 |

**F6 · The technology signal does not cross the bridge.** This is the headline. Three lenses use
`tech_focus_areas`; the data flow drops it at the one hop that feeds ranking.

**F7 · No highlight or annotation path exists across the bridge at all.** `solicitation_annotations`
(`kind='highlight'`, since migration 009, tools wired into the curation page) has **0 rows** and no
bridge carrier. And `solicitation-save-annotation` captures `sourceLocation {page, offset, length}`
with **no excerpt text** — so even if it were used, there is nothing to carry.

---

## Stage 5 · Bucket setup — the tenant side

| Lens | State |
|---|---|
| **Actor** | `canManageBuckets`: `tenant_admin` and above, **or** a delegated member with `can_manage_buckets`. An **rfp_admin passes the role check directly** via `hasRoleAtLeast`, and `verifyTenantAccess` grants the derived shadow membership — **the shadow-admin path works** |
| **Data** | the editor is **four free-text, comma-separated inputs**: keywords, agencies, program types, NAICS. No prefill, no dropdowns, no suggestions |
| **Automation** | bucket create → `rankBucket` scores the whole pipeline; cap 25, rfp-admin settable |
| **AI** | `onboarding_agent` — designed to output *"spotlight buckets to seed"* and *"profile enrichment suggestions"* — **dormant** |

**F8 · `tenant_profiles` is a column-for-column match and is not connected.** `naics_codes`,
`keywords`, `agency_priorities`, `set_aside_types` map onto `BucketCriteria` exactly. Collected on the
profile page, read by the dashboard and the agent tools, **not read by bucket authoring.** Of two
profile rows, one is empty in every field.

**F9 · Every real bucket sets keywords and nothing else** — 4 of 5; the fifth adds programme types.
The live denominator is `keyword 1 + timeline 0.5`, making **keywords 67% of the score.**

---

## Stage 6 · Ranking and monitoring

| Lens | State |
|---|---|
| **Actor** | tenant_admin sees ranked cards; the score's composition is not shown |
| **Data** | `scoreCard` matches `title + spotlightSummary + description + office` — **~296 characters**, via `String.includes` |
| **Automation** | `capture:card.applied` → `rescore.py`, a faithful mirror of `scoreCard` |
| **AI** | `scoring_strategist` — an LLM overlay on the algorithmic score — **dormant**. `capture_strategist` **already assembles both sides**: `tenant_profile.tech_focus` and `opportunity.tech_focus_areas`, into one prompt |

**F10 · The full-text search is already installed and unused.** Since **migration 001**:

```
opportunities.full_text_tsv        TSVECTOR + GIN index idx_opp_fts        22/22 populated
curated_solicitations.full_text_tsv TSVECTOR GENERATED ALWAYS AS
                                     to_tsvector('english', full_text)
                                   + GIN index idx_csol_fts                 auto-maintained
```

Verified working — `websearch_to_tsquery('english','manufacturing')` ranks two opportunities through
the existing index. **No code queries either column.** The `curated_solicitations` one is generated
from the *entire shredded solicitation* and maintained by Postgres for free.

**F11 · Four of six factors punish a card for the ingest side's missing data.** `agency`, `naics`,
`program`, `accessibility` guard only the bucket side, so an absent card field scores **0** and still
enters the denominator. Only `timeline` abstains — with the comment *"an invalid date must not change
the denominator."* Latent today because buckets are thin; it fires the moment they are enriched.

**F12 · The AI fabric performs the matching the scorer cannot.** `capture_strategist` reads tenant
technology focus and opportunity technology areas together. The deterministic scorer has neither —
one because the bridge drops it, the other because the bucket never asks.

---

## Stage 7 · Procurement → build-out (release #2)

| Lens | State |
|---|---|
| **Actor** | buyer purchases with a comp code; rfp_admin completes build-out in the provisioning cockpit |
| **Data** | `provisionProposal` reads `opportunities` by id and falls back to `curated_solicitations` — **it bypasses the card entirely**, so the bridge's thinness costs nothing here |
| **Automation** | `provisionAndReleasePortal`, then `completeBuildOut` broadcasts `updated` to every tenant's mirror |
| **AI** | `section_drafter` + the review cohort |

**F13 · The ranking → revenue loop is designed twice and populated never.**

```
proposals.source_bucket    0 of 5 populated — nothing writes it, only SELECTs reference it
origin_card.bucket         written as null   {"bucket": null, "frozenAt": …, "opportunity": {…}}
```

The question *"which lens surfaced the opportunity that became this build"* — the only measure of
whether a tenant's buckets are working — cannot be answered, though the schema was shaped twice to
answer it.

---

## The pattern across all seven stages

| | |
|---|---|
| **Ingest produces more than the bridge carries** | tech focus areas, phase type, topic identity |
| **Curation asks for less than ingest produces** | two free-text fields at the gate; structure on another surface |
| **Ranking consumes less than the data layer offers** | 296 characters and `String.includes`, over a GIN-indexed tsvector that has been there since migration 001 |
| **The AI fabric already does what the deterministic path cannot** | and two of the agents that would close the gap are dormant |
| **The loop does not close** | no attribution from bucket → build |

**Nothing here needs new architecture.** Every gap is a connection between things that already exist:
a field that is written and not carried, an index that is built and not queried, a profile that is
collected and not read, an agent that is registered and not woken, and a column that is defined and
not populated.
