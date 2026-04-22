# dod_25_1_sbir_baa — notes

**Source:** `docs/DoD 25.1 SBIR BAA FULL_02032025.pdf`
**Agency:** Department of Defense (umbrella BAA)
**Program:** SBIR 25.1 Annual Program BAA
**Open / Close:** 8 January 2025 — 5 February 2025 (12:00 PM ET)

## Namespace key expected

`DOD:unknown:SBIR:Phase1`

- `agency`: "Department of Defense" → alias → `DOD`
- `office`: DoD-wide umbrella, no specific component → `unknown`
- `type`: SBIR
- `phase`: Phase I (annual BAA, Phase I proposals only at this level;
  per-component appendices cover Direct-to-Phase-II)

## The umbrella-BAA quirk

DoD SBIR/STTR BAAs are **umbrella documents**. The core BAA tells you:

- 10-point minimum font
- 1-inch margins on all sides (header/footer permitted within)
- 8.5x11 paper
- Submit via DSIP
- Required certifications (SAM, SBA Company Registry)
- TABA allowance (amount varies by Service/Component)

But the per-Service page limits, per-Service funding amounts, and
per-topic technical requirements live in the Component Instruction
Appendices (Army, Navy/DoN, Air Force, SOCOM, DTRA, etc.) which are
past our 200K extraction cap. The BAA explicitly says:

> "it is the proposing SBC's responsibility to consult the
> Service/Component-specific instructions for detailed guidance,
> including required proposal documentation and structure, cost and
> duration limitations, budget structure, TABA allowance and
> proposal page limits."

**Implication:** the shredder at the BAA level should capture only
the universal rules. Per-component extractions are a §D.5 concern
(future work — separate pipeline job per component appendix PDF).

## Compliance variables expected (universal rules only)

| Variable | Expected | Source |
|---|---|---|
| `font_size` | "10" or 10 | "no type smaller than 10-point on standard 8-1/2\" x 11\" paper" |
| `margins` | "1 inch" | "one-inch margins, including the header" |
| `submission_format` | "DSIP" | Section 6.0 PROPOSAL SUBMISSION |
| `pi_must_be_employee` | true | SBC eligibility standard |
| `classified_proposals_accepted` | (custom) false | "Classified Proposals" section |

## Sections expected

The TOC is explicit — sections 1-7 + Appendix A/B/C:

- `cover` — IMPORTANT DATES, front matter
- `eligibility` — §1.4 (Eligibility and Performance Requirements), §1.5 (Venture ownership), §1.6 (Performance benchmarks)
- `submission_format` — §3.0 Proposal Preparation Instructions
- `evaluation_criteria` — §4.0 Method of Selection and Evaluation Criteria
- `team` — PI rules within §1.4
- `cost_volume` — Appendix A (Technical Proposal Template Volume 2)
- `compliance_requirements` — §2.0 Certifications, Appendix C (FAR/DFARS clauses)
- `appendix` — Appendix B (Definitions), Appendix C (FAR clauses)

## Cross-cycle pairing (for §H test)

Paired with `dod_25_2_sbir_baa`. Same structure, different dates.
§H's `memory.search_namespace` search for `DOD:unknown:SBIR:`
should surface BOTH fixtures, enabling the curation workspace to
pre-fill compliance values from 25.1 when curating 25.2.
