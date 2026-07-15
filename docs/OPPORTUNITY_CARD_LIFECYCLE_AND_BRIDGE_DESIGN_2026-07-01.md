# Opportunity Card — Lifecycle, Forward-Only Bridge, and Per-Tenant Pipeline (2026-07-01)

> **Status (updated 2026-07-15): this design is now largely AS-BUILT — read it as the origin design,
> not current truth.** Shipped: **`opportunity_bridge`** + **`tenant_opportunity_cards`** +
> `tenant_bridge_cursor` (mig 094), `pinned_docs` (095), **`tenant_spotlight_buckets`** +
> **`tenant_bucket_scores`** (096, replacing the fixed-5), and the `submission_stage` lifecycle (100).
> **Open-decision #1 was resolved toward the *new sibling table*:** the as-built chose a fresh
> **`tenant_opportunity_cards`** (NOT evolving `tenant_pipeline_items` in place) — `tenant_pipeline_items`
> is now **RETIRED** off the customer path. The **canonical design of record** that folds this doc in and
> tracks it to the as-built (migrations 001→108) is **[`MASTER_MIRROR_OPP_DESIGN.md`](MASTER_MIRROR_OPP_DESIGN.md)**;
> see also `ARCHITECTURE_V10.md` §2–3. Where this doc says "the design will…" for the items above, read
> "shipped." The still-⚠-future items (buyer/outcome ledger, sbir.gov outcome scrape, proposal-ready
> nudge) are tracked in MASTER_MIRROR §7 / its gap register.

Runs the "opportunity card carries all information (visible or not)" concept through the
entire process: admin ingest → review gate → matrix → **approve** → **forward-only bridge
post** → per-tenant **thin-copy** replication → **on-demand bucket ranking** → new-customer
backfill → **closed-but-accessible** market intelligence. Grounded against current code;
deltas from today are called out explicitly.

## Thesis
There is **one master card per opportunity** (the full carrier: everything, visible or not).
It lives behind an **append-only bridge**. Every subscribed tenant holds a **denormalized
thin copy** of the customer-visible face of every approved card, kept current by consuming
the bridge forward-only. All ranking is **local** to the tenant's thin copies, so any bucket
(or any new tenant) can rank the entire available universe the instant it registers — and,
because the thin copy carries no hard FK back to global tables, each tenant's pipeline is
**self-sufficient for a future DB split**. The bridge is the single global surface, kept
indefinitely.

---

## 1. The card as carrier — data model + visibility partition

Today the "card" is spread across `opportunities` (discovery facts) + `curated_solicitations`
(curation + RFP text + annotations) + `solicitation_compliance`/`_volumes`/`_documents`
(the matrix + deliverables). The design unifies these into **one card with a visibility
partition**:

**Customer-visible face** (→ replicated into the tenant thin copy):
`title, agency, office, solicitation_number, naics_codes, classification_code, set_aside_type,
program_type, posted_date, close_date, award_date/amount/awardee, estimated_value_min/max,
description, lifecycle_status` (from `opportunities`) **+ a compliance summary**
(page limits, required volumes/items, key deadlines — derived from `solicitation_compliance`
/`_volumes`) **+ a document manifest** (names only; bytes gated to purchase).

**Admin-internal face** (stays master-side; never in a thin copy):
`full_text, ai_extracted, ai_confidence, ai_similar_to/score, annotations (raw section
anchors), claimed_by/curated_by/approved_by, dismissed_reason, curation status`
(from `curated_solicitations`). Admins see this via their (to-be-bounded) act-as path.

**Implication:** the thin copy is a **denormalized JSONB card snapshot**, not a JOIN to
`opportunities`. That single choice is what makes both the "rank instantly" and the
"shard later" goals true.

---

## 2. Lifecycle + gates (mapped to the EXISTING state machine)

`curated_solicitations.status` already encodes the gates — we hang the bridge off it:

| Stage | status | Gate | Bridge effect |
|---|---|---|---|
| Ingest | `new → claimed → released → ai_analyzed` | RFP uploaded, shredded (`ai_extracted`) | none |
| Matrix | `curation_in_progress` | admin fills compliance + volumes + annotations "to whatever level is feasible" | none |
| **Review** | `review_requested` | **admin review gate** | none |
| **Approve** | `approved` | **admin approve gate** | none |
| **Publish** | `pushed_to_pipeline` | (automatic on approve) | **POST a `published` card version to the bridge** |
| Update | (stays `pushed_to_pipeline`) | admin edits + **re-release** | **POST an `updated` version** |
| Close | `opportunities.lifecycle_status='closed'` | admin closes | **POST a `closed` version** (card retained) |

