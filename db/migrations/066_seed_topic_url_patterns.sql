-- Migration 066: Seed real per-topic URL patterns on source_profiles
-- (Scouting Spine M3 / T3.4 — contract C3.a).
--
-- WHAT: Populate source_profiles.topic_url_pattern with the public, per-topic
--       detail-URL convention for the sources where a stable pattern is known
--       (DSIP, AFWERX, SBIR.gov). The topic expander renders one absolute URL
--       per topic via renderTopicUrl(pattern, { topicNumber, solicitationNumber })
--       (frontend/lib/source-url.ts) — {topicNumber}/{solicitationNumber} are the
--       tokens those patterns reference.
--
-- WHY:  migration 020 created the column and a DSIP seed, but the seeded DSIP
--       value is the *release listing* URL (?baa=&release=), not a per-topic URL,
--       and AFWERX/SBIR were left NULL. Expansion (T3.1) needs a per-topic form to
--       build detail URLs, so we seed the real ones here.
--
-- HOW:  One UPDATE per site_type, matched by site_type (not name) so every profile
--       of that type is covered. Guarded with `topic_url_pattern IS NULL OR
--       btrim(topic_url_pattern) = ''` so we NEVER clobber an admin-edited or
--       already-correct value — this makes the migration safe to re-run
--       (idempotent: a second run finds the value already set and updates nothing).
--
-- NOTE: DSIP primarily ingests via its public JSON API
--       (/topics-app/api/public/topics, filtered by solicitation — see T3.1); the
--       pattern below is the *human / detail* URL used for the per-topic link and
--       as the non-API fallback. {topicNumber} carries the DSIP topic id used by
--       the topics-app deep link.

-- DSIP — DoD SBIR/STTR topics-app per-topic detail deep link.
-- (Primary ingestion is the JSON API; this is the human/detail URL.)
UPDATE source_profiles
   SET topic_url_pattern = 'https://www.dodsbirsttr.mil/topics-app/#/topics/{topicNumber}',
       updated_at        = now()
 WHERE site_type = 'dsip'
   AND (topic_url_pattern IS NULL OR btrim(topic_url_pattern) = '');

-- AFWERX — Air Force SBIR/STTR. AFWERX topics resolve through DSIP's topics-app;
-- key by topic number so a per-topic detail link is buildable.
UPDATE source_profiles
   SET topic_url_pattern = 'https://www.dodsbirsttr.mil/topics-app/#/topics/{topicNumber}',
       updated_at        = now()
 WHERE site_type = 'afwerx'
   AND (topic_url_pattern IS NULL OR btrim(topic_url_pattern) = '');

-- SBIR.gov — federal SBIR/STTR topic search; stable per-topic detail path keyed
-- by the public topic number.
UPDATE source_profiles
   SET topic_url_pattern = 'https://www.sbir.gov/topics/{topicNumber}',
       updated_at        = now()
 WHERE site_type = 'sbir_gov'
   AND (topic_url_pattern IS NULL OR btrim(topic_url_pattern) = '');
