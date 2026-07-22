# Greenfield Component Audit — Ingest → Download

Full component-by-component analysis of every UI page/component/route/table used at each
step of the pipeline, mapped against the target spec, with an **EXISTS / PARTIAL / MISSING**
status and file:line evidence, followed by the prioritized dev/test backlog.

Method: five parallel grounded reviewers (ingest+matrix, bridge+replication, library+ranking,
pin+pay+portal, canvas HITL). Every claim is anchored to `frontend/…` or `db/migrations/…`.

---

## 1. Verdict

**The spine is real.** The end-to-end happy path in `docs/HITL_TEST_PLAN.md` works: upload an RFP,
attach N topics, build a 3-layer overlay matrix, self-approve, push, fan out a card, shadow a
tenant, bucket+rank, pin, open a no-pay portal, provision a proposal, draft/revise/review in the
canvas, lock, advance, and download a `.docx`. All of that EXISTS and is cited below.

**The rich model is the work.** The spec's differentiators are layered on the spine and are mostly
PARTIAL or MISSING. Five headline gaps, in rough value order:

1. **Ranking ignores the library entirely** — `scoreCard` is keyword-only; the atomized library +
   the `embedding vector(1536)` column are never touched (deferred to a never-shipped "Phase-4").
   The "atoms focus the ranking" premise is unimplemented.
2. **No unified 6-state lifecycle** — only `open/closed/archived` exists, split across 3 disjoint
   columns; **NOFO and UPDATED exist nowhere**. And lifecycle transitions **bypass the bridge**, so
   updates/closes don't fan out to customers automatically.
3. **AI does not generate into the guardrails** — `pageLimit` is a one-line prose hint, font is
   ignored, and the page meter is a cosmetic `nodeCount/8` estimate. No budget, no enforcement.
4. **Pay is disconnected from portal creation** — Stripe is built but payment success writes a
   `purchases` row + a task and **never creates a portal**; there's no modal; the customer-admin 72h
   notice doesn't exist; pinned docs are copied but never rendered customer-side.
5. **HITL is permission-based, not task-driven** — section acceptance is admin-gated (any proposal
   admin), not the *tasked* reviewer; forced-advance audits open sections but leaves open tasks/
   comments untouched; there's no per-tenant `card_activity` history and no card-scoped audit.

None of these block the solo happy-path test; all are required for the full vision.

---

## 2. Per-step component map (what each step actually uses)

| Step | Pages / Components | Routes / Libs / Tables | Status |
|---|---|---|---|
| **Intake** | `app/admin/intake`, `components/admin/intake-form.tsx` | `/api/admin/intake` → `lib/intake.ts`; `opportunities`, `curated_solicitations`, `curated_solicitations.intake_meta` (mig 099) | EXISTS |
| **Upload RFP + N topics** | `app/admin/rfp-curation`, `components/rfp-curation/{upload-form,curation-workspace}.tsx` | `/api/admin/rfp-upload:304-416`, `/api/admin/extract-topics`, `opportunities.solicitation_id` (mig 013) | EXISTS |
| **Build matrix (volumes/items/style/compliance)** | `curation-workspace.tsx:2108+`, `topic-compliance-manager.tsx`, `topic-detail.tsx` | `solicitation_volumes`, `volume_required_items` (mig 012), `solicitation_compliance` (mig 001/027); `lib/compliance-resolver.ts` (3-layer merge) | EXISTS |
| **Per-opp deviation** | `topic-compliance-manager.tsx:397-429` | `.../topics/[topicId]/compliance` (PUT/DELETE); `apply-to-all-topics/route.ts:86-133` | PARTIAL (copy, not live overlay) |
| **Atomize / annotate** | `annotation-atomize-rail.tsx`, `pdf-viewer.tsx`, `atom-review.tsx` | `library/atomize`, `lib/import/{pdf,docx,text}-reader.ts` | PARTIAL (no xls; no skeleton gate) |
| **Request review → approve → push** | `curation-workspace.tsx:428-483,700-718` | `lib/tools/solicitation-{request-review,approve,push}.ts` (self-approve now allowed) | EXISTS |
| **Master cockpit** | `app/admin/cards`, `components/admin/master-cards.tsx` | aggregate over `opportunities ⋈ curated_solicitations ⋈ compliance` + bridge head + tenant-card counts | EXISTS |
| **Bridge fan-out** | — | `lib/opportunity-bridge.ts` (publish/fanOut/applyToTenant); `opportunity_bridge`, `tenant_opportunity_cards`, `tenant_bridge_cursor` (mig 094) | PARTIAL (publish-only; transitions bypass) |
| **Shadow into tenant** | `app/admin/tenants` → `/portal/[slug]/dashboard` | `verifyTenantAccess` admin bypass; `rfp_admin > tenant_admin` | EXISTS |
| **Buckets + rank** | `app/portal/[slug]/buckets`, `components/portal/spotlight-buckets.tsx` | `/api/portal/[slug]/buckets*`; `lib/bucket-ranking.ts`; `tenant_spotlight_buckets`, `tenant_bucket_scores` (mig 096) | PARTIAL (keyword-only, uncapped, no atoms) |
| **Cards + pin** | `components/portal/pipeline-cards.tsx` | `cards/[opp]/pin` → `lib/opportunity-pin.ts` (copyObject + `pinned_docs`) | PARTIAL (copy only; no viewer) |
| **Pay → portal** | `billing-panel.tsx`, `spotlight-detail-actions.tsx` | `stripe/checkout`, `stripe/webhook`; `lib/portal-launch.ts createPortal` | PARTIAL (redirect; no portal-on-pay) |
| **Portal / accept guardrails** | `app/portal/[slug]/portals`, `components/portal/proposal-portals.tsx` | `portals/[portalId]?action=accept` → `lib/{portal-launch,portal-workflow,provision-proposal}.ts` | EXISTS |
| **Canvas: draft/revise/review** | `proposal-workspace.tsx`, `canvas-editor.tsx`, `canvas-renderer.tsx`, `draft-all-sections.tsx`, `ai-revision-panel.tsx`, `canvas-sidebar.tsx` | `ai/draft`, `ai/review`, `sections/[id]/save`; `lib/tools/proposal-draft-section.ts` (Claude in frontend) | PARTIAL (no guardrail enforcement) |
| **Lock / advance / download** | `stage-control.tsx` | `sections/[id]/lock`, `advance` (`lib/proposal-advance.ts`), `lock`, `package?format=docx` | PARTIAL (advance leaves tasks open) |

