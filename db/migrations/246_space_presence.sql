-- 246 · `space_presence` — the OPEN half of "somebody from outside is in your workspace".
--
-- ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────────────────────────
-- Two kinds of actor enter a tenant's space without belonging to it: an rfp_admin descending as a
-- shadow admin, and a partner-manager descending into a company they manage. Both emitted an ENTER
-- event into the customer's audit trail. Neither reliably emitted an EXIT.
--
--   partner   `partner.exited` was emitted with `tenantId: null`, so it landed in no customer's
--             trail at all — the company saw the arrival and never the departure. And it only
--             fired from the "Exit to partner console" link: navigating away emitted nothing.
--
--   shadow    `shadow.ascended` fired ONLY from the "Return to platform" button, posted by a client
--             component. Close the tab, type a URL, follow a nav link, or let the session lapse and
--             no exit was ever emitted. Worse, its once-per-entry guard was `sessionStorage`, which
--             is per-TAB — a second tab opened a second bracket that nothing would ever close.
--
-- A customer's audit trail therefore accumulated "An RFP administrator opened your workspace" with
-- no matching close, permanently. That is the one line in the trail that most needs an end: the
-- question it answers is not "did someone come in" but "are they still here".
--
-- ── WHY A TABLE AND NOT JUST THE EVENTS ──────────────────────────────────────────────────────
-- `system_events` can already answer "was there a descend with no ascend after it". What it cannot
-- answer is "is that bracket ABANDONED" — for that you need to know when the actor was last
-- actually present, and a read-only browsing session emits no events at all. So presence is real
-- state with a `last_seen_at`, and the events remain the audit record projected from it.
--
-- ── ONE OPEN BRACKET PER (ACTOR, TENANT) ─────────────────────────────────────────────────────
-- Enforced by a partial unique index rather than by convention, because the thing being prevented
-- is precisely a second opener that no closer will ever match. Re-entering while already inside is
-- a `last_seen_at` refresh, not a new bracket and not a second ENTER event.
--
-- `close_reason` is not decoration: "they pressed exit", "they walked out of the space", "they went
-- to another company" and "they vanished and we timed them out" are four different facts about who
-- was in a customer's workspace, and only the last one is uncertain.

CREATE TABLE IF NOT EXISTS space_presence (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Which door they came through. Both are "outside actor inside a tenant", and they close the
  -- same way, but the customer-facing sentence differs and so does who to ask about it.
  kind          text NOT NULL CHECK (kind IN ('shadow', 'partner')),
  entered_at    timestamptz NOT NULL DEFAULT now(),
  -- Refreshed on every render inside the space. This is what makes an abandoned bracket
  -- distinguishable from a long one.
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz,
  close_reason  text CHECK (close_reason IN ('explicit', 'left_space', 'moved', 'timeout')),
  -- A closed row must say why, and an open row must not pretend to. Paired, because a half-set
  -- pair is how "closed" and "closed for a reason nobody recorded" become indistinguishable.
  CONSTRAINT space_presence_closed_pair CHECK (
    (closed_at IS NULL AND close_reason IS NULL) OR
    (closed_at IS NOT NULL AND close_reason IS NOT NULL)
  )
);

-- THE INVARIANT, as an index: one open bracket per actor per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_space_presence_open
  ON space_presence (user_id, tenant_id) WHERE closed_at IS NULL;

-- The sweep's access path: every open bracket, oldest sighting first.
CREATE INDEX IF NOT EXISTS idx_space_presence_stale
  ON space_presence (last_seen_at) WHERE closed_at IS NULL;

-- The customer's question — "who has been in my workspace" — newest first.
CREATE INDEX IF NOT EXISTS idx_space_presence_tenant
  ON space_presence (tenant_id, entered_at DESC);

COMMENT ON TABLE space_presence IS
  'Open/closed bracket for an outside actor (rfp_admin shadow, partner-manager) inside a tenant space. '
  'One open row per (user_id, tenant_id); the ENTER/EXIT events in system_events are projected from it.';

ALTER TABLE space_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE space_presence FORCE ROW LEVEL SECURITY;

-- Scoped to the tenant whose space it describes. A company can read who was in THEIR workspace —
-- that is the point of the record — and cannot read anyone else's.
DROP POLICY IF EXISTS tenant_isolation_select ON space_presence;
CREATE POLICY tenant_isolation_select ON space_presence FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_insert ON space_presence;
CREATE POLICY tenant_isolation_insert ON space_presence FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_update ON space_presence;
CREATE POLICY tenant_isolation_update ON space_presence FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_delete ON space_presence;
CREATE POLICY tenant_isolation_delete ON space_presence FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON space_presence TO govtech_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON space_presence TO rfp_agent;
