# MVP Development Plan — Spotlight + Proposal Portal

**Target:** Fully functional product from Spotlight subscription through
collaborative phased proposal package delivery with compliance-anchored
AI drafting, WYSIWYG canvas editing, and MS Office export.

**Structure:** 6 phases, each with discrete agent-executable tasks.
Manager (Claude) orchestrates, monitors, and validates each task before
advancing. No task exceeds 100 lines or 3 minutes of agent work.

---

## Phase 1: Spotlight Pipeline (Admin → Customer)

**Goal:** Admin uploads RFP → curates → pushes to Spotlight → customer
sees scored matches → pins topics.

### What Gets Built

**UI Changes:**
- 5 admin curation API routes replace 501 stubs → the curation workspace buttons (Claim, Push, Save Compliance) actually work server-side
- Spotlight detail page shows full topic info: title, agency, funding, close date, tech areas, compliance preview, "Pin" and "Build Proposal" buttons
- Billing UI on customer portal: current subscription status, Stripe checkout button, manage billing link

**Database:**
- Migration 020: `subscriptions` (tenant_id, stripe_customer_id, stripe_subscription_id, status, current_period_start/end), `invoices` (stripe_invoice_id, amount, status, paid_at), `payment_events` (webhook audit trail)
- No changes to existing tables — all curation tables (curated_solicitations, solicitation_compliance, solicitation_volumes, volume_required_items) already exist

**API Routes (6 stubs → real):**
- `GET /api/admin/rfp-curation` → query curated_solicitations with status filter, join opportunity data
- `POST /api/admin/rfp-curation/[solId]/claim` → invoke `solicitation.claim` tool (already registered)
- `POST /api/admin/rfp-curation/[solId]/push` → invoke `solicitation.push` tool
- `GET/POST /api/admin/rfp-curation/[solId]/compliance` → list/save compliance variables via tools
- `GET /api/admin/rfp-curation/[solId]` → solicitation detail with documents, topics, volumes
- `POST /api/stripe/checkout` → Stripe Checkout session creation
- `POST /api/stripe/webhook` → Stripe event handler (idempotent, verifies signature)
- `GET /api/stripe/portal` → Stripe customer portal redirect

**Agents:** No new agents. Existing tools (solicitation.claim, solicitation.push, compliance.save_variable_value) get wired to their API routes.

**Automation/Audit:**
- All curation actions already emit events (finder.solicitation.claimed, finder.solicitation.pushed, etc.)
- Stripe webhook creates `payment_events` audit rows for every Stripe event
- `identity.subscription.created` and `identity.subscription.canceled` events added
- CRM event listener picks up subscription events → sends welcome email with Spotlight access instructions

### 1.1 — Fix remaining Spotlight data flow
| Task | Description | Files | Agent Size |
|------|-------------|-------|------------|
| 1.1.1 | Wire `/api/admin/rfp-curation/route.ts` — list solicitations with status filters (replace 501 stub) | 1 file | Small |
| 1.1.2 | Wire `/api/admin/rfp-curation/[solId]/claim/route.ts` — call solicitation.claim tool | 1 file | Small |
| 1.1.3 | Wire `/api/admin/rfp-curation/[solId]/push/route.ts` — call solicitation.push tool | 1 file | Small |
| 1.1.4 | Wire `/api/admin/rfp-curation/[solId]/compliance/route.ts` — list/save compliance vars | 1 file | Small |
| 1.1.5 | Wire `/api/admin/rfp-curation/[solId]/route.ts` — get solicitation detail | 1 file | Small |
| 1.1.6 | Spotlight detail page `/portal/[slug]/spotlights/[id]/page.tsx` — replace stub with topic detail + pin button + compliance preview | 1 file | Medium |
| 1.1.7 | HITL test: upload real BAA PDF → claim → curate → push → verify appears in customer Spotlight | Manual test | — |