---

## 3. Gap register (by workstream)

### A — Lifecycle & card model
| ID | Gap | Status | Evidence | Needed |
|---|---|---|---|---|
| A1 | Unified 6-state submission stage (NOFO/PRE-RELEASE/OPEN/UPDATED/CLOSED/ARCHIVED) | MISSING | 3 states split across `lifecycle_status` (mig 082:10-12), `topic_status` (mig 013:50-52), bridge `event_type` (mig 094:35). NOFO+UPDATED absent everywhere | One canonical enum + transition guards + UI to set all 6 |
| A2 | Rich card metadata | PARTIAL | Missing: `topic_acceptance`, pre-release **date**, distinct open date, org "unit" (3rd level), opp/topic-level **Expert Notes** (only per-volume/item, mig 086:22,25), first-class `released_by`/`release_datetime`/`built_by` (only in audit trail) | Add columns + capture on release + surface on card |
| A3 | Matrix deviation = live overlay, not copy | PARTIAL | `apply-to-all-topics:86-133` hard-copies baseline into each topic; later baseline edits don't propagate | Keep the read-merge; make cohort-seed a delta/patch or re-resolve on read |

### B — Bridge propagation & history
| ID | Gap | Status | Evidence | Needed |
|---|---|---|---|---|
| B1 | Lifecycle transitions + content edits fan out | PARTIAL | `[oppId]/lifecycle/route.ts` updates status + emits finder event but **never calls `publishAndFanOut`**; only initial `push` (`solicitation-push.ts:240`) + manual publish endpoint fan out; `archived` isn't a `BridgeEventType` (bridge:16) | Call `publishAndFanOut` in the lifecycle route + content-edit paths; add `archived` event |
| B2 | Per-tenant `card_activity` history | MISSING | Only design-doc (`V1_LOCKED_ARCHITECTURE:35-36`); `tenant_opportunity_cards` stores current state only; portal shows no history (`pipeline-cards.tsx`) | Create tenant-scoped append-only `card_activity` (RLS) + writer in `applyToTenant` + UI both levels |
| B3 | Self-healing replication | PARTIAL | `tenant_bridge_cursor` written (bridge:157-161) but **never read**; `backfillTenant` is manual and **not wired into onboarding** (no `OnApplicationAccepted`) | Cursor-driven catch-up consumer + backfill on tenant activation |

