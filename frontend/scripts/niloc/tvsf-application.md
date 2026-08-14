# NILOC Technologies — Ohio Third Frontier Technology Validation and Startup Fund (TVSF) Application

**Project title:** Commercializing Ontology-Guided Document Intelligence — Validating Battelle's OATS Technology (U.S. Patent 12,430,376) for Regulated-Industry and Federal-Proposal Markets

**Applicant snapshot**

- **Company:** NILOC Technologies (parent company of RFP Pipeline)
- **Location:** Columbus, Ohio — Ohio in-state applicant [confirm exact street address]
- **Identifiers:** CAGE 8NLC7 · UEI K9NLC7X2M4Q8 · NAICS 541715 (Custom Computer Programming Services)
- **Founder & CEO / Principal Investigator:** Eric Wagner (https://www.linkedin.com/in/eric-wagner-7480385) [confirm bio specifics]
- **Licensed Ohio technology:** Battelle Memorial Institute — U.S. Patent 12,430,376, "OATS" (Ontology-based and user-focused Automatic Text Summarization), issued Sep 30, 2025, Columbus, Ohio [license availability and terms to be confirmed with Battelle — see §3 and §11]
- **TVSF request:** [$150,000] · **Cost-share/match:** [$150,000] · **Total project:** [$300,000]
- **Program cycle:** Ohio Third Frontier TVSF, Startup Fund track, Round [45] [confirm]

---

## 1. Executive Summary

NILOC Technologies, a Columbus-based software company, requests **[$150,000]** from the Ohio Third Frontier Technology Validation and Startup Fund to validate and commercialize an Ohio-invented technology into a fielded product. NILOC proposes to license **Battelle Memorial Institute's OATS method (U.S. Patent 12,430,376)** — an ontology-guided, query-focused automatic text-summarization and information-extraction technology invented in Columbus — and to validate it as the next-generation **document-intelligence engine** behind two commercial surfaces: NILOC's shipping SaaS platform **RFP Pipeline**, and a new **standalone document-intelligence product** for regulated, document-heavy industries.

NILOC is uniquely positioned to execute. RFP Pipeline is a live, multi-tenant, AI-native platform that already turns federal solicitations (SBIR, STTR, BAA, OTA) into submission-ready, compliance-checked proposals — direct proof the team ships production AI at scale. RFP Pipeline's own core (taxonomy-guided extraction fused with semantic retrieval over unstructured documents) is the closest commercial analog to OATS, so the licensed technology drops into a proven product spine rather than a science project.

The Ohio nexus is the heart of the fit: **Ohio-invented IP, commercialized by an Ohio company, creating Ohio jobs, Ohio spend, and Ohio follow-on investment.** In candor, OATS is Battelle's intellectual property — this is a **commercial license from a private Ohio nonprofit, not a federal technology transfer** — and NILOC must **confirm license availability and terms with Battelle's commercialization office** [confirm] as a first milestone. A **[$150,000]** cost-share/match brings total project investment to **[$300,000]** over **[12–18 months]**, de-risking the technology toward a **[$1–3M]** follow-on seed round [estimate].

## 2. The Innovation & Technology Description

NILOC will build the **NILOC Document Intelligence Engine** — software that reads a large pile of unstructured technical documents plus a user's questions, and returns precise, source-grounded answers and summaries. The engine performs three jobs that regulated industries pay for today with slow, manual labor:

1. **Source identification** — given a topic, use an ontology (domain concepts and their relations) to decide which documents and passages are actually relevant, before any generation.
2. **Query-focused extraction and summarization** — pull the specific answer content a user asked for, grounded in the source text (extractive, not hallucinated), using named-entity recognition and semantic-relation extraction.
3. **Compliance parsing** — decompose a governing document (a solicitation, a regulation, a contract) into discrete, traceable requirements that downstream workflows can check against.

This is not a generic chatbot. It is a **verifiable, ontology-guided extraction engine** whose outputs trace back to source passages — the property regulated buyers require. RFP Pipeline already demonstrates the pattern in production: a hybrid atom-retrieval selector blends taxonomy/context matching with per-document semantic cosine similarity (pgvector) to assemble compliance-checked proposal drafts from a governed content library. The TVSF project validates and elevates that core with Battelle's patented method, then exposes it both inside RFP Pipeline and as a standalone product API/UI.

## 3. The Licensed Technology & IP Position

**Background IP (to be licensed from an Ohio institution).** The foundational method is **U.S. Patent 12,430,376, "OATS,"** owned by **Battelle Memorial Institute** (Columbus, Ohio; Ohio-based inventors; issued Sep 30, 2025). OATS (a) uses an ontology of concepts and relations to identify the right information sources for a topic, and (b) generates user-query-focused **extractive** summaries from unstructured documents using named-entity recognition, semantic-relation extraction, and a bidirectional LSTM, selecting answer content by distinctive terms.

**Honesty of basis.** OATS is **Battelle's intellectual property.** NILOC's rights would arise from a **negotiated commercial license from a private Ohio nonprofit research institution — this is not a federal lab transfer and not an entitlement.** NILOC has not yet executed a license; **confirming availability, field-of-use, exclusivity, and financial terms with Battelle's commercialization office is Milestone 1 of this project** [confirm]. TVSF's mandate — Ohio companies commercializing technology licensed from Ohio institutions such as Battelle — is precisely this transaction, and NILOC's Columbus location makes it a clean in-state match.

**Foreground IP (NILOC-owned).** NILOC owns and will continue to own everything it builds on top: the domain **ontologies** for each target vertical (protectable as trade secrets and/or new filings), the integration/fusion of OATS with NILOC's existing semantic-retrieval spine, the standalone product, and all training and evaluation assets. NILOC's shipping RFP Pipeline platform and its pgvector retrieval are pre-existing **NILOC background IP**, independent of the license.

**Strategy.** License Battelle's background method; own and defend the foreground (ontologies, integration, product); conduct a freedom-to-operate review [confirm]; and file on NILOC improvements where warranted.

## 4. Problem & Market Opportunity

Regulated, document-heavy organizations drown in unstructured text — solicitations, regulations, standards, filings, contracts, technical literature — and pay skilled people to read, extract, cross-reference, and summarize it under deadline. Generic large-language-model tools accelerate drafting but **hallucinate, cannot cite sources reliably, lack domain ontologies, and do not enforce tenant data isolation** — disqualifying them from compliance-grade work.

**Beachhead — federal proposals (via RFP Pipeline).** Thousands of small firms pursue SBIR/STTR/BAA/OTA opportunities each year; the SBIR/STTR programs alone represent **[~$4B] in annual awards across [11] agencies** [confirm]. Every pursuit demands machine-precise requirement extraction and compliant drafting — exactly what the engine does, and where NILOC already has a live paying surface.

**Expansion — regulated document intelligence.** The broader intelligent-document-processing market is estimated at **[~$2–3B in 2025], growing toward [$10B+ by 2030] at a [~30% CAGR]** per industry-analyst estimates [confirm source]. Adjacent, document-heavy verticals — life-sciences/medical-device regulatory affairs, financial-services compliance, legal, and government contracting — share the same pain and buy the same capability.

All figures above are **planning estimates**; NILOC will validate market size and willingness-to-pay through design-partner pilots in the validation plan rather than assert them.

## 5. Technology Validation Plan (TVSF Core)

The project is organized into four milestone-based phases, each with concrete deliverables and **quantitative go/no-go metrics** that de-risk the licensed technology toward commercial deployment. Timeline is a **[bracketed planning estimate]**.

**Phase 1 — License execution, technology transfer & baseline (Months [1–3]).**
- Execute the Battelle license or option; receive method documentation and any reference implementation [confirm].
- Build an evaluation harness and a gold-standard, SME-annotated corpus of **[~500]** documents across the two beachhead verticals.
- Reproduce the OATS extraction/summarization baseline on NILOC's corpora.
- **Deliverables:** executed license/option; evaluation harness; reproduced-baseline report.
- **Go/no-go:** reproduce OATS extraction performance within **[±10%]** of the published/reference benchmark.

**Phase 2 — Domain adaptation & ontology engineering (Months [3–8]).**
- Author domain ontologies for **[2]** verticals (federal solicitations; one regulated vertical, e.g., life-sciences regulatory).
- Fuse OATS ontology-guided source identification with NILOC's existing pgvector semantic retrieval (hybrid).
- Adapt query-focused extractive summarization to NILOC's document/atom model.
- **Deliverables:** two domain ontologies; integrated hybrid retrieval-and-extraction prototype.
- **Go/no-go:** **[+15–25%]** extraction accuracy versus NILOC's current baseline on held-out documents.

**Phase 3 — Product integration & compliance validation (Months [6–12]).**
- Integrate the engine into RFP Pipeline as the next-generation document-intelligence layer.
- Stand up the standalone product prototype (API + UI).
- Validate automated compliance-requirement extraction against SME-annotated ground truth.
- **Deliverables:** integrated engine in RFP Pipeline; standalone prototype; compliance-validation report.
- **Go/no-go:** compliance-requirement extraction **F1 ≥ [0.85]**; SME-rated summary faithfulness **≥ [4.0/5]**.

**Phase 4 — Commercial validation & pilots (Months [10–18]).**
- Run **[3–5]** design-partner pilots across verticals [confirm partners].
- Harden performance, scale, and tenant-isolation (RLS) for production.
- Validate pricing and conversion; assemble the follow-on-funding readiness package.
- **Deliverables:** pilot results; commercial-readiness package; documented willingness-to-pay; investor materials.
- **Go/no-go:** **[≥2]** pilots converting to paid or letters of intent [confirm].

## 6. Commercialization Plan & Business Model

NILOC monetizes the validated engine through **recurring SaaS subscriptions plus usage-based document processing**, with two go-to-market motions:

1. **RFP Pipeline as the launch channel (beachhead).** RFP Pipeline is already selling proposal portals to government contractors via a comp-code purchase and curation flow. The validated engine becomes a premium capability inside that live product — zero cold-start, immediate revenue attribution, and a captive population of design partners for the standalone product.
2. **Standalone document-intelligence product (expansion).** A separately packaged API/UI sold into regulated verticals (regulatory affairs, compliance, legal, GovCon) on per-seat and per-document pricing, with an option to license the engine to enterprise and integration partners.

**Sequence:** validate in the beachhead → convert pilots to paid in one adjacent vertical → expand vertical-by-vertical, each new vertical requiring primarily a new ontology (a repeatable, defensible unit of work) rather than new core science. Revenue and unit-economics assumptions are **[bracketed]** and will be validated in Phase 4 rather than asserted here.

## 7. Competitive Landscape & Differentiation

- **Generic LLM / RAG tools (ChatGPT, off-the-shelf RAG):** fast but hallucinate, weak on source-grounding, no domain ontology, no tenant isolation. **NILOC advantage:** ontology-guided, **extractive/verifiable** output and multi-tenant RLS isolation.
- **IDP incumbents (ABBYY, Google Document AI, Amazon Textract, Hyperscience, Instabase):** strong on OCR and structured-form extraction; weaker on **query-focused semantic summarization**, domain ontologies, and proposal-grade drafting. **NILOC advantage:** patented ontology + query-focused method, tuned to unstructured narrative documents.
- **GovCon/proposal tools:** workflow and knowledge-management layers, not deep document-intelligence engines. **NILOC advantage:** a genuine extraction/summarization engine underneath a shipping proposal product.

**Durable moat:** a **patented Ohio method (licensed)** + **NILOC-owned domain ontologies and integration** + **a live product and customer base** + **verifiable, compliance-grade outputs** — a combination no single competitor holds.

## 8. Management Team

- **Eric Wagner — Founder & CEO / Principal Investigator.** Architect and builder of RFP Pipeline, NILOC's shipping multi-tenant AI SaaS platform; demonstrated ability to ship production AI (hybrid semantic retrieval, compliance automation, multi-tenant security). [Confirm education, prior roles, and relevant domain experience.]
- **Planned key hires (TVSF-funded):** a full-stack/ML engineer and a part-time NLP/ontology engineer, recruited from Ohio's talent pipeline (Ohio State, Battelle alumni network) [confirm].
- **Advisors (to be engaged):** a Battelle technical liaison for OATS transfer [confirm]; an Ohio-based commercialization advisor from the Third Frontier / Rev1 Ventures network [confirm]; and vertical SME advisors for the regulated beachhead [confirm].

NILOC will not overstate its bench: advisory relationships and hires listed above are **planned and to be confirmed**, and the validation budget funds the team NILOC needs to execute.

## 9. Ohio Economic Impact

NILOC's project keeps **Ohio-invented intellectual property being commercialized by an Ohio company** — the core Third Frontier thesis. Battelle's OATS was created in Columbus; NILOC will commercialize it in Columbus.

- **Jobs:** **[3–6]** new high-wage Ohio technology jobs created over **[3 years]**; **[confirm]** current positions retained [all estimates].
- **In-state spend:** the Battelle license fee (to a Columbus institution), Ohio payroll, and Ohio-based contractors and cloud/compute spend keep project dollars in-state [estimate].
- **Follow-on capital:** a targeted **[$1–3M]** seed round after validation, positioned to attract Ohio and regional investors [estimate].
- **Ecosystem:** engagement with Ohio's innovation network (Ohio Third Frontier, Rev1 Ventures, JobsOhio) to accelerate scaling [confirm].

All jobs, spend, and capital figures are **bracketed planning estimates**, to be firmed in the formal application and reported against during the award.

## 10. Budget & Funding Request

NILOC requests **[$150,000]** in TVSF funds, matched by **[$150,000]** in cost-share (cash and in-kind), for a **[$300,000]** total project — consistent with the TVSF Startup Fund's **[1:1]** match expectation [confirm current-round requirement]. In-kind match comprises founder time, the pre-existing RFP Pipeline platform contributed to the project, and facilities. The figures below are **bracketed planning estimates**; the binding numbers will be transcribed into the **official Ohio TVSF budget form** as the authoritative budget of record.

| Category | TVSF Request | Cost-Share / Match | Total |
|---|---:|---:|---:|
| Personnel (salaries & wages) | [$85,000] | [$65,000] | [$150,000] |
| Fringe benefits [~25%] | [$21,000] | [$16,500] | [$37,500] |
| Equipment, software, cloud & compute | [$15,000] | [$10,000] | [$25,000] |
| Subcontracts & consultants (incl. **Battelle license/option** + independent validation) | [$22,000] | [$23,000] | [$45,000] |
| Travel | [$3,000] | [$2,000] | [$5,000] |
| Indirect / overhead [~15%] | [$4,000] | [$33,500] | [$37,500] |
| **Total** | **[$150,000]** | **[$150,000]** | **[$300,000]** |

- **Personnel:** CEO/PI [~0.25 FTE], one full-stack/ML engineer [~1.0 FTE], one part-time NLP/ontology engineer [~0.5 FTE] over the project.
- **Subcontracts:** the **Battelle license or option fee** [confirm amount] plus an independent benchmarking/validation consultant to keep go/no-go metrics objective.
- **Match composition:** approximately [$75,000] cash and [$75,000] in-kind [confirm split].

## 11. Risks & Mitigation

- **License availability & terms (stated honestly).** OATS is Battelle's IP; NILOC has not executed a license and terms are unknown. **Mitigation:** engage Battelle's commercialization office immediately and structure an **option** before full commitment; the patent is public, and NILOC's own shipping pgvector semantic-retrieval engine provides a functioning baseline **independent of the license**, so validation progresses even if negotiation extends. NILOC will structure the award so that license-dependent tasks follow license execution, and will disclose to the program that certain deliverables are **contingent on an executed Battelle license** [confirm].
- **Technical risk (method modernization).** OATS' bidirectional-LSTM core predates current transformer methods. **Mitigation:** benchmark OATS against and hybridize it with modern retrieval; capture improvements as NILOC-owned foreground IP.
- **Market/adoption risk.** **Mitigation:** RFP Pipeline is a captive launch channel; Phase 4 pilots validate willingness-to-pay before scale spend.
- **Talent risk.** **Mitigation:** recruit from Ohio State and the Battelle alumni network; scope hires to the funded plan.
- **Data & security risk.** **Mitigation:** tenant isolation (row-level security) is already built into RFP Pipeline; the engine inherits it.
- **Match/funding risk.** **Mitigation:** documented cash-plus-in-kind match plan and a defined follow-on-capital path.

## 12. Milestones & Timeline

| Phase | Window [est.] | Milestone / gate | Key deliverable |
|---|---|---|---|
| 1 | Months [1–3] | **Battelle license/option executed**; baseline reproduced [±10%] | License; eval harness; baseline report |
| 2 | Months [3–8] | Ontologies built; hybrid engine [+15–25%] accuracy | Two ontologies; integrated prototype |
| 3 | Months [6–12] | Compliance extraction F1 ≥ [0.85]; product integration | Engine in RFP Pipeline; standalone prototype; validation report |
| 4 | Months [10–18] | [≥2] pilots to paid/LOI; production hardening | Pilot results; commercial-readiness & investor package |

Reporting and reimbursement milestones will align to the phase gates above and to the Ohio TVSF award agreement's schedule [confirm]. Successful completion positions NILOC to close a **[$1–3M]** follow-on round and to scale an Ohio-invented, Ohio-owned document-intelligence business from Columbus [estimate].
