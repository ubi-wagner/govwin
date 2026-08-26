-- 217_project_event_namespace.sql
--
-- Add `project` to the event-namespace registry.
--
-- Post-award delivery is a new domain with its own lifecycle — baselines, milestone gates,
-- deliverable acceptance — and none of the seven existing namespaces owns it. `proposal` is the
-- pre-award workspace; `capture` is the customer lifecycle up to purchase; `system` is infra. A
-- milestone being met is none of those.
--
-- ── THE REGISTRY LIVES IN FOUR PLACES, NOT THREE ─────────────────────────────────────────────
-- docs/DELIVERY_MANAGEMENT_DESIGN.md called this "a deliberate three-file change: the test's
-- REGISTRY, lib/events.ts's KNOWN_NAMESPACES, and docs/EVENT_CONTRACT.md". It missed this one — and
-- this one is the only one that FAILS rather than warns:
--
--   · db          `system_events_namespace_chk`  → INSERT raises 23514. Fail-closed.
--   · frontend    lib/events.ts KNOWN_NAMESPACES → logs a warning, then inserts anyway
--   · test        __tests__/event-contract.test.ts REGISTRY
--   · docs        docs/EVENT_CONTRACT.md §4
--
-- Without the CHECK widened first, every `project:` emit would throw at the database and the
-- surrounding best-effort catch would swallow it — a delivery workspace that created itself
-- correctly and left no trace that it had.
--
-- The frontend guard only warns, which is the right split: the database is the enforcement and the
-- log line is the diagnosis. Worth knowing before someone reads `warnUnknownNamespace` and concludes
-- the namespace list is advisory.
--
-- Idempotent / re-runnable.

ALTER TABLE system_events DROP CONSTRAINT IF EXISTS system_events_namespace_chk;

ALTER TABLE system_events ADD CONSTRAINT system_events_namespace_chk
  CHECK (namespace = ANY (ARRAY[
    'finder', 'capture', 'identity', 'proposal', 'library', 'system', 'tool',
    'project'
  ]));

COMMENT ON CONSTRAINT system_events_namespace_chk ON system_events IS
  'The event-namespace registry, enforced. EIGHT namespaces; never admin, cms or spotlight. '
  'Changing this set means changing four places — this CHECK, lib/events.ts KNOWN_NAMESPACES, '
  '__tests__/event-contract.test.ts REGISTRY, and docs/EVENT_CONTRACT.md §4. See migration 217.';
