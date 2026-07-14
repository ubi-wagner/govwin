# HITL Click-Plan — RFP-admin → shadow-admin → Immobileyes (Monday)

The single-operator test: **you sign in as the RFP admin, shadow-admin into the customer tenant
(Immobileyes), and drive the whole loop**, because `verifyTenantAccess` grants `rfp_admin`/`master_admin`
global tenant access (`lib/db.ts:52`) — so the admin can act inside any tenant's portal (the shadow path;
the formal `shadow_admin_grants` mechanism, mig 097, scopes per-portal guardrails on top).

Columns: **Click** (where) · **Perform** (action) · **Expect** · **Verified** (result of the 2026-07-05
sandbox rehearsal — see `scratchpad/immobileyes_rehearsal.md`). Test company: **Immobileyes** (CV property
intelligence). Pre-req: stack up per `ALPHA_HITL_RUNBOOK.md §1`, mig **104**, seed + fixtures, and — for the
two ⚠ items — **real S3 creds** and the **Python pipeline worker** running.

| # | Click | Perform | Expect | Verified |
|---|---|---|---|---|
| 1 | `/apply` (anon) | Submit an Immobileyes application (company, tech summary ≥20, T&C w/ matching email) | 201; `applications` row `pending` | ✅ 201 |
| 2 | `/admin/applications` (rfp_admin) | Open Immobileyes → **Accept** (notes ≥10) | Green panel with the **temp password**; a `tenants` + `tenant_admin` user; the opp river **mirrors** onto the tenant | ✅ tenant+tempPw; mirror=0 (nothing pushed yet — see #6) |
| 3 | `/admin/rfp-upload` | Upload an RFP file (title, agency, `programType=sbir_phase_1`) | An `opportunities` + `curated_solicitations('new')` row + the stored doc | ✅ opp+solicitation created; ⚠ **500 STORAGE_ERROR** without real S3 (B2 orphan) — set AWS creds for Monday |
| 4 | `/admin/templates` | **Build a baseline template** (a Technical-Volume canvas with `{company_name}`/`{topic_title}` merge fields) | 201; a `document_templates` row with a real `canvas_document` | ✅ 201 |
| 5 | `/admin/rfp-curation/<sol>` | Add a **volume** + **required item**; set **compliance** (esp. `submission_format`); **link the template** + an **expert note** to the item | Persisted (edits now stick — the silent-edit no-op was fixed) | ✅ link+note persisted; `submission_format` required before push |
| 6 | curation → **Approve + Push** | `solicitation.push` | Fan-out → a `tenant_opportunity_cards` row per active tenant (Immobileyes) | ✅ push 200; **Immobileyes card = 1** |
| 7 | `/portal/immobileyes/cards` (shadow) | View the customer's cards | The pushed opp appears | ✅ 1 card |
| 8 | `/portal/immobileyes/atoms` (shadow) | Upload a capability doc → atomize → tag `vol` → Create | `library_atoms` rows (reference + primitive) | ✅ reference+block+primitive |
| 9 | provision | `proposals/create {topicId}` (founding-cohort admin-provisioned) | Sections + artifacts + **compliance matrix**; the linked template **interpolates into the mold** | ✅ 2 sections; Technical Approach = **"Immobileyes proposes…"**, `ai_drafted`, `meta` object, expert note readable |
| 10 | proposal admin panel | **Release** (admin unlock a `lock_count=0` proposal) | `is_locked=false`; the customer can edit | ✅ 200, unlocked |
| 11 | each section | **Accept & Lock** | sections `approved`; matrix → `satisfied` | ✅ ×2; matrix **satisfied ×2** |
| 12 | stage control | **Advance draft → final** | auto-locks → `submitted`; downloads enabled | ✅ 200 → submitted, lock_count=1 |
| 13 | proposal panel | **Download Proposal (.docx)** | a real Word doc | ✅ 200, **8962-byte .docx (valid zip)** |
| 14 | `/admin/activity` | Audit the run | events posting as **objects** (not string scalars) | ✅ **33/33 objects** |
| 15 | `/admin/workflows` | Audit automation | `process_instances` carry `opportunity_id` | ⚠ boot the **pipeline worker** (events are posting for it; proven earlier in-session) |

**Verdict:** the RFP-admin→shadow→Immobileyes loop is **green end-to-end**
(ingest → template-build → link → push → mirror → shadow → library → provision-with-template → release →
build → lock → download), with two operator prerequisites for the full picture: **real S3** (step 3 doc
storage) and the **pipeline worker** (step 15 workflow instances). Both are config/infra, tracked in
`ALPHA_TODO_BACKLOG.md`.

**Two small real findings from the rehearsal** (added to the backlog): `solicitation_compliance` has no
`UNIQUE(solicitation_id)` (so an upsert must be a plain insert), and `rfp-upload` commits the
opp+solicitation **before** storing the file → an S3 failure orphans a zero-doc solicitation (B2).
