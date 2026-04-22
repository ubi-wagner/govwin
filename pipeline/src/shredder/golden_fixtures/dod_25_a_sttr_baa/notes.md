# dod_25_a_sttr_baa — notes

**Source:** `docs/DoD 25.A STTR BAA FULL_12202024.pdf`
**Agency:** Department of Defense
**Program:** STTR 25.A Annual Program BAA
**Opened:** ~December 2024

## Namespace key expected

`DOD:unknown:STTR:Phase1`

Same umbrella structure as the DoD SBIR BAAs, but `type=STTR` instead
of `SBIR`. §H pre-fill for STTR cycles should work the same way
against prefix `DOD:unknown:STTR:`.

## Why STTR is a distinct archetype

STTR requires a **research institution partner** (31.5% minimum of
R&D effort) in addition to the small business. The shredder should
surface the partner requirement as a compliance flag separate from
the SBIR rules.

## Compliance variables expected

Inherits the umbrella rules from SBIR BAAs, plus STTR-specific:

| Variable | Expected | Source |
|---|---|---|
| `font_size` | "10" or 10 | Same layout language as SBIR BAA |
| `margins` | "1 inch" | Same |
| `submission_format` | "DSIP" | Same |
| `pi_must_be_employee` | false | STTR PI can be employed by either SBC OR research institution |
| `partner_max_pct` | 60-69 | SBC does ≥40%, RI does ≥30%, others ≤30% (inverse rule) |

Note on `pi_must_be_employee`: STTR relaxes the SBIR rule that the
PI must primarily work at the SBC. For STTR, the PI may be at
either entity. Shredder should reflect this as `false` or mark
`custom_variables.pi_employer_flexible=true`.

## Sections expected

Same as SBIR BAAs (same umbrella template):

- `cover`
- `eligibility` (with STTR-specific partnership language)
- `submission_format`
- `evaluation_criteria`
- `compliance_requirements`
- `appendix`