The **approve→publish transition is the single trigger** for customer-wide replication. Today
that transition calls `solicitation.push` → `match_tenants()` (threshold-gated scoring). The
design replaces the *effect* of that push with a **bridge post** (below); scoring moves to
bucket-time.

---

## 3. The forward-only bridge (the master seam) — NEW

`opportunity_bridge` (global, **append-only**, admin-write-only):
`id, opportunity_id, version (monotonic per opp), event_type ('published'|'updated'|'closed'
|'reopened'|'awarded'), card JSONB (full customer-visible snapshot at this version),
posted_at, posted_by`. INSERT-only; a card's current state = its highest version.

- Each gate transition in §2 appends one row. **Forward-only** = history is immutable; consumers
  replay from a cursor.
- It also emits a `system_events` row (`opportunity.published|updated|closed`) so the existing
  `pg_notify` wakes consumers — the notify is the doorbell, the bridge table is the payload +
  replay log.
- **Stays indefinitely.** Closed opps are `closed` versions, not deletions — the bridge is the
  permanent market-intelligence spine.
- This is the **shard seam** (mirrors the CMS's own-DB + `system_events`-only coupling, which
  already ships in `services/cms/.../database.py`).

---

## 4. Customer-side ingest → thin copies — EVOLVE `tenant_pipeline_items`

Every **subscribed** tenant (`tenants.status IN ('active','trial')`) holds a thin copy of
**every** approved card (not threshold-gated — the delta from `match_tenants`).

Evolve `tenant_pipeline_items` (or a sibling `tenant_opportunity_cards`) to carry:
`tenant_id, opportunity_id, card JSONB (denormalized snapshot), lifecycle_status,
bridge_version (last applied), pursuit_status, is_pinned, …` with `UNIQUE(tenant_id,
opportunity_id)`. **Drop the JOIN-to-global for display** — the snapshot is self-contained.

A **bridge consumer** (pipeline worker), on each bridge post, applies versions `>` each
tenant's cursor: upsert the thin copy, advance `tenant_bridge_cursor`. Idempotent (version
monotonic). This is also the **update fan-out** that's missing today — admin re-release now
reaches every tenant card.

Rank signals (`total_score`, factor scores) become **derived at bucket-time**, not stored on
push — so a tenant carries *all* opps and ranks them per bucket on demand.

---

## 5. Registration — two levels

- **Tenant ↔ bridge (subscription):** on **RFP-admin approval of a new customer**
  (`tenants.status → active`), run a **backfill**: replay the whole bridge (all versions,
  open **and** closed) into the tenant's thin copies + set cursor to head. Result: the new
  customer lands with the full local pipeline immediately (alongside today's landing pages +
  onboarding). Thereafter the consumer keeps them current forward-only.
- **Bucket ↔ local pipeline:** a bucket ranks the tenant's **thin copies** (already local), so
  "any bucket registers at any time and has every available opp ranked instantly" falls out for
  free — no bridge round-trip.

---

## 6. Dynamic per-tenant spotlight buckets + on-demand ranking — the big delta

Today buckets are a **fixed** global set of 5 (`spotlight_bucket_scores.bucket` CHECK) scored
at push. The design makes them **customer-defined**:

- NEW `tenant_spotlight_buckets`: `id, tenant_id, name, description, criteria JSONB
  {weights, keywords, naics[], program_types[], set_aside[], agency_prefs[], tech_focus,
  include_closed}, created_at, updated_at`.
- EVOLVE `spotlight_bucket_scores`: replace the fixed `bucket` CHECK with `bucket_id →
  tenant_spotlight_buckets`, keep `UNIQUE(tenant_id, bucket_id, opportunity_id)`.
- **On bucket create/update:** rank the tenant's local pipeline (active + anticipated, and
  closed when `include_closed`) against the bucket's criteria → upsert scores. Pure local
  compute; instant; re-rankable. Reuse the `match_tenants` factor math, but keyed to the
  bucket's criteria instead of one global tenant profile.

