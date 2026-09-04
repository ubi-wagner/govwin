-- 252 · Redo 245's repair, which was applied as a role that could not see the rows
--
-- ── WHAT HAPPENED ──────────────────────────────────────────────────────────────────────────────
-- Migration 245 renamed `library_atoms` whose title was a raw canvas node type — 48 rows titled
-- `bulleted_list`, an internal term shown to customers on a shelf they browse BY TITLE. It was
-- applied on this database while `migrate.mjs` was connected as `govtech_app`.
--
-- `library_atoms` is FORCE-RLS. Under a NOBYPASSRLS role with no tenant context, the policy matches
-- nothing: `govtech_app` sees 0 of 1242 atoms. So 245's UPDATE touched ZERO ROWS, raised no error,
-- and was recorded in `_migration_history` as applied — which means it can never run again.
--
-- A day later the customer-finish probe counted those same 48 rows as 34 live `jargon` defects on
-- four tenant-facing routes, and the only reason they were found is that a probe reads the rendered
-- page rather than trusting a migration's exit status.
--
-- ── WHY A NEW FILE AND NOT AN EDIT ─────────────────────────────────────────────────────────────
-- The runner skips applied migrations BY FILENAME, so editing 245 would change nothing here and
-- would silently diverge from any database where 245 genuinely worked. Drift is fixed forward with
-- a new file, never by editing the old one — the rule mig 154 exists to enforce.
--
-- ── AND THE RUNNER NOW REFUSES THE INVOCATION THAT LOST IT ─────────────────────────────────────
-- `migrate.mjs` asserts up front that the connected role can bypass RLS, because the existing 42501
-- handler only catches a missing PRIVILEGE — a data-repair UPDATE needs none and fails silently.
-- Red-tested: as `govtech_app` the runner now exits 1 before touching anything.
--
-- The logic below is 245's, unchanged, so the two cannot diverge. Idempotent: it matches only a
-- title that is exactly a snake_case token AND names the very node the atom holds, so re-running
-- finds nothing and it cannot touch a title a person chose.

UPDATE library_atoms a
SET title = COALESCE(
      NULLIF(btrim(n.node -> 'content' -> 'items' -> 0 ->> 'text'), ''),
      NULLIF(btrim(n.node -> 'content' ->> 'caption'), ''),
      NULLIF(btrim(n.node -> 'content' ->> 'alt_text'), ''),
      NULLIF(btrim(n.node -> 'content' ->> 'display_text'), ''),
      NULLIF(btrim(n.node -> 'content' ->> 'href'), ''),
      NULLIF(btrim(n.node -> 'content' ->> 'text'), ''),
      initcap(replace(a.title, '_', ' '))
    )
FROM (
  SELECT id, canvas_nodes -> 0 AS node
  FROM library_atoms
  WHERE jsonb_typeof(canvas_nodes) = 'array' AND jsonb_array_length(canvas_nodes) > 0
) n
WHERE a.id = n.id
  AND a.title ~ '^[a-z]+(_[a-z]+)+$'
  AND a.title = n.node ->> 'type';

UPDATE library_atoms SET title = left(title, 60) WHERE length(title) > 60 AND grain = 'primitive';

-- Say what was repaired. A data migration that reports nothing is indistinguishable from one that
-- did nothing — which is the entire reason this file exists.
DO $$
DECLARE remaining int;
BEGIN
  SELECT count(*) INTO remaining FROM library_atoms WHERE title ~ '^[a-z]+(_[a-z]+)+$';
  RAISE NOTICE '252: % atom(s) still carry a raw node-type title (expected 0)', remaining;
END $$;
