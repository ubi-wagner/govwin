# The scenario matrix

**What "drive all the combinations" actually means, written down before anything is driven.**

The two front-door guides — [`CUSTOMER_ONBOARDING_GUIDE.md`](./CUSTOMER_ONBOARDING_GUIDE.md) and
[`RFP_ADMIN_OPERATIONS_GUIDE.md`](./RFP_ADMIN_OPERATIONS_GUIDE.md) — are now the specification: they
describe every surface and every branch a real actor can take. This document turns that prose into
an enumerated matrix, so **coverage is a claim that can be checked rather than asserted**.

---

## First, the honest arithmetic

Sixteen dimensions come out of the guides. Their cross-product is:

```
3 × 2 × 3 × 2 × 4 × 3 × 3 × 3 × 5 × 4 × 2 × 3 × 2 × 3 × 6 × 2  ≈  45,000,000
```

Forty-five million combinations, most of them meaningless — "an archived tenant exporting a
spreadsheet cost volume as a partner_user while acknowledging an amendment" is not a scenario, it is
a sentence. Driving them is not possible and would not be informative if it were.

So **"all combinations" is delivered as a covering set**, and the two properties that make it worth
anything are stated up front:

1. **Every value of every dimension is exercised at least once.** No value is left untested.
2. **Every pair that genuinely interacts is exercised together.** Cost form × canvas surface
   interacts (a form renders on a surface). Cost form × archive target does not (they never meet in
   the product). The interacting pairs are named in §3 rather than left to the reader's trust.

What this set cannot claim is exhaustiveness over the cross-product. Saying so is the difference
between a coverage claim and a marketing one.

---

## 1 · The dimensions, and where each comes from

| # | Dimension | Values | Guide |
|---|---|---|---|
| **D1** | Acquisition | comp-code purchase · admin comp (free portal) · second-buyer reuse | Cust 3.3 · Admin 7.1, 7.4 |
| **D2** | Release path | provisioning cockpit *Complete & Release* · tenant-side release | Admin 7.1 |
| **D3** | Workflow plan | accepted as recommended · edited before start · rebaselined after start | Cust 4.2 |
| **D4** | Stage gate | Human · AI-manager | Cust 4.2 |
| **D5** | Draft path | drafter on release · Studio Draft loop · full-draft Mode C · admin doorbell | Cust 4.3, 6.1 · Admin 8.5 |
| **D6** | Canvas surface | fluid (`letter`) · slides (`slide_16_9`) · grid (`spreadsheet`) | Cust 5.1 |
| **D7** | Cost form | `burden_waterfall` · `sf424a` · `otf_state_budget` | Admin 5.3 |
| **D8** | Collaborator scope | whole-workspace · per-build · per-section | Cust 7.2 |
| **D9** | Library source | upload+atomize · hand-atomize · starter set · reuse-past · template gallery | Cust 2.1–2.4, 5.20 |
| **D10** | Export format | json · docx · pdf · zip | Cust 6.4 |
| **D11** | Compliance gate | within limits · over limit (refused, with the rule named) | Cust 6.3 |
| **D12** | Outcome | won · lost · withdrawn | Cust 6.5 |
| **D13** | Amendment | none · detected → confirmed → fanned out → acknowledged | Admin 4.5 · Cust 7.1 |
| **D14** | Archive target | portal · library atom · tenant | Cust 2.4 · Admin 2.2 |
| **D15** | Actor | master_admin · rfp_admin · partner_admin · tenant_admin · tenant_user · partner_user | Admin 11 |
| **D16** | Isolation | own-tenant allowed · cross-tenant refused | Cust "What RFP Pipeline is" · Admin overview |

### What the box can supply

Checked before enumerating, so the matrix is not aspirational. Nine provisionable opportunities —
a curated master with at least one volume and at least one required item — spanning:

| Agency / program | Cost form it exercises |
|---|---|
| DoW SBIR Phase I (Navy), DoW STTR D2P2 (Navy), Army ERDC SBIR | `burden_waterfall` |
| NSF SBIR, NSF STTR, DOE SBIR, NASA SBIR | `sf424a` |
| Ohio TVSF ×2 | `otf_state_budget` |

