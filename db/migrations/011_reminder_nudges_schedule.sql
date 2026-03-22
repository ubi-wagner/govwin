-- Migration 011: Add reminder_nudges schedule and email_delivery schedule
--
-- reminder_nudges: Checks approaching deadlines for reminder+ tenants (8am UTC daily)
-- email_delivery:  Flushes notifications_queue via Gmail API (every 15 min)

INSERT INTO pipeline_schedules (source, display_name, run_type, cron_expression, priority)
VALUES
    ('reminder_nudges', 'Deadline Nudge Check', 'notify', '0 8 * * *',    3),
    ('email_delivery',  'Email Queue Flush',    'notify', '*/15 * * * *', 4)
ON CONFLICT (source) DO NOTHING;
