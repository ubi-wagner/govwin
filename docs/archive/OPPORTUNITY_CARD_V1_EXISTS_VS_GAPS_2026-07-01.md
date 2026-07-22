# Opportunity Card as the Spine — V1 Exists-vs-Gaps Map (2026-07-01)

Precise, code-grounded map of the full concept: **the opportunity card carries all state
(visible or not) through the entire process** — discovery → rank → pin → purchase → build →
closeout — with state accreting in **immutable layers**. Every row below is verified against
the code (six audits this session); each is EXISTS / PARTIAL / GAP with the grounding and the
V1 delta. Companion to `OPPORTUNITY_CARD_LIFECYCLE_AND_BRIDGE_DESIGN_2026-07-01.md`.

## The card as a layered spine
| Layer | What it holds | Immutable? | Today's home | Target home |
|---|---|---|---|---|
| **L0 Master card** | ALL fields (visible + admin-only) + doc folder + (later) admin strawman | yes, **versioned** | `opportunities` + `curated_solicitations` + `rfp-pipeline/{opp}/` (no versioned bridge) | **`opportunity_bridge`** (append-only) |
| **L1 Tenant thin copy** | customer-visible face, **every** approved opp | yes (snapshot) | `tenant_pipeline_items` (threshold-gated, JOINs global) | denormalized thin copy + cursor |
| **L2 Use-state overlay** | pin, pursuit, **bucket rankings**, copied opp folder | mutable overlay | `tenant_pipeline_items.is_pinned/pursuit_status` (no bucket-state link, no folder copy) | pin→copy + bucket state on the card |
| **L3 Proposal portal(s)** | 1+ proposal builds (rare 2 for 2 techs), stage-gate state → closeout | append-only builds | `proposals` (FK to global, **1 per opp enforced**, no card back-ref) | N-per-card, card-linked, run-to-closeout |

The card is the through-line; today the layers are **fragmented and cross-FK'd to global**,
which is why isolation is convention-only and sharding is blocked. The design makes each layer
reference the one below by **snapshot**, not FK.

---

## A. Master card + forward-only bridge (L0)
| Item | State | Grounding | V1 delta |
|---|---|---|---|
| Card fields (visible/hidden partition) | **EXISTS** | `opportunities` (customer-visible) + `curated_solicitations` (admin: full_text, ai_extracted, annotations, status) | unify into a card snapshot w/ visibility partition |
| Approve-gate state machine | **EXISTS** | `curated_solicitations.status`: …`review_requested → approved → pushed_to_pipeline` | reuse as-is; hang the bridge post on `→pushed_to_pipeline` |
| Matrix built pre-approve | **EXISTS** | `solicitation_compliance`/`_volumes`/`volume_required_items` + admin annotations | none (already the gate content) |
| Global read-only doc folder | **EXISTS (store) / GAP (access)** | `rfp-pipeline/{opportunityId}/` (source, text.md, shredded/, attachments/) + `solicitation_documents` | grant customers **read-only** access to the global folder pre-purchase |
| Forward-only bridge w/ card versions | **GAP** | `system_events` is generic forward-only + `pg_notify`, but carries no card payload/replay | **`opportunity_bridge`** append-only (opp, version, event_type, card JSONB) |
| Admin-built strawman on the bridge | **GAP** | strawmen only exist post-purchase (`draft_v0` in the customer proposal) | optional admin strawman attached to the master card (teaser) |

## B. Tenant thin copy (L1) — subscription-wide
| Item | State | Grounding | V1 delta |
|---|---|---|---|
| Per-tenant card row | **PARTIAL** | `tenant_pipeline_items` (UNIQUE tenant×opp) — but JOINs global `opportunities` for display | denormalize a card snapshot onto the row (shard-safe) |
| Replicate **all** approved opps | **GAP** | `match_tenants` upserts only above `min_surface_score` (default 40) | replicate every approved card; move scoring to bucket-time |
| Update fan-out (re-release → cards) | **GAP** | no consumer; rankings **freeze at first push** (mig-confirmed) | bridge consumer applies `updated`/`closed` versions forward-only |
| New-customer backfill | **GAP** | tenants scored only on the next push | on `tenants.status→active`, replay the whole bridge into their space |

