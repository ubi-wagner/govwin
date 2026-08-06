# TVSF Build — Paul Jackson's Two-Role Journey (RFP Pipeline admin → Foundation shadow admin)

> **Who this is for.** Paul Jackson (VP Strategic Programs, Entrepreneurs' Center — the EC) wears
> two hats on the RFP Pipeline platform. This guide walks his end-to-end path and doubles as the
> **section-by-section TVSF compliance contract** that the platform builds to. It is validated against
> the EC's DMVEC Round-45 template **and** against Paul's own deterministic proposal parser (font /
> margins / native tables / pro-forma math / budget caps). The worked artifact is
> `Foundation_TVSF_R45_Templated.docx`.
>
> **The point of the two roles:** the more the EC curates the OPP up front (Role 1), the more compliant
> the fully-automated build comes out the far end (Role 2) — for *every* company that submits after.

---

## The two hats

| Hat | Where | What Paul does |
|---|---|---|
| **RFP Pipeline admin** | platform side (`/admin`) | ingest + curate the TVSF OPP, and **build a quality compliance matrix section-by-section** so the auto-build is constrained to the EC's real rules |
| **Foundation shadow admin** | tenant side (`/portal/foundation`) | comp-**purchase** the TVSF portal, run the **admin-guided 3-stage doorbell build** (Draft → Refine → Compliance) with **adversarial color-team review**, **download**, and **recycle** atoms into the library for the next SBIR |

Accounts (sandbox): RFP admin `eric@rfppipeline.com`; Paul (shadow admin) `pjackson@ecinnovates.com` / `DemoPass123!`.

---

# Part 1 — RFP Pipeline admin: ingest the OPP + build the compliance matrix

### 1. Sign in and open the triage queue
`/login` → `/admin/rfp-curation`. **Validation:** the TVSF OPP appears in the RFP Triage Queue
(source `intake:admin`, agency *Ohio Third Frontier · DMVE(C)*).

### 2. Claim + curate the OPP from the EC template
Claim the solicitation, then curate its two volumes from the DMVEC Round-45 template:
**Volume 1 — Proposal** (7-page narrative; Abstract excluded) and **Volume 2 — Budget** (spend-type table).
**Validation:** status advances `new → claimed → curation_in_progress`; both volumes provisioned.

### 3. Build the compliance matrix — section by section (the EC contract)

This is the heart of the job. One matrix row per section, `is_mandatory=true`,
`requirement_source = 'TVSF Round 45 — DMVEC template'`. Each row encodes **what the section must
contain, whether it is narrative or a native table, and the hard numeric constraints** — so the
auto-build cannot produce the failures Paul's parser catches.

| § | Section | Narrative? | Mandatory native table / element | Hard rule the matrix enforces |
|---|---|:--:|---|---|
| — | **Abstract** | ✓ | — | Plain, public/press-safe; **no trade secrets**; **excluded** from the 7-page count |
| 1 | **Market Opportunity** | ✓ | TAM→SAM→SOM 3-circle diagram | **External only** (no company/solution); **state the TAM**; **hyperlinks allowed here only** |
| 2 | **Overview of Technology/Product** | ✓ | **Competitor comparison table** (You vs A–D) | concise, editable table cells |
| 3 | **Development Stage & Timeline** | ✓ | **Gantt / timeline table** | must match §11 milestones; **state the TRL** |
| 4 | **Commercialization Strategy** | ✓ | — | **open with the SAM** (2 sentences + how reached) |
| 5 | **Intellectual Property** | ✓ | — | licensed IP + status; **compare vs alternatives** (other IP / in-house / off-the-shelf) |
| 6 | **Business Model & Pro-forma P&L** | ✓ | **Pro-forma P&L table** | **years 2027–2031**; **mandatory TVSF revenue row**; summary rows; arithmetic must check |
| 7 | **Current Financial Stage** | ✓ | — | raise history + capital plan |
| 8 | **Economic Impact on Ohio** | ✓ | — | Ohio jobs / in-state spend |
| 9 | **Management Team** | ✓ | — | **highest-weighted**; bolded names, **time-commitment %**, **$X raised across Y** |
| 10 | **ESP Engagement** | ✓ | — | the EC contact, cadence, what they helped with |
| 11 | **Project Plan** | — table-led | **Milestone table** — Name · Desc/Success · **Timeframe · Approx. Funds · Vendor(s)** | funds **sum to the ask** and reconcile to §12 |
| 12 | **Budget** | ✓ | **Spend-type table** | **ask ≤ $200,000**; **Personnel ≤ 20% (≤$40k)**; **NO cost share**; narrative explains every line |
| 13 | **Next Steps** | ✓ | — | post-award actions; **no "exit" language** |
| 14 | **Major Risks & Mitigation** | — table-only | **Risk table** — Risk · Type · Severity · Mitigation | **must be a native table, not narrative** |
| V2 | **Willingness-to-License Letter** | letter | — | ≤1 page, from the IP-owning institution |
| V3 | **ESP Support Letter** | letter | — | ≤1 page, from the EC |

**Format (enforced on Volume 1):** US-Letter · **0.75″ margins · 11 pt Times New Roman · exactly 12 pt
line spacing** · left-aligned · single space after sentences. (Unlike SBIR, TVSF allows **no font-size
exception for tables** — 11 pt everywhere.)

### 4. Adversarial review before it ever reaches a customer
Run the **color-team reviewer in adversarial mode** over the drafted matrix/section skeleton. It is
told to *refute* compliance — flagging exactly the misses Paul's parser would (a §1 that names the
company, a Risk answer written as prose, a budget over $200k, a pro-forma on the wrong years). Findings
land as guidance on the offending rows; nothing advances until they clear.

