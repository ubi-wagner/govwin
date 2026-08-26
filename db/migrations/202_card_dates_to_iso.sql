-- 202 · Card dates stored as Date.prototype.toString() → ISO.
--
-- buildCardSnapshot stringified date columns with a bare String(v). postgres.js returns those
-- columns as JS Date objects, so what landed in the card jsonb was
-- "Fri Aug 28 2026 00:00:00 GMT+0000 (Coordinated Universal Time)" — locale- and timezone-shaped
-- prose, not a date format.
--
-- It broke a ranking dimension in a way nothing surfaced. V8 parses its own toString output, so the
-- TS scorer applied the timeline signal; Python's `_close_ms` uses datetime.fromisoformat and
-- returns None, so it SKIPPED it. The two scorers disagreed on the same card, which
-- lib/bucket-ranking.ts explicitly says they must not. Measured before the fix: across 3,486 stored
-- bucket scores, not one carried a `timeline` factor — every opportunity was ranked on keywords
-- alone and "closes in nine days" counted for nothing.
--
-- The serializer is fixed (opportunity-bridge.ts now emits toISOString, with a test pinning the
-- format because the format is the contract between the two services). This repairs the rows.
--
-- WHY A MIGRATION AND NOT JUST THE REPAIR SCRIPT. Migration 140 seeds card jsonb as literals
-- captured from a live database that already had the bug, so a FRESH environment starts broken
-- too — measured on a clean rebuild: 12 of 18 cards carrying Date.toString(), zero ISO. A one-off
-- script cannot fix that; the correction has to travel with the schema.
--
-- Migration 140 itself is deliberately NOT edited: it is already applied everywhere, and rewriting
-- applied history would leave environments disagreeing about what 140 did.
--
-- BOTH SIDES. tenant_opportunity_cards is what a tenant reads; opportunity_bridge is what a
-- reconcile REPLAYS from. Fixing only the cards would let the next reconcile faithfully restore the
-- bad format.
--
-- SAFE TO RE-RUN: the WHERE clause matches only the legacy shape, which the rewrite removes.

BEGIN;

-- Postgres cannot parse the trailing zone NAME ("(Coordinated Universal Time)"), but it parses the
-- rest once the name is stripped down to the numeric offset. Anything that still fails to parse is
-- left alone rather than guessed at.
CREATE OR REPLACE FUNCTION pg_temp.iso_or_null(v text) RETURNS text AS $$
BEGIN
  IF v IS NULL THEN RETURN NULL; END IF;
  RETURN to_char(
    (regexp_replace(v, ' GMT([+-])([0-9]{4}).*$', ' \1\2'))::timestamptz AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
EXCEPTION WHEN others THEN
  RETURN NULL;  -- unparseable: leave the original in place, never invent a date
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- The five date fields the card carries, plus the two timestamps.
CREATE OR REPLACE FUNCTION pg_temp.isoise_card(card jsonb) RETURNS jsonb AS $$
DECLARE
  k text;
  raw text;
  iso text;
  out jsonb := card;
BEGIN
  FOREACH k IN ARRAY ARRAY['postedDate','preReleaseDate','openDate','closeDate','awardDate','releasedAt','frozenAt']
  LOOP
    raw := out ->> k;
    CONTINUE WHEN raw IS NULL;
    -- Only the legacy shape: "Fri Aug 28 2026 …". An ISO value is already correct.
    CONTINUE WHEN raw !~ '^[A-Z][a-z]{2} [A-Z][a-z]{2} [0-9]{2} [0-9]{4}';
    iso := pg_temp.iso_or_null(raw);
    CONTINUE WHEN iso IS NULL;
    out := jsonb_set(out, ARRAY[k], to_jsonb(iso));
  END LOOP;
  RETURN out;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

UPDATE tenant_opportunity_cards
   SET card = pg_temp.isoise_card(card), updated_at = now()
 WHERE
-- NOTE the \s* around the colon: Postgres renders jsonb::text as {"key": "value"} WITH a space,
-- so a regex written for the compact {"key":"value"} form matches nothing and the migration
-- silently no-ops. Caught by injecting a known-bad row and watching it survive.
       card::text ~ '"[a-zA-Z]+"\s*:\s*"[A-Z][a-z]{2} [A-Z][a-z]{2} [0-9]{2} [0-9]{4}';

UPDATE opportunity_bridge
   SET card = pg_temp.isoise_card(card)
 WHERE
-- NOTE the \s* around the colon: Postgres renders jsonb::text as {"key": "value"} WITH a space,
-- so a regex written for the compact {"key":"value"} form matches nothing and the migration
-- silently no-ops. Caught by injecting a known-bad row and watching it survive.
       card::text ~ '"[a-zA-Z]+"\s*:\s*"[A-Z][a-z]{2} [A-Z][a-z]{2} [0-9]{2} [0-9]{4}';

COMMIT;