## C. Pin → copy opp folder (L2)
| Item | State | Grounding | V1 delta |
|---|---|---|---|
| Pin | **EXISTS** | `spotlight/pin` route: `is_pinned` upsert + a "pursue_decision" task | keep |
| Copy opp folder on pin | **GAP** | pin does **zero** S3 ops; copy happens only at purchase (`proposals/create` → `copyObject`) | copy `rfp-pipeline/{opp}/` → tenant space on pin |
| Immutable card copy on pin | **GAP** | `origin_card` (mig 089) frozen only at **purchase** | freeze a card snapshot at pin (or at L1 subscription) |
| Update copy-check for pinned | **GAP** | amendments write new `solicitation_documents`, never re-sync pinned tenants | on bridge `updated`, re-copy/diff for pinned tenants |

## D. Buckets — atomized-bounded, per-tenant, ranked (L2)
| Item | State | Grounding | V1 delta |
|---|---|---|---|
| Per-tenant dynamic buckets | **GAP** | fixed 5 (`spotlight_bucket_scores.bucket` CHECK + Python tuple); no def table, no create UI | `tenant_spotlight_buckets` (name, criteria JSONB) |
| Per-bucket document ingest + atomization | **GAP** | none; matching is `tenant_profiles` structured fields only; `library_units` **never** used in ranking | per-bucket doc upload → atomize → bucket atom set |
| Ranking: tech / NAICS / agency / set-aside / timeline | **EXISTS** | `match_tenants`: NAICS 30, keyword 25, agency 20, set-aside 10, timeline 5 | keep, re-key to the bucket's criteria |
| Ranking: **TRL** | **GAP** | TRL is only a proposal `section_standards` entry; not in profile or scoring | add TRL to bucket criteria + opp extract |
| Ranking: **prior-funding win** | **GAP (data exists)** | `sbir_awards` table (mig 018) holds award history but is **never queried**; `prior_funding` bucket fakes it w/ agency+set-aside | join `sbir_awards` into scoring |
| **Accessibility** as a distinct signal | **PARTIAL** | set-aside folded into the score; no separate eligibility gate; all above threshold notified regardless | split **alignment** vs **accessibility** (can-bid) signals |
| Semantic (atom-content) ranking | **GAP** | structured-profile-only; no embeddings in ranking | vectorized atoms (see atom-vectorization plan) |
| Score stored at push / rank at read | **EXISTS** | score persisted; `ROW_NUMBER() OVER (PARTITION BY bucket)` at read | move score compute to bucket-time / on-demand |

## E. Pin → portal conversion
| Item | State | Grounding | V1 delta |
|---|---|---|---|
| Show the matrix to inform pin/purchase | **PARTIAL** | full matrix resolved at purchase; pre-purchase customer visibility is thin | surface a matrix summary on the card pre-purchase |
| Teaser "recommended build" strawman | **GAP** | `draft_v0` is post-purchase only | admin/AI strawman on the master card for high-alignment opps |