All three cost forms and both spines are supplied. Tenants, people, partner orgs and builds are
constructed per-run by `scripts/lib/scenario.mts` and disposed after, so no scenario depends on a
seeded fixture that can rot.

---

## 2 · The covering set

Eighteen scenarios. Each drives a coherent story a real person would recognise — that is the
constraint that keeps them meaningful rather than a random assignment of dimension values.

| # | Scenario | Dimensions it covers |
|---|---|---|
| **S01** | DoW SBIR Phase I: comp-code buy → cockpit release → plan accepted as recommended (Human gate) → drafter on release → author in the fluid canvas → lock → docx | D1a D2a D3a D4a D5a D6a D7a D10b D11a D15d |
| **S02** | Same opportunity, **second buyer** — the fast path, no 72h build | D1c D2a D15b |
| **S03** | NSF SBIR: **admin comp** (free portal) → tenant-side release → plan **edited** before start → Studio Draft loop → zip | D1b D2b D3b D5b D7b D10d D15b |
| **S04** | Ohio TVSF: buy → release → plan **rebaselined** after start (shift ±N days) → **AI-manager** gate → pdf | D2a D3c D4b D7c D10c |
| **S05** | DoW STTR D2P2: full-draft **Mode C** (auto) via the portal → land on review → json | D5c D10a |
| **S06** | Same build, full draft fired from the **admin doorbell** — recorded as `admin_doorbell`, not `portal` | D5d D15a |
| **S07** | Deck: instantiate a **slide** template from the gallery → edit → slide budget → pptx | D6b D9e |
| **S08** | Workbook: blank **grid** preset → type a budget → save → xlsx | D6c |
| **S09** | Library: **upload + atomize** a document → review → accept → it appears as an insert candidate | D9a |
| **S10** | Library: **hand-atomize** (box-and-tag on a rendered page) → accept | D9b |
| **S11** | Library: **starter set** copied into a fresh tenant — a copy, not a shared object | D9c D16a |
| **S12** | Library: **reuse a past proposal** — structure kept, content stripped, re-drafted from the library | D9d |
| **S13** | Collaborator **whole-workspace** grant → sees the build; **per-build** grant → sees one; **per-section** grant → opens on My Sections and cannot reach the library | D8a D8b D8c D15f |
| **S14** | **Compliance gate**: a volume driven over its page limit → export refused, naming the rule and the overage | D11b |
| **S15** | Outcomes: **won** (contract + kickoff task) · **lost** · **withdrawn** — three builds, three endings | D12a D12b D12c |
| **S16** | **Amendment**: logged on a master → confirmed → fanned out → the buyer acknowledges | D13b |
| **S17** | **Archive**: a portal (cascades its build workflows) · an atom (drops from draft selection) · a tenant (licence slumber) — each reversible, nothing hard-deleted | D14a D14b D14c D15a |
| **S18** | **Isolation**: a partner_admin runs a stable of two companies, descends into one, and cannot read the other; a tenant_admin cannot read a foreign atom | D15c D15e D16a D16b |

---

## 3 · The interacting pairs, named

A covering set is only as good as its account of what interacts. These pairs are covered
**together**, and the scenario that does it is named:

| Pair | Why it interacts | Covered by |
|---|---|---|
| D6 canvas surface × D10 export | Each surface has a native format; a deck must leave as pptx, a grid as xlsx | S07, S08 |
| D7 cost form × D6 surface | An agency cost form is a `letter` page carrying spreadsheet-style tables, **not** a workbook — the distinction the guides had to make explicit | S01, S03, S04 |
| D11 gate × D10 export | The gate is enforced *at* export, per format | S14 |
| D1 acquisition × D2 release | A comp purchase and an admin comp reach release by different routes | S01, S03 |
| D3 plan × D4 gate | An edited plan re-projects onto live tasks; an AI-manager gate advances them | S03, S04 |
| D5 draft path × D15 actor | The same trigger fired from the portal and from the doorbell must be distinguishable in the audit trail | S05, S06 |
| D8 collaborator scope × D16 isolation | A scoped grant is a real boundary, not UI hiding | S13 |
| D9 library source × D16 isolation | Everything arrives by **copy into** the tenant — never a shared object | S11 |
| D12 outcome × D14 archive | A won build becomes a contract; an archived portal cascades its workflows but not co-active runs | S15, S17 |
| D13 amendment × D15 actor | Detected by an admin, acknowledged by the buyer — two actors, one chain | S16 |

