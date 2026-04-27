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