### 1.2 — Stripe billing
| Task | Description | Files | Agent Size |
|------|-------------|-------|------------|
| 1.2.1 | Migration 020: `subscriptions`, `invoices`, `payment_events` tables | 1 file | Small |
| 1.2.2 | `/api/stripe/checkout/route.ts` — create Stripe checkout session for Spotlight ($299/mo) | 1 file | Medium |
| 1.2.3 | `/api/stripe/webhook/route.ts` — handle checkout.session.completed, invoice.paid, subscription.canceled | 1 file | Medium |
| 1.2.4 | `/api/stripe/portal/route.ts` — Stripe customer portal redirect (manage billing) | 1 file | Small |
| 1.2.5 | Billing UI component — current plan, payment status, manage button | 1 file | Medium |
| 1.2.6 | Wire Stripe into accept flow — create Stripe customer on tenant creation | 1 file edit | Small |
| 1.2.7 | HITL test: accept application → Stripe checkout → subscription active → portal access | Manual test | — |

---

## Phase 2: Proposal Portal Purchase + Provisioning

**Goal:** Customer buys a proposal portal for a pinned topic → workspace
provisioned with sections from volumes → compliance matrix loaded →
ready for AI drafting.

### What Gets Built

**UI Changes:**
- "Build Proposal" button on Spotlight detail page triggers Stripe checkout for portal purchase ($999/$1999)
- Proposal workspace page renders real section data from volume_required_items — section number, title, page allocation, format requirements
- Stage progress bar (Outline → Draft → Pink → Red → Gold → Final → Submitted) shows current position
- Canvas editor loads with compliance-aware presets — correct font, margins, page limit, header/footer templates with {company_name}, {topic_number}, {page n of N} interpolation
- Version history dropdown — revert to any previous save

**Database:**
- `proposals` row created with stage='outline', linked to opportunity (topic) and tenant
- `proposal_sections` rows created from `volume_required_items` — one section per required item with title, section_number, page_allocation, status='empty'
- `canvas_versions` row saved on every canvas save — version_number, content JSON snapshot, created_by, snapshot_reason

**API Routes:**
- `POST /api/portal/[slug]/proposals/create` — already built, validates against duplicate proposals, provisions sections from volumes
- `PUT /api/portal/[slug]/proposals/[id]/sections/[sectionId]/save` — persist CanvasDocument JSON, increment version, snapshot to canvas_versions
- Portal artifact provisioner copies compliance.json + outline + templates from `rfp-pipeline/{opportunityId}/` to `customers/{slug}/proposals/{proposalId}/`

**Agents:**
- `portal_provisioner.py` in pipeline copies S3 artifacts from master curation to customer sandbox
- Provenance chain: every canvas node tracks `source: 'template'` with original template_id

**Automation/Audit:**
- `capture.proposal.purchased` event already fires — CRM sends confirmation email
- `proposal.section.saved` event on every save with actor, version number, section_id
- `capture.proposal.provisioned` event when S3 copy completes with artifact manifest

### 2.1 — Portal purchase flow
| Task | Description | Files | Agent Size |
|------|-------------|-------|------------|
| 2.1.1 | "Build Proposal" button on Spotlight detail page → triggers purchase API | 1 file edit | Small |
| 2.1.2 | `/api/portal/[slug]/proposals/create/route.ts` — verify it provisions sections from volume_required_items (already built, needs HITL test) | Test | — |
| 2.1.3 | Portal artifact provisioner — copy compliance.json + outline + templates from master to customer S3 sandbox | 1 file | Medium |
| 2.1.4 | Proposal workspace page — verify section list, status indicators, stage progress bar work with real data | Test + fixes | Small |
| 2.1.5 | HITL test: pin topic → create proposal → verify sections appear with correct titles/page limits | Manual test | — |

