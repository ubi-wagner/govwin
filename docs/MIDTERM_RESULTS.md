# Midterm end-to-end drive — what actually happened

**Run**: 2026-08-22 · branch `claude/nice-hamilton-kBqtD` · sandbox emulating production exactly
(served as `govtech_app`, RLS on).
**Method**: `frontend/e2e/mt-arc-drive.spec.ts`, one continuous arc against a database reset to
schema-plus-platform-config only (`scripts/reset-minimal.sh`).

## The rule this run was built on

**Nothing is seeded that a user could create.** The database starts with the schema, the platform
config (automation rules, document templates, source profiles, content pages), the `rfp-pipeline`
house tenant's copy-forward starter shelf, and one operator account. Every tenant, opportunity,
library atom, bucket, purchase, portal, section, review and export in this report exists because
the drive pressed the button that makes it.

That constraint is the whole point. A suite that asserts against seeded fixtures is checking that
the seeder ran. Composing the world through the product's own surfaces is what makes a green run
mean the product works — and it is what surfaced B62 below, which no unit test could have found
because the defect only exists in a tenant that was *created*, not inserted.

## The ledger

Every step is recorded with an actor and one of five statuses. A block is noted and stepped past,
never fatal — the arc's job is to reach the end and report honestly, not to stop at the first
surprise.

| status | meaning |
|---|---|
| `ok` | the step did what it said |
| `decision` | a judgement a human had to make, with the reasoning recorded |
| `override` | proceeded past a gate deliberately, with what was overridden on the record |
| `note` | an observation worth keeping (counts, sizes, verdicts) |
| `blocked` | failed; recorded with its message, and the arc continued |

The ledger is also the record of the run converging. Each figure is one full arc against a freshly
reset database, and every block that closed between them was a defect in the *harness* — the drive
speaking a dialect the API never offered — not in the product:

| run | ok | blocked | what closed |
|---|---|---|---|
| first complete pass | 71 | 29 | — |
| after verb + gate-walk fixes | 113 | 3 | reached submission and exported all four formats |
| after the collaborator / comment / shadow fixes | 89 | 3 | ACTs 1–8 clean; only the second-portal release left |
| after the sign-out fix | 89 | 0 | all nine acts, including the automated divergent path |
| **final** | **133** | **0** | the informed pursuit choice — a full 22-section build end to end |

The final tally reads **`ok=133 · decision=33 · note=29 · override=2 · blocked=0`**, in 2.3 minutes.

The two overrides are both deliberate and both recorded with what was overridden: accepting a
default skeleton on a solicitation that defers its format elsewhere, and then entering that
deferred value by hand as the curator. Nothing else in the run needed one.

The jump from 89 to 133 is the last real fix, and it is worth naming because it looks like a
harness detail and is not. The customer was buying whichever opportunity happened to be first,
which on one pass was the master whose skeleton had never been landed — so the build provisioned a
single generic "Technical Volume" and there was nothing to author. The product was being honest;
the drive was not reading. A customer reads the card before buying, and the card carries
`complianceSummary.volumeCount`. The drive now sorts on it, says which one it chose and why, and
records any opportunity that has no volume structure yet:

```
◆ [HITL] pursuit choice — pursuing "NSF STTR Phase I — Robotics for the Built Environment
         (NSF 26-522)" — 6 volume(s) on the card, so there is a real build behind it
·  [system] sections provisioned — 22
```

### Two invariants the run checks rather than assumes

- **The operator's descent is visible to the customer.** After the admin descends into the tenant's
  space and ascends back, the drive opens `/portal/<slug>/activity` — the page a customer would
  open — and confirms both crossings appear there. `descended=true ascended=true`. An audit trail
  nobody can read is not an audit trail.
- **The agent workforce is advisory, not autonomous.** After the admin doorbell fires a full draft
  in Mode C (full auto, adversarial gate on), the drive re-reads the proposal: `stage=draft
  locked=false`. Work was proposed; nothing advanced, locked, or submitted. An agent writing text
  is the product working — an agent submitting a bid would be the product being dangerous.

## The arc

