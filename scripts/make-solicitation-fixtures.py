#!/usr/bin/env python3
"""Author durable multi-agency solicitation fixtures for the ingest drives.

WHY THESE EXIST. The ingest specs were pointed at chat-uploaded PDFs under a
session directory, so on any other machine they skipped. Worse, the one fixture
in the repo (dsip-sample.pdf) is a *proposal* package, not a solicitation — it
cannot exercise the compliance extractor at all.

WHY THEY LOOK LIKE THIS. Each of the four states its rules DIFFERENTLY and with
DIFFERENT VALUES, so a passing extraction proves the reader read *that* document
rather than fell back to a default that happens to be right:

  dow-sbir-p1     Times New Roman · 11pt · 1 inch · page limit DEFERRED to the
                  Component-specific instructions · 4,000-character narrative
                  → the deferral must CLEAR the default and render "Set elsewhere",
                    never a fabricated number (docs/INGEST_PROVENANCE.md)
  nsf-sttr-p1     Arial · 10pt · 1 inch · 15 pages · NO character limit stated
                  → the character limit must come back absent, not invented
  doe-sbir-p2     Calibri · 11pt · 0.75 inch · 20 pages · 2,500 characters
                  → all five stated; the odd margin catches a hardcoded 1 inch
  ohio-tvsf-r46   Georgia · 12pt · 1 inch · 8 pages · no character limit
                  → a STATE program, so the cost volume must resolve to
                    otf_state_budget rather than a federal burden waterfall

Run: python3 scripts/make-solicitation-fixtures.py [outdir]
Default outdir: frontend/e2e/fixtures/solicitations
"""
import sys
from pathlib import Path

import fitz  # PyMuPDF