### 2.2 — Section canvas initialization
| Task | Description | Files | Agent Size |
|------|-------------|-------|------------|
| 2.2.1 | Load compliance constraints per section from volume_required_items (font, margins, page limit) into canvas preset | 1 file edit | Small |
| 2.2.2 | Canvas header/footer templates — interpolate {company_name}, {topic_number}, {page n of N} | 1 file edit | Medium |
| 2.2.3 | Section save API — persist CanvasDocument JSON to proposal_sections.content | 1 file (verify existing) | Small |
| 2.2.4 | Canvas version history — save snapshot on each save to canvas_versions table | 1 file | Small |

---

## Phase 3: AI Drafting + Library Integration

**Goal:** AI drafts each section using library atoms + RFP context +
compliance constraints. Customer reviews, revises, accepts.

### What Gets Built

**UI Changes:**
- "Draft All Sections" button triggers sequential AI drafting — per-section progress with drafting/done/failed indicators (already built, needs live Claude test)
- AI Revision Panel sidebar — 8 quick actions (Regenerate, Make shorter/longer, More specific, Simpler language, Stronger opening, Add metrics, Fix compliance) + custom prompt input (already built)
- "Replace with library content" button searches library by content similarity and feeds matching atoms to Claude for rewrite (already built, upgraded this session)
- NEW: Library picker component — "Insert from Library" button opens a ranked list of candidate atoms from the customer's library, filterable by category, sorted by outcome_score. Click to insert as a new canvas node with `provenance.source = 'library'`
- NEW: "Save to Library" button on each canvas node — saves accepted content back to library_units with atom_hash dedup, category, tags
- NEW: Inline text editing — click any text_block to edit directly in the WYSIWYG canvas
- NEW: Drag-drop node reordering within a section
- Compliance sidebar tab shows: page limit (current vs max), required subsections checklist, evaluation criteria with check/uncheck
- Real-time page count indicator — green when under limit, yellow at 90%, red when over

**Database:**
- `library_units.embedding` column (vector(1536)) populated on atom creation via Claude embedding API
- No new tables — library_units, library_atom_outcomes, canvas_versions all exist

**API Routes:**
- `POST /api/tools/proposal.draft_section` — already wired, calls Claude Sonnet with system prompt + library atoms + RFP excerpt + compliance constraints → returns CanvasNode[] JSON
- `POST /api/tools/library.search_atoms` — upgraded to support vector similarity search when embedding column is populated
- `POST /api/tools/library.save_atom` — already wired with atom_hash dedup
- NEW: `POST /api/tools/proposal.check_compliance` — validates section against compliance matrix (page count, required subsections present, font compliance)

**Agents:**
- `proposal.draft_section` tool — the core AI drafting tool. System prompt instructs Claude as "senior government proposal writer". Input: section title, page limit, font/margin constraints, required subsections, evaluation criteria, RFP excerpt, library atoms. Output: CanvasNode[] with headings, paragraphs, lists.
- `proposal.check_compliance` tool — NEW. Reads the section's canvas content, compares against the compliance matrix from solicitation_compliance. Returns pass/fail per criterion with specific violations.
- Library search enhanced with embedding cosine similarity: `ORDER BY embedding <=> $query_embedding, outcome_score DESC`

**Automation/Audit:**
- Every draft emits `proposal.section.ai_drafted` with model, token count, library atoms used
- Every revision emits `proposal.section.revised` with action type (regenerate, shorten, etc.)
- Every library save emits `library.atom.saved` with source proposal, node type, category
- Compliance check results stored in `proposal_compliance_matrix` table with per-criterion pass/fail

### 3.1 — Real AI drafting (Claude API)
| Task | Description | Files | Agent Size |
|------|-------------|-------|------------|
| 3.1.1 | Verify `proposal.draft_section` tool works with ANTHROPIC_API_KEY on Railway (already built, needs live test) | Test | — |
| 3.1.2 | Upgrade library search to use text query + category match (already done in draft-all-sections) | Verify | — |
| 3.1.3 | Add embedding generation on atom creation — call Claude embedding API, store in vector(1536) column | 1 file edit | Medium |
| 3.1.4 | Add vector similarity search to `library.search_atoms` tool when query provided | 1 file edit | Medium |
| 3.1.5 | HITL test: Draft All Sections with real Claude → verify quality of generated content | Manual test | — |