| act | actor | what happened |
|---|---|---|
| 1 · opportunity supply | master_admin | 4 solicitations across 4 agencies (DoW SBIR Phase I, NSF STTR Phase I, DOE SBIR Phase II, Ohio TVSF) staged, curated, approved and pushed through the real tool state machine |
| 2 · customer onboarding | public → master_admin | Northwind Additive applied through the **public application form** — T&Cs opened, scrolled, signed — then was reviewed and accepted, creating the tenant and issuing a temp password |
| 3 · tenant library | tenant_admin | first sign-in, forced password reset, two company PDFs uploaded and atomized, and the company's own scoring bucket authored |
| 4 · purchase + provision | tenant_admin → master_admin | comp code redeemed → `curation_pending`; operator completed build-out and released the portal; 22 sections provisioned from the compliance matrix |
| 5 · authoring | tenant_admin | all 22 sections authored |
| 5b · collaborators | tenant_admin | a teammate invited as `contributor` (edit) and an outside consultant as `external` (comment), then a review note anchored to a section |
| 5c · shadow descend / ascend | master_admin | the operator entered the customer's space, read their live build, and left — both crossings audited |
| 6 · reviews | tenant_admin | AI/color-team review, compliance matrix, packaging review, readiness verdict — each read and accepted as **advisory** |
| 7 · lock + export | tenant_admin | all sections locked, gates walked to submission, all four formats exported |
| 8 · artifact inspection | — | the exports opened and checked (below) |
| 9 · divergent path | tenant_admin → master_admin | a **second** portal on a different opportunity, released, then handed to the agent workforce via the admin doorbell (Mode C, full auto) and never hand-authored |

## The artifacts, actually opened

Not byte counts — the documents were parsed and their contents checked against the source of truth.

```
json   17,112 bytes   22 sections, every one carrying prose, ordered by integer sort_index
docx   27,985 bytes   22/22 section titles present in the body, 0 out of order
pdf    71,942 bytes   6 pages, 14,198 chars of extractable text, 22/22 titles in ascending order
zip   127,401 bytes   6 per-volume-native files
```

The zip is the one to look at closely:

```
V1_Proposal_Cover_Sheet.docx
V2_Technical_Volume.docx
V3_Cost_Volume.xlsx          ← the cost volume renders as a spreadsheet, not a Word file
V4_Company_Commercialization_Report.docx
V5_Supporting_Documents.docx
V6_Fraud_Waste_and_Abuse_Training.docx
```

Per-volume-native means each volume exports in the format that volume actually is. The cost volume
comes out as `.xlsx` because a burden waterfall is a spreadsheet; the narrative volumes come out as
`.docx`. That is the unified canvas forking on `canvas.format` at the export boundary, visible in
the file extensions.

**Section ordering was checked for teeth, not just for pass.** The export order is compared against
a natural (numeric-aware) sort AND against a naive string sort. Sections number 1…22, so a string
sort puts "10" before "2" — a different document with the same bytes. The export matches the
natural order; the string sort does not. That is mig 143's reason for existing, confirmed on a
real package rather than asserted.

## Findings

### B62 — a new tenant could never author its own scoring lens *(fixed)*

The headline finding, and it took walking in as a customer to see it.

Every tenant-creation path seeds `DEFAULT_BUCKETS` (6) so fanned cards rank on arrival. Mig 181 set
`max_buckets_per_tenant` to 6. Neither is wrong alone. Together, a tenant opens at **100% of cap**,
so the first thing a customer does — author the lens they want opportunities ranked by, item ① of
the ranking spine — answers:

```
409  {"error":"You've reached the limit of 6 spotlight buckets. Delete one to add another.",
      "code":"BUCKET_LIMIT"}
```

on a tenant that had authored zero.

`RANKING_SPINE.md` §15 asks for both halves in one sentence — *"global default raised 12 → 6; keep
all 6 seeded defaults"* — which is where the collision hid. (It also calls a lowering a raise.) The
cap's unit test passes, because it builds its own fixture to reach the ceiling; nothing ever asked
what a tenant's bucket count is at the moment of creation.