### Pairs deliberately **not** covered, and why

Naming these is the point: an unstated exclusion is how a coverage claim quietly stops meaning
anything.

- **D7 cost form × D14 archive** — a cost form and an archive action never meet in the product.
- **D9 library source × D10 export format** — an atom's origin does not reach the export writer;
  by the time a section exports, provenance is metadata, not content.
- **D3 workflow plan × D6 canvas surface** — the plan schedules work; the surface renders it. No
  code path joins them.

---

## 4 · The rules every scenario runs under

Inherited from the four verification rules (`docs/TESTING_STRATEGY.md`) and the drive estate's own
hard-won ones:

1. **Real actors, real routes.** Signed in as the person the scenario names, through the product's
   own endpoints. A scenario that cannot authenticate reports **CANNOT RUN**, never a verdict.
2. **Proven on four planes** where each applies — database, events, storage, filesystem. A route
   returning 200 is not evidence a write landed.
3. **Built and disposed per run.** No scenario depends on a seeded fixture; each constructs what it
   needs through `scripts/lib/scenario.mts` and returns the world to what it was.
4. **Uncovered is not passing.** A scenario the box cannot supply is reported with the reason,
   never silently skipped, and never counted as a pass.
5. **The expectation comes from the source.** Where a scenario asserts what a page or route should
   produce, the predicate is copied from that page or route — not from a version of it believed to
   be equivalent.

---

## 5 · Status

Driver: `frontend/scripts/drive-scenario-matrix.mts`. **A scenario absent from that run's table has
not been driven, whatever this document says about it.**

As of the last run — 7 passed · 0 failed · 0 could-not-run · 11 not driven, database untouched:

| Driven and passing | Registered, driver not written |
|---|---|
| **S01** buy → release → lock → docx (33 KB, PK magic bytes, 0 violations) | S03 · S04 · S07 · S08 · S10 · S14 |
| **S02** second buyer — two builds off one master, neither reachable from the other | |
| **S11** starter library copied in, not shared — 303 atoms each, 0 shared rows, 0 crossing edges | |
| **S13** collaborator scope — per-section grant, no leak to a sibling build, revoked-not-deleted | |
| **S15** outcomes — awarded/rejected/withdrawn, a win creates the contract | |
| **S17** archive — portal · atom · tenant, every row still present and stamped | |
| **S18** isolation — 403/403/404 foreign, 200 own (isolation, not deny-all) | |

Five of the eleven are already covered by existing branch drives (S05, S06 by `drive-full-draft`;
S09 by `drive-atomization`; S12 by the reuse-past drives; S16 by `drive-amendment`) — they are
listed as NOT DRIVEN *here* because being covered somewhere else is not the same as being covered
by this matrix, and a table that borrows another suite's green is a table that overstates.

### What driving the first seven found

Four defects, **all four in the scenarios rather than the product** — which is itself the finding
worth recording, because each one had me briefly believing a flow was broken:

| | The scenario asserted | The product actually does |
|---|---|---|
| S01 | that locking every **section** makes a build downloadable | *"Proposal must be locked or in submitted/archived stage"* — the guide states this correctly; the scenario had simplified it |
| S15 | `won / lost / withdrawn` on a draft build | the wire vocabulary is `awarded / rejected / withdrawn` (the **buttons** say Won/Lost/Withdrawn), and the build must be `submitted` or `final` first |
| S15 | that the outcome lands on `proposals.outcome` | there is no such column: the proposal is **archived**, the detail goes to `proposal_stage_history`, and `outcome` is stamped on the **library atoms** — which is exactly the guide's claim that outcomes tune your library |
| S17 | an empty archive body | `{ action: 'archive' \| 'restore' }` — one endpoint both ways, which is how the product expresses reversibility |

Two more were in the reporting rather than the driving: a detail string that printed
`archived_at set` whenever the row existed, including when it was null; and a summary table that
printed `FAIL` without the reason beside it.
