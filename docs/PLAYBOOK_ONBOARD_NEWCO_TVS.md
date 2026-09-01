# Playbook — onboard a new company, ingest a custom-format RFP, build the proposal

A **reusable, code-verified, one-off operator playbook**: stand up a brand-new customer company,
ingest a NON-federal custom-format opportunity (a state Economic-Development grant) into the master
Opportunities list, curate its format, and walk the proposal build to a downloadable package.

> **Worked example:** company **Fondation**, opportunity **TVSF** — the **real Ohio Third Frontier ·
> Technology Validation & Startup Fund** format, digested from the Economic-Development team's DMVEC
> Round-45 template into **`docs/runbook-assets/fondation-tvs/TVSF_FORMAT.md`** (a Proposal of 12
> questions at a 7-page limit with the Abstract excluded, plus a Budget by spend type). The *procedure*
> is format- and company-agnostic — swap the name + format to onboard the next company. Every step below
> is verified against the real route handlers / components / migrations (paths cited); example outputs
> are from a live sandbox drive. (An earlier `TVS_RFP_Fondation_MOCK.md` in the same folder is a
> superseded placeholder — use `TVSF_FORMAT.md`.)
>
> **Loading the TVSF opportunity itself** (dated "opened 2 weeks ago, closes in 2 weeks") is scripted in
> **`frontend/e2e/hitl-load-tvsf.spec.ts`** — the same proven `intake → curate(2 volumes) → approve →
> push` chain, with the real 2-volume TVSF format. Run it, then set the "opened" date (intake sets close
> + posted; `open_date` is not an intake field and push defaults it to `now()`), all in one window:
> ```bash
> cd frontend && npx playwright test e2e/hitl-load-tvsf.spec.ts --project=hitl   # prints OPPID=… SOLID=…
> psql "$DATABASE_URL" -c "UPDATE opportunities SET open_date=now()-interval '14 days',
>   posted_date=now()-interval '14 days', close_date=now()+interval '14 days' WHERE id='<OPPID>';"
> # refresh the fanned card with the corrected dates:
> curl -s -X POST http://localhost:3000/api/admin/opportunities/<OPPID>/publish -d '{"eventType":"updated"}'
> ```

## Conventions

Each step gives: **WHO** (role) · **DO** (the UI click) · **CALL** (the underlying route + payload) ·
**WRITES** (DB tables/columns) · **EMITS** (event) · **VERIFY** (how to confirm). You can drive every
step through the UI *or* the CALL directly (same handler).

## Prerequisites (once per environment)

- A running, seeded instance + the E2E operator accounts (`scripts/seed-e2e-hitl.mjs`,
  `docs/E2E_HITL_RUNBOOK.md §1`). This playbook uses **`e2e-rfpadmin@rfppipeline.test`** (rfp_admin)
  as the operator and **comp code `rfppipelinetest`** for the purchase.
