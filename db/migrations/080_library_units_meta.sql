-- Migration 080: classified-shred metadata on library atoms (C2).
--
-- C2 treats harvested library atoms as classified "shreds" of proposal content:
-- JSON now, vector-ready. The embedding column already exists
-- (library_units.embedding vector(1536) + HNSW index, mig 001) and stays NULL
-- until Phase-4 populates real vectors. This adds the meta JSONB the shreds
-- carry — the section's standard taxonomy (section_type + standard category) +
-- provenance — so Phase-4 retrieval can filter/rank by the C1 standards.

ALTER TABLE library_units
    ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Bucket-level retrieval: harvested atoms now carry the standard category in
-- subcategory (already a column); index it alongside tenant for fast scoping.
CREATE INDEX IF NOT EXISTS idx_library_tenant_subcat
    ON library_units (tenant_id, subcategory)
    WHERE subcategory IS NOT NULL;
