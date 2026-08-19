-- 192 · Document-dedupe uniqueness is PER SOLICITATION, not global.
--
-- `idx_sol_docs_content_hash_unique` was UNIQUE on content_hash across the whole table, so the
-- FIRST solicitation to attach a given file claimed it forever and every later solicitation got a
-- 409 DUPLICATE_FILE. That breaks the product's core case rather than an edge one: every DoW SBIR
-- topic legitimately attaches the SAME `DoW_2026_SBIR_BAA_Preface.pdf`, and an umbrella BAA and its
-- topic solicitation legitimately share the same topic PDF. Under the global index only one
-- solicitation in the entire system could ever hold the preface; ingesting a second topic under the
-- same BAA was impossible, and the only escape the route offered was "rename/modify the file" —
-- which means storing a doctored document and destroying its provenance.
--
-- The real duplicate is the same file attached TWICE TO THE SAME SOLICITATION. Scope the uniqueness
-- to (solicitation_id, content_hash) so that case still 409s while cross-solicitation reuse — the
-- normal, correct case — is allowed.
--
-- Found live: re-ingesting the real OSW26BZ04-DP013 T3CP topic was blocked because the same PDFs had
-- previously been consumed under a coverage-test fixture solicitation.

DROP INDEX IF EXISTS idx_sol_docs_content_hash_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sol_docs_hash_per_solicitation
  ON solicitation_documents (solicitation_id, content_hash)
  WHERE content_hash IS NOT NULL;