### 3.2 — Canvas revision tools
| Task | Description | Files | Agent Size |
|------|-------------|-------|------------|
| 3.2.1 | AI Revision Panel — verify all 8 quick actions work with real Claude (already built) | Test | — |
| 3.2.2 | Library picker — inline "Insert from Library" button that shows ranked atom candidates with preview | 1 new component | Medium |
| 3.2.3 | Accept node to library — "Save to Library" button on accepted nodes, calls library.save_atom tool | 1 file edit | Small |
| 3.2.4 | Node reordering — drag-drop to move nodes within a section | 1 file edit | Medium |
| 3.2.5 | Inline text editing — click a text_block node to edit text directly in the canvas | 1 file edit | Medium |

### 3.3 — Compliance anchoring
| Task | Description | Files | Agent Size |
|------|-------------|-------|------------|
| 3.3.1 | Compliance sidebar tab — show compliance matrix for this section (page limit, required subsections, evaluation criteria) | 1 file edit | Medium |
| 3.3.2 | Page count indicator — real-time estimated page count vs page limit, red when over | 1 file edit | Small |
| 3.3.3 | Compliance check tool — `proposal.check_compliance` that validates section meets all requirements | 1 new tool | Medium |
| 3.3.4 | AI compliance fix — "Fix Compliance" quick action uses the compliance check result to guide revision | 1 file edit | Small |

---

## Phase 4: Collaboration + Phase Gates

**Goal:** Multiple users work on a proposal with role-based access.
Proposal advances through review stages with defined gate criteria.

### What Gets Built

**UI Changes:**
- Team page (`/portal/[slug]/team`) — list current team members with role badges, invite form (email + role + proposal scope + stage scope)
- Invite acceptance page (`/invite/[token]`) — set password, view assigned proposals
- Comment threads on canvas nodes — click a node to see/add comments, resolve/unresolve, reply. Color-coded per commenter. Comment count badge on each node.
- Change indicators on canvas nodes — colored dot per collaborator showing who last edited, with timestamp. Diff view available (word-level comparison).
- Watermark overlay — auto-generated from proposal stage (DRAFT, PINK TEAM REVIEW, etc.)
- Review page (`/portal/[slug]/proposals/[id]/review`) — gate criteria checklist (all sections drafted? page limits met? required subsections present?), advance button, stage history timeline
- Notification banners — "John commented on Technical Approach" with link to the specific node

**Database:**
- `proposal_collaborators` (already exists) — user_id, proposal_id, role, invited_by, accepted_at
- `collaborator_stage_access` (already exists) — which stages each collaborator can see/edit
- `proposal_comments` (already exists) — node_id, actor_id, text, resolved, resolved_by
- `proposal_stage_history` (already exists) — from_stage, to_stage, actor_id, gate_results JSON, timestamp
- `proposal_reviews` (already exists) — review_type (pink/red/gold), reviewer_id, section_id, score, comments
- NEW: `process_templates` table — step function definitions as JSON (steps, conditions, actions, escalations, deadlines)
- NEW: `process_instances` table — active process state per proposal (current step, started_at, deadline, nudge count)

**API Routes:**
- `POST /api/portal/[slug]/team/invite` — create user with temp_password=true, insert proposal_collaborators + collaborator_stage_access rows, emit event
- `POST /api/invite/[token]` — verify token, set password, mark accepted
- `POST /api/portal/[slug]/proposals/[id]/advance` — validate gate criteria → advance stage → record in proposal_stage_history → emit event
- `GET /api/portal/[slug]/proposals/[id]/review` — gate criteria status (pass/fail per criterion)
- `POST /api/portal/[slug]/proposals/[id]/comments` — add/resolve comments on canvas nodes

