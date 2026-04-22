# dow_2026_sbir_baa — notes

**Source:** `docs/DoW 2026 SBIR BAA FULL_R1_04132026.pdf`
**Agency:** Department of War (recent rename from Department of Defense)
**Program:** SBIR 2026 Annual Program BAA, Revision 1
**Published:** 13 April 2026

## Namespace key expected

`DOW:unknown:SBIR:Phase1` — if the namespace module recognizes "DoW"
as a distinct agency alias. **Currently it does not** (our
`shredder/namespace._AGENCY_ALIASES` only maps variants of
"Department of Defense" → `DOD`).

## Implication for the namespace map

"DoW" is the recent rename of DoD (as of 2025-09). When this fixture's
`opportunities.agency` field contains "Department of War" or "DoW",
the namespace computation will currently yield `DOW:...`, which
breaks §H cross-cycle pre-fill from pre-rename DoD solicitations
(they're stamped `DOD:...`).

Two resolutions — both valid, pick one when this fixture first runs:

**Option A (preferred):** Add `DEPARTMENT OF WAR` → `DOD` (and
`DOW` → `DOD`) to `_AGENCY_ALIASES`. Rationale: organizational
continuity — same agency, same compliance rules, same historical
knowledge base. We want pre-fill from DoD 25.1 to work when curating
DoW 2026 BAAs.

**Option B:** Keep DoW as its own namespace, accept the discontinuity,
and rebuild namespace memory over a year or two. Rationale: if the
compliance rules change meaningfully post-rename, the segregation
is intentional.

## Recommended decision

Option A, with a `DECISIONS.md` entry noting the rationale. Verified
by running the regression suite against this fixture: the namespace
should come out as `DOD:unknown:SBIR:Phase1`, indistinguishable from
pre-rename BAAs.

## Compliance variables expected

Same as earlier DoD SBIR BAAs — the umbrella template is preserved.
Grep confirms the layout language is character-for-character
identical:

- 10-point min font
- 1-inch margins
- 8.5x11 paper
- DSIP submission

## Regression value

This fixture specifically guards against silent namespace breakage
from agency renames. If the namespace map regresses, this test fails.
