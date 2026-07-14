-- 103: repair event payloads stored as jsonb STRING scalars.
--
-- Event emitters wrote payloads via `${JSON.stringify(x)}::jsonb`, which stores a
-- jsonb string scalar ("{\"a\":1}") instead of an object ({"a":1}). Every audit /
-- automation consumer that does `payload->>'field'` (the proposal activity feed,
-- RFP-curation event history, storage dedup, the workflow overlay pickup) then got
-- NULL. The emitters are fixed to use sql.json going forward; this back-fills the
-- rows already written. The left()='{' / '[' guard skips any genuine string scalar
-- so the ::jsonb re-parse can't fail.
UPDATE system_events
   SET payload = (payload #>> '{}')::jsonb
 WHERE payload IS NOT NULL
   AND jsonb_typeof(payload) = 'string'
   AND left(ltrim(payload #>> '{}'), 1) IN ('{', '[');

UPDATE system_events
   SET error = (error #>> '{}')::jsonb
 WHERE error IS NOT NULL
   AND jsonb_typeof(error) = 'string'
   AND left(ltrim(error #>> '{}'), 1) IN ('{', '[');