**Agents (NEW tools):**
- `proposal.pink_team_review` — Claude reads each section + compliance matrix → generates review comments as if a pink team reviewer. Inserts comments on specific nodes with actionable suggestions.
- `proposal.red_team_review` — Claude runs compliance check + scoring rubric evaluation against the RFP's evaluation criteria. Scores each section 1-5 with detailed rationale. Inserts structured review in proposal_reviews.
- `proposal.gold_team_review` — Final quality gate. Checks formatting compliance, cross-references between volumes, consistency of technical claims vs cost/schedule.

**Automation/Audit:**
- `proposal.stage.advanced` event with from/to stage, actor, gate results → CRM sends email to all collaborators ("Proposal moved to Red Team Review")
- `proposal.comment.added` event → CRM sends notification to section owner
- Process engine evaluates `process_templates` against proposal state on every stage change:
  - If deadline approaching: emit `process.nudge.due` → CRM sends reminder
  - If deadline passed + nudge_count > threshold: emit `process.escalation.triggered` → CRM notifies admin
  - If all gate criteria met: auto-suggest advancement to next stage
- Every invitation emits `identity.collaborator.invited` → CRM sends invite email with temp password
- Escalation chain: nudge (email) → reminder (email + dashboard flag) → escalation (admin notification)

### 4.1 — Team collaboration
| Task | Description | Files | Agent Size |
|------|-------------|-------|------------|
| 4.1.1 | Team page `/portal/[slug]/team/page.tsx` — list team members, invite form | 1 file | Medium |
| 4.1.2 | Invite API — `/api/portal/[slug]/team/invite/route.ts` — create user with temp password + stage-scoped access | 1 file | Medium |
| 4.1.3 | `/api/invite/[token]/route.ts` — accept invitation, set password | 1 file | Medium |
| 4.1.4 | Collaborator access check — verify proposal_collaborators + collaborator_stage_access in canvas load | 1 file edit | Small |
| 4.1.5 | Comment thread component — inline comments on canvas nodes with resolve/unresolve | 1 new component | Medium |
| 4.1.6 | Change indicator — show who edited what, when, color-coded per collaborator (collaboration.tsx exists, wire it) | 1 file edit | Small |

### 4.2 — Phase gate workflow
| Task | Description | Files | Agent Size |
|------|-------------|-------|------------|
| 4.2.1 | Stage advancement API — `/api/portal/[slug]/proposals/[id]/advance/route.ts` — validate gate criteria before advancing | 1 file | Medium |
| 4.2.2 | Gate criteria definition — per-stage checklist from compliance matrix (all sections drafted? page limits met? all required items present?) | 1 file | Medium |
| 4.2.3 | Stage history — record every advancement in proposal_stage_history with actor, timestamp, gate results | 1 file edit | Small |
| 4.2.4 | Review UI — `/portal/[slug]/proposals/[id]/review/page.tsx` — replace stub with gate checklist + advance button | 1 file | Medium |
| 4.2.5 | Pink team automation — when stage = pink_team, generate AI review comments on each section using Claude | 1 new tool | Medium |
| 4.2.6 | Red team automation — when stage = red_team, run compliance check + scoring rubric evaluation | 1 new tool | Medium |
| 4.2.7 | Notification on stage advance — emit event → CRM sends email to all collaborators | Event + CRM template | Small |

### 4.3 — Automation process templates
| Task | Description | Files | Agent Size |
|------|-------------|-------|------------|
| 4.3.1 | Process template schema — define step functions as JSON: steps[], conditions[], actions[], escalations[] | 1 file | Medium |
| 4.3.2 | Seed process templates — SBIR Phase I standard (outline→draft→pink→red→gold→final→submit), SBIR Phase II, CSO, BAA | 1 migration | Medium |
| 4.3.3 | Process engine — evaluate current state against template steps, determine next actions, fire nudges | 1 file | Large |
| 4.3.4 | Nudge system — when a step is overdue, emit event → CRM sends reminder email with deadline | CRM template + event | Small |
| 4.3.5 | Escalation — when nudge ignored for N days, notify admin + flag in dashboard | 1 file edit | Small |

---

## Phase 5: Multi-Volume Package Assembly + Export

