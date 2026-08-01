<!--
  TVSF format — DIGESTED STRUCTURE ONLY.
  Structure digested from the DMVEC (Dayton/Miami Valley Entrepreneurs Center) "TVSF Proposal
  Template" (Round 45, last edit 07/13/26) supplied by the Economic-Development team. That template
  is DMVEC's proprietary material ("to be used only with the express written permission of DMVEC");
  this file captures ONLY the format/section map + rules needed to curate the opportunity in the
  system — none of DMVEC's question prose or guidance is reproduced here. Use the original template
  as the applicant-facing instructions.
-->

# TVSF — Ohio Third Frontier · Technology Validation & Startup Fund (the format)

**Source:** DMVEC TVSF Proposal Template, Round 45. **Funder:** Ohio Third Frontier (OTF) — a state
Economic-Development commercialization program (non-federal; not SBIR/STTR).

## Submission = two artifacts, **7 pages total**
The applicant submits a **Proposal** (a question-driven narrative) and a **Budget**. The **7-page limit**
covers the proposal answers; the **Abstract does NOT count against the 7 pages**. The Abstract is written
in plain, non-technical language for public/press use and **must not contain trade-secret information**.

### Volume 1 — Proposal (narrative → doc/pdf; 7-page limit, Abstract excluded)
The DMVEC template is organized as numbered questions (#1–#11 here; #12 is the Budget, Volume 2). Each
is a required section (matrix row). Concise section labels (the applicant answers each per the DMVEC
prose):

| # | Section | Notes (from the template's own structure) |
|---|---|---|
| 0 | **Abstract** | ~¼ page; plain-language; public/press-safe; no trade secrets; **excluded from the 7-page limit** |
| 1 | **Market Opportunity** | the pain / need; TAM (with TAM narrated here; SAM→#4, SOM→#6) |
| 2 | **Overview of the Technology** | how the technology solves #1 |
| 3 | **Development Stage** | current stage; what's needed to implement the technology |
| 4 | **Commercialization Strategy** | the go-to-market; explains the SAM |
| 5 | **Intellectual Property** | the IP / technology to be licensed (with #2, #3) |
| 6 | **Business Model & Pro-forma P&L** | "does this business make economic sense?"; abbreviated pro-forma P&L; year-5 revenue sized for **meaningful economic impact**; SOM. ~1 page |
| 7 | **Financial Stage** | "can this business attract the capital needed to execute?"; investor discussions |
| 8 | **Team / Management** | areas of expertise; each member's key business area (industry/technical/…) |
| 9 | **Competitive Landscape** | Your Company vs Competitors A–D comparison |
| 10 | **Economic Impact (Ohio)** | Ohio jobs / follow-on investment (OTF's economic-development goal) |
| 11 | **Project Plan (milestones)** | milestones: Name · Description · Success Criteria · Timeframe · Approximate Funds Required |

### Volume 2 — Budget (spreadsheet/table → xlsx/pdf)
Question #12 — the project laid out **by spend type** (the Project Plan #11 laid it out by milestone; the
Budget flips it to spend). Rows × the funding column:

| Spend type | OTF Project Funds | (match / other) | Total |
|---|---|---|---|
| **Personnel** | | | |
| **Equipment** | | | |
| **Supplies** | | | |
| **Purchased Services** | | | |
| **TOTAL** | | | |

"OTF Project Funds" = the Ohio Third Frontier grant portion; the platform's cost engine
(`proposal.budget_model`) fills/roll-ups burdened totals, and the Budget volume is provisioned as a
`cost` artifact.

## How this maps into the system (curation)
Curate the opportunity with **two volumes** (Phase C of `docs/PLAYBOOK_ONBOARD_NEWCO_TVS.md`):
- **Volume 1 "Proposal"** (`volume_format='custom'`) with the 12 required items above (`item_type='word_doc'`;
  Abstract/Competitive Landscape/Milestones may be `word_doc`).
- **Volume 2 "Budget"** (`volume_format='custom'`) with one `spreadsheet` required item.
- Compliance: `submissionFormat` = "Proposal (≤7 pages, Abstract excluded) + Budget"; `requiredSections`
  = the section labels; page limit 7 on the Proposal.
