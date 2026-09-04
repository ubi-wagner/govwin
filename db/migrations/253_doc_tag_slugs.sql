-- 253 · A `doc` tag a person can read
--
-- ── WHAT A CUSTOMER SAW ────────────────────────────────────────────────────────────────────────
-- The library shelf renders an atom's taxonomy as `dimension:value`, so a `doc` tag is
-- customer-facing text. 909 of them are proper slugs — `dp2-technical-volume`,
-- `sbir-p1-technical-volume`. 76 were a raw uuid, and the `customer-finish` probe counted every one
-- of them as an `identifier` defect across `/atoms`, `/library` and `/library/review`:
--
--     doc:01b85d14-4a4e-494f-9122-d50cb75e3060
--
-- It is not even useful internally: that id resolves to no row in `tenant_documents`,
-- `document_templates` or `content_pages`. A caller passed an identifier where a slug belongs.
--
-- ── THE NAME IS RECOVERABLE, WHICH IS WHY THIS IS A REPAIR AND NOT A DELETION ──────────────────
-- Every uuid-tagged group is one foundation, and its `grain = 'foundation'` atom carries the real
-- title — "CDR walkthrough with the COR". That is the name that should have been on the chip, so
-- the slug is derived from it rather than the tag being dropped. Deleting the tag would remove a
-- browsing facet to hide a display bug.
--
-- ── AND THE SOURCE IS FIXED IN THE SAME CHANGE ─────────────────────────────────────────────────
-- `foundationTags` now routes every `doc` value through `readableDocSlug`, which falls back to a
-- slugified title when the caller hands it a uuid. Normalising at the single write site rather than
-- in each caller is the same choice `nodeLabel` makes about the atomizer: the invariant holds no
-- matter who calls. Without it this migration would be repairing rows the product recreates.
--
-- Idempotent: only rows whose value is EXACTLY a uuid are touched, and after this none are.

UPDATE atom_tags t
SET value = COALESCE(NULLIF(f.slug, ''), 'document')
FROM (
  SELECT t2.value AS uuid_value,
         left(regexp_replace(lower(btrim(a.title)), '[^a-z0-9]+', '-', 'g'), 60) AS slug
    FROM atom_tags t2
    JOIN library_atoms a ON a.id = t2.atom_id
   WHERE t2.dimension = 'doc'
     AND t2.value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     -- The FOUNDATION grain holds the document's own title; the other grains are its parts.
     AND a.grain = 'foundation'
) f
WHERE t.dimension = 'doc'
  AND t.value = f.uuid_value;

-- Trim any leading/trailing hyphen the slugify could leave (a title ending in punctuation).
UPDATE atom_tags
   SET value = btrim(value, '-')
 WHERE dimension = 'doc' AND (value LIKE '-%' OR value LIKE '%-');

DO $$
DECLARE remaining int;
BEGIN
  SELECT count(*) INTO remaining FROM atom_tags
   WHERE dimension = 'doc'
     AND value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  RAISE NOTICE '253: % doc tag(s) still carry a raw uuid (expected 0)', remaining;
END $$;
