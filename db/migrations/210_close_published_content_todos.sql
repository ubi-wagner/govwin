-- 210_close_published_content_todos.sql
--
-- BACKFILL for the fix in lib/content-admin.ts: publishing a page now closes the content_publish
-- ToDo that asked for it. Nothing did before, so a page could be reviewed, published and live on
-- the marketing site while its "Review & publish" ToDo sat open forever — pointing, by entity id,
-- at the very version the publish had archived. The BAA program primer was in exactly that state.
--
-- The rule applied here is the same one the code now applies, run once over history: a page_key
-- that has an ACTIVE version has been published, so any open content_publish ToDo naming any
-- version of that page is asking for work that is done.
--
-- MATCHED BY page_key, not by the ToDo's entity id, because a publish REWRITES rows — the draft is
-- promoted and the prior active archived — so the id a ToDo holds is routinely stale by the time
-- anyone acts on it. page_key is what survives a version.
--
-- Deliberately NARROW. A page whose only versions are drafts still has an open ToDo, because that
-- review has genuinely not happened. This closes only what publishing already decided.

UPDATE tasks t
SET status = 'completed', completed_at = now()
WHERE t.task_type = 'content_publish'
  AND t.status = 'open'
  AND EXISTS (
    SELECT 1
    FROM content_pages src
    JOIN content_pages live
      ON live.page_key = src.page_key
     AND live.content_type = src.content_type
     AND live.status = 'active'
    WHERE src.id = t.entity_id
  );

-- Orphans: an open review ToDo whose entity_id names a content_pages row that no longer exists.
-- Its deep link ("open it in the Studio") resolves to nothing, so it is an item a human can see
-- and cannot act on. There is no product path that deletes a content page — archive is the model
-- (docs/ARCHIVABLE_CONTRACT.md) — so these can only come from a seed script that replaced a draft,
-- and cancelling them loses no decision. Cancelled rather than completed: nobody reviewed anything.
UPDATE tasks t
SET status = 'cancelled', completed_at = now()
WHERE t.task_type = 'content_publish'
  AND t.status = 'open'
  AND t.entity_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM content_pages cp WHERE cp.id = t.entity_id);
