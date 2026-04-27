"""
Event listener — polls the shared DB system_events table and triggers
automated actions based on automation_rules.

Adapts to the actual DB schema (trigger_bus, trigger_events, conditions,
actions columns from the deployed automation_rules table).
"""
import asyncio
import json
import logging
import os

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

    # Discover the automation_rules schema dynamically
    try:
        cols = await pool.fetch(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'automation_rules'"
        )
        col_names = {r['column_name'] for r in cols}
    except Exception as e:
        logger.warning(f'Cannot read automation_rules schema: {e}')
        return

    if not col_names:
        return

    # Fetch rules
    try:
        rules = await pool.fetch('SELECT * FROM automation_rules')
    except Exception as e:
        logger.warning(f'Cannot fetch automation_rules: {e}')
        return

    if not rules:
        return

    # Fetch new events
    try:
        if _last_processed_at:
            events = await pool.fetch(
                '''SELECT * FROM system_events
                   WHERE created_at > $1::timestamptz
                   ORDER BY created_at ASC LIMIT 50''',
                _last_processed_at,
            )
        else:
            events = await pool.fetch(
                '''SELECT * FROM system_events
                   WHERE created_at > NOW() - INTERVAL '5 minutes'
                   ORDER BY created_at ASC LIMIT 50'''
            )
    except Exception as e:
        logger.warning(f'Cannot fetch system_events: {e}')
        return

    for event in events:
        _last_processed_at = str(event['created_at'])
        ns = event.get('namespace', '')
        etype = event.get('type', '')

        for rule in rules:
            if _rule_matches(rule, col_names, ns, etype):
                try:
                    await _execute_rule(rule, col_names, event)
                except Exception as e:
                    logger.error(f'Rule execution failed for {etype}: {e}')


def _rule_matches(rule, col_names: set, namespace: str, event_type: str) -> bool:
    """Check if an event matches a rule, adapting to the actual column names."""
    # Schema variant 1: trigger_namespace + trigger_type (migration 019)
    if 'trigger_namespace' in col_names and 'trigger_type' in col_names:
        return rule.get('trigger_namespace') == namespace and rule.get('trigger_type') == event_type

    # Schema variant 2: trigger_bus + trigger_events (pre-existing)
    if 'trigger_bus' in col_names and 'trigger_events' in col_names:
        bus = rule.get('trigger_bus', '')
        events_val = rule.get('trigger_events')
        # trigger_events might be a string, array, or JSON
        if isinstance(events_val, list):
            return bus == namespace and event_type in events_val
        elif isinstance(events_val, str):
            try:
                events_list = json.loads(events_val)
                if isinstance(events_list, list):
                    return bus == namespace and event_type in events_list
            except (json.JSONDecodeError, TypeError):
                pass
            return bus == namespace and events_val == event_type
        return bus == namespace

    return False


async def _execute_rule(rule, col_names: set, event):
    pool = get_event_pool()
    payload = event.get('payload')
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except (json.JSONDecodeError, TypeError):
            payload = {}
    if not payload:
        payload = {}

    # Get action config — adapt to column names
    if 'action_config' in col_names:
        config = rule.get('action_config', {})
    elif 'actions' in col_names:
        config = rule.get('actions', {})
    else:
        config = {}
    if isinstance(config, str):
        try:
            config = json.loads(config)
        except (json.JSONDecodeError, TypeError):
            config = {}

    # Get action type
    action_type = rule.get('action_type') or config.get('type', '')

    # If actions is a list of action objects, process each
    if isinstance(config, list):
        for action in config:
            await _do_action(action.get('type', ''), action, payload, event)
    elif action_type:
        await _do_action(action_type, config, payload, event)
    else:
        # Try to infer action from the config structure
        if config.get('template') or config.get('to'):
            await _do_action('send_email', config, payload, event)


async def _do_action(action_type: str, config: dict, payload: dict, event):
    if action_type == 'send_email':
        template_name = config.get('template', '')
        html = render_template(template_name, payload)
        if html:
            to_email = payload.get('contactEmail') or config.get('to')
            if to_email:
                result = await send_email(
                    to=to_email,
                    subject=f"RFP Pipeline — {template_name.replace('_', ' ').title()}",
                    html=html,
                )
                logger.info(f'Sent email to {to_email}: {result}')

    elif action_type == 'notify_admin':
        to_email = config.get('to', 'eric@rfppipeline.com')
        html = render_template('admin_notification', {**payload, 'event_type': event.get('type', '')})
        if html:
            result = await send_email(
                to=to_email,
                subject=f"[RFP Admin] {event.get('type', 'event')}",
                html=html,
            )
            logger.info(f'Notified admin {to_email}: {result}')
