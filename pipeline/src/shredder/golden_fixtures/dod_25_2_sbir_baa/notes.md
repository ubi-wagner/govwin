# dod_25_2_sbir_baa — notes

**Source:** `docs/DoD 25.2 SBIR BAA FULL_04212025.pdf`
**Agency:** Department of Defense (umbrella BAA)
**Program:** SBIR 25.2 Annual Program BAA
**Open / Close:** 23 April 2025 — 21 May 2025 (12:00 PM ET)

## Namespace key expected

`DOD:unknown:SBIR:Phase1` — same as 25.1, same cycle forms the pair.

## Cross-cycle role

This is the "new cycle" in the cross-cycle test with `dod_25_1_sbir_baa`.
The §H regression scenario is:

1. Shred 25.1 first → namespace stamped `DOD:unknown:SBIR:Phase1`,
   compliance values written to `solicitation_compliance` for 25.1's
   curated row.
2. Shred 25.2 second → same namespace stamped.
3. When curator opens 25.2 in the workspace, `memory.search_namespace`
   with prefix `DOD:unknown:SBIR:` MUST surface 25.1's curated values.
4. UI offers one-click pre-fill of 25.1's page limits, font rules,
   etc. into 25.2's compliance draft.

## Compliance variables expected (identical to 25.1)

See `../dod_25_1_sbir_baa/notes.md` — the umbrella rules don't change
between cycles. Individual topics and per-component limits may
change, but those are beyond the 200K-char scope of this fixture.

| Variable | Expected | Source |
|---|---|---|
| `font_size` | "10" or 10 | §3.7 Phase I Proposal Instructions |
| `margins` | "1 inch" | §3.7 Layout |
| `submission_format` | "DSIP" | §6.0 |
| `pi_must_be_employee` | true | §1.4 Eligibility |

## Regression-test value

A diff between 25.1's and 25.2's `expected.json` sections reveals
changes in the BAA template — useful for tracking which compliance
shifts happen cycle-over-cycle.