### C — Atomic library → atom-driven ranking (the central premise)
| ID | Gap | Status | Evidence | Needed |
|---|---|---|---|---|
| C4 | **Ranking uses the bucket's atoms** (semantic/embedding), not just keywords | MISSING | `bucket-ranking.ts:40-77` scores keyword/naics/agency/program/set-aside/timeline only; `library_units` + `embedding` never referenced; embeddings "stay NULL until Phase-4" (mig 080:4-5) | Generate embeddings on atomize; score cards by bucket-atom similarity (`<=>`) |
| C3 | Assign atoms to a bucket + provide context | MISSING | No `bucket_atoms` link, no UI; bucket = keyword criteria (mig 096:15-25) | `bucket_atoms` table + assignment UI + context capture |
| C5 | 5-bucket cap + pause/activate lifecycle | MISSING/PARTIAL | POST does bare INSERT, no cap (`buckets/route.ts:46-63`); DELETE = one-way `is_active=false` with no reactivate; list filters `is_active` so paused buckets vanish | Cap constant + reactivate endpoint + clean&launch + named tabs |
| C6 | Atom-change + activate rerank over global non-closed universe | MISSING | `rankBucket` only on manual `?action=rank` / criteria PATCH; ranks **local** `tenant_opportunity_cards` filtered `open` | Rerank triggers on atom add/activate; rank the global non-closed/archived opp list |
| C1 | xls/xlsx ingest | MISSING | Allowed types lack xls (`upload/route.ts:23`); only an xlsx **exporter** exists | Add xlsx reader + allow-list entry |
| C2 | Poor-extraction "PDF skeleton needs admin annotation" branch | PARTIAL | Coarse-atom fallback exists (`pdf-reader.ts:440-493`) + annotation UI (`atom-review.tsx`), but no quality gate; failed reads just archived | Extraction-confidence gate → distinct skeleton/annotation queue |
| C7 | Retire old fixed-taxonomy spotlight system | PARTIAL | mig 081 (5 hardcoded buckets, `spotlights/[id]/page.tsx:200-327`) coexists with mig 096; cutover not done | Migrate + remove the legacy system |

### D — Buckets landing page
| ID | Gap | Status | Evidence | Needed |
|---|---|---|---|---|
| D1 | Tabbed landing (per-bucket named tabs + cross-bucket best score + all-opps/per-bucket summaries + creation history) | MISSING | `spotlight-buckets.tsx` = create form + flat list + single-bucket ranked column | New landing page + `MAX(score)` cross-bucket view + summaries + history feed |
| D2 | Card rows: change-history + forward milestone dates + Pin + Pay | PARTIAL | Pin exists (`pipeline-cards.tsx:76-86`); only `closeDate` shown; no Pay, no history, no white-paper/topic-open dates | Forward-date model + per-card history + Pay button |

### E — Pin visualization
| ID | Gap | Status | Evidence | Needed |
|---|---|---|---|---|
| E1 | Customer-side viewer for pinned docs | MISSING | `pinned_docs`/`customerPinnedPath` written (`opportunity-pin.ts`) but never read/served; no `PdfViewer`/`CanvasRenderer` under `components/portal/`; customer UI links to **global** docs only | Wire a customer viewer to the pinned copy |

### F — Pay → portal → notifications
| ID | Gap | Status | Evidence | Needed |
|---|---|---|---|---|
| F1 | Stripe payment **modal** (pop up/down) | MISSING | Full-page redirect (`billing-panel.tsx:103,131,155`) | Modal checkout component |
| F2 | Payment success **creates a portal** | MISSING | Webhook inserts `purchases` + launches a task (`webhook:180-199`), never `createPortal`; `createPortal` only via paste-UUID form | Webhook `checkout.session.completed` → `createPortal` + `assumeShadowAdmin` |
| F3 | 72h notices: RFP admin (start clock) + customer admin (max turn) | PARTIAL/MISSING | Webhook sends **no email**; RFP-admin 72h email only on non-payment `proposals/create:630-673`; customer-admin notice absent | Webhook emails both parties on payment |

### G — Card-scoped audit
| ID | Gap | Status | Evidence | Needed |
|---|---|---|---|---|
| G1 | Emit + surface card history for pin/portal | PARTIAL | Pay audited (`checkout:113`, `webhook:149-203`); pin + portal-create emit **no** events; activity feed is tenant-wide, not card-scoped | Emit on pin/unpin/resync + portal create/accept/advance; card-scoped read |