This is what turns spotlight from "5 fixed lenses scored once" into "unlimited customer lenses,
each ranking the whole universe on demand."

---

## 7. Closed-but-accessible (market intelligence)

`closed`/`awarded` post a bridge version; the thin copy flips `lifecycle_status` but is
**retained**. Buckets with `include_closed` rank historical opps too — so a customer mines
"who funded my kind of technology" (awardee + award_amount are on the card). Nothing is ever
deleted from the bridge or the thin copies; closed just changes how the UI/default filters
present them.

---

## 8. Reconciliation — exists / change / new (grounded)

| Piece | Today | Design |
|---|---|---|
| Card fields | split across opportunities + curated_solicitations + compliance/volumes | **unified card w/ visibility partition** (concept + JSONB snapshot) |
| Approve gate | `status` machine exists (…`review_requested→approved→pushed_to_pipeline`) | **reuse as-is** — hang the bridge post on `→pushed_to_pipeline` |
| Publish effect | `solicitation.push` → `match_tenants()` (threshold-gated scoring) | **POST bridge version**; scoring → bucket-time |
| Bridge | `system_events` (generic, forward-only) + `pg_notify` | **`opportunity_bridge`** (card versions) + notify via system_events |
| Thin copy | `tenant_pipeline_items` (above-threshold only; JOINs global for display) | **all approved opps; denormalized snapshot; cursor** |
| Update fan-out | **missing** (rankings freeze at first push) | bridge consumer applies `updated`/`closed` forward-only |
| Buckets | **fixed 5** (CHECK), scored at push | **per-tenant `tenant_spotlight_buckets`**, ranked on demand |
| New-tenant pipeline | scored on next push only | **backfill replay** of the whole bridge on approval |
| Closed opps | `lifecycle_status` set; not fanned out | retained thin copies; `include_closed` bucket ranking |

---

## 9. Shardability payoff (why this closes the blocker)

The FK-to-global blocker (`proposals`/`tenant_pipeline_items → opportunities`) dissolves: the
tenant's pipeline is a **denormalized snapshot fed only by the forward-only bridge**, with no
hard FK back to global tables. A per-customer DB then needs only its own thin cards + a bridge
feed (a subscription to the append-only stream). The bridge is the one global thing; everything
else is tenant-local. This is the same shape the CMS already runs (own DB + `system_events`
bridge). Proposals should likewise **snapshot** the opp identity (they already store
`origin_card`) and soft-ref `opportunity_id` rather than hard-FK it.

## 10. Isolation fit
Thin cards are `tenant_id`-scoped; the bridge is admin-write-only and append-only; the consumer
is the only writer of tenant cards. This is the natural home for the RLS/act-as hardening: put
an RLS policy on `tenant_opportunity_cards` + `tenant_spotlight_buckets`, and the bridge stays
outside tenant RLS (admin-owned, forward-only).

---

## Open decisions (yours)

> **Resolved as-built (2026-07-15):** #1 → **new `tenant_opportunity_cards`** (tpi retired, not evolved).
> #4 → **structured facets shipped** (`tenant_spotlight_buckets.criteria` jsonb); embedding-similarity is a
> default-off later increment (the `embedding vector(1536)` column exists on `library_atoms`). #5 →
> shipped in that order (bridge + cards + fan-out in mig 094; per-tenant buckets in 096; `backfillTenant`
> is a manual admin route). #2/#3 remain product calls. Full as-built map: `MASTER_MIRROR_OPP_DESIGN.md`.

1. **Evolve `tenant_pipeline_items` in place** (add snapshot + cursor) **or** new
   `tenant_opportunity_cards` beside it (keep tpi as the pursuit/pin overlay)?
2. **Backfill scale:** replay-the-bridge per new tenant is O(cards). Fine at hundreds–thousands;
   if the corpus is huge, seed from a card-state materialized view instead of full replay.
3. **Compliance summary in the card** — how much of the matrix is customer-visible pre-purchase
   (enough to rank/decide) vs gated to purchase (full matrix + docs)?
4. **Bucket criteria language** — structured facets (weights/keywords/NAICS) now; natural-language
   or embedding-similarity buckets later (ties into the atom-vectorization plan)?
5. **Sequencing:** ship the bridge + thin-copy + update-fan-out first (fixes a real gap and is
   shard-prep), then dynamic buckets, then new-tenant backfill?
</content>
