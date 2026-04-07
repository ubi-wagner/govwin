# Chapter 2: Agent Archetypes and Insertion Points

## Overview

Every agent interaction in our system happens at a specific moment in the customer
journey. This chapter maps each agent archetype to its exact trigger points, inputs,
outputs, and human gates. Nothing is vague — if an agent activates, you can trace
exactly when, why, what it receives, and what it produces.

---

## The Proposal Lifecycle with Agent Insertion Points

```
OPPORTUNITY DISCOVERED (Finder)
  │
  │  ◆ Opportunity Analyst — parses RFP on ingestion
  │  ◆ Scoring Strategist — scores against all tenant profiles
  │
  ▼
CUSTOMER REVIEWS OPPORTUNITY (Pipeline Page)
  │
  │  ◆ Capture Strategist — generates pursue/no-go recommendation (on demand)
  │
  ▼
CUSTOMER PURCHASES PROPOSAL PORTAL
  │
  │  ◆ Proposal Architect — generates outline + requirements matrix
  │  ◆ Librarian — matches library units to requirements
  │  ◆ Partner Coordinator — suggests partners from history
  │
  ▼
OUTLINE STAGE
  │
  │  ◆ Proposal Architect — refines outline based on human edits
  │  ◆ Compliance Reviewer — validates outline covers all requirements
  │  ▸ HUMAN GATE: Customer approves outline
  │
  ▼
DRAFT STAGE
  │
  │  ◆ Section Drafter — pre-drafts each section from library + requirements
  │  ◆ Research Analyst — finds relevant past performance, market data
  │  ◆ Partner Coordinator — nudges partners for input, tracks uploads
  │  ◆ Compliance Reviewer — continuous gap checking as sections complete
  │  ▸ HUMAN GATE: Customer reviews/edits all drafted sections
  │
  ▼
PINK TEAM REVIEW
  │
  │  ◆ Color Team Reviewer — pre-review scoring against evaluation criteria
  │  ◆ Compliance Reviewer — formal compliance matrix verification
  │  ▸ HUMAN GATE: Human reviewers conduct pink team, provide feedback
  │  ◆ Section Drafter — assists with revisions based on review feedback
  │
  ▼
RED TEAM REVIEW
  │
  │  ◆ Color Team Reviewer — adversarial review, competitive analysis
  │  ◆ Scoring Strategist — updated win probability assessment
  │  ▸ HUMAN GATE: Human reviewers conduct red team
  │  ◆ Section Drafter — revision assistance
  │
  ▼
GOLD TEAM REVIEW
  │
  │  ◆ Color Team Reviewer — executive-level review, cost/risk assessment
  │  ◆ Compliance Reviewer — final compliance verification
  │  ▸ HUMAN GATE: Executive sign-off required
  │
  ▼
FINAL / SUBMIT
  │
  │  ◆ Packaging Specialist — compiles documents, verifies format requirements
  │  ◆ Compliance Reviewer — final checklist
  │  ▸ HUMAN GATE: Customer locks and downloads package
  │
  ▼
POST-SUBMISSION
  │
  │  ◆ Librarian — harvests winning content back into library
  │  ◆ All agents — memory consolidation from this proposal's lifecycle
  │
  ▼
OUTCOME (when award data arrives)
  │
  │  ◆ Librarian — tags library units with win/loss outcome
  │  ◆ Scoring Strategist — recalibrates scoring model
  │  ◆ All agents — outcome-based memory updates
```

---

## Agent Archetype Specifications

### 1. Opportunity Analyst

**Identity:** The agent that reads and understands solicitations.

**When it activates:**
| Trigger Event | Context |
|--------------|---------|
| `finder.opportunity.ingested` | New opportunity from SAM.gov/SBIR.gov/Grants.gov |
| `finder.opportunity.amended` | Solicitation amendment detected |
| User clicks "Deep Analysis" | On-demand for a specific opportunity |

**Inputs (injected into context):**
- Full solicitation text (from ingested source or downloaded PDF)
- Agency template knowledge (from foundational memory — how this agency structures RFPs)
- Amendment history (if analyzing an amendment)

**Tools available:**
```
opportunity_details(opp_id)    — read opportunity metadata
memory_search(query)           — search foundational knowledge about agency patterns
memory_write(content, type)    — store extracted requirements and patterns
emit_event(stream, type, data) — emit analysis results
```

