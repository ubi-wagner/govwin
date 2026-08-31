# HITL Click-Plan — Immobileyes → US Navy (RFP-admin → purchase → shadow → V1)

The single-operator Monday test: **you sign in as the RFP admin, drive the two master releases,
buy the portal as the customer with the comp code, then resolve the ToDo that drops you into the
Immobileyes tenant as the shadow admin and build V0→V1.** This is the **manual/shadow-assisted**
spine of `docs/MASTER_MIRROR_OPP_DESIGN.md` — read that for the architecture; this is what you click.

Admins reach any tenant because `verifyTenantAccess` grants `rfp_admin`/`master_admin` global access
(`frontend/lib/db.ts:52`); the purchase writes a `shadow_admin_grants` row (`097`) on top. Pre-reqs:
stack up per `ALPHA_HITL_RUNBOOK.md §1`, migrations **001→108**, seed + fixtures, and — for the two
⚠ infra items — **real S3 creds** and the **Python pipeline worker** running. Test company
**Immobileyes** (CV property intelligence) → a **US Navy SBIR** opportunity.

`✅` = verified in a prior sandbox rehearsal / this build cycle. `⚠` = infra-dependent or **future**
(marked so it doesn't read as a regression — see the design doc's gap register §9).

## Pass A — RFP admin, ingestor → **Release 1 (Spotlight)**

| # | Click | Perform | Expect | Status |
|---|---|---|---|---|
| 1 | `/apply` (anon) | Submit the Immobileyes application (company, tech summary ≥20, T&C w/ matching email) | 201; `applications` row `pending` | ✅ |
| 2 | `/admin/applications` (rfp_admin) | Open Immobileyes → **Accept** (notes ≥10) | Temp password panel; `tenants` + `tenant_admin` user; opp river mirrors onto the tenant | ✅ tenant+tempPw |
| 3 | `/admin/rfp-upload` | Upload the **Navy** RFP (title, agency=Navy, `programType=sbir_phase_1`) — **minimums** | `opportunities` + `curated_solicitations('new')` + stored doc | ✅ (⚠ **real S3** for doc storage; S3 failure now rolls back the orphan) |
| 4 | `/admin/rfp-curation/<sol>` | Write the **spotlight summary** (the push gate) + set `submission_format` | Persisted; push is blocked until both are present | ✅ gate on `spotlight_summary`+`submission_format` |
| 5 | curation → **Approve + Push** | `solicitation.push` | Fan-out → a `tenant_opportunity_cards` row per active tenant (Immobileyes), auto-ranked vs buckets | ✅ push 200; **Immobileyes card = 1** |

*Release 1 done: the Navy OPP is discoverable + ranked on every customer's Spotlight.*

## Release 2 — master skeleton (any time in advance, **or** within 72h of first purchase — §5)

| # | Click | Perform | Expect | Status |
|---|---|---|---|---|
| 6 | `/admin/templates` | Build the **blank molds** — a Technical-Volume canvas with `{company_name}`/`{topic_title}` merge fields + the guardrails (e.g. 1-page tech summary = 15-page Word doc, font/margins/page-limit) | 201; `document_templates` row w/ a real `canvas_document` | ✅ |
| 7 | `/admin/rfp-curation/<sol>` | Add **volumes** + **required items**; set **full compliance**; **link the template** + an **expert note** to the item | Persisted; the master skeleton is reusable by every future buyer | ✅ link+note persisted |

*If steps 6–7 are done before anyone buys, step 11 becomes a ~15-min review instead of a 72h build.*

## Pass B — Customer (`eric@immobileyes.com`)

| # | Click | Perform | Expect | Status |
|---|---|---|---|---|
| 8 | `/portal/immobileyes/atoms` | Upload a capability doc → atomize → tag `vol` → Create | `library_atoms` rows (reference + primitive), tenant-scoped | ✅ |
| 9 | `/portal/immobileyes/buckets` | Create 2–3 **Spotlight buckets** | Each card carries a **rank per bucket** (`tenant_bucket_scores`) | ✅ |
| 10 | `/portal/immobileyes/cards` | **Pin** Navy | The OPP's files copy into the tenant (`copied_docs`); nudges armed | ✅ (⚠ real S3) |
| 11 | pinned card → **Purchase** | Type `rfppipelinetest` → Complete | Portal opens **`curation_pending`**; `$0` completed `purchases`; `shadow_admin_grants` written; `capture:purchase.completed` emitted | ✅ this cycle |
| 12 | `/portal/immobileyes/portals` | View | **"Waiting for RFP Expert Curation"** + live **72h** countdown | ✅ this cycle |

## Pass C — RFP admin, shadow (curation #2, routed in by the ToDo)