## F. Purchase → automation/guardrail launch gate (L3 entry)
| Item | State | Grounding | V1 delta |
|---|---|---|---|
| Purchase → locked proposal + admin gates | **EXISTS** | Stripe webhook → `purchases` + `purchase.completed` → `launchProjectCollaboration(scope='opp', proposal_setup)`; `proposals/create` → locked + `scope='project' admin_review` (72h) | keep |
| Copy compliance/volumes/RFP → customer bucket | **EXISTS (fragile)** | `proposals/create` freezes `origin_card`, `proposal_artifacts.format_spec/compliance_spec`, writes `compliance.json`/`volumes.json`/`rfp/*` | **harden** (S3 outside txn, non-fatal, no retry — see gaps §X) |
| **Customer-admin automation-template setup as launch prerequisite** | **GAP** | `tenant_automation_preferences` (mig 076) is lazy upsert-on-read (notify/auto-advance/ai-review prefs), **not** a launch gate | a real "configure + apply to launch" step owned by the customer admin |
| **Project guardrail templates** | **GAP (don't exist)** | only `agent_archetypes.guardrails` JSONB (unpopulated) + marketing copy; `automation_rules` is CMS-scoped; `stage_gate_requirements` is legacy manual gates | a guardrail-template table + apply-on-launch |

## G. Run-as-automation → closeout (L3 lifecycle)
| Item | State | Grounding | V1 delta |
|---|---|---|---|
| Stage machine + gates | **EXISTS** | `proposals.stage` (draft→review→final→submitted→archived), `gate_config`, `advanceProposalStage` (OCC + snapshots + events), auto-advance on all-locked | keep |
| **Card holds build state through closeout** | **GAP** | `tenant_pipeline_items` has **no** `proposal_id`/`build_stage`; only `pursuit_status`; `v_opportunity_rollup` is a read-time view, not card state | add card→proposal link + denormalized `build_stage` |
| **Run as a single automation** | **GAP** | stages advance manually / on section-lock; `ProjectCollaboration` instances are **transient single HITL gates**; no long-lived workflow drives the arc | a per-proposal process instance driving the build (guardrail-bounded) |
| Closeout + outcome learning loop | **EXISTS (solid)** | `outcome` route (awarded/rejected/withdrawn) → `library_units.outcome_score` + harvest-at-lock + **contract spin-off** on win (`contracts` + `contract_kickoff` gate) | keep; surface outcome on the card |

## H. Multi-proposal (2 techs / 1 opp)
| Item | State | Grounding | V1 delta |
|---|---|---|---|
| N proposals per opp | **GAP (blocked)** | `proposals/create` returns **409** on existing (tenant, opp); index but no UNIQUE (mig 092, residual race documented) | add `label/variant`, `UNIQUE(tenant, opp, label)`, relax the 409 to "new variant" |

## I. Closed-but-accessible (market intelligence)
| Item | State | Grounding | V1 delta |
|---|---|---|---|
| Close lifecycle | **EXISTS** | `opportunities.lifecycle_status` open/closed/archived (mig 082) | post a `closed` bridge version; retain thin copies |
| Rank closed opps for new buckets | **GAP** | fixed buckets + no fan-out + no retained local copies | `include_closed` in bucket ranking; card + awardee/amount already on the row |

## X. Cross-cutting (from the isolation & copy audits)
| Item | State | V1 delta |
|---|---|---|
| Tenant isolation | **CONVENTION-ONLY** — RLS enabled, **zero policies**, app connects as owner (bypass); 53/53 routes gate `verifyTenantAccess` but no DB backstop | RLS policies + non-owner role + `SET LOCAL app.tenant_id`; bounded, audited admin **act-as** (today it's an unbounded god-view) |
| Copy atomicity | DB txn atomic; **S3 outside txn, non-fatal, not idempotent**; double-purchase race | idempotent + verified + reconcilable provisioning; `UNIQUE(tenant, opp, label)` |
| Shardability | Blocked by FK-to-global (`proposals`/`tpi → opportunities`) | **dissolved** by L1 denormalized snapshot + bridge; CMS own-DB + `system_events` is the working precedent |

---

## What this means (the honest headline)
**More than half of the spine already exists** — the approve-gate machine, the global doc
folder, the thin-copy table, purchase→locked→admin-gates, the stage machine, and (fully) the
closeout + outcome learning loop + contract spin-off. The **new work is concentrated in five
places**: (1) the versioned **bridge** + all-opps replication + update fan-out; (2) **pin→copy**
+ pin-time card freeze + update copy-check; (3) **dynamic per-tenant buckets with per-bucket
atomized documents** and the TRL/prior-funding/accessibility ranking signals; (4) the
**automation/guardrail launch gate** + **run-as-one-automation** + **card-held build state**;
(5) **multi-proposal** per opp. Plus the cross-cutting isolation/atomicity/shard hardening.

## V1 build sequence (recommended)
1. **Spine + bridge** (shard-prep, fixes a live gap): `opportunity_bridge`, publish-on-approve, denormalized L1 thin copy, update fan-out, new-tenant backfill. Relax FK-to-global to snapshot.
2. **Pin→copy + card freeze + update copy-check** (L2 folder), and **multi-proposal** (label + unique).
3. **Buckets v2**: `tenant_spotlight_buckets` + per-bucket doc ingest/atomization + wire `sbir_awards` (prior-funding), TRL, and split accessibility; semantic ranking rides the atom-vectorization plan.
4. **Launch gate + run-to-closeout**: guardrail/automation templates the customer admin applies to launch; a per-proposal automation instance; card-held `build_stage`; outcome already closes the loop.
5. **Isolation hardening** (RLS policies + non-owner role + bounded admin act-as) — do alongside 1 since the bridge/thin-copy is the natural enforcement seam.

## Open decisions (yours)
- Pin-copy scope: full opp folder on pin, or metadata now + docs on purchase?
- Buckets: structured criteria first, semantic (vectorized-atom) second — confirm the split.
- Accessibility as a hard **eligibility gate** (hide un-biddable) vs a ranking signal only?
- Multi-proposal: cap at 2, or unbounded with labels?
- Guardrail templates: a first-class template table now, or start by promoting `tenant_automation_preferences` into an explicit apply-to-launch step?
</content>