**Goal:** All volumes assembled, cross-referenced, formatted per
compliance matrix, exported as final submission package.

### What Gets Built

**UI Changes:**
- Proposal workspace reorganized with volume tabs/accordion — each volume (Technical, Cost, Supporting) is a collapsible section containing its required items/sections
- Per-volume progress bar — percentage of sections in 'complete' or 'approved' status
- Cover sheet component — auto-populated CanvasDocument from compliance matrix (solicitation number, topic title, company name, CAGE code, UEI, PI info, period of performance) + tenant profile data
- Table of Contents generator — walks all heading nodes across all sections in a volume, generates a TOC node with section numbers + page estimates
- Cross-volume reference nodes — "See Section 2.3 in Technical Volume" links that resolve to the correct section
- "Export Final Package" button on workspace — generates ZIP with all volumes as DOCX/PPTX/XLSX + cover sheet + supporting docs + certifications
- Download via presigned S3 URL (same pattern as admin storage)

**Database:**
- `proposal_sections.content` — CanvasDocument JSON for each section (already exists)
- `document_templates` — canvas presets for cover sheets, certifications, bio templates, past performance templates (table exists from migration 017)
- Export results stored at `customers/{slug}/proposals/{id}/exports/{timestamp}.zip` in S3

**API Routes:**
- `POST /api/portal/[slug]/proposals/[id]/export` — orchestrates the full export pipeline:
  1. Load all sections grouped by volume
  2. For each section, render CanvasDocument through the appropriate exporter (docx for letter, pptx for slides, xlsx for tables)
  3. Apply compliance formatting: font family/size from solicitation_compliance, margins, headers/footers with field codes (PAGE, NUMPAGES)
  4. Generate cover sheet from template
  5. Generate TOC
  6. Assemble ZIP with folder structure matching volume hierarchy
  7. Upload to S3, return presigned download URL
  8. Emit `proposal.package.exported` event

**Agents (document lifecycle agents already built — now wired to export):**
- `DocxAgent.export(bundle)` — renders CanvasBundle to .docx with python-docx: headings, paragraphs with inline formatting, lists, tables, page breaks, headers/footers with PAGE fields, watermarks
- `PptxAgent.export(bundle)` — renders to .pptx for CSO briefing slides
- `XlsxAgent.export(bundle)` — renders to .xlsx for cost volumes with formulas
- Cross-format handoff: if a section was authored as DOCX content but needs PDF, `docx_agent.hand_off_to(bundle, pdf_agent)` → DocxAgent exports to .docx → converter renders to PDF via LibreOffice headless
- Canvas presets for supporting documents:
  - SF424 (federal form template)
  - DD2345 (military form template)
  - Budget justification (structured cost table)
  - Key personnel bio (heading + paragraphs + table)
  - Past performance narrative (contract info + relevance + outcomes)
  - Commercialization plan (market + IP + transition)
  - CSO slide deck (7 slides: title, problem, approach, team, schedule, cost, Q&A)

