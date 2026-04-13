# Phase 1 §D — AI Shredder + Compliance Extraction

**Mini-TODO scope:** A pipeline worker that takes a solicitation document (PDF), extracts text with `pymupdf4llm`, runs Claude with versioned prompts to atomize sections + pre-extract compliance variables, and writes the structured output back to `curated_solicitations.ai_extracted` and `solicitation_compliance.*`. Also: a synchronous variant exposed as the `compliance.extract_from_text` tool from §E for the curation UI's "preview suggestions" loop.

**Depends on:** §B (table columns), §C (pipeline plumbing — runs in the same worker process)
**Blocks:** §E (curation tools call into the shredder), §G (workspace UI shows shredder output), §J (e2e test triggers shredding)

## Why this section exists

This is the only place in Phase 1 where Claude makes a real call. Quality of the rest of the curation workflow depends on:
- Good text extraction (pymupdf4llm)
- Good prompts (versioned, golden-fixture-tested)
- Idempotent re-runs (re-shredding the same doc produces the same output, or at least a deterministic diff)
- A regression suite (so prompt changes don't silently degrade quality)

The pre-V2 codebase had `pipeline/src/workers/rfp_parser.py` (754 lines) doing this with `pymupdf4llm` + Claude. We can lift the structure but rebuild the prompts + add the golden fixture suite.

## Items

- [ ] **D1.** `pipeline/src/shredder/__init__.py` (empty marker) and `pipeline/src/shredder/extractor.py` — text extraction layer:
  - `def extract_text_from_pdf(pdf_bytes: bytes) -> str` — uses `pymupdf4llm.to_markdown()` to convert PDF → markdown
  - `def extract_text_from_path(s3_key: str) -> str` — fetches from S3 via the storage helpers (mirrors `frontend/lib/storage/s3-client.ts` from 0.5b), then calls `extract_text_from_pdf`
  - Truncation: hard cap at 200K characters per document. If a doc exceeds that, log a warning event (`system.shredder.budget_exceeded` precursor) and process the first 200K only. This is enforced BEFORE the Claude call so we don't burn tokens on a 1MB document.
  - **Acceptance:** unit test against a small PDF fixture (~5 pages, drop one in `pipeline/tests/fixtures/shredder/sample-rfp.pdf` from a real public RFP) that returns markdown longer than 1KB.

- [ ] **D2.** `pipeline/src/shredder/prompts/v1/section_extraction.txt` — versioned prompt for atomizing the doc into sections (technical volume, cost volume, eligibility, evaluation criteria, etc.). The prompt:
  - Asks Claude to return JSON with `{ sections: [{ key, title, page_range, summary, raw_text_excerpt }] }`
  - Lists the canonical section keys: `cover`, `technical_approach`, `commercialization`, `team`, `cost_volume`, `eligibility`, `evaluation_criteria`, `submission_format`, `compliance_requirements`, `appendix`
  - Includes 2 few-shot examples (real Phase I + real Phase II RFP → expected JSON output)
  - Has a system prompt that says "respond ONLY with valid JSON, no commentary" to keep output deterministic
  - Stamped with `version: 1` in the file header so future versions are obvious in `git log`

- [ ] **D3.** `pipeline/src/shredder/prompts/v1/compliance_extraction.txt` — versioned prompt for pre-extracting compliance variables from each section:
  - Input: a section's raw_text + the master compliance variable list (from `compliance_variables` table)
  - Output: JSON `{ matches: [{ variable_name, value, source_excerpt, page, confidence }] }`
  - The prompt instructs Claude to ONLY suggest values it's confident about (`confidence > 0.7`) — humans verify the rest
  - Few-shot examples covering the most common variables: `page_limit_technical`, `font_family`, `font_size`, `margins`, `partner_max_pct`, `pi_must_be_employee`, `taba_allowed`
  - Same `version: 1` stamp

- [ ] **D4.** `pipeline/src/shredder/runner.py` — the orchestrator that actually calls Claude:
  - `async def shred_solicitation(solicitation_id: str) -> ShredResult`:
    1. Emit `finder.rfp.shredding.start` with `{ solicitation_id, document_count, total_bytes }`
    2. Look up `curated_solicitations` row, fetch each linked document from S3
    3. For each document, call `extract_text_from_pdf`
    4. Concatenate texts (with per-document headers), truncate to 200K
    5. Load `prompts/v1/section_extraction.txt`, call Claude (`anthropic.AsyncAnthropic()` with `claude-sonnet-4` model from env), parse JSON response
    6. For each section, load `prompts/v1/compliance_extraction.txt`, call Claude with the section text + master compliance variable list, parse JSON
    7. Compute `agency_namespace_key` via `pipeline/src/shredder/namespace.py` (separate file in D6) — stamps the `{agency}:{program_office}:{type}:{phase}` key on the output
    8. UPDATE `curated_solicitations` SET `ai_extracted = ${full_json}`, `status = 'ai_analyzed'`, `namespace = ${key}` WHERE id = ${solicitation_id}
    9. UPDATE `solicitation_compliance` rows for each suggested variable (write the value but mark `verified_by = NULL` so the curator must confirm)
    10. Emit `finder.rfp.shredding.end` with `{ sections_extracted, compliance_variables_extracted, similar_prior_cycles_found, duration_ms, prompt_version: 1, total_input_tokens, total_output_tokens }`
  - Token budget: hard cap at 50K input tokens per single shredding run. If exceeded, raise `ShredderBudgetError` and mark `status = 'shredder_failed'` (need to add that to the CHECK constraint in §B if not already there)
  - Idempotency: re-running on the same `solicitation_id` is safe — the UPDATE replaces `ai_extracted` wholesale, the compliance UPDATE is idempotent because the variables are matched by name
  - **Acceptance:** unit test in `pipeline/tests/test_shredder_runner.py` with a mocked `anthropic.AsyncAnthropic` (returns canned JSON) that exercises the full path against a fixture PDF and verifies the DB writes happen via a throwaway PG.

- [ ] **D5.** `pipeline/src/shredder/golden_fixtures/` — at least 5 real RFPs with hand-verified expected extractions:
  - `golden_fixtures/sam_gov_phase1_001.pdf` + `expected.json` (a real SAM.gov SBIR Phase I solicitation)
  - `golden_fixtures/sam_gov_phase2_001.pdf` + `expected.json`
  - `golden_fixtures/sbir_gov_phase1_001.pdf` + `expected.json`
  - `golden_fixtures/grants_gov_phase1_001.pdf` + `expected.json`
  - `golden_fixtures/baa_001.pdf` + `expected.json` (a Broad Agency Announcement, structurally different from SBIR)
  - Each `expected.json` is hand-curated: the actual sections that should be extracted and the actual compliance variables that should be detected
  - **Acceptance:** the directory exists with the 5 PDFs + 5 JSON files

- [ ] **D6.** `pipeline/src/shredder/namespace.py` — agency namespace key computation:
  - `def compute_namespace_key(agency: str | None, office: str | None, program_type: str | None, phase: str | None) -> str` — returns `{agency}:{program_office}:{type}:{phase}` per `docs/NAMESPACES.md` §"Memory namespace keys"
  - Normalization rules: agency uppercased, office uppercased OR `unknown` if null, type/phase preserved case
  - Three-part variant for sources without an office (NSF, NIH): `{agency}:{type}:{phase}`
  - **Acceptance:** unit test in `pipeline/tests/test_shredder_namespace.py` covering the documented examples (`USAF:AFWERX:SBIR:Phase1`, `ARMY:DEVCOM:STTR:Phase2`, `NSF:SBIR:Phase1`, `NIH:SBIR:Phase2`, `DARPA:unknown:BAA:Open`).

- [ ] **D7.** `pipeline/tests/test_shredder_regression.py` — golden fixture regression suite:
  - For each fixture in `golden_fixtures/`, run the shredder against the PDF, compare actual extraction to `expected.json`, fail if they diverge significantly
  - "Significantly" = (a) any section in expected is missing from actual, OR (b) any required compliance variable in expected is missing from actual, OR (c) any value in actual disagrees with a value in expected for the same variable. Cosmetic differences (whitespace, ordering of optional fields) are allowed.
  - This test is the canary for prompt regressions. When it fails on a Phase 1 PR, we know the prompt change broke quality.
  - **Acceptance:** all 5 golden fixtures pass on an initial run with `prompts/v1/*`. (Bootstrapping: when first writing the prompts, iterate until they pass against the fixtures, then check in.)

- [ ] **D8.** `pipeline/src/shredder/sync_extract.py` — a thinner sync entry point used by the `compliance.extract_from_text` tool from §E. NOT a worker, NOT writing to DB. Just:
  - `async def extract_compliance_from_text(text_fragment: str) -> list[ComplianceSuggestion]` — calls Claude with `prompts/v1/compliance_extraction.txt`, parses, returns suggestions
  - Used by the curation workspace UI when the curator highlights a chunk of text and clicks "extract"
  - **Acceptance:** exists, has a unit test against mocked Claude, the §E `compliance.extract_from_text` tool successfully calls it via HTTP.

- [ ] **D9.** Wire the shredder into the cron dispatcher from §C: when a `pipeline_jobs` row arrives with `kind = 'shred_solicitation'`, the consumer routes it to `shredder.runner.shred_solicitation`. The `solicitation.release` tool from §E inserts these jobs.
  - **Acceptance:** an end-to-end test in §J inserts a `pipeline_jobs` row, watches it get consumed, watches the `curated_solicitations.status` flip from `released_for_analysis` → `ai_analyzed` within the test's timeout.

## Anti-patterns from Phase 0.5

- ❌ **Don't call the LLM without versioning the prompt.** Phase 4 will need to attribute quality regressions to prompt changes — that's only possible if every call stamps the prompt version on the event. Hardcoded prompts in code are forbidden; they live in `prompts/v{N}/*.txt`.
- ❌ **Don't ship a free-form extractor without a regression test.** The golden fixture suite is the only thing standing between us and prompt drift. It's mandatory, not nice-to-have.
- ❌ **Don't burn unlimited tokens.** The 200K char cap and 50K input token budget are real production guardrails. Tests should verify the budget enforcement.
- ❌ **Don't write to `solicitation_compliance` with `verified_by = ${actor}`.** The shredder is automated suggestion, not human verification. `verified_by` stays NULL until a curator explicitly confirms via the UI.

## Definition of Done for §D

- All 9 items checked
- `pytest pipeline/tests/test_shredder_*.py` passes (4 test files minimum: extractor, runner, namespace, regression)
- The 5 golden fixtures pass the regression suite with `prompts/v1/`
- A manual end-to-end via §J's e2e test successfully shreds one solicitation and writes to `curated_solicitations.ai_extracted`
- Commit message: `feat(phase-1-D): AI shredder + compliance extraction + golden fixtures`
- `docs/PHASE_1_PLAN.md` Section completion tracker has §D ticked