| # | Click | Perform | Expect | Status |
|---|---|---|---|---|
| 13 | `/admin/rfp-curation` | Resolve the **"Purchase — needs curation"** ToDo | Tenant-scoped `proposal_setup` task (+ admin email if CMS configured); routes you into Immobileyes | ✅ this cycle (⚠ email needs CMS listener) |
| 14 | (in-tenant) | If steps 6–7 done → **~15-min review**; else **build the skeleton now (within 72h)** | Master matrix + molds complete | ✅ build path verified |
| 15 | `/portal/immobileyes/portals` (shadow) | **Release to customer** (`action=release`) | `curation_pending→launched`; proposal provisioned **unlocked**; `proposal_compliance_matrix` instantiated; `draft_v0` auto-draft fires → **V0** | ✅ 200, unlocked |

## Pass D — Build V0 → V1 (shadow-assisted today; customer-executed later)

| # | Click | Perform | Expect | Status |
|---|---|---|---|---|
| 16 | a section in the canvas | **Draft / regenerate** — pick atoms, then a quick action **or** a custom prompt in the **AI Revision Panel** (or **Draft all sections**) | `proposal.draft_section` fills the mold from the **RFP context + picked atoms + your instruction**; empty sections fall back to the **expert note + all proposal atoms**. HITL — the agent workforce stays parked | ✅ this cycle |
| 17 | each section | **Accept & Lock** (library plug-and-play) | Sections `approved`; matrix rows → `satisfied` — **V0 → V0.5** (~15 min) | ✅ ×2 satisfied |
| 18 | stage control | **Lock all** *or* **Force advance to V1** | Advances to **V1**/`submitted` (force skips locking every section); downloads enabled | ✅ this cycle |
| 19 | proposal panel | **Download Proposal (.docx)** | A real Word doc (V1) | ✅ valid .docx |
**Next buyer of the same OPP:** their own portal + skeleton instance — molds already exist → skip
steps 6–7/14, straight to step 16. (⚠ today they still open `curation_pending`; auto-skip is §5 future.)

## Pass E — Monitor the spine (customer + shadow + admin)

**Two spine systems** (`MASTER_MIRROR_OPP_DESIGN.md §1`): the customer reads **only their own** copy
spine; the admin reads across spines. All tenant-scoped (`verifyTenantAccess` + `WHERE tenant_id`).

| # | Click | Perform | Expect | Status |
|---|---|---|---|---|
| 20 | `/portal/immobileyes/processes` (customer **or** shadow) | Watch the workflow ledger → click **Steps** on an instance | Health chips (running/waiting/stalled/failing) + current step + the **step timeline** (`process_instance_transitions`) — **their own spine only** | ✅ this cycle |
| 21 | `/portal/immobileyes/activity` | View the audit stream | Their `system_events` (ns/type/phase/actor/payload), filterable, 10s refresh — tenant-scoped | ✅ this cycle |
| 22 | `/admin/workflows` + `/admin/events` (rfp_admin) | **Cross-spine** audit → **Steps** on any instance | `process_instances` carry `opportunity_id`; the step timeline; events post as **objects** | ✅ 33/33 objects; ⚠ boot the **pipeline worker** for live instances |

---

## Hardened + tested this cycle (rock-solid)
The **phase-gated** stage machine (`advanceProposalStage` — single-step gates + OCC compare-and-swap),
the **HITL gates** (wait/park/resume by entity correlation + CAS, force-advance), the **base cron**
(the dispatcher now honours `cron_expression`), and the **HITL draft** (mold-fit + budget guards) are
guarded and unit-tested. Two fixes landed: the onboarding gate correlates login by `userId` (no
cross-user resume), and the cron dispatcher no longer silently mis-schedules. Suites: **frontend 572 ·
pipeline 581 · tsc 0**. Agents/automation-with-agents stay parked (`AUTOMATION_DESIGN.md`).

## ⚠ On the roadmap (shown so the runbook carries the trajectory — not clicked Monday)
Per `MASTER_MIRROR_OPP_DESIGN.md §9`: the **buyer/outcome ledger** on the master OPP + **sbir.gov
outcome scrape**; the **"proposal-ready" nudge** fanned to all mirror cards on skeleton completion;
the **T&C shadow opt-out** toggle (grant is unconditional today; only post-hoc revoke); **auto-skip
curation** for pre-built OPPs; the **full V0→V1 Workplan automation** (nudges/actions into shadow +
company admin accounts — the customer-executed target); the **EconDev appointed-shadow** role
(`shadow_admin_grants.source='invite'` is the hook); and the **security** hardening to enforce the
shadow grant and retire the `verifyTenantAccess` god-view.

## Infra prerequisites for a full green run
**Real S3** (steps 3, 10 doc storage) · the **Python pipeline worker** (steps 15–16 auto-draft + the
Pass E workflow/spine views, steps 20–22) · **CMS event listener + creds** (step 13 admin email —
graceful without; the in-app ToDo still shows).