**Fixed** (mig 203 + `lib/automation/policy.ts`) by putting the two numbers in a relationship:
`DEFAULT_MAX_BUCKETS = DEFAULT_BUCKETS.length + BUCKET_AUTHORING_HEADROOM`, with any configured cap
floored at `DEFAULT_BUCKETS.length + 1` so admin tuning cannot re-close authoring either. Verified
live: cap reads 10, and a freshly-onboarded tenant authors its bucket.

### B63 — the drive harness had no action timeout *(fixed)*

`playwright.config.ts` never set `actionTimeout` or `navigationTimeout`, and Playwright's default
for both is **0, meaning wait forever**. Combined with the 30-minute per-test timeout the long
drives need, a single missing selector stalled an entire run — producing no error, because nothing
had failed; it was still politely waiting. Bounded to 20s/45s so a missing element fails in seconds
and the ledger records it.

### Two product behaviours that look like bugs and are not

Both cost real time to understand, so both are now documented where the next person will look.

**A deferred compliance field blocks the push — correctly.** The DoW BAA says its submission format
lives in the Component-specific instructions. Ingest Assist refuses to invent a value the document
does not state, clears the default and records the deferral. The push gate then refuses to release
an opportunity whose `submission_format` is unknown. Neither is wrong; together they are an
instruction to a human. The drive now does what that instruction says — enters the value by hand
via `compliance.save_variable_value` with `action: 'manual_entry'`, so it lands with `hitl`
provenance and never masquerades as read-from-source — and the push then succeeds.

**The build-out readiness bar has five conditions, not three.** A master showing compliance, six
volumes and twenty-two required items still reported `ready:false`. The summary comments in
`lib/provisioning/readiness.ts` and `PROVISIONING_WORKSPACE_DESIGN.md` both said the bar was
"compliance + ≥1 volume + ≥1 required item", but the implementation also requires
`itemsUndecided === 0` and `volumesUndecided === 0` — folded in later, and load-bearing: an
undecided item provisions as an authorable section, and the drafter then writes plausible prose
where a signed federal form belongs. The code was right; the summaries were stale.

Confirmed against the live data rather than inferred from the source — every one of those
twenty-two items is undecided, so the verdict is exactly right:

```
  sol    | vols | items | undecided
---------+------+-------+-----------
 391eaa2a|    6 |    22 |        22
 c2aa4185|    6 |    22 |        22
 b168c015|    6 |    22 |        22
 c9b74492|    0 |     0 |         0   ← the master whose skeleton was never landed
```

Corrected in `readiness.ts`, the design doc, and the RFP-admin guide.

## What this run does not cover

Stated plainly rather than left for someone to discover:

- **One tenant, not several.** The arc composes Northwind Additive end to end and runs two
  divergent completion paths *within* it — manual authoring on the first build, the agent
  workforce on the second — which is what isolates the path as the variable. Cross-tenant
  isolation is exercised by the separate `mt3-library-drive` spec; this arc does not re-prove it.
- **The partner-manager console is not walked.** Shadow descent and ascent are driven and audited
  as rfp_admin; the `partner_admin` stable-of-companies path is not part of this arc.
- **The canvas is exercised through its outputs, not its editor.** The per-volume-native export
  proves the doc and xls surfaces fork correctly (`.docx` narrative volumes, `.xlsx` cost volume),
  but the drive writes sections through the save API rather than clicking in `CanvasRenderer` /
  `SheetEditor` / `SlideEditor`. The interaction layer — overlays, act-on-selection verbs, the
  assist panel — is not touched here.
- **The AI-gated flows run against the committed emulator**, not a live key (`EMULATE=1`,
  docs/AI_FLOWS_PROOF.md). The wiring is real and identical to production; the model is not.
- **Volume-level page budgets are checked by the compliance floor at export**, and the drive records
  the `X-Compliance-Violations` header, but the arc does not assert a specific page budget per
  volume against each agency's stated limit.
- **The second build is left mid-flight on purpose.** ACT 9 requests the full draft and then checks
  that nothing advanced. Landing the workforce's staged output is a separate human act
  (docs/FULL_DRAFT_LANDING_DESIGN.md) and the arc stops short of it deliberately.
