"""
Event listener — polls the shared DB system_events table and triggers
automated actions (send email, create calendar event, etc.)

Runs as a background task inside the FastAPI process.
"""
import asyncio
import json
import logging
import os
from datetime import datetime, timezone

from .models.database import get_event_pool
from .gmail import send_email
from .templates import render_template

logger = logging.getLogger('cms.events')

_task: asyncio.Task | None = None
_last_processed_at: str | None = None
POLL_INTERVAL = int(os.getenv('EVENT_POLL_INTERVAL', '10'))

async def start_event_listener():
    global _task
    pool = get_event_pool()
    if not pool:
        logger.warning('Event listener disabled — SHARED_DATABASE_URL not set')
        return
    _task = asyncio.create_task(_poll_loop())
    logger.info(f'Event listener started (poll every {POLL_INTERVAL}s)')

async def stop_event_listener():
    global _task
    if _task:
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
        _task = None

async def _poll_loop():
    global _last_processed_at
    while True:
        try:
            await _process_new_events()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(f'Event listener error: {e}')
        await asyncio.sleep(POLL_INTERVAL)

async def _process_new_events():
    global _last_processed_at
    pool = get_event_pool()
    if not pool:
        return

    # Fetch automation rules
    rules = await pool.fetch(
        'SELECT * FROM automation_rules WHERE is_active = true'
    )
    if not rules:
        return

    # Fetch unprocessed events since last check
    if _last_processed_at:
        events = await pool.fetch(
            '''SELECT * FROM system_events
               WHERE created_at > $1::timestamptz
               ORDER BY created_at ASC LIMIT 50''',
            _last_processed_at,
        )
    else:
        # First run — only process events from the last 5 minutes
        events = await pool.fetch(
            '''SELECT * FROM system_events
               WHERE created_at > NOW() - INTERVAL '5 minutes'
               ORDER BY created_at ASC LIMIT 50'''
        )

    for event in events:
        _last_processed_at = str(event['created_at'])
        ns = event['namespace']
        etype = event['type']

        for rule in rules:
            if rule['trigger_namespace'] == ns and rule['trigger_type'] == etype:
                try:
                    await _execute_rule(rule, event)
                except Exception as e:
                    logger.error(f'Rule {rule["name"]} failed for event {etype}: {e}')
                    # Log failure
                    try:
                        await pool.execute(
                            '''INSERT INTO automation_log (rule_id, trigger_event_id, action_type, status, error_message)
                               VALUES ($1, $2, $3, 'failed', $4)''',
                            rule['id'], event['id'], rule['action_type'], str(e),
                        )
                    except Exception:
                        pass

async def _execute_rule(rule, event):
    pool = get_event_pool()
    config = json.loads(rule['action_config']) if isinstance(rule['action_config'], str) else rule['action_config']
    payload = json.loads(event['payload']) if isinstance(event['payload'], str) else (event['payload'] or {})

    if rule['action_type'] == 'send_email':
        template_name = config.get('template', '')
        html = render_template(template_name, payload)
        if html:
            to_email = payload.get('contactEmail') or config.get('to')
            if to_email:
                result = await send_email(to=to_email, subject=f"RFP Pipeline — {template_name.replace('_', ' ').title()}", html=html)
                logger.info(f'Rule "{rule["name"]}" sent email to {to_email}: {result}')

    elif rule['action_type'] == 'notify_admin':
        to_email = config.get('to', 'eric@rfppipeline.com')
        html = render_template('admin_notification', {**payload, 'event_type': event['type']})
        if html:
            result = await send_email(to=to_email, subject=f"[RFP Admin] {event['type']}", html=html)
            logger.info(f'Rule "{rule["name"]}" notified {to_email}: {result}')

    # Log success
    if pool:
        await pool.execute(
            '''INSERT INTO automation_log (rule_id, trigger_event_id, action_type, status, result)
               VALUES ($1, $2, $3, 'success', $4::jsonb)''',
            rule['id'], event['id'], rule['action_type'], json.dumps({'payload_keys': list(payload.keys())}),
        )