### 5. Provision / apply the matrix
Apply the compliance preset → the volumes, required items, and the section molds are materialized on
the master solicitation, ready to fan into any tenant's portal on release.
**Validation:** `GET /admin/rfp-curation/<solId>` shows Vol 1 (14 sections + Abstract + molds),
Vol 2 (budget), and the compliance rows above.

---

# Part 2 — Foundation shadow admin: purchase → doorbell build → download → recycle

### 6. Pin Foundation as shadow admin
Paul signs in and pins Foundation (`/api/enter?slug=foundation`). He is a `partner_user` with a
company-appointed **`tenant_admin` membership** (shadow admin) **plus** an external
proposal-collaborator grant on the TVSF build. **Validation:** `/api/auth/session` returns
`tenantSlug=foundation`, `membershipPinned=true`.

### 7. Comp-purchase the TVSF portal
Buy the proposal portal with the comp code **`rfppipelinetest`** → `proposal_portals` `curation_pending`
(72h SLA). An RFP admin then **releases** it from the shadow account, provisioning the build **UNLOCKED**
and instantiating the **compliance matrix + section molds from the master solicitation** (the one Part 1
just curated). **Validation:** the portal shows `launched`; the compliance matrix is 14/14 instantiated.

### 8. Run the doorbell — fully-automated, 3-stage, color-team reviewed
From `/admin/agents` (the **Proposal Auto-Drive doorbell**) or the tenant Studio, run the admin-guided
**3 gated loops**:

1. **Draft** — `proposal_manager` plans; the cohort (`section_drafter`, `market_analyst`,
   `cost_estimator` backed by the deterministic `budget_model`) fills every section against the matrix.
2. **Refine** — restyle / tighten to the §-rules; `formatter`/`stylist`/`continuity_manager` enforce
   the .75″/11pt/12pt format and native tables.
3. **Compliance** — the **AdvisoryOverlay in adversarial mode** fans the review cohort 1:n, the
   `advisory_manager` reconciles, and each loop **lands in review**: Paul **comments + regenerates**
   (comments thread as `guidance`) or **approves → next**. Full-auto (Mode C) chains all three.

Every stage is advisory — it never advances a gate, locks, or submits on its own.
**Validation:** `proposals.studio_phase` walks `draft → refine → compliance`; `system_events` records
each `AI_INVOKE` + color-team pass.

### 9. Advance + download
On the compliance gate clearing, advance the build to **`submitted`** and download:
`POST /api/portal/foundation/proposals/<id>/package?format=docx|pdf|zip`. **Validation:** the docx opens
with the native tables, 7-page narrative, and the budget spreadsheet — and passes Paul's parser.

### 10. Recycle into the library
Atomize the locked sections back into `library_atoms` (visibility-enforced, taxonomy-tagged). Those atoms
are now reusable draft-selection content for Foundation's **SBIR** builds (NSF Advanced Manufacturing,
DOE Low-Carbon Concrete, Army ERDC ACES) — the company is "set up to do SBIRs with all of its library
content." **Validation:** the drafted sections appear as approved atoms in `/portal/foundation` library.

---

## The acceptance test — Paul's deterministic parser

The matrix in Part 1 is built so the Part 2 auto-build **passes Paul's Python parser**, which
deterministically checks: left-alignment · ≥11 pt (no table exception) · 0.75″ margins · Times New Roman ·
all required sections present · **all required native tables present** (Risk §14, Project Plan §11) ·
hyperlinks only in allowed sections · §1 has no company reference / has a TAM / has external links ·
§3 has a Gantt · pro-forma summary rows + ≥5 years + **correct gross-profit / total-expense / net-profit
arithmetic** · **budget total ≤ $200k, Personnel ≤ $40k, per-line narrative**. The one thing the
system cannot originate is the **real founder bios and fundraising history** (§9) — those stay
applicant-supplied placeholders; everything the platform controls is enforced by the matrix.