- Roles used: **rfp_admin/master_admin** (Phases A–C admin side, release), **tenant_admin** (the new
  company's admin — created in Phase A — for purchase + build).

---

## PHASE A — Create the company (Fondation)

**Canonical path: Direct admin create.** It is the only true one-shot — it creates the tenant AND a
login-able `tenant_admin` AND the membership, seeds spotlight buckets, backfills opportunity cards,
offers the starter library, and emails credentials, with **no pre-existing application required**.
(The Application→Accept path does the same but only after a customer self-submits `/apply`; Waitlist is
lead-capture only, not a create path.)

### A1 — Open the New Company form
- **WHO** rfp_admin (or master_admin). **DO** sign in at `/login` → go to **`/admin/tenants`** → click
  **"+ New Company"**.
- Route gate: `hasRoleAtLeast(role,'rfp_admin')` (`app/api/admin/tenants/route.ts` ~L186) and the page
  gate at `app/admin/tenants/page.tsx` ~L41 — rfp_admin or master_admin only, else 403.

### A2 — Fill + submit
- **DO** enter **Company name** `Fondation` (required), **Admin POC email** `admin@fondation.test`
  (required), **Admin POC name** `Fondation Admin`, **Legal name** `Fondation, Inc.`, **Website**
  `https://fondation.example` → **Create company**. (`components/admin/new-company-form.tsx`)
- **CALL** `POST /api/admin/tenants`
  ```json
  { "name": "Fondation", "adminEmail": "admin@fondation.test",
    "adminName": "Fondation Admin", "legalName": "Fondation, Inc.",
    "website": "https://fondation.example" }
  ```
  Only `name` + a valid `adminEmail` are required.
- **WRITES** (one transaction, `route.ts` ~L212–251):
  - `tenants` INSERT `(name, slug='fondation', legal_name, website, status='active',
    lifecycle_stage='customer')` — slug auto-bumps on conflict; defaults `product_tier='finder'`,
    `subscription_status='none'`.
  - `users` INSERT `(email, name, role='tenant_admin', tenant_id, password_hash, temp_password=true,
    is_active=true)` for a new email (an existing email is reused + gets a `manual` membership).
  - `user_memberships` INSERT `(user_id, tenant_id, role='tenant_admin', status='active',
    source='home')` — this is what prevents the "No workspace assigned" dead-end.
  - Post-tx (best-effort): `tenant_spotlight_buckets` (6 default buckets), `tenant_opportunity_cards`
    + `tenant_bridge_cursor` (bridge-head backfill), one `tasks` row `starter_set_offer` → tenant_admin.
- **EMITS** `finder:tenant.created` (tenantId=null) · `library:starter_set.offered` (tenant-scoped) ·
  `capture:card.applied` (one per backfilled card).
- **Response 201** — capture these:
  ```json
  { "data": { "tenantId": "<uuid>", "slug": "fondation",
    "adminPoc": { "email": "admin@fondation.test", "isNewUser": true,
      "tempPassword": "<relay-if-email-unconfigured>", "emailSent": false },
    "cardsBackfilled": <n> } }
  ```
- **VERIFY**
  ```bash
  psql "$DATABASE_URL" -c "SELECT slug,status,product_tier,lifecycle_stage FROM tenants WHERE slug='fondation';"
  psql "$DATABASE_URL" -c "SELECT u.email,u.role,u.temp_password,m.status FROM users u JOIN user_memberships m ON m.user_id=u.id JOIN tenants t ON t.id=m.tenant_id WHERE t.slug='fondation';"
  ```

### A3 — First login (the new admin)
- **WHO** the Fondation tenant_admin (`admin@fondation.test`). **DO** sign in at `/login` with the
  **temp password** from A2 → middleware **forces `/change-password`** (`middleware.ts` ~L185–196,
  because `temp_password=true`) → set a real password → lands on `/portal/fondation/dashboard`.
- **VERIFY** `GET /api/auth/session` → `role=tenant_admin`, `tenantSlug=fondation`.

### Phase-A gotchas
- **Temp-password wall** — a fresh admin can't do anything until the reset. If email is unconfigured,
  relay `tempPassword` from the A2 response.
- **Empty `/cards`** — `cardsBackfilled=0` if no opportunity has been published to the bridge yet
  (that's fine here — we publish TVS in Phase C). Re-runnable any time via
  `POST /api/admin/tenants/[tenantId]/backfill-cards`; future admin publishes auto-fan-out to Fondation
  (status `active`).
- **Empty library by design** — the starter set is an *offer* (a ToDo), not an auto-seed; the admin
  clicks "Add starter set" on `/portal/fondation/atoms` when ready.
- **`product_tier='finder'`** — creation does NOT grant a paid build; the proposal-portal build is the
  separate comp-code purchase + release in Phase C.

---

## PHASE B — Ingest the TVS RFP into the master Opps list

**Canonical model (verified):** there is **no `solicitations` table** — the master record is
**`opportunities`**; **`curated_solicitations`** is the 1:1 curation wrapper keyed by `opportunity_id`.
Every API param called `solicitationId` = **`curated_solicitations.id`** (not the opportunity id).

**Use the file-upload door** (`/admin/rfp-curation/upload`), not `/admin/intake`. The intake door is
notice-only (JSON, no file) and hardcodes the program to SBIR/STTR/BAA/OTA/CSO — it has no way to mark a
custom format. The upload door exposes **Program Type = "Other"**, the custom-format escape hatch.
`opportunities.program_type` is free **TEXT with no CHECK**, so `'other'` (or any string via the API)
is valid, and nothing SBIR-specific is required.

### B1 — Open the upload form
- **WHO** rfp_admin. **DO** `/admin/rfp-curation` → **"+ Upload RFP"** → `/admin/rfp-curation/upload`
  (`app/admin/rfp-curation/upload/page.tsx`; gate rfp_admin+).

### B2 — Fill + attach the RFP, then submit
- **DO** — **Title** `TVS-2026-01 — Technology Validation & Startup Fund`; **Agency** (free-text) type
  `State Economic Development Office — Third Frontier`; **Program Type = "Other"** (the key step);
  **Solicitation #** `TVS-2026-01`; **Open/Close dates** `2026-08-01` / `2026-10-15`; paste the RFP
  description. **Drag the RFP file** (prefer **`.pdf`** so inline text extraction runs; `.docx` is
  accepted but won't auto-extract). Optionally drop the two **topic files** (TVS-2026-01-A / -B) into
  the topics zone for a multi-topic ingest. **UNCHECK "✨ Run Ingest Assist"** so the opp stays
  `status='new'` and un-fanned (see gotcha). Submit. (`components/rfp-curation/upload-form.tsx`)
- **CALL** `POST /api/admin/rfp-curation/upload` (multipart): `{ title, agency, office?, programType:'other',
  solicitationNumber, closeDate, postedDate, description, files[] }`. Accepts `.pdf .docx .xlsx .pptx
  .txt .md` (30 MB total); role rfp_admin+.
- **WRITES** (tx): `opportunities` (`source='manual_upload', is_active=true, program_type='other',
  content_hash=md5(title||desc||oppId)`) + `curated_solicitations` (`namespace='pending', status='new'`)
  + `solicitation_documents` (first PDF → `document_type='source'`, `extracted_text` inline). No shredder
  is required to land the OPP (shredding is an optional async pass off `finder:rfp.uploaded:end`).
- **EMITS** `finder:rfp.uploaded` start/end.
- **Response** `{ opportunity_id, solicitation_id, document_ids }` — capture both ids. **`solicitation_id`
  is the `curated_solicitations.id`** you use for topic/curation calls; `opportunity_id` for publish.
- **VERIFY** the opp appears in **`/admin/rfp-curation`** at `status='new'` (NOT `/admin/opportunities`
  — that page is a downstream rollup that only shows opps already fanned to a tenant):
  ```bash
  psql "$DATABASE_URL" -c "SELECT o.id opp, o.program_type, o.is_active, cs.id sol, cs.status FROM opportunities o JOIN curated_solicitations cs ON cs.opportunity_id=o.id WHERE o.title ILIKE '%TVS%';"
  ```

### B3 (optional) — Add topic files (1 solicitation + N topics → N opportunities, #183)
- **CALL** `POST /api/admin/upload-topic-files` (multipart `{ solicitationId=<sol_id>, files[] }`). Each
  file → a **topic `opportunities`** row (`is_active=true`, `topic_number` parsed from filename,
  `origin_document_id`) + `solicitation_documents` (`document_type='topic'`); flips the umbrella
  `curated_solicitations.solicitation_type='multi_topic'`. **EMITS** `finder:topic.imported`.
  (`.pdf/.txt/.md` extract text; `.docx` stores only.)

### B-alt — Storage-free ingest door (no file; what the live drive used)
If object storage (R2/S3) is **not** configured, the file-upload door 500s at the storage-put step with
`[storage/s3-client] AWS_S3_BUCKET_NAME is required in production`. The **notice/intake door** is
storage-free and creates the same master record without a file:
- **CALL** `POST /api/admin/intake` (JSON) `{ title, agency, programType:'other', solicitationNumber?,
  closeDate:'2026-10-15', description? }` (role rfp_admin+; requires `title`+`agency`; `programType` is
  free text via the API even though the UI select omits "other"). **WRITES** `opportunities`
  (`is_active=false`, `program_type` free text) + `curated_solicitations` (`status='new'`). **EMITS**
  `finder:opportunity.staged`. **Response** `{data:{opportunityId, solicitationId, status:'new'}}`.
- Curate it identically (Phase C); the push sets `is_active=true`. Use this door in a sandbox / any env
  without R2; use the **file-upload door in production** to attach the actual RFP document.

### Phase-B gotchas
- **File-upload door needs object storage (R2/S3).** `POST /api/admin/rfp-curation/upload` puts the file to
  `rfp-pipeline/{oppId}/…`; without `AWS_S3_BUCKET_NAME` it 500s. Prod has R2; a bare sandbox does not —
  use the intake door (B-alt) there.
- **Uncheck "Run Ingest Assist"** unless you want the opp published to EVERY tenant on upload (it calls
  `publishAndFanOut`). For a curate-first custom opp, leave it unchecked → stays `status='new'`.
- **`/admin/opportunities` won't show a fresh (un-fanned) opp** — verify in `/admin/rfp-curation`.
- **`solicitationId` is always `curated_solicitations.id`**, never the opportunity id.
- **Duplicate file → hard 409** (global SHA-256 on `solicitation_documents`). Rename/modify to re-ingest.

---

## PHASE C — Curate the format → push → purchase → release/provision

This is the heart of the "new format" work: because a state econ-dev grant has **no preset** (all seeded
presets are SBIR/CSO), you DEFINE the TVS volumes + required items + compliance matrix by hand. Curation
state machine: `curated_solicitations.status` = `new → claimed → curation_in_progress →
review_requested → approved → pushed_to_pipeline`.

### C1 — Open the curation workspace + claim + advance to editable state
- **WHO** rfp_admin. **DO** `/admin/rfp-curation` → click the TVS row → `/admin/rfp-curation/<solId>`
  (loads `solicitation_compliance` + `solicitation_volumes`⋈`volume_required_items` +
  `document_templates` into `curation-workspace.tsx`).
- **CALL** `POST /api/admin/rfp-curation/<solId>/triage {action:'claim'}` → `status='claimed'`,
  `curated_by=you`; writes `triage_actions`; **EMITS** `finder:solicitation.triaged`.
- **CALL** `POST /api/admin/rfp-curation/<solId>/triage {action:'skip_shredder'}` → `curation_in_progress`.
  **You must reach `curation_in_progress` before `request_review`/`approve` will accept** (the state machine
  CAS's on the from-state; `request_review` from `claimed` returns 409).

### C2 — Define the TVS format (volumes + required items + matrix)  ✅ proven live
Map the mock RFP §3 (V1–V6) onto the system with the bulk skeleton call. **CRITICAL — the `parsed`
payload is camelCase and uses these EXACT keys (verified against `lib/ingest/materialize.ts`), NOT the DB
column names:** volumes are `{ name, format, items:[{ name, type, pageLimit?, notes? }] }` and compliance is
`{ submissionFormat, requiredSections, requiredDocuments, … }`. Using `volume_name`/`required_items`/
`item_type`/`page_limit` binds `undefined` → **`UNDEFINED_VALUE` 500 "Failed to build the skeleton"**.
- **CALL** `POST /api/admin/rfp-curation/<solId>/ingest-assist`
  ```json
  { "publish": false,
    "parsed": {
      "compliance": { "submissionFormat": "Single combined PDF per volume",
        "requiredSections": ["Project Narrative","Commercialization Plan","Ohio Economic Impact"],
        "requiredDocuments": ["Match-commitment letter(s)","Key-personnel bios"] },
      "volumes": [
        { "name":"Cover & Eligibility", "format":"custom", "items":[{ "name":"Applicant & eligibility form", "type":"form_other" }] },
        { "name":"Project Narrative", "format":"custom", "items":[{ "name":"Technology & work plan", "type":"word_doc", "pageLimit":12 }] },
        { "name":"Commercialization & Market-Entry Plan", "format":"custom", "items":[{ "name":"Market & path to revenue", "type":"word_doc", "pageLimit":6 }] },
        { "name":"Budget & Match", "format":"custom", "items":[{ "name":"Line-item budget + match schedule", "type":"spreadsheet" }] },
        { "name":"Ohio Economic-Impact Statement", "format":"custom", "items":[{ "name":"Jobs & follow-on investment", "type":"word_doc", "pageLimit":2 }] },
        { "name":"Supporting Documents", "format":"custom", "items":[{ "name":"Binding match-commitment letter", "type":"pdf" }] }
      ] } }
  ```
  `parsed.volumes` sets `source='override'` (skips AI parsing). **Response** `{data:{source:'override',
  volumes:6, items:6, topics:0, cards:0}}`. **WRITES** (via `materializeSkeleton`): DELETE+INSERT
  `solicitation_compliance`, `solicitation_volumes`, `volume_required_items` for the sol.
- **Coercion:** `format` is coerced to `{dsip_standard,l_and_m,custom}` (use **`custom`**); `type` is coerced
  to `{word_doc,slide_deck,spreadsheet,pdf,text,form_sf424,form_sbir_certs,form_other,other}` — use
  `word_doc`/`spreadsheet`/`pdf`/`form_other` for a state grant. `volume_number`/`item_number` are
  auto-assigned; `required` is forced `true`.
- **Fine-grained alternative:** `POST /api/tools/volume.add {input:{…}}` then
  `POST /api/tools/volume.add_required_item {input:{…, template_id?, expert_notes?}}` per item.
- **Attach a mold (optional):** author it via `POST /api/admin/templates` → `document_templates`
  (`canvas_preset` + `canvas_document`), then pass its id as `template_id` on a required item — provision
  (C7) hydrates that section's content from the mold.

### C3 — Set the push-gate variables
- **`submission_format`** (the ONE required compliance var for push) — set in the workspace via
  `invoke('compliance.save_variable_value')` → `solicitation_compliance.custom_variables.submission_format`
  (already set above via `ingest-assist.compliance`).
- **`spotlight_summary`** (also required for push) — **CALL** `PATCH /api/admin/rfp-curation/<solId>
  {spotlightSummary:"TVS Technology Validation & Startup — Ohio econ-dev commercialization grant; 1:1
  match; validation to milestone."}` → `curated_solicitations.spotlight_summary`; **EMITS**
  `finder:solicitation.summary_updated`.
- **`close_date`** on the umbrella opp AND every topic (the DATE GUARD). Set the RFP close date
  (2026-10-15). Estimates are allowed via `dates_estimated`. (Only `close_date` is enforced; `open_date`
  auto-fills at push.)

### C4 — Request review + approve
- **CALL** `POST /api/admin/rfp-curation/<solId>/triage {action:'request_review'}` → `review_requested`.
- **CALL** `POST /api/tools/solicitation.approve {input:{solicitationId:'<solId>'}}` → `approved`
  (requires `curated_by` set; solo self-approve is allowed and flagged in `curation_revisions`). **EMITS**
  `finder:solicitation.approved`.

### C5 — PUSH (activate → bridge → Fondation's cards)
- **CALL** `POST /api/tools/solicitation.push {input:{solicitationId:'<solId>'}}` (rfp_admin). **Three
  hard gates**, each 400 on failure: (a) `submission_format` present, (b) non-empty `spotlight_summary`,
  (c) **DATE GUARD** (mig 128) — every opp under the sol must have `close_date`.
- **WRITES** (atomic): `curated_solicitations → status='pushed_to_pipeline'`; `opportunities →
  is_active=true, submission_stage='open', open_date=COALESCE(open_date,now())` (umbrella + all topics);
  `opportunity_bridge` INSERT (version, `card` snapshot); `tenant_opportunity_cards` upsert (forward-only)
  for every tenant `status IN ('active','trial')`. **EMITS** `capture:card.applied` per tenant, then
  `finder:solicitation.pushed` LAST.
- **Fondation's card:** because Fondation was created in Phase A with `status='active'`, the push fans the
  TVS card straight to it. **If you push BEFORE creating Fondation** (or a timing gap), catch it up:
  `POST /api/admin/tenants/<fondationTenantId>/backfill-cards` (idempotent bridge-head replay).
- **VERIFY** `psql -c "SELECT submission_stage, lifecycle_status FROM tenant_opportunity_cards c JOIN
  tenants t ON t.id=c.tenant_id WHERE t.slug='fondation' AND c.opportunity_id='<oppId>';"`

### C6 — PURCHASE the portal (customer, comp code)
- **WHO** the Fondation **tenant_admin**. **DO** `/portal/fondation/cards` → open the TVS card → **pin**
  it (`POST /api/portal/fondation/cards/<oppId>/pin`) → **Buy proposal portal** → enter comp code
  **`rfppipelinetest`**.
- **CALL** `POST /api/portal/fondation/purchase {opportunityId:'<oppId>', promoCode:'rfppipelinetest'}`
  (gate tenant_admin+ · verifyTenantAccess). **WRITES** (one RLS tx): `promo_codes` lookup (must be
  `kind='comp'`, active) → `proposal_portals (status='curation_pending', paid_at, curation_due_at=now()+72h)`
  (409 `ALREADY_PURCHASED` on repeat) · `purchases (amount_cents=0, status='completed', metadata.comp)` ·
  `promo_codes.used_count++` · `shadow_admin_grants (source='t_and_c')` (this is what lets an rfp_admin
  curate/release inside the tenant). **EMITS** `capture:purchase.completed` → a **72h rfp_admin curation
  ToDo**. Response `{portalId, status:'curation_pending', curationDueAt, comp:true}`.
- **VERIFY** the customer UI shows "Waiting for RFP Expert Curation"; the rfp_admin sees the curation ToDo.

### C7 — RELEASE + PROVISION (rfp_admin unlocks the build)
- **WHO** rfp_admin (follows the 72h ToDo into Fondation's shadow account — the `shadow_admin_grants`
  from C6). **A buying tenant_admin CANNOT self-release** — release re-checks
  `hasRoleAtLeast(role,'rfp_admin')`.
- **CALL** `POST /api/portal/fondation/portals/<portalId>?action=release {guardrailConfig?}` (default =
  DEFAULT_RELEASE_GUARDRAILS: draft/review/final). **Provision runs BEFORE the status flip** (retry-safe):
  - `proposals` INSERT `(stage='draft', is_locked=false /* UNLOCKED */, gate_config)`.
  - `proposal_artifacts` per volume (V1–V6; `artifact_type='cost'` for the Budget & Match volume, else
    `'narrative'`).
  - `proposal_sections` per required item (`status='empty'`, `page_allocation`, `volume_name`).
  - **`proposal_compliance_matrix` per required item (`status='not_addressed'`, `section_id`)** — the
    matrix **populates HERE at release, not at purchase**, so the card sits at 0% until release.
  - Mold hydration: any item with `template_id` → its section content interpolated from
    `document_templates.canvas_document`, `status='ai_drafted'`.
  - Flip: `proposal_portals.proposal_id` set, then `status='launched'` (CAS `WHERE curation_pending`).
  - **EMITS** `proposal:proposal.created` (→ pipeline `section_drafter` V0) + `capture:workspace.released`.
    Response `{released:true, proposalId, tasksCreated}`.
- **VERIFY** `psql -c "SELECT id,stage,is_locked FROM proposals WHERE id='<proposalId>';"` (draft,
  unlocked) and `psql -c "SELECT status,count(*) FROM proposal_compliance_matrix WHERE
  proposal_id='<proposalId>' GROUP BY status;"` (rows at `not_addressed`). The build is now UNLOCKED →
  proceed to **Phase D**.

### Phase-C gotchas
- **No preset for a state grant** — define the TVS format via `ingest-assist` `parsed` override (above),
  `apply-preset` with a **raw** `{compliance, volumes}` body (not a `presetId`), or the `volume.*` tools.
- **`submission_format` + `spotlight_summary` + `close_date`** are the three push prerequisites.
- **Matrix populates at RELEASE**, not purchase — expect 0% between C6 and C7.
- **rfp_admin re-gate on release** — the customer cannot self-release; an admin must (via the shadow grant).
- **Provision is idempotent** and precedes the status flip, so a failed release leaves `curation_pending`
  and is safely retryable.

---

## PHASE D — Walk the proposal build to a package

**Precondition:** Phase C released + provisioned an **UNLOCKED** Fondation build with sections + the TVS
compliance matrix. Operator = the Fondation **tenant_admin** (or an rfp_admin via shadow — both resolve
to `access.role==='admin'` in `lib/proposal-access.ts`).

> **D0 — Understand the load-bearing gate first: locked ⇄ unlocked is TWO-WAY.**
> - **UNLOCKED** (fresh provision): you can draft/edit/lock sections — but **export 403s**
>   (`canExport = lock_count >= 1`).
> - Advancing to **`final` auto-locks to `submitted`** → export works, but **save 423s** and re-advance
>   409s.
>
> So the only path that ends in a download is: **draft → lock sections (matrix advances) → advance
> (auto-lock) → download.** You cannot download an all-unlocked build; you cannot edit an accepted
> section without unlocking it first.

### D1 — Open the build
- **WHO** tenant_admin. **DO** `/portal/fondation/proposals/<id>` (`app/portal/[tenantSlug]/proposals/
  [proposalId]/page.tsx`; `verifyProposalAccess` else redirect). Renders `<ProposalWorkspace>` —
  `<StageControl>` + the sections + the **compliance matrix** (from `proposal_compliance_matrix`). The
  **AI Actions + "Run full draft" panel** lives in the admin panel's **"AI & Library"** tab (admin only).
- **VERIFY** the matrix shows the TVS required items (V1–V6 from Phase C provision); sections listed.

### D2 — Draft sections (AI-assist)
- **(a) "Draft All Sections"** (the button on empty sections) — the *synchronous* drafter: per empty
  section it ranks `library_atoms`, runs the `proposal.draft_section` tool **in the Next.js process**,
  and persists via the section save route (`status='ai_drafted', source='ai_draft'`; prior content →
  `canvas_versions`). With the **frontend `ANTHROPIC_API_KEY`** it writes real prose; **without it you get
  placeholder scaffolding** (`source:'template'`) — no error.
- **(b) "Draft with AI"** button (AI & Library tab) → `POST .../ai/draft` — this only **counts** empty
  sections and returns `{data:{sections_queued}}`; it does NOT draft. (Emits `proposal.draft_requested`.)

### D3 — Run full draft (Proposal Draft Manager, P4)
- **DO** "AI & Library" tab → **"Run full draft"**: pick **Mode** (A · V0.1 HITL / B · V0.2 restyle /
  C · V0.5 full auto), optional **Voice**, and — Mode C — the **Adversarial gate** (Human review / Auto).
- **CALL** `POST .../full-draft` `{ mode, voice?, adversarial?, adversarialPolicy? }` (role tenant_admin+;
  `adversarial`+`adversarialPolicy` sent only for Mode C). Persists `proposals.voice`. **EMITS** the sole
  `proposal.full_draft_requested` (its END payload is the pipeline trigger — snake_case incl.
  `adversarial`, `adversarial_policy`, `adversarial_resolution`). Returns `{requested:true, mode, adversarial}`.
- **Pipeline:** `OnFullDraftRequested{A,B,C}` → `section_drafter` (needs the **pipeline
  `ANTHROPIC_API_KEY`**, distinct from D2's) → `publish_section_draft` lands content `status='ai_drafted'`
  (unlocked, review-staged) — **never auto-advances**; a guardrail `review` verdict HOLDS a section.
  Mode C also runs `cost_estimator` + `packaging_specialist` + the review-gate cohort; the adversarial
  gate elevates that cohort to the AdvisoryOverlay (HITL or auto landing).
- **VERIFY** section version history shows `ai_drafted` revisions; `system_events` has
  `proposal.full_draft_requested`. (With `sk-noop` keys the agent steps skip — the HITL gates still appear.)

### D4 — Review + Accept & Lock (the matrix advances here)
- **DO** review/edit in the canvas editor, then Artifacts tab → **"✓ Accept & Lock"** per section (or
  **"Accept & Lock All"**, or **"Lock Volume"**).
- **CALL** `POST .../sections/[id]/lock` → `lockSectionCore` (`lib/proposal/lock-section.ts`): section →
  `status='approved', is_locked=true`; **`proposal_compliance_matrix.status → 'satisfied' WHERE
  section_id`** (the matrix advance); accepted `canvas_versions` snapshot; harvest to `library_atoms`;
  artifact roll-up (a volume locks when all its sections lock); `proposal.advance_ready` when ALL sections
  lock. Role must be `admin`. **EMITS** `section.locked`.
- **VERIFY** the matrix row flips to **satisfied**; the section shows locked. (Unlock = `DELETE` reverses
  matrix → `not_addressed`.)

### D5 — Advance the stage
- **DO** `<StageControl>` **"Advance to X →"** (or admin **"Force advance to V1"**).
- **CALL** `POST .../advance {force?}` → `advanceProposalStage` (`lib/proposal-advance.ts`): **GATE** —
  every REQUIRED section must be `is_locked` else **422 `SECTIONS_NOT_LOCKED`** (with `details.openSections`)
  unless `force`; unmet `stage_gate_requirements` → 422. Writes `stage_completion_snapshots`, CAS
  `proposals.stage`. Target **`final` → auto-lock to `submitted`** (`lock_count+1`). **EMITS**
  `proposal.advanced`. (V0.5→V1 relabel is UI-only; the DB path is draft→…→final→submitted.)
- **VERIFY** stage label moves; `proposal.advanced` event present.

### D6 — Package + download
Export is now unlocked (`lock_count ≥ 1`, or stage `submitted`).
- **(A) Whole proposal** — Artifacts tab **"Download Proposal (.docx)"** / **"Download all (.zip)"** →
  `POST .../package?format=docx|zip`. `docx` assembles every `proposal_sections.content` into one
  `CanvasDocument` → `.docx`. `zip` = **`packaging_specialist` manifest across ALL volumes**
  (narrative→docx, slides→pptx, cost→xlsx; fails the whole zip if any volume can't render — no silent
  partial). Increments `proposals.download_count`; **EMITS** `package.exported`.
- **(B) Per-volume native** — each locked volume's **"Download"** (`format=auto`) / **"PDF"** →
  `GET .../artifacts/[artifactId]/export?format=auto|pdf`. PDF needs Chromium → **503 `PDF_UNAVAILABLE`**
  if absent.
- **DOWNLOAD GATE:** `!isLocked && stage ∉ {submitted,archived}` → **403**. Lock at least one section (or
  advance to final) before downloading.

### Phase-D gotchas
- **Two `ANTHROPIC_API_KEY`s, both silent-degrade.** Frontend key → the synchronous `Draft All`/re-draft
  tool (else placeholder). Pipeline key → the async `full-draft` `section_drafter` + advance-time
  `color_team_reviewer` (else those sections skip). Neither errors the UI.
- **Matrix advances ONLY on lock** — not on save/draft/full-draft. It tracks *accepted* content, keyed by
  `section_id` seeded at provision.
- **Full draft never advances a gate** — it lands `ai_drafted` (unlocked); you still Accept & Lock, then
  Advance. `publish_section_draft` also won't overwrite a section you've edited past `ai_drafted` or locked.
- **Optimistic concurrency** — section save CAS on `baseVersion` (409), stage advance CAS on
  `proposals.version` (409). `lock_count ≥ 2` surfaces "Further changes require RFP Pipeline support."

---

## Live verification (what was driven vs traced)

The **entire chain A → C7 was driven live** through the real route handlers and passes — producing a
real provisioned, unlocked Fondation build with the exact 6-volume TVS format + matrix:

| Step | Call | Result (example run) |
|---|---|---|
| A create company | `POST /api/admin/tenants` | **201** → tenant `fondation-906622`, 8 cards backfilled |
| B ingest → master Opps | `POST /api/admin/intake` | **200** → `opportunityId`, `solicitationId`, `status='new'` |
| C1 claim + skip_shredder | `POST …/triage` ×2 | **200** → `curation_in_progress` |
| C2 define 6 TVS volumes | `POST …/ingest-assist` | **200** → `{source:'override', volumes:6, items:6}` |
| C3 spotlight_summary | `PATCH …/rfp-curation/<solId>` | **200** |
| C4 request_review + approve | `POST …/triage`, `…/solicitation.approve` | **200** → `approved` |
| C5 push → bridge/cards | `POST …/solicitation.push` | **200** → `pushed_to_pipeline`; card fans to Fondation |
| C6 comp-code purchase | `POST /api/portal/<slug>/purchase` | **200** → portal `curation_pending`, `comp:true` |
| C7 release + provision | `POST …/portals/<portalId>?action=release` | **200** → `{released:true, proposalId}` |

**Provisioned build verified in the DB:** the proposal is `stage='draft', is_locked=false`; **6
`proposal_artifacts`** materialized from the custom TVS volumes (Budget & Match correctly typed `cost`,
the rest `narrative`); **6 `proposal_sections`** (all `status='empty'`, ready to draft); **6
`proposal_compliance_matrix`** rows (`not_addressed`, advance to `satisfied` on lock); portal `launched`.
→ **Phase D is walkable on this build.**

Run the two drivers (after §1 spin-up + seed, in a window where postgres is up):
```bash
cd frontend
# A → C5 (rfp_admin: create → ingest → curate → push)
TEST_BASE_URL=http://localhost:3000 npx playwright test e2e/hitl-onboard-tvs.spec.ts --project=hitl
# C6 → C7 (tenant_admin buys, rfp_admin releases) — supply the pushed card + a login-able admin:
FOND_SLUG=<slug> FOND_OPP=<opportunityId> FOND_ADMIN=<tenant_admin_email> \
  npx playwright test e2e/hitl-onboard-tvs-build.spec.ts --project=hitl
```
> The new tenant_admin's temp password must be reset before the C6 login (Phase A gotcha): either set a
> real one via `/change-password`, or `UPDATE users SET password_hash=crypt('…',gen_salt('bf',12)),
> temp_password=false WHERE email=…`.

**Phase D's full-draft** (the P4 route) is separately proven green by `frontend/e2e/hitl-full-draft.spec.ts`;
the draft → lock (matrix advance) → advance → package/download chain is trace-verified (§D). *Minor
finding:* the card `pin` route returned 500 in the drive but is not required — `POST …/purchase` takes
`opportunityId` directly.

## Reuse — onboarding the next company

Repeat Phase A with the new name/email; ingest that company's RFP (Phase B); curate its format
(Phase C — define ITS volumes/matrix); purchase + release; build (Phase D). The only per-company
inputs are the **company name + admin email** (Phase A) and the **RFP + its volume/matrix definition**
(Phases B–C). Everything else is the same procedure.