**Automation/Audit:**
- `proposal.package.exported` event with volume count, section count, total pages, file size, format breakdown
- `proposal.package.downloaded` event when customer downloads the ZIP
- Export history visible in proposal workspace — timestamp, who exported, file size, download link (24h expiry)
- Compliance validation runs automatically before export — if any section fails compliance check, export shows warnings but still proceeds (customer's choice to submit non-compliant)

### 5.1 — Multi-volume workspace
| Task | Description | Files | Agent Size |
|------|-------------|-------|------------|
| 5.1.1 | Proposal workspace shows volumes as tabs/accordion — Technical, Cost, Supporting | 1 file edit | Medium |
| 5.1.2 | Volume progress — per-volume completion percentage based on section statuses | 1 file edit | Small |
| 5.1.3 | Cross-volume references — "See Section X in Technical Volume" link nodes | 1 file edit | Small |
| 5.1.4 | Cover sheet template — auto-populated from compliance matrix + tenant profile | 1 new component | Medium |
| 5.1.5 | Table of Contents generator — auto-generated from heading nodes across all sections | 1 file edit | Medium |

### 5.2 — Compliance-driven export
| Task | Description | Files | Agent Size |
|------|-------------|-------|------------|
| 5.2.1 | Export bundle API — `/api/portal/[slug]/proposals/[id]/export/route.ts` — assemble all volumes into final package | 1 file | Large |
| 5.2.2 | DOCX export with compliance formatting — apply font, margins, headers/footers from compliance matrix per section | 1 file edit (docx-exporter) | Medium |
| 5.2.3 | PPTX export for slide-format sections (CSO briefings) | Verify existing | Small |
| 5.2.4 | XLSX export for cost volumes with formulas | Verify existing | Small |
| 5.2.5 | PDF rendering via DocxAgent → LibreOffice headless | Wire pipeline agent | Medium |
| 5.2.6 | Submission package assembly — zip all volumes + supporting docs + cover sheet + certifications | 1 file | Medium |
| 5.2.7 | Download button on workspace — "Export Final Package" → generates zip → presigned download URL | 1 file edit | Small |
| 5.2.8 | HITL test: complete proposal → export → open in Word → verify formatting matches compliance requirements | Manual test | — |

### 5.3 — Supporting documents
| Task | Description | Files | Agent Size |
|------|-------------|-------|------------|
| 5.3.1 | Certification forms — SF424, DD2345, budget justification templates as canvas presets | 1 file | Medium |
| 5.3.2 | Key personnel bio template — structured canvas with name, title, education, experience, publications | 1 file | Small |
| 5.3.3 | Past performance template — contract info, relevance statement, outcomes, reference contacts | 1 file | Small |
| 5.3.4 | Commercialization plan template — market analysis, IP strategy, transition path | 1 file | Small |
| 5.3.5 | Slide deck template for CSO — title slide, problem, approach, team, schedule, cost, Q&A | 1 file | Small |

---

## Phase 6: Learning Loop + Outcome Tracking

**Goal:** Win/loss outcomes feed back into the library. Winning atoms
rank higher. AI drafts improve over time.

### What Gets Built

**UI Changes:**
- Proposals list page gets an "Outcome" column — pending (gray), awarded (green trophy), rejected (red), withdrawn (gray strikethrough)
- "Record Outcome" button on submitted proposals — dropdown: awarded, rejected, withdrawn + notes field
- Library page gets analytics row: total atoms, by category breakdown, win rate by category bar chart
- Library atoms from winning proposals show a gold trophy badge in search results and the library list
- Atom detail shows "Used in N proposals (W wins, L losses)" with links to the proposals
- Dashboard stat card: "Win Rate: X%" based on recorded outcomes

**Database:**
- `proposals.outcome` column — 'pending' | 'awarded' | 'rejected' | 'withdrawn' (column may already exist, verify)
- `proposals.outcome_recorded_at`, `proposals.outcome_recorded_by`
- `library_atom_outcomes` (already exists) — unit_id, proposal_id, outcome, recorded_at
- `library_units.outcome_score` (already exists, added by migration 017) — recalculated on outcome recording

**API Routes:**
- `POST /api/portal/[slug]/proposals/[id]/outcome` — record outcome, update proposal, fan out to library_atom_outcomes for every atom used in that proposal (tracked via provenance.library_unit_id on canvas nodes)
- `GET /api/portal/[slug]/library/analytics` — aggregate stats: total atoms, by category, win rate, usage count distribution

**Agents:**
- Auto-harvest agent — when proposal stage = 'submitted', walk all canvas nodes across all sections. For each node with `library_eligible = true` that isn't already in the library, call `library.save_atom` with the proposal_id as provenance. This ensures winning content enters the library automatically.
- Outcome score recalculator — when an outcome is recorded, query all `library_atom_outcomes` for each affected atom, compute weighted average: `score = sum(outcome_weight * recency_weight) / count`. Awards = 1.0, rejections = 0.0, recency decays by 0.9 per year. Write to `library_units.outcome_score`.

**Automation/Audit:**
- `proposal.outcome.recorded` event with outcome, proposal_id, tenant_id → CRM updates customer health score
- `library.outcome.recalculated` event with atoms affected count, score changes
- `library.harvest.completed` event with atoms harvested count, categories
- Admin dashboard shows win rate trend over time
- CRM sends "Congratulations" or "Debrief" email based on outcome
- Outcome data feeds into Spotlight scoring — topics from agencies where the customer has won before get a score boost

### 6.1 — Outcome recording
| Task | Description | Files | Agent Size |
|------|-------------|-------|------------|
| 6.1.1 | Proposal outcome API — `/api/portal/[slug]/proposals/[id]/outcome/route.ts` — record win/loss/pending | 1 file | Small |
| 6.1.2 | Outcome UI on proposals page — status column, record outcome button | 1 file edit | Small |
| 6.1.3 | Library atom outcome tracking — when outcome recorded, update library_atom_outcomes for all atoms used in that proposal | 1 file | Medium |
| 6.1.4 | Outcome score recalculation — weighted average of all outcomes per atom, recency-weighted | 1 file | Small |

### 6.2 — Library feedback loop
| Task | Description | Files | Agent Size |
|------|-------------|-------|------------|
| 6.2.1 | Winning atoms badge — atoms from winning proposals show a trophy icon in library and search results | 1 file edit | Small |
| 6.2.2 | Library analytics — `/portal/[slug]/library` stats: total atoms, by category, win rate by category | 1 file edit | Medium |
| 6.2.3 | Auto-harvest — when proposal is marked "submitted", harvest all accepted canvas nodes to library | 1 file | Medium |
| 6.2.4 | Cross-proposal library reuse tracking — show "This atom was used in N proposals (W wins)" | 1 file edit | Small |

---

## Execution Order + Dependencies

```
Phase 1.1 (Spotlight flow)     ← Can start immediately
Phase 1.2 (Stripe)             ← Can start in parallel
Phase 2.1 (Portal purchase)    ← Depends on 1.1 (topics in Spotlight)
Phase 2.2 (Canvas init)        ← Depends on 2.1 (sections exist)
Phase 3.1 (AI drafting)        ← Depends on 2.2 (canvas ready)
Phase 3.2 (Revision tools)     ← Depends on 3.1 (content to revise)
Phase 3.3 (Compliance)         ← Can parallel with 3.2
Phase 4.1 (Collaboration)      ← Can parallel with Phase 3
Phase 4.2 (Phase gates)        ← Depends on 3.1 (content to review)
Phase 4.3 (Automation)         ← Depends on 4.2 (gates defined)
Phase 5.1 (Multi-volume)       ← Depends on 3.1 (sections drafted)
Phase 5.2 (Export)              ← Depends on 5.1 (volumes assembled)
Phase 5.3 (Supporting docs)    ← Can parallel with Phase 5
Phase 6.1 (Outcomes)           ← Depends on 5.2 (submission complete)
Phase 6.2 (Learning loop)      ← Depends on 6.1 (outcomes recorded)
```

## Critical Path (minimum to MVP)

```
1.1.1-1.1.7 → 2.1.1-2.1.5 → 2.2.1-2.2.4 → 3.1.1-3.1.5 → 3.2.1-3.2.5
→ 4.2.1-4.2.4 → 5.2.1-5.2.7

= 32 tasks on critical path
= ~16 agent hours at 30 min/task average
= 2-3 sprint sessions
```

## Task Sizing Summary

| Size | Count | Avg Time | Description |
|------|-------|----------|-------------|
| Small | 28 | 15 min | Single file edit, <50 lines, clear spec |
| Medium | 32 | 30 min | New component or significant edit, 50-150 lines |
| Large | 3 | 60 min | Multi-file coordination, complex logic |
| Test | 9 | 15 min | Manual HITL verification |
| **Total** | **72** | | |
