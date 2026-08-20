-- 201 · Decode the XML entities a pptx upload left in the library.
--
-- PPTX text lives in XML, so a slide reading "Core Technology & IP" is stored as
-- "Core Technology &amp; IP". lib/import/pptx-reader.ts decoded TABLE cells only, so every slide
-- TITLE and BODY paragraph entered the library raw. That is not cosmetic: those rows are library
-- atoms, atoms get ranked into a proposal section, and the section is exported into a customer's
-- submission — the escape rides all the way to the government.
--
-- The reader is fixed (decoding now happens per text run, the one choke point all slide text passes
-- through; __tests__/pptx-entities.test.ts round-trips through the real exporter and fails without
-- the fix). This repairs what the old reader already wrote.
--
-- SCOPE, measured before writing rather than assumed: library_atoms only — 3 titles, 10 contents,
-- 9 canvas_nodes, and only two entities present (&amp; and &lt;). Zero in document_cocoons, zero in
-- summaries, and nothing had reached proposal_sections — no customer document needs rewriting, and
-- catching it here is what keeps that true.
--
-- ORDER MATTERS: &amp; is decoded LAST, or "&amp;lt;" double-decodes into "<" instead of the
-- literal "&lt;" the author actually typed. Same rule the reader follows.
--
-- SAFE TO RE-RUN: idempotent in this direction, and each WHERE clause skips untouched rows.

BEGIN;

-- Text columns: all five predefined entities, no escaping concerns. ------------
UPDATE library_atoms
   SET title = replace(replace(replace(replace(replace(
                 title, '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&apos;', ''''), '&amp;', '&'),
       updated_at = now()
 WHERE title ~ '&(amp|lt|gt|quot|apos);';

UPDATE library_atoms
   SET content = replace(replace(replace(replace(replace(
                   content, '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&apos;', ''''), '&amp;', '&'),
       updated_at = now()
 WHERE content ~ '&(amp|lt|gt|quot|apos);';

UPDATE library_atoms
   SET summary = replace(replace(replace(replace(replace(
                   summary, '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&apos;', ''''), '&amp;', '&'),
       updated_at = now()
 WHERE summary ~ '&(amp|lt|gt|quot|apos);';

-- Canvas nodes: jsonb, so the substitution has to respect JSON's own escaping. --
--
-- Rewriting through ::text is safe for &amp; &lt; &gt; &apos; and ONLY those: each decodes to a
-- character JSON stores literally inside a string, so replacing them in the serialized form can
-- only alter string VALUES, never structure. &quot; is deliberately excluded — it decodes to a
-- double quote, which JSON must store as \", and a blind text replace would produce an unescaped
-- quote that breaks the document. None exist today (checked); if any ever appear, re-import the
-- source rather than rewriting bytes in place.
--
-- The ::jsonb cast at the end is the safety net: a malformed rewrite raises here and rolls the
-- whole migration back instead of storing corruption.
UPDATE library_atoms
   SET canvas_nodes = replace(replace(replace(replace(
                        canvas_nodes::text,
                        '&lt;', '<'), '&gt;', '>'), '&apos;', ''''), '&amp;', '&')::jsonb,
       updated_at = now()
 WHERE canvas_nodes::text ~ '&(amp|lt|gt|apos);';

COMMIT;
