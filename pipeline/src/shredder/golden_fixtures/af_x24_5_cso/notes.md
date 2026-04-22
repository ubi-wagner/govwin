# af_x24_5_cso — notes

**Source:** `docs/AF_X24.5_CSO.pdf`
**Agency:** Department of the Air Force (DAF)
**Program:** SBIR Commercial Solutions Opening (CSO), X24.5 Phase I
**Topics:** AFX245-PCSO1, AFX245-PCSO2
**Open / Close:** 7 February 2024 — 7 March 2024 (12:00 PM ET)

## Namespace key expected

The canonical key is `USAF:unknown:CSO:Open` under the current
`shredder/namespace.py` rules:

- `agency`: "Department of the Air Force" → alias → `USAF`
- `office`: none distinct (DAF runs CSO directly) → `unknown`
- `type`: CSO (Commercial Solutions Opening)
- `phase`: `Open` — CSO is a single-phase open call, not a
  multi-phase program like SBIR/STTR. Even though this specific
  CSO is labeled "Phase I" in the PDF title, the namespace module
  intentionally collapses all CSO cycles to `:Open` because memory
  search across CSO solicitations shouldn't be segmented by
  illusory "phases".

Not in `_THREE_PART_AGENCIES` (USAF isn't on the NSF/NIH list), so the
full 4-part form applies.

## Structurally distinct from SBIR BAAs

Unlike the DoD SBIR/STTR BAAs, this CSO uses a **slide deck** for the
technical volume (25-slide max), not a page-limited document.
Compliance extraction should populate `slides_allowed=true`,
`slide_limit=25`, and leave `page_limit_technical=null`.

## Compliance variables we expect to be extracted (hand-audited)

| Variable | Expected value | Source excerpt clue |
|---|---|---|
| `slides_allowed` | true | "Slide Deck is limited to twenty-five (25) slides" |
| `slide_limit` | 25 | Same line |
| `images_tables_allowed` | true | Slide format inherently allows tables/images |
| `submission_format` | "DSIP" | "All proposals must be prepared and submitted through the Department of Defense (DOD) SBIR/STTR Innovation Portal (DSIP)" |
| `pi_must_be_employee` | true | Standard SBIR rule (PI primary employment at SBC) — typically stated in eligibility |

## Custom variables (long tail, expected in `custom_variables` JSONB)

- `max_period_of_performance_months`: 3
- `max_sbir_funding_amount_usd`: 75000
- `classified_proposals_accepted`: false ("Classified proposals are NOT accepted")

## Sections expected

The CSO is short and dense — section extraction should cover at
minimum:

- `cover` — "Solicitation at a Glance" header with dates + limits
- `eligibility` — SBC eligibility, PI employment rule, foreign ownership
- `submission_format` — DSIP submission, deadline, slide deck format
- `evaluation_criteria` — how proposals are scored
