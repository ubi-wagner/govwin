-- 104_jsonb_string_scalar_backfill.sql
--
-- Heal jsonb columns that were written via the `${JSON.stringify(x)}::jsonb`
-- anti-pattern (postgres.js stores those as a jsonb STRING SCALAR, not an object;
-- see CLIFFNOTES Mistake 36 + migration 103 which did the same for system_events).
-- The write sites were all converted to sql.json in this pass, so NEW rows are
-- correct objects; this repairs any pre-existing string-scalar rows on the actively
-- read columns so `col->>'k'` / `col->'k'` / object reads work. Guarded + idempotent:
-- only rows whose value is a string that looks like JSON ('{' or '[') are reparsed.
--
-- Also: give sbir_awards a real business-key unique index so the ingest ON CONFLICT
-- can actually dedup (it was a bare no-op arbitrated only by the random-UUID PK).

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('episodic_memories',            'metadata'),
      ('solicitation_annotations',     'source_location'),
      ('solicitation_annotations',     'payload'),
      ('proposal_sections',            'meta'),
      ('proposal_artifacts',           'format_spec'),
      ('proposal_artifacts',           'compliance_spec'),
      ('process_instance_transitions', 'metadata')
    ) AS t(tbl, col)
  LOOP
    -- skip if the table/column doesn't exist in this DB (defensive across envs)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = r.tbl AND column_name = r.col
    ) THEN
      EXECUTE format(
        'UPDATE %I SET %I = (%I #>> ''{}'')::jsonb
           WHERE jsonb_typeof(%I) = ''string''
             AND left(ltrim(%I #>> ''{}''), 1) IN (''{'', ''['')',
        r.tbl, r.col, r.col, r.col, r.col
      );
    END IF;
  END LOOP;
END $$;

-- sbir_awards dedup key (natural per-award identifier). Partial so blank tracking
-- numbers don't collide. The ingest route restates this predicate in ON CONFLICT.
--
-- A real prod dataset already carries DUPLICATE agency_tracking_number rows (re-import
-- artifacts) — so the plain CREATE UNIQUE INDEX below cannot build ("could not create
-- unique index") and crash-loops the deploy entrypoint. Collapse the duplicates FIRST,
-- keeping exactly one row per non-blank ATN: the earliest created_at (which matches the
-- ingest ON CONFLICT DO NOTHING = first-write-wins), with ctid breaking any created_at
-- ties so precisely one survivor remains. Only touches rows the index actually governs
-- (non-null/non-blank ATN); NULL/'' ATN rows are left alone. Atomic with the CREATE
-- (migrate.mjs runs each file in one tx), and a no-op on a clean/fresh DB.
DO $$
DECLARE removed BIGINT;
BEGIN
  DELETE FROM sbir_awards a
  USING sbir_awards b
  WHERE a.agency_tracking_number IS NOT NULL
    AND a.agency_tracking_number <> ''
    AND a.agency_tracking_number = b.agency_tracking_number
    AND (a.created_at > b.created_at
         OR (a.created_at = b.created_at AND a.ctid > b.ctid));
  GET DIAGNOSTICS removed = ROW_COUNT;
  RAISE NOTICE 'sbir_awards ATN dedup: removed % duplicate row(s) before unique index', removed;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sbir_awards_atn
  ON sbir_awards (agency_tracking_number)
  WHERE agency_tracking_number IS NOT NULL AND agency_tracking_number <> '';
