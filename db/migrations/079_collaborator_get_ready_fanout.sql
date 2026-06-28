-- Migration 079: fan the "get ready" email out to collaborators (C3 follow-on).
--
-- The Increment 3a rule "Proposal ready to advance — collaborator get-ready"
-- (mig 078) sent to the tenant admin (to_field=payload.tenantId). This flips it
-- to a per-collaborator fan-out: the event_listener's send_email handler reads
-- recipients='collaborators' and emails every accepted collaborator on the
-- proposal, falling back to the tenant admin (to_field) when there are none.
-- The notify_collaborators_get_ready preference gate is unchanged.

UPDATE automation_rules
SET action_config = action_config || '{"recipients": "collaborators"}'::jsonb,
    updated_at = now()
WHERE name = 'Proposal ready to advance — collaborator get-ready'
  AND NOT (action_config ? 'recipients');
