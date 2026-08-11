-- 172_seed_scout_schedule.sql — put web Source Scout auto-discovery on the shared cron.
--
-- The scout worker (source_scout.scout_all_due) + OnSourceChangeDetected → create_drafts_from_scout
-- (opp + curated_solicitation) were all wired, but NOTHING scheduled the scout — it ran only on the
-- admin "Scout Now" button (0 scout jobs had ever run). This schedules an all-due scout daily; the
-- dispatcher's scout_source branch enqueues a kind='scout_source' pipeline_job with no source_id, so
-- scout_all_due scouts every auto_crawl-enabled, due source_profile. Newly-published solicitations on
-- watched sites are then discovered → drafted → curated → released automatically. Idempotent.
INSERT INTO pipeline_schedules (source, run_type, cron_expression, enabled, next_run_at)
VALUES ('scout_source', 'full', '0 5 * * *', true, now())
ON CONFLICT (source) DO NOTHING;