**Outputs:**
- Structured requirements matrix: `[{requirement_id, text, category, is_mandatory, evaluation_weight}]`
- Key evaluation criteria with weights
- Submission format requirements
- Eligibility constraints (size standards, certifications, clearances)
- Important dates (Q&A period, draft due, final due)
- Risk flags (unusually short timeline, complex teaming requirements, etc.)

**Human gate:** None. This runs autonomously on ingestion. Output is stored as
structured data that humans see when they view the opportunity.

**Memory writes:**
- Episodic: "Analyzed RFP {sol_number} for {agency}. Key requirements: {summary}"
- Semantic: Agency-specific patterns detected (e.g., "Air Force SBIR Phase I RFPs
  from AFRL consistently weight TRL progression at 25% of technical evaluation")

**Token budget:** 15K-40K input (full RFP can be large), 2K-5K output.
Runs once per opportunity, not per tenant.

---

### 2. Scoring Strategist

**Identity:** The agent that evaluates opportunity fit for specific tenants.

**When it activates:**
| Trigger Event | Context |
|--------------|---------|
| `finder.scoring.completed` (surface score >= 50) | After algorithmic scoring, high-potential opps get LLM analysis |
| `capture.proposal.outcome_recorded` | Win/loss data to recalibrate |
| Scheduled weekly | Portfolio-level scoring recalibration |

**Inputs:**
- Opportunity metadata + analyst output (requirements matrix)
- Tenant profile (NAICS, keywords, agency history, tech focus, certifications)
- Tenant's past proposal outcomes (win/loss with scores)
- Relevant tenant memories about scoring accuracy

**Tools available:**
```
tenant_profile(tenant_id)        — read tenant scoring config
library_search(query, tenant_id) — find relevant past performance
memory_search(query, tenant_id)  — retrieve scoring calibration memories
score_adjust(tenant_id, opp_id, adjustment, rationale) — write score adjustment
memory_write(content, type)      — store calibration learnings
```

**Outputs:**
- LLM score adjustment: -15 to +15 (added to algorithmic base score)
- Rationale: 2-3 sentences explaining the adjustment
- Key requirements assessment: how well tenant capabilities match
- Competitive risk analysis: known competitors, incumbent advantages
- RFI questions: suggested questions for the agency (if Q&A period is open)
- Pursuit recommendation: pursue / monitor / pass (with confidence)

**Human gate:** None for scoring. The recommendation is displayed but never
auto-acted on. Customer decides pursuit status.

**Memory writes:**
- Episodic: "Scored opp {sol_number} for {tenant}. Adjustment: +8. Rationale: strong NAICS match, past AF experience"
- Semantic (after outcome): "Opportunities I scored 80+ for {tenant} won at 60% rate. Scoring is slightly optimistic — consider -3 calibration."
- Procedural: "When {tenant} has direct past performance with {agency}, add +5 to agency alignment score."

**Token budget:** 5K-15K input, 1K-3K output. Runs per tenant per high-scoring opportunity.

---

### 3. Capture Strategist

**Identity:** The agent that recommends whether to pursue and how to win.

**When it activates:**
| Trigger Event | Context |
|--------------|---------|
| User clicks "Analyze Fit" on an opportunity | On-demand deep analysis |
| `identity.purchase.completed` (proposal portal purchased) | Generate initial capture strategy |

**Inputs:**
- Full RFP analysis (from Opportunity Analyst)
- Tenant profile + past performance + capabilities
- Scoring results + rationale
- Similar past proposals (found via library search)
- Competitive landscape (known incumbents from USASpending data)
- Relevant agent memories for this tenant

**Tools available:**
```
opportunity_details(opp_id)
tenant_profile(tenant_id)
library_search(query, tenant_id)
memory_search(query, tenant_id)
proposal_read(proposal_id)      — read past proposals for reference
memory_write(content, type)
```

**Outputs:**
- Go/No-Go recommendation with confidence score
- Win themes: 3-5 discriminating themes that differentiate this tenant
- Competitive positioning: strengths vs. likely competitors
- Teaming recommendations: capability gaps that need partners
- Risk register: technical, schedule, cost, competitive risks
- Capture timeline: key milestones from now to submission

**Human gate:** YES. This is a recommendation only. Customer makes the pursuit
decision and purchases the portal.

**Memory writes:**
- Episodic: "Recommended {pursue/pass} for {opp}. Customer decided {actual decision}. Win themes: {themes}"
- Semantic (over time): "{Tenant} tends to pursue when I recommend pursue, but also pursues some I recommend passing on — they weight {agency relationship} more than I do"

**Token budget:** 15K-30K input (rich context), 3K-8K output. Runs once per opportunity per tenant, on demand.

---

### 4. Proposal Architect

**Identity:** The agent that designs proposal structure and maps content to requirements.

**When it activates:**
| Trigger Event | Context |
|--------------|---------|
| `capture.proposal.created` | New proposal portal purchased |
| `capture.proposal.stage_changed` to outline | Entering outline stage |
| User requests "Redesign outline" | On-demand restructure |

**Inputs:**
- Requirements matrix (from Opportunity Analyst)
- Agency-specific proposal template (from template library)
- Capture strategy (from Capture Strategist, if available)
- Similar past proposal outlines (from library)
- Tenant preferences for proposal structure
- Page limits and format requirements

**Tools available:**
```
opportunity_details(opp_id)
tenant_profile(tenant_id)
library_search(query, tenant_id)
memory_search(query, tenant_id)
section_draft(proposal_id, section_id, content, confidence)
compliance_flag(proposal_id, requirement_id, status, note)
memory_write(content, type)
```

**Outputs:**
- Proposal outline: hierarchical section structure with:
  - Section number, title, page allocation
  - Assigned requirements (from requirements matrix)
  - Suggested content sources (library units, past proposals)
  - Responsible person suggestion (from key personnel)
- Initial compliance matrix: requirement ↔ section mapping
- Content gap analysis: requirements with no matching library content

**Human gate:** YES. Outline must be human-approved before entering Draft stage.

**Memory writes:**
- Episodic: "Generated outline for {agency} {program_type} proposal. {N} sections, {M} requirements mapped."
- Procedural: "For {agency} {program_type}, use {template_name} template. Section order: {preferred order}."
- Semantic: "Customer always adds an 'Innovation' section even when not required. Include by default."

**Token budget:** 10K-25K input, 3K-8K output.

---

### 5. Section Drafter

**Identity:** The agent that writes proposal sections. This is the highest-volume agent.

**When it activates:**
| Trigger Event | Context |
|--------------|---------|
| `capture.proposal.stage_changed` to draft | Auto-draft all sections (if automation enabled) |
| User clicks "AI Draft" on a section | On-demand for one section |
| `capture.section.reviewed` with revision requests | Revision assistance after review feedback |

**Inputs:**
- Section assignment: which section, what requirements it must address
- Relevant library units (pre-matched by Librarian)
- Past proposal sections for similar requirements (semantic search)
- Tenant writing style preferences (from memory)
- Review feedback (if revising after color team)
- Page/word limits for this section

**Tools available:**
```
library_search(query, tenant_id, category)
memory_search(query, tenant_id)
proposal_read(proposal_id, section_id)    — read existing draft, other sections for coherence
opportunity_details(opp_id)
section_draft(proposal_id, section_id, content, confidence)
request_human_review(proposal_id, section_id, reason)
memory_write(content, type)
```

**Outputs:**
- Draft section content (formatted text, potentially with suggested tables/figures)
- Confidence score (0-1): how confident the agent is in this draft
- Content provenance: which library units were used, how they were adapted
- Gaps flagged: parts where the agent lacked sufficient information
- Requirement traceability: which requirements this section addresses

**Human gate:** YES. Every draft goes to the human for review/edit. The agent
NEVER auto-finalizes a section.

**Memory writes:**
- Episodic: "Drafted section {section_num} for proposal {id}. Used {N} library units. Confidence: {score}. Human edited {X}% of content."
- Semantic (from human edits): "Customer prefers {observation about their editing pattern}"
- Procedural: "For {category} sections for {agency}, customer prefers {specific pattern}. Apply this structure."

**Token budget:** 5K-20K input, 2K-10K output (sections can be long).
Highest volume agent — runs per section per proposal.

---

### 6. Compliance Reviewer

**Identity:** The agent that verifies every requirement is addressed.

**When it activates:**
| Trigger Event | Context |
|--------------|---------|
| `capture.section.drafted` | Check newly drafted section against requirements |
| `capture.proposal.stage_changed` to pink_team | Full proposal compliance check |
| `capture.proposal.stage_changed` to final | Final compliance verification |
| User clicks "Check Compliance" | On-demand |

**Inputs:**
- Requirements matrix with current satisfaction status
- Full or partial proposal content
- Solicitation instructions (format, page limits, font, margins)
- Agency-specific compliance patterns (from memory)

**Tools available:**
```
proposal_read(proposal_id)            — read full proposal or sections
opportunity_details(opp_id)
memory_search(query, tenant_id)
compliance_flag(proposal_id, req_id, status, note)
review_comment(proposal_id, section_id, comment, severity)
memory_write(content, type)
```

**Outputs:**
- Compliance matrix update: each requirement marked as satisfied/partial/missing/not-applicable
- Format violations: page count, font, margin, heading style issues
- Missing elements: required attachments, forms, certifications not found
- Risk flags: requirements addressed weakly or in wrong section

**Human gate:** Output is advisory. Flags are displayed in the UI. Human decides
whether to address each flag.

**Memory writes:**
- Episodic: "Compliance check for proposal {id} at {stage}. {N} requirements satisfied, {M} gaps found."
- Procedural: "{Tenant} consistently misses {specific compliance item}. Flag proactively in future proposals."
- Semantic: "{Agency} interprets requirement {X} to mean {Y} based on past award patterns."

**Token budget:** 10K-40K input (full proposal), 2K-5K output. Runs multiple times per proposal.

---

### 7. Color Team Reviewer

**Identity:** The agent that simulates color team reviews.

**When it activates:**
| Trigger Event | Context |
|--------------|---------|
| `capture.proposal.stage_changed` to pink_team/red_team/gold_team | Pre-review scoring |
| User clicks "AI Pre-Review" | On-demand before human reviewers |

**Inputs:**
- Full proposal at current stage
- Evaluation criteria and weights (from Opportunity Analyst)
- Agency-specific scoring rubric (from template library)
- Previous review feedback (if this is red/gold after pink)
- Tenant's past review patterns (what reviewers typically flag)

**Tools available:**
```
proposal_read(proposal_id)
opportunity_details(opp_id)
memory_search(query, tenant_id)
review_comment(proposal_id, section_id, comment, severity)
memory_write(content, type)
```

**Outputs:**
- Section-by-section score against evaluation criteria
- Strengths: what reads well, what differentiates
- Weaknesses: where the proposal is vulnerable
- Specific revision recommendations with priority
- Overall win probability estimate (with caveats)

**Human gate:** YES. AI review happens BEFORE human review. Human reviewers
can see AI's assessment but conduct their own independent review.

**Memory writes:**
- Episodic: "Pre-reviewed proposal {id} at {stage}. AI score: {score}. Human reviewers scored: {actual}."
- Semantic: "My pink team scores for {tenant} trend {X}% higher than human scores. I am {optimistic/pessimistic} relative to their reviewers."
- Procedural: "Reviewer {name} for {tenant} always flags {specific pattern}. Pre-address this."

**Token budget:** 20K-50K input (full proposal + criteria), 5K-10K output.

---

### 8. Partner Coordinator

**Identity:** The agent that manages partner/collaborator communications.

**When it activates:**
| Trigger Event | Context |
|--------------|---------|
| `capture.collaborator.invited` | Draft welcome/context message for partner |
| Scheduled daily during active stages | Check for overdue partner deliverables |
| `capture.proposal.stage_changed` | Prepare stage transition notifications |

**Inputs:**
- Partner profile (from partner directory)
- Their assigned deliverables and deadlines
- Current delivery status
- Past interaction history with this partner (from memory)

**Tools available:**
```
memory_search(query, tenant_id)
proposal_read(proposal_id)
notify(user_id, message, priority)
memory_write(content, type)
emit_event(stream, type, data)
```

**Outputs:**
- Drafted communications (partner welcome, upload reminders, deadline nudges)
- Status reports (who's delivered, who hasn't, what's at risk)
- Escalation flags (partner significantly overdue)

**Human gate:** YES for external communications. Drafted messages are queued
for tenant admin review before sending. Status reports are advisory.

**Memory writes:**
- Episodic: "Nudged {partner_email} for {deliverable}. They delivered {on_time/late/not_yet}."
- Semantic: "{Partner} delivers bios within 2 days but past performance takes a week."
- Procedural: "Start nudging {partner} 5 days before deadline, not 3. They need extra time."

**Token budget:** 3K-8K input, 1K-3K output. Low cost per call.

---

### 9. Librarian

**Identity:** The agent that manages the content library — cataloging, scoring, and harvesting.

**When it activates:**
| Trigger Event | Context |
|--------------|---------|
| `capture.partner.upload_received` | Decompose uploaded document into library units |
| `capture.proposal.submitted` | Harvest content from completed proposal |
| `capture.proposal.outcome_recorded` | Tag units with win/loss outcome |
| Scheduled weekly | Freshness review, deduplication, quality scoring |

**Inputs:**
- Uploaded documents (PDFs, DOCX) → text extraction done by document processing pipeline
- Completed proposal sections (for harvesting)
- Existing library units (for deduplication check)
- Outcome data (for attribution)

**Tools available:**
```
library_search(query, tenant_id, category)
memory_search(query, tenant_id)
memory_write(content, type)
emit_event(stream, type, data)
```

**Outputs:**
- New library units: `[{content, category, subcategory, tags, confidence, source}]`
- Deduplication report: units that are near-duplicates of existing content
- Quality scores: updated confidence based on usage and outcomes
- Freshness flags: units that may be outdated (old past performance, departed personnel)

**Human gate:** New units created in DRAFT status. Tenant admin must approve
before they enter the active library. Outcome tagging is automatic.

**Memory writes:**
- Episodic: "Harvested {N} units from proposal {id}. Categories: {distribution}."
- Semantic: "Category {X} has {N} approved units. Category {Y} is underpopulated — recommend customer uploads."
- Procedural: "When harvesting from {agency} proposals, split technical approach into sub-components by technology area."

**Token budget:** 10K-30K input (document text), 3K-10K output (multiple units).

---

### 10. Packaging Specialist

**Identity:** The agent that compiles and formats the final submission package.

**When it activates:**
| Trigger Event | Context |
|--------------|---------|
| `capture.proposal.stage_changed` to final | Begin package compilation |
| User clicks "Generate Package" | On-demand package creation |

**Inputs:**
- All approved proposal sections
- Submission requirements (formats, volumes, attachments)
- Agency-specific template (if applicable)
- Required government forms (SF-424, budget templates, etc.)

**Tools available:**
```
proposal_read(proposal_id)
opportunity_details(opp_id)
memory_search(query, tenant_id)
compliance_flag(proposal_id, requirement_id, status, note)
emit_event(stream, type, data)
```

**Outputs:**
- Package manifest: list of all documents with format, page count, file type
- Compliance checklist: final verification that all required elements present
- Formatting notes: any discrepancies with submission requirements
- Upload instructions: agency portal-specific guidance (if known)

**Human gate:** YES. Customer reviews manifest, downloads package, and submits
manually to the government portal. We NEVER auto-submit.

**Token budget:** 15K-30K input, 2K-5K output. Runs once per proposal.

---

## Agent Activation Summary

| Stage | Active Agents | Automation Default | Human Gate |
|-------|--------------|-------------------|------------|
| Ingestion | Opportunity Analyst | ON (always) | None |
| Scoring | Scoring Strategist | ON (for high scores) | None |
| Pre-Purchase | Capture Strategist | ON DEMAND only | Recommendation only |
| Portal Created | Proposal Architect, Librarian, Partner Coordinator | ON | Outline approval |
| Outline | Proposal Architect, Compliance Reviewer | ON | Outline approval |
| Draft | Section Drafter, Research Analyst, Partner Coordinator, Compliance Reviewer | CONFIGURABLE | Section review |
| Pink Team | Color Team Reviewer, Compliance Reviewer, Section Drafter | CONFIGURABLE | Human review |
| Red Team | Color Team Reviewer, Scoring Strategist, Section Drafter | CONFIGURABLE | Human review |
| Gold Team | Color Team Reviewer, Compliance Reviewer | CONFIGURABLE | Executive sign-off |
| Final | Packaging Specialist, Compliance Reviewer | ON | Lock + download |
| Post-Submit | Librarian, All (memory consolidation) | ON | None |
| Outcome | Librarian, Scoring Strategist, All (memory update) | ON | None |

**CONFIGURABLE** means the customer can toggle these agents on/off per proposal
via proposal settings. Default is ON for new customers, but they can run fully
manual if they prefer.