# Body text is deliberately plain: the extractor works on a normalized copy of the
# shredded text, so styling here would only obscure what it actually matched.
FIXTURES = {
    "dow-sbir-p1": {
        "title": "Department of the Navy — SBIR Phase I Broad Agency Announcement 26.1",
        "topic": "N261-118 — Additive Construction for Expeditionary Basing",
        "close": "2026-11-14",
        "pages": [
            [
                "DEPARTMENT OF THE NAVY",
                "SMALL BUSINESS INNOVATION RESEARCH (SBIR) PROGRAM",
                "BROAD AGENCY ANNOUNCEMENT 26.1",
                "",
                "Topic N261-118 — Additive Construction for Expeditionary Basing",
                "",
                "1. INTRODUCTION",
                "This Broad Agency Announcement solicits Phase I proposals from qualified small",
                "business concerns. Proposals are due no later than 14 November 2026 at 12:00 noon",
                "Eastern Time. Late submissions will not be considered.",
                "",
                "2. AWARD INFORMATION",
                "Phase I awards under this announcement shall not exceed $314,000 over a period of",
                "performance of six (6) months.",
            ],
            [
                "3. PROPOSAL FORMAT AND PREPARATION",
                "",
                "3.1 Typography",
                "All text shall be prepared in Times New Roman. Type size shall be no smaller than",
                "11 point. Pages shall be formatted with 1 inch margins on all sides.",
                "",
                "3.2 Page Limitations",
                "Page limits for the Technical Volume are Component-specific. Offerors shall refer to",
                "the Component-specific instructions accompanying this announcement for the page limit",
                "applicable to Topic N261-118. Do not assume the limit published for any other",
                "Component applies to this topic.",
                "",
                "3.3 Technical Abstract",
                "The technical abstract shall be limited to 4,000 characters including spaces.",
            ],
            [
                "4. VOLUME STRUCTURE",
                "Volume 1 — Proposal Cover Sheet",
                "Volume 2 — Technical Volume",
                "Volume 3 — Cost Volume",
                "Volume 4 — Company Commercialization Report",
                "Volume 5 — Supporting Documents",
                "",
                "5. EVALUATION CRITERIA",
                "Proposals will be evaluated on technical merit, qualifications of the principal",
                "investigator and team, and the commercialization potential of the proposed effort.",
            ],
        ],
    },
    "nsf-sttr-p1": {
        "title": "National Science Foundation — STTR Phase I Solicitation NSF 26-522",
        "topic": "Robotics for the Built Environment",
        "close": "2026-12-03",
        "pages": [
            [
                "NATIONAL SCIENCE FOUNDATION",
                "SMALL BUSINESS TECHNOLOGY TRANSFER (STTR) PROGRAM — PHASE I",
                "PROGRAM SOLICITATION NSF 26-522",
                "",
                "Topic Area: Robotics for the Built Environment",
                "",
                "FULL PROPOSAL DEADLINE: December 3, 2026",
                "",
                "I. PROGRAM DESCRIPTION",
                "The STTR program supports cooperative research and development carried out",
                "between a small business concern and a research institution.",
                "",
                "II. AWARD INFORMATION",
                "Phase I awards are expected to be up to $305,000 for a period of twelve months.",
            ],
            [
                "III. PROPOSAL PREPARATION INSTRUCTIONS",
                "",
                "A. Formatting",
                "Proposals must use Arial typeface. Font size must be at least 10 point. Use 1 inch",
                "margins on all sides of every page.",
                "",
                "B. Length",
                "The Project Description shall not exceed 15 pages, inclusive of all figures, tables",
                "and illustrations. Pages in excess of this limit will be removed prior to review.",
                "",
                "C. Budget",
                "Applicants shall submit a budget on NSF forms, including a budget justification for",
                "each line item.",
            ],
            [
                "IV. PROPOSAL CONTENTS",
                "Volume 1 — Cover Sheet and Project Summary",
                "Volume 2 — Project Description",
                "Volume 3 — Budget and Budget Justification",
                "Volume 4 — Biographical Sketches and Facilities",
                "",
                "V. REVIEW CRITERIA",
                "All proposals are evaluated against the two National Science Board criteria of",
                "intellectual merit and broader impacts.",
            ],
        ],
    },
    "doe-sbir-p2": {
        "title": "U.S. Department of Energy — SBIR Phase II Funding Opportunity DE-FOA-0003412",
        "topic": "Low-Carbon Concrete and Cement Materials",
        "close": "2027-02-19",
        "pages": [
            [
                "U.S. DEPARTMENT OF ENERGY",
                "OFFICE OF SCIENCE",
                "SBIR PHASE II FUNDING OPPORTUNITY ANNOUNCEMENT DE-FOA-0003412",
                "",
                "Topic: Low-Carbon Concrete and Cement Materials",
                "",
                "APPLICATION DUE DATE: February 19, 2027, 11:59 PM Eastern Time",
                "",
                "A. PROGRAM OBJECTIVE",
                "This announcement seeks Phase II applications to advance materials that reduce the",
                "embodied carbon of structural concrete.",
                "",
                "B. AWARD SIZE",
                "Phase II awards shall not exceed $1,100,000 over twenty-four months.",
            ],
            [
                "C. PREPARATION OF THE TECHNICAL NARRATIVE",
                "",
                "C.1 Format Requirements",
                "The technical narrative must be prepared in Calibri. Font size must be no smaller",
                "than 11 point. Applications shall use 0.75 inch margins on all sides.",
                "",
                "C.2 Length Requirements",
                "The Technical Volume shall not exceed 20 pages. This limit includes figures and",
                "tables but excludes the required forms.",
                "",
                "C.3 Project Summary",
                "The public project summary shall not exceed 2,500 characters.",
            ],
            [
                "D. APPLICATION COMPONENTS",
                "Volume 1 — SF-424 Application for Federal Assistance",
                "Volume 2 — Technical Narrative",
                "Volume 3 — Budget (SF-424A) and Budget Justification",
                "Volume 4 — Letters of Commitment and Support",
                "",
                "E. MERIT REVIEW",
                "Applications are evaluated on scientific and technical merit, appropriateness of the",
                "proposed method, and competency of applicant personnel and adequacy of resources.",
            ],
        ],
    },
    "ohio-tvsf-r46": {
        "title": "Ohio Third Frontier — Technology Validation and Startup Fund Round 46",
        "topic": "TVS-2027-01 — Technology Validation and Startup Fund",
        "close": "2027-01-22",
        "pages": [
            [
                "OHIO DEPARTMENT OF DEVELOPMENT",
                "OHIO THIRD FRONTIER",
                "TECHNOLOGY VALIDATION AND STARTUP FUND — ROUND 46",
                "",
                "Program Announcement TVS-2027-01",
                "",
                "PROPOSAL DEADLINE: January 22, 2027 at 5:00 PM Eastern Time",
                "",
                "1. PURPOSE",
                "The Technology Validation and Startup Fund accelerates the commercialization of",
                "technologies developed at Ohio institutions of higher education.",
                "",
                "2. AWARD AMOUNT",
                "Awards shall not exceed $150,000 with a required one-to-one cost share.",
            ],
            [
                "3. PROPOSAL FORMATTING",
                "",
                "3.1 Type and Layout",
                "Proposals shall be prepared in Georgia. Type size shall be no smaller than 12 point.",
                "All pages shall have 1 inch margins on all sides.",
                "",
                "3.2 Narrative Length",
                "The Technical Volume shall not exceed 8 pages, excluding the budget forms, letters",
                "of support and the required license agreement.",
                "",
                "3.3 Required Attachments",
                "A willingness-to-license letter from the originating institution is required.",
            ],
            [
                "4. PROPOSAL STRUCTURE",
                "Volume 1 — Project Narrative",
                "Volume 2 — Budget and Budget Narrative",
                "Volume 3 — Supporting Documentation",
                "",
                "5. SCORING",
                "Proposals are scored on commercial potential, technical merit, team capability and",
                "the strength of the Ohio economic development impact.",
            ],
        ],
    },
}


def build(slug: str, spec: dict, outdir: Path) -> Path:
    doc = fitz.open()
    total = len(spec["pages"])
    for i, lines in enumerate(spec["pages"], start=1):
        page = doc.new_page(width=612, height=792)  # US Letter
        y = 72.0
        page.insert_text((72, y), spec["title"], fontname="tibo", fontsize=11)
        y += 26
        for line in lines:
            if y > 720:
                break
            page.insert_text((72, y), line, fontname="tiro", fontsize=10.5)
            y += 15
        # A visible page marker: the extractor resolves an anchor's page number from
        # markers in the shredded text, and a real solicitation carries a footer.
        page.insert_text((72, 756), f"-- Page {i} of {total} --", fontname="tiro", fontsize=9)
    out = outdir / f"{slug}.pdf"
    doc.save(out)
    doc.close()
    return out


def main() -> int:
    outdir = Path(sys.argv[1] if len(sys.argv) > 1 else "frontend/e2e/fixtures/solicitations")
    outdir.mkdir(parents=True, exist_ok=True)
    for slug, spec in FIXTURES.items():
        p = build(slug, spec, outdir)
        print(f"  {p}  ({p.stat().st_size:,} bytes, {len(spec['pages'])}pp)  {spec['title'][:58]}")
    print(f"\n{len(FIXTURES)} solicitation fixtures written to {outdir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
