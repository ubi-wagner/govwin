# Human Gap Analysis — RFP Pipeline (2026-08-10)

> From the perspective of the **humans who use the platform**, not a code audit. Grounded in what I
> actually drove this session against the two real DoW 2026 solicitations. Each gap is framed as:
> **what the human expects → what actually happens → the gap → how to close it.** Severity: **P1**
> (would cause a wrong/rejected submission or the core value is unproven) · **P2** (scope/expectation
> mismatch) · **P3** (polish).

---

## RFP Admin — the operator who builds the OPP card

**Proven live:** author a solicitation's compliance matrix + the 6-volume DSIP structure + per-solicitation
templates by hand in the curation workspace, adversarially review, and Push to fan cards to tenants.

- **P1 · "Ingest Assist" (AI auto-compliance from a BAA) is unproven end-to-end.** The cockpit's promise
  is *drop the BAA PDF → get a drafted compliance matrix + volumes + molds*. I could not run it
  (`ANTHROPIC_API_KEY` empty), so I authored everything by hand. **Unknown:** whether the shredder
  extracts 6 volumes, the 12 technical sections, and the **component-specific** page limit correctly from
  a real 137–330-page BAA. This is the admin's single biggest time-saver and it's untested on real input.
  *Close:* run the shredder with a live key against `docs/DoW 2026 *.pdf` and diff its output vs. the
  hand-authored ground truth now in mig 167.
- **P1 · Component-specific page limits need human knowledge.** The BAA states different Technical-Volume
  limits per Service (Navy Phase I = 10pp; others differ), buried in component annexes. There is no
  `(component, phase, topic) → limit` lookup; the admin must read the annex. Ingest Assist would have to
  parse the right annex, not the umbrella. *Close:* a component-annex parser + a small reference table.
- **P2 · Uploading the real BAA through the UI wasn't exercised.** I injected rows via API. The real path
  (upload a 3 MB / 330-page PDF → sanitize → S3 → shred) was not run on these files; size/timeout behavior
  unproven. *Close:* drive one real BAA upload through `/admin/rfp-curation` upload.
- **P2 · Multi-topic at scale.** A real BAA carries dozens–hundreds of topics under one umbrella (shared
  proposal structure, distinct subjects). I modeled **one** topic per BAA. The extract/bulk-import-topics
  flow at 100s of topics is unproven. *Close:* import a real BAA's full topic list and check scoring/fan-out.
- **P3 · Amendments on real data.** The detect→confirm→fan-out→acknowledge engine exists; a real DoD
  amendment (`docs/AF_X24.5_CSO_Amendment_1.pdf`) was not run through it this session.

## Tenant Admin — the customer building the proposal

**Proven live:** procure → provision to the solicitation's exact spec → the 6-volume DSIP build appears
correctly bounded (10pp / 30pp, right icons, numeric order) → draft → lock → readiness **GO** →
download docx/pdf/zip (per-volume-native).

- **P1 · Page-limit readiness is an *estimate*, not the rendered count.** Submission-readiness approximates
  ~3 nodes/page. DSIP enforces a **hard** page limit and rejects an over-limit Technical Volume outright.
  A customer can pass our GREEN readiness and still render an 11-page Technical Volume → hard reject.
  *Close:* page-count the **actually rendered** docx/pdf (we already render it for export) and gate on that.
- **P1 · AI drafting from the library — the core value prop — is unproven for these solicitations.** I
  hand-authored every section. The real experience is *the Studio drafts my Technical Volume from my
  past-performance library.* That needs (a) the API key and (b) a library populated with **relevant** DoD
  content. Foundation's library is TVSF/concrete-oriented, not a DoD technical corpus. **Untested:** does
  the drafter produce a credible 10-page DoD Technical Volume from a customer's atoms?
- **P1 · STTR work-split is *asserted*, not *computed*.** SB≥40% / RI≥30% lives as prose + a compliance
  variable. The real rule is a **budget computation** (SB direct+indirect ≥ 40% of total), which we do not
  derive from the Cost Volume. A customer can write "we meet 40/30" while their actual budget doesn't.
  *Close:* compute the split from the cost model and validate it in readiness.
- **P2 · The DSIP forms are scaffolds, not the real artifacts.** Vol 1 Cover Sheet, Vol 3 Cost Volume,
  Vol 4 CCR, Vol 6 FWA Training are **DSIP webforms / portal actions** — filled field-by-field on the
  government portal, not authored as documents in our canvas. We model them as canvas sections with
  placeholder text. We produce the **Technical Volume** (the real document) well; the forms are stubs.
  The rebuilt guides now say so, but there is **no field-level cost-form model, no CCR pull, no FWA link.**
- **P2 · No "submit to DSIP."** We produce the package; the human downloads it and uploads to DSIP by
  hand. No submission integration, tracking, or confirmation — the customer leaves the tool to submit.
- **P2 · Eligibility gates aren't validated.** Phase I award cap, PI-employment %, foreign-national
  disclosure, ITAR — DSIP enforces these; we capture some as compliance variables but don't check the
  proposal/company against them.

## End customer / the company (business view)

- **P2 · Topic fit at scale.** Bucket scoring ranks cards; for a 300-topic BAA, whether it surfaces the
  *right* topics for a given company is unproven at topic scale.
- **P2 · Discovery freshness.** We can't live-pull DSIP (egress blocks `.mil`). Close dates matter enormously
  for federal work; without a live DSIP connector the topic list + dates go stale. The scout/source system
  exists but DSIP-specific ingestion isn't demonstrated.

## Cross-cutting

- **P1 · The whole "AI magic" layer is gated on the API key, which is off in this sandbox.** The
  **deterministic spine is proven** (provision, compliance matrix, readiness, package, events, archive).
  The **AI layer** (ingest shred, section drafting, compliance review, full-draft manager, packaging
  specialist) is registered + wired but **unexercised on this data**. The platform's demoable value today
  is the spine; the AI value is a promise pending a key + a real run.
- **P3 · Seed fan-out is Foundation-only.** mig 167 seeds the DoW cards for the Foundation tenant; other
  tenants won't see them until re-pushed.
- **P3 · Two guide crops missing** (`curation-tabs`, `purchase-release`) — lost on a container reclaim;
  cosmetic gaps in older guide sections.

---

## The one-paragraph honest read
The **skeleton is real and works end-to-end for a human**: an admin can build a real DoD solicitation's
compliance/volumes/templates and publish it; a customer can procure it, get a correctly-bounded 6-volume
DSIP workspace, build the Technical Volume, clear a readiness gate, and download a compliant package. The
**flesh is where the gaps are**: the AI that's supposed to *draft* and *auto-extract* is unproven on real
DoD input (needs a key + a real corpus); the **hard-compliance checks that keep a customer from a rejected
submission are estimates or prose, not computed** (rendered page count, STTR budget split); and the **DSIP
forms + actual submission live outside our tool** and are modeled as stubs. Close the two P1 correctness
gaps (rendered page count, computed work-split) and prove the two P1 AI paths (ingest shred, library
drafting) with a live key, and this goes from "impressive demo spine" to "a customer can actually rely on it
to submit."
