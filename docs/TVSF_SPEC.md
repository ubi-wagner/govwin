# TVSF_SPEC.md — the canonical TVSF Opp Card (any TVSF, going forward)

> Authoritative structure for an Ohio TVSF (Technology Validation & Startup Fund) proposal, derived from
> **DMVEC/EC's `TVSF_Outline_Template_10_31_25` (Round 43)** and confirmed against two funded winners
> (**EverTrack**, **HydroSmart**). This is the structure the TVSF Opportunity Card provisions to: **three
> volumes** + the mandatory tables + the two required letters. Numbers here are the *display* numbers; the
> Abstract is unnumbered and does not count against the 7-page narrative limit.

## Volumes (the Opp Card)
| Vol | Name | Type | Required | Page rule |
|---|---|---|---|---|
| 1 | **Narrative** | narrative | yes | **7 pages** (Q1–14); Abstract is a separate, uncounted page |
| 2 | **Willingness-to-License Letter** | letter | **yes** | ≤ 1 page, from the IP-owning institution |
| 3 | **ESP Support Letter** | letter | **yes** | ≤ 1 page, from the Entrepreneurial Services Provider (the EC) |

**Format (Vol 1):** US-Letter · **0.75″ margins · 11 pt Times New Roman · exactly 12 pt line spacing** · single
space after sentences · Oxford commas · left-aligned narrative. (Preset: a TVSF variant of `letter_sbir_phase1`
tuned to .75″/11pt/12pt, 7-page cap.)

---

## Volume 1 — Narrative (Abstract + Q1–14)

**Abstract** *(unnumbered; stand-alone page; excluded from the 7-page count; page numbering starts after it)*
Succinct, layman's overview. Shape: **2 sentences problem · 1–2 sentences tech · 2 sentences company · 2
sentences project.** Not a technical/academic abstract.

| # | Section | What it must contain (EC guidance, condensed) | Mandatory element |
|---|---|---|---|
| 1 | **Market Opportunity** | The problem (quantified), the market segment, and the **current** TAM (aim **$150M+**). Weblinks allowed *here only*. Do **not** reference your company or solution. | — |
| 2 | **Overview of Technology/Product** | The tech, the value proposition, and the differentiators vs named competitors. | **Competitor comparison table** — *Your Company vs Competitor A–D × performance factors* (✓/✗) |
| 3 | **Development Stage & Timeline** | Current TRL, MVP status, path to market; ties to Q11. | **Gantt chart** (must match the Q11 milestones/timeline) |
| 4 | **Commercialization & Market Entry Strategy** | Market dynamics + go-to-market: who buys, who you've talked to, initial target customer. | — |
| 5 | **IP Position** | The **licensed** IP: patent/application number + prosecution step; licensing status; fit to product. 4–5 sentences. | — |
| 6 | **Business Model** | Business model + abbreviated pro-forma P&L; Year-5 revenue must show meaningful economic impact. | **Pro-forma P&L table (unmodifiable categories)** — years 2026–2030: Revenues {Product sales · Licensing · TVSF · Other · **Total revenues**} · Production Expenses {COGS · **Gross profit**} · Other Expenses {R&D incl. IP · SG&A · Other · **Total other expenses**} · **Net profit** · **Equity Investment** |
| 7 | **Current Financial Stage** | Raise history, funding strategy, key assumptions. | — |
| 8 | **Economic Impact on State of Ohio** | Jobs, spend, and benefit to Ohio. | — |
| 9 | **Management Team** | Team's track record and fit. **Highest-weighted review category — do not shortchange it.** | — |
| 10 | **ESP Engagement** | Your work with the EC/Entrepreneurial Services Provider (the primary point of contact, cadence, what they've helped with). | — |
| 11 | **Project Plan** | The 12-month TVSF project plan; milestones measurable, tied to Q3 Gantt. | **Milestone table** — *Milestone Name · Description / Success Criteria* (rows MS 1…MS n) |
| 12 | **Budget: Table & Narrative** | Fully-vetted project budget with narrative; fixed-price where possible. | **Budget table** (by spend type → OTF project funds + total) + narrative |
| 13 | **Next Steps** | Immediate post-award actions (execute the license, etc.). | — |
| 14 | **Major Risks & Mitigation** | Key development/market risks and how they're mitigated. | — |
| — | *Proposal Supplement (conditional)* | **Only** if the Lead Applicant received a prior TVSF **Phase 1** award: a 1-page summary. | Phase-1 Project Summary table — *Milestone Name · Description/Success Criteria · Outcome* |

---

## Volume 2 — Willingness-to-License Letter *(required, template example)*

A ≤1-page letter **from the institution that owns the IP** (university TTO / Army lab / Navy / TechLink),
stating it is willing to license the identified patent to the Lead Applicant for the field of use. Required for
every TVSF. Template (bracketed = fill-in):

> **[Institution letterhead]** · [Date]
> To the Ohio Third Frontier / TVSF Review Committee:
> [Institution] owns U.S. Patent **[number]** ("[title]"). [Institution], through [TTO/TechLink], confirms it is
> **willing to license** this technology to **[Company]** on a field-of-use exclusive basis for **[field]**. A
> license application and commercialization plan **[has been submitted / is in negotiation]**; we anticipate
> executing a definitive agreement **[timeframe]**. We support [Company]'s TVSF application to validate and
> commercialize this technology.
> Sincerely, [Name, Title, Institution]

---

## Volume 3 — ESP Support Letter *(required, template example)*

A ≤1-page letter **from the Entrepreneurial Services Provider (the EC)** that has been working with the company,
confirming the engagement and endorsing the project. Template:

> **[EC letterhead]** · [Date]
> To the TVSF Review Committee:
> **[EC name]** has been working with **[Company]** since **[date]** as its Entrepreneurial Services Provider.
> Over this engagement we have advised on **[market validation / customer discovery / financial model / this
> TVSF proposal]**. [Company]'s **[technology]** addresses a real, quantified market need, and the team is
> **[assessment]**. We endorse this TVSF application and will continue to support the project through award.
> Sincerely, [Name, Title, EC]

---

## Compliance matrix (what the Opp Card provisions)

One matrix requirement per row, `is_mandatory=true`, `requirement_source='TVSF Round 43 — TVSF_Outline_Template_10_31_25'`:
Abstract; Q1–Q14 (each); the pro-forma P&L table (Q6); the milestone table (Q11); the budget table (Q12);
**Willingness-to-License letter**; **ESP support letter**; page-limit compliance (7-page narrative, ≤1-page
letters); format compliance (.75″/11pt TNR/12pt). The conditional Phase-1 supplement row is added only when the
opportunity/company indicates a prior Phase-1 award.

## Numbering (root fix, applied here)
`section_number` is a display label only (Abstract = none; Q1–14 = "1".."14"); a separate integer **`sort_index`**
(Abstract=0, Q1–14=1..14, letters follow their volume) is the sort key everywhere, so sections never string-sort
`1,10,2` and headings render clean **"1. Market Opportunity"** — never "2. #1 …".
