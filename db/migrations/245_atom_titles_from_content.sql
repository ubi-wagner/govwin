-- 245 · Repair atoms that were named after their node type.
--
-- ── THE DEFECT ───────────────────────────────────────────────────────────────────────────────
-- `nodeLabel` (lib/library/foundation.ts) handled heading · text_block · table by deriving a title
-- from the node's own content, and fell through for everything else to `return { title: n.type }`.
-- So every list, image, link, caption and footnote atom was named after the system's own
-- vocabulary, and a customer's library filled with rows titled `bulleted_list`.
--
-- It is B136 in another surface — an internal term shown to the company that bought a proposal
-- portal — and like B136 it never looked broken: the page rendered, the string was present, the API
-- answered 200. `probe-customer-finish` found it by asking a different question: not "is this
-- correct" but "is this FINISHED". 48 rows on the sandbox at the time of writing.
--
-- A library is browsed BY TITLE. A shelf of identically-named rows is not a cosmetic problem; it is
-- a shelf its owner cannot search.
--
-- ── WHY A MIGRATION AND NOT JUST THE CODE FIX ────────────────────────────────────────────────
-- The code fix (same commit) only governs atoms created from now on. Rows already sitting in a
-- customer's library keep the machine name until something rewrites them, and "we fixed it going
-- forward" is not a fix for the person looking at the shelf.
--
-- ── WHY THIS IS SAFE TO REWRITE ──────────────────────────────────────────────────────────────
-- Scoped to titles that are EXACTLY a snake_case node type AND match the type of the node the atom
-- actually holds. Nobody types `bulleted_list` as a title, so this cannot overwrite a name a person
-- chose — which is the only thing that would make a backfill destructive. `canvas_nodes` carries
-- the content, so the title is re-derived from the same fields the fixed `nodeLabel` reads, in the
-- same precedence, capped at the same 60 characters.
--
-- Idempotent: re-running matches nothing, because the rows no longer carry a node-type title.

UPDATE library_atoms a
SET title = COALESCE(
      -- Same precedence as nodeLabel(): list item → image caption/alt → link text/href → text.
      NULLIF(btrim(n.node -> 'content' -> 'items' -> 0 ->> 'text'), ''),
      NULLIF(btrim(n.node -> 'content' ->> 'caption'), ''),
      NULLIF(btrim(n.node -> 'content' ->> 'alt_text'), ''),
      NULLIF(btrim(n.node -> 'content' ->> 'display_text'), ''),
      NULLIF(btrim(n.node -> 'content' ->> 'href'), ''),
      NULLIF(btrim(n.node -> 'content' ->> 'text'), ''),
      -- Last resort: a noun a person would write, never the raw token.
      initcap(replace(a.title, '_', ' '))
    )
FROM (
  SELECT id, canvas_nodes -> 0 AS node
  FROM library_atoms
  WHERE jsonb_typeof(canvas_nodes) = 'array' AND jsonb_array_length(canvas_nodes) > 0
) n
WHERE a.id = n.id
  -- Only a raw snake_case token, and only when it names the very node the atom holds. Both
  -- conditions together are what make this incapable of touching a human-chosen title.
  AND a.title ~ '^[a-z]+(_[a-z]+)+$'
  AND a.title = n.node ->> 'type';

-- Truncate to the same 60-character cap the code applies, so a backfilled title and a freshly
-- atomized one cannot differ in length. Separate statement: the CASE would otherwise have to be
-- repeated inside every COALESCE arm above.
UPDATE library_atoms SET title = left(title, 60) WHERE length(title) > 60 AND grain = 'primitive';