### H — Canvas HITL into guardrails
| ID | Gap | Status | Evidence | Needed |
|---|---|---|---|---|
| H1 | **AI generates into the guardrails** | MISSING | `proposal-draft-section.ts:84-86` pageLimit = one prose hint; font ignored (no caller passes it); meter is `nodeCount/8` (`canvas-sidebar.tsx:324-378`) | Compute word/char/page budget from matrix; enforce on gen (max_tokens + validate/regenerate-to-fit) and on save |
| H2 | Acceptance by the **tasked** reviewer | MISSING | Lock/accept is `role==='admin'` (`sections/[id]/lock:78-84`); never calls `completeTask`; no per-section review task created | Create per-section review task on assignment; acceptance = assignee completing it (reuse `tasks.ts:245-291`) |
| H3 | Forced advance **closes open tasks/comments** | MISSING | `proposal-advance.ts` audits forced-open sections (`:202-209,282-288`) but never touches `tasks`/comments/gate-reqs | Cancel/complete open tasks + resolve comments in the advance transaction |
| H4 | Section lifecycle wired to tasks/nudges | PARTIAL | Ledger + 1 proposal-level `admin_review` task + portal ToDos exist; section draft/revise/accept/lock/advance create no tasks; no frontend nudge sweep (dormant pipeline) | Emit/complete section tasks; activate a nudge sweep |
| H5 | Interactive whole-section/document prompt window | PARTIAL | Per-node window exists (`ai-revision-panel.tsx`); whole-doc is a batch button that passes no `instructions` (`draft-all-sections.tsx`) though the API accepts them | Free-text prompt surface at section/doc scope |
| H6 | Resize text/list nodes + enforce page bound | PARTIAL | Only image nodes resize; page uses `minHeight` so content overflows the guardrail (`canvas-renderer.tsx:75`) | Resizable text nodes + hard page-height enforcement |

**Solid (EXISTS, no action):** upload+N-topics, 3-layer read-merge matrix, volume/style/submission defs, release-to-global, L0 append-only audit, master cockpit, admin bypass, section admin lock/unlock + artifact roll-up, forced-advance section audit, revision/versioning + audited acceptance mechanism, docx package gated on lock-or-final-stage.

---

## 4. Prioritized task backlog (dev → test → repeat)

Each epic = one PR-sized tranche. Build, then I document the HITL test doc for it and you run it.

**Tranche 1 — Card lifecycle spine (unblocks the real card model)**
- A1: canonical `submission_stage` enum (6 states) + transition guards + admin UI to set NOFO/UPDATED. Test: move a card NOFO→PRE-RELEASE→OPEN→UPDATED→CLOSED→ARCHIVED.
- B1: lifecycle route + content-edit paths call `publishAndFanOut`; add `archived` bridge event. Test: close an opp → every tenant card flips closed with a version bump.
- A2 (subset): add `released_by`, `release_datetime`, `built_by`, `open_date`, `pre_release_date`, opp-level `expert_notes`, org `unit` to the card + surface on `/admin/cards`. Test: released-by/dates render.

**Tranche 2 — Atom-driven ranking (the central premise)**
- C1 xlsx importer; C4 embeddings on atomize + `<=>` scoring; C3 `bucket_atoms` + assignment UI; C6 rerank triggers over the global non-closed universe; C5 5-cap + pause/activate. Test: assign atoms → Activate → global opps rank by atom similarity; add an atom → re-rank fires.

**Tranche 3 — Buckets landing page**
- D1 tabbed landing (named tabs, cross-bucket best score, summaries, creation history); D2 per-card change-history + forward milestone dates + Pin/Pay buttons; C7 retire mig-081. Test: 5 named bucket tabs + "all opps best score" + per-bucket summary render.

**Tranche 4 — Pay → portal → notifications + pin visualization**
- F1 Stripe modal; F2 webhook → `createPortal`; F3 72h emails (RFP admin start + customer admin cap); E1 customer pinned-doc viewer. Test: pay in modal → portal appears → both notices sent → pinned PDF renders in-portal.

**Tranche 5 — HITL depth**
- H1 AI-into-guardrails (budget + enforce); H2 tasked-reviewer acceptance; H3 forced-advance closes open tasks; H4 section-task wiring + nudge sweep; B2 `card_activity` + G1 card-scoped audit; H5/H6. Test: assigned reviewer accepts a section via task; force-advance closes open ToDos in the audit; AI output respects the page budget.

**Tranche 6 — Resilience**
- B3 cursor-driven catch-up + backfill-on-onboarding; A3 live-overlay deviation; C2 skeleton/annotation gate.

---

## 5. Sequencing note
Tranches 1–2 are the highest-value and are prerequisites for the rest (the lifecycle and the
atom-ranking are what the cards, buckets, and landing page all render). Recommend building in
order, one tranche per PR, each with its own HITL test doc appended to `docs/HITL_TEST_PLAN.md`.
