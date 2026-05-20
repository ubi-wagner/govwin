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
import uuid

from .models.database import get_pool as _get_cms_pool, get_event_pool
from .workers.gmail_client import send_email as _gmail_send
from .templates import render_template, render_db_template, build_trigger_metadata

logger = logging.getLogger('cms.events')

_task: asyncio.Task | None = None
_last_processed_at: object | None = None
POLL_INTERVAL = int(os.getenv('EVENT_POLL_INTERVAL', '10'))
ADMIN_EMAIL = os.getenv('ADMIN_NOTIFICATION_EMAIL', 'eric@rfppipeline.com')
_SEND_AS = os.getenv('GOOGLE_WORKSPACE_EMAIL', 'platform@rfppipeline.com')


async def send_email(to: str, subject: str, html: str) -> dict:
    """Send via service account delegation (gmail_client), matching legacy signature."""
    try:
        result = await _gmail_send(
            delegate_email=_SEND_AS,
            to_email=to,
            subject=subject,
            body_html=html,
        )
        return {'provider': 'gmail', 'messageId': result.get('message_id')}
    except Exception as e:
        logger.error('send_email failed: %s', e)
        return {'provider': 'gmail', 'error': str(e)}


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
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'automation_rules' AND table_schema = 'public'"
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

    # Events that should still be skipped by the CRM because they are
    # handled inline by the frontend (e.g. during the same request).
    # As we migrate all email sending to the CRM, this set should shrink.
    FRONTEND_HANDLED: set[tuple[str, str]] = set()

    for event in events:
        _last_processed_at = event['created_at']
        ns = event.get('namespace', '')
        etype = event.get('type', '')

        if (ns, etype) in FRONTEND_HANDLED:
            continue

        # Handle workflow NOTIFY steps directly — these events carry the
        # template name and recipient info in their payload so we don't
        # need to match against automation_rules.
        if ns == 'system' and etype == 'notification.requested':
            try:
                await _handle_notification_requested(event)
            except Exception as e:
                logger.error(f'notification.requested handling failed: {e}')
            continue

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

    rule_id = rule.get('id')
    event_id = event.get('id')

    # If actions is a list of action objects, process each
    if isinstance(config, list):
        for action in config:
            act_type = action.get('type', '')
            try:
                # Dedup check
                if act_type in ('send_email', 'notify_admin', 'create_todo', 'enroll_drip', 'distribute_social', 'publish_content') and pool:
                    if await _check_dedup(pool, event_id, act_type):
                        logger.info("Skipping duplicate action %s for event %s", act_type, event_id)
                        continue
                await _do_action(act_type, action, payload, event)
                if pool:
                    await _log_rule_execution(pool, rule_id, event_id, act_type, 'success',
                                              result={'action': act_type})
            except Exception as e:
                logger.error(f'Rule action {act_type} failed for {event_id}: {e}')
                if pool:
                    await _log_rule_execution(pool, rule_id, event_id, act_type, 'failed',
                                              error_message=str(e))
    elif action_type:
        try:
            # Dedup check
            if action_type in ('send_email', 'notify_admin', 'create_todo', 'enroll_drip', 'distribute_social', 'publish_content') and pool:
                if await _check_dedup(pool, event_id, action_type):
                    logger.info("Skipping duplicate action %s for event %s", action_type, event_id)
                    return
            await _do_action(action_type, config, payload, event)
            if pool:
                await _log_rule_execution(pool, rule_id, event_id, action_type, 'success',
                                          result={'action': action_type})
        except Exception as e:
            logger.error(f'Rule action {action_type} failed for {event_id}: {e}')
            if pool:
                await _log_rule_execution(pool, rule_id, event_id, action_type, 'error',
                                          error_message=str(e))
    else:
        # Try to infer action from the config structure
        if config.get('template') or config.get('to'):
            inferred_type = 'send_email'
            try:
                if pool:
                    if await _check_dedup(pool, event_id, inferred_type):
                        logger.info("Skipping duplicate action %s for event %s", inferred_type, event_id)
                        return
                await _do_action(inferred_type, config, payload, event)
                if pool:
                    await _log_rule_execution(pool, rule_id, event_id, inferred_type, 'success',
                                              result={'action': inferred_type})
            except Exception as e:
                logger.error(f'Rule action {inferred_type} failed for {event_id}: {e}')
                if pool:
                    await _log_rule_execution(pool, rule_id, event_id, inferred_type, 'error',
                                              error_message=str(e))


async def _log_rule_execution(conn, rule_id, trigger_event_id, action_type, status, result=None, error_message=None):
    """Insert a row into automation_log to record a rule execution."""
    try:
        await conn.execute("""
            INSERT INTO automation_log (rule_id, trigger_event_id, action_type, status, result, error_message)
            VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb, $6)
        """, rule_id, str(trigger_event_id) if trigger_event_id else None,
            action_type, status,
            json.dumps(result) if result else None,
            error_message)
    except Exception as e:
        logger.error(f'[_log_rule_execution] Failed to log rule execution: {e}')


async def _check_dedup(conn, trigger_event_id, action_type):
    """Check if this action was already executed for this event recently."""
    row = await conn.fetchrow("""
        SELECT id FROM automation_log
        WHERE trigger_event_id = $1::uuid AND action_type = $2 AND status = 'success'
          AND executed_at > NOW() - INTERVAL '5 minutes'
        LIMIT 1
    """, str(trigger_event_id), action_type)
    return row is not None


async def _resolve_recipient_email(to_field: str, payload: dict, event: dict) -> str | None:
    """
    Resolve a recipient email address from the event payload.

    The ``to_field`` value in automation_rules tells us *where* in the payload
    the recipient identifier lives.  It might already be an email address, or
    it might be a userId / tenantId that we need to look up.

    Supported patterns:
      - "result.userId"   → look up user email by id
      - "payload.tenantId" → look up billing_email from tenants, fall back to
                             the tenant admin's email
      - "payload.contactEmail" → direct email from payload
      - Any dotted path  → traverse the payload dict
    """
    # Walk the dotted path to get the raw value
    parts = to_field.split('.')
    obj: dict = {**payload, 'result': payload, 'payload': payload}
    raw_value = None
    for part in parts:
        if isinstance(obj, dict):
            obj = obj.get(part, {})  # type: ignore[assignment]
        else:
            break
    if isinstance(obj, str) and obj:
        raw_value = obj

    if not raw_value:
        # Fall back: check common fields
        raw_value = payload.get('contactEmail') or payload.get('email')
        if raw_value:
            return raw_value
        return None

    # If it looks like an email, return it directly
    if '@' in raw_value:
        return raw_value

    # Otherwise treat it as an ID and look it up
    pool = get_event_pool()
    if not pool:
        return None

    try:
        # Try as user ID first
        row = await pool.fetchrow(
            'SELECT email FROM users WHERE id = $1::uuid',
            raw_value,
        )
        if row:
            return row['email']

        # Try as tenant ID — get billing_email or the tenant admin's email
        row = await pool.fetchrow(
            '''SELECT COALESCE(t.billing_email, u.email) AS email
               FROM tenants t
               LEFT JOIN users u ON u.tenant_id = t.id AND u.role = 'tenant_admin'
               WHERE t.id = $1::uuid
               LIMIT 1''',
            raw_value,
        )
        if row and row['email']:
            return row['email']
    except Exception as e:
        logger.warning(f'Failed to resolve recipient from {to_field}={raw_value}: {e}')

    return None


async def _handle_notification_requested(event) -> None:
    """Handle a ``system:notification.requested`` event emitted by a workflow
    NOTIFY step.

    The event payload contains:
      - template: template name to render
      - channel: delivery channel ("email" for V1)
      - tenant_id / user_id / to_role: recipient identifiers
      - additional fields forwarded as template context
    """
    payload = event.get('payload')
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except (json.JSONDecodeError, TypeError):
            payload = {}
    if not payload:
        logger.warning('notification.requested event has no payload, skipping')
        return

    pool = get_event_pool()

    channel = payload.get('channel', 'email')
    if channel != 'email':
        logger.info(f'notification.requested channel={channel} not supported in V1, skipping')
        return

    template_name = payload.get('template', '')
    if not template_name:
        logger.warning('notification.requested event has no template, skipping')
        return

    # Render the template
    html = render_template(template_name, payload)
    if not html:
        logger.warning(f'No template rendered for "{template_name}" in notification.requested, skipping')
        return

    # Resolve recipient
    to_email = None

    # Check for admin-targeted notifications (to_role = rfp_admin)
    to_role = payload.get('to_role')
    if to_role in ('rfp_admin', 'master_admin'):
        to_email = ADMIN_EMAIL
    else:
        # Try to resolve from user_id or tenant_id
        for field in ('user_id', 'tenant_id'):
            val = payload.get(field)
            if val:
                resolved = await _resolve_recipient_email(
                    f'payload.{field}', payload, event
                )
                if resolved:
                    to_email = resolved
                    break

    # Fall back to direct email fields in the payload
    if not to_email:
        to_email = payload.get('contactEmail') or payload.get('email') or payload.get('to')
    if not to_email:
        logger.warning(f'No recipient resolved for notification.requested template="{template_name}", skipping')
        return

    subject = payload.get('subject', f"RFP Pipeline — {template_name.replace('_', ' ').title()}")

    # Check for dedup using trigger_event_id from the workflow NOTIFY step
    trigger_event_id = payload.get('trigger_event_id')
    if trigger_event_id and pool:
        if await _check_dedup(pool, trigger_event_id, 'send_email'):
            logger.info("Skipping duplicate notification.requested for trigger event %s", trigger_event_id)
            return

    result = await send_email(
        to=to_email,
        subject=subject,
        html=html,
    )
    logger.info(f'notification.requested: sent "{template_name}" to {to_email}: {result}')

    # Log to automation_log for dedup cross-referencing
    if trigger_event_id and pool:
        try:
            await _log_rule_execution(
                pool, None, trigger_event_id, 'send_email', 'success',
                result={'action': 'send_email', 'template': template_name, 'recipient': to_email,
                        'source': 'notification.requested'})
        except Exception as e:
            logger.error(f'Failed to log notification.requested to automation_log: {e}')


async def _action_create_todo(config: dict, payload: dict, event):
    """Create an admin_todo in CMS Postgres."""
    from .models.database import get_pool as get_cms_pool

    try:
        cms_pool = get_cms_pool()
    except RuntimeError:
        logger.warning('Cannot create todo: CMS database not connected')
        return

    title_template = config.get('title_template', 'New TODO')
    try:
        title = title_template.format(**payload)
    except (KeyError, IndexError):
        title = title_template

    await cms_pool.execute(
        '''INSERT INTO admin_todos
               (title, todo_type, priority, related_entity_type,
                related_entity_id, metadata)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)''',
        title,
        config.get('todo_type', 'general'),
        config.get('priority', 'medium'),
        event.get('namespace'),
        event.get('id'),
        json.dumps(payload),
    )
    logger.info(f'Created admin todo: "{title}" (type={config.get("todo_type", "general")})')


async def _action_enroll_drip(config: dict, payload: dict, event):
    """Enroll a recipient in a drip campaign."""
    from .models.database import get_pool as get_cms_pool

    cms_pool = get_cms_pool()
    campaign_name = config.get('campaign')
    if not campaign_name:
        logger.warning('enroll_drip action has no campaign specified')
        return

    # Look up campaign by name in CMS DB
    campaign = await cms_pool.fetchrow(
        "SELECT id FROM email_campaigns WHERE name ILIKE $1 AND campaign_type = 'drip' LIMIT 1",
        campaign_name.replace('%', r'\%').replace('_', r'\_'),
    )
    if not campaign:
        logger.warning(f'Drip campaign "{campaign_name}" not found in CMS DB')
        return

    campaign_id = campaign['id']

    # Resolve recipient email from event payload
    recipient_email = (
        payload.get('contactEmail')
        or payload.get('email')
        or payload.get('billing_email')
    )
    if not recipient_email:
        # Try to resolve from tenant_id or user_id
        shared_pool = get_event_pool()
        if shared_pool:
            user_id = payload.get('user_id') or payload.get('userId')
            tenant_id = payload.get('tenant_id') or payload.get('tenantId')
            if user_id:
                row = await shared_pool.fetchrow(
                    'SELECT email, name FROM users WHERE id = $1::uuid', user_id
                )
                if row:
                    recipient_email = row['email']
            elif tenant_id:
                row = await shared_pool.fetchrow(
                    '''SELECT COALESCE(t.billing_email, u.email) as email,
                              COALESCE(u.name, t.company_name) as name
                       FROM tenants t
                       LEFT JOIN users u ON u.tenant_id = t.id AND u.role = 'tenant_admin'
                       WHERE t.id = $1::uuid LIMIT 1''',
                    tenant_id
                )
                if row:
                    recipient_email = row['email']

    if not recipient_email:
        logger.warning(f'enroll_drip: no recipient email resolved from event payload')
        return

    recipient_name = payload.get('name') or payload.get('company_name') or ''
    tenant_id_val = payload.get('tenant_id') or payload.get('tenantId')

    # Check for existing active enrollment
    existing = await cms_pool.fetchrow(
        '''SELECT id FROM drip_enrollments
           WHERE campaign_id = $1 AND recipient_email = $2 AND status = 'active'
           LIMIT 1''',
        campaign_id, recipient_email,
    )
    if existing:
        logger.info(f'enroll_drip: {recipient_email} already enrolled in campaign "{campaign_name}"')
        return

    # Compute next_send_at from first step
    from datetime import timedelta
    first_step = await cms_pool.fetchrow(
        'SELECT delay_hours FROM drip_sequences WHERE campaign_id = $1 ORDER BY step_number ASC LIMIT 1',
        campaign_id,
    )

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    if first_step:
        next_send_at = now + timedelta(hours=first_step['delay_hours'] or 0)
    else:
        next_send_at = now

    await cms_pool.execute(
        '''INSERT INTO drip_enrollments
               (campaign_id, tenant_id, recipient_email, recipient_name,
                next_send_at, metadata)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)''',
        campaign_id,
        tenant_id_val,
        recipient_email,
        recipient_name,
        next_send_at,
        json.dumps(payload),
    )

    logger.info(f'Enrolled {recipient_email} in drip campaign "{campaign_name}" (next_send_at={next_send_at})')


async def _action_distribute_social(config: dict, payload: dict, event):
    """Create social posts for connected accounts based on config platforms."""
    from .models.database import get_pool as get_cms_pool

    try:
        cms_pool = get_cms_pool()
    except RuntimeError:
        logger.warning('Cannot distribute social: CMS database not connected')
        return

    platforms = config.get('platforms', [])
    if not platforms:
        logger.warning('distribute_social action has no platforms specified')
        return

    # Build post content from event payload
    title = payload.get('title') or payload.get('diff_summary') or ''
    body = payload.get('excerpt') or payload.get('body', '')[:280] or title
    link_url = payload.get('url') or payload.get('link_url') or ''
    content_id = payload.get('entity_id') or payload.get('content_id')

    if not body:
        logger.warning('distribute_social: no content to post')
        return

    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    scheduled_at = now + timedelta(minutes=5)  # 5-minute review window

    for platform in platforms:
        try:
            # Find active accounts for this platform
            accounts = await cms_pool.fetch(
                '''SELECT id FROM social_accounts
                   WHERE platform = $1 AND status = 'active'
                   ORDER BY created_at''',
                platform,
            )

            for account in accounts:
                await cms_pool.execute(
                    '''INSERT INTO social_posts
                           (content_id, social_account_id, platform, post_text,
                            link_url, scheduled_at, status)
                       VALUES ($1, $2, $3, $4, $5, $6, 'scheduled')''',
                    content_id if content_id else None,
                    account['id'],
                    platform,
                    body[:3000],
                    link_url or None,
                    scheduled_at,
                )

            if accounts:
                logger.info(f'Created {len(accounts)} social post(s) for {platform}')
            else:
                logger.info(f'No active {platform} accounts found for social distribution')

        except Exception as e:
            logger.error(f'distribute_social: error creating {platform} posts: {e}')


async def _action_publish_content(config: dict, payload: dict, event):
    """Push approved CMS content to Main Postgres cms_content table.

    Maps CMS cms_posts fields to Main Postgres cms_content fields.
    Upserts by slug (unique key).
    """
    shared_pool = get_event_pool()
    if not shared_pool:
        logger.warning('publish_content: shared pool not available, skipping')
        return

    post_id = payload.get('post_id') or config.get('post_id')
    if not post_id:
        logger.warning('publish_content: no post_id in payload or config')
        return

    # Fetch full post from CMS database
    from .models.database import get_pool as get_cms_pool
    cms_pool = get_cms_pool()

    rows = await cms_pool.fetch("""
        SELECT id, slug, title, body, excerpt, status, author_name, author_email,
               featured_image_url, category, tags, meta_title, meta_description,
               published_at, published_by, version
        FROM cms_posts WHERE id = $1
    """, uuid.UUID(post_id) if isinstance(post_id, str) else post_id)

    if not rows:
        logger.warning(f'publish_content: post {post_id} not found in CMS DB')
        return

    post = dict(rows[0])

    if post['status'] != 'published':
        logger.info(f'publish_content: post status is {post["status"]}, not published — skipping')
        return

    # Determine content_type from category or config
    content_type = config.get('content_type', 'blog_post')
    if post.get('category') == 'page_block':
        content_type = 'page_block'
    elif post.get('category') == 'resource':
        content_type = 'resource'
    elif post.get('category') == 'guide':
        content_type = 'guide'

    tags_array = post.get('tags') or []

    # Upsert into Main Postgres cms_content by slug
    await shared_pool.execute("""
        INSERT INTO cms_content (slug, title, body, excerpt, content_type, author, tags,
                                 status, published, published_at, featured_image,
                                 metadata, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'published', true, $8, $9, $10, now())
        ON CONFLICT (slug) DO UPDATE SET
            title = EXCLUDED.title,
            body = EXCLUDED.body,
            excerpt = EXCLUDED.excerpt,
            content_type = EXCLUDED.content_type,
            author = EXCLUDED.author,
            tags = EXCLUDED.tags,
            status = 'published',
            published = true,
            published_at = COALESCE(EXCLUDED.published_at, cms_content.published_at),
            featured_image = EXCLUDED.featured_image,
            metadata = EXCLUDED.metadata,
            updated_at = now()
    """, post['slug'], post['title'], post['body'], post.get('excerpt'),
         content_type, post.get('author_name'), tags_array,
         post.get('published_at'), post.get('featured_image_url'),
         json.dumps({"cms_post_id": str(post['id']), "cms_version": post.get('version', 1),
                      "meta_title": post.get('meta_title'), "meta_description": post.get('meta_description')}))

    logger.info(f'publish_content: pushed "{post["slug"]}" to cms_content (type={content_type})')


async def _do_action(action_type: str, config: dict, payload: dict, event):
    if action_type == 'create_todo':
        await _action_create_todo(config, payload, event)
        return

    elif action_type == 'enroll_drip':
        await _action_enroll_drip(config, payload, event)
        return

    elif action_type == 'distribute_social':
        await _action_distribute_social(config, payload, event)
        return

    elif action_type == 'publish_content':
        await _action_publish_content(config, payload, event)
        return

    elif action_type == 'send_email':
        template_name = config.get('template', '')
        subject = config.get('subject', f"RFP Pipeline — {template_name.replace('_', ' ').title()}")
        html = render_template(template_name, payload)
        if not html:
            logger.warning(f'No template rendered for "{template_name}", skipping send')
            return

        # Resolve recipient: use to_field from config, then fall back to payload fields
        to_email = None
        to_field = config.get('to_field')
        if to_field:
            to_email = await _resolve_recipient_email(to_field, payload, event)
        if not to_email:
            to_email = payload.get('contactEmail') or config.get('to')
        if not to_email:
            logger.warning(f'No recipient resolved for template "{template_name}", skipping')
            return

        # Check if the template has trigger_config (DB template with triggers)
        trigger_metadata = {}
        try:
            cms_pool = _get_cms_pool()
            db_template = await cms_pool.fetchrow(
                '''SELECT id, slug, trigger_config, response_map, profile_variables, template_category
                   FROM email_templates WHERE slug = $1 AND is_active = TRUE''',
                template_name,
            )
            if db_template and db_template.get('trigger_config'):
                import json as _json
                trigger_config = db_template['trigger_config']
                if isinstance(trigger_config, str):
                    trigger_config = _json.loads(trigger_config)
                if trigger_config:
                    trigger_metadata = build_trigger_metadata(
                        template={
                            'trigger_config': trigger_config,
                            'response_map': db_template.get('response_map') or {},
                            'id': db_template['id'],
                            'slug': db_template['slug'],
                        },
                        send_context={
                            'send_id': '',  # will be updated after send record creation
                            'tenant_id': payload.get('tenantId') or payload.get('tenant_id'),
                            'campaign_id': config.get('campaign_id'),
                            'template_id': str(db_template['id']),
                        },
                    )
        except Exception as trig_err:
            logger.error(f'[send_email] Error building trigger metadata: {trig_err}')

        result = await send_email(
            to=to_email,
            subject=subject,
            html=html,
        )

        # If we have trigger metadata, store it on the email_send record
        if trigger_metadata and result.get('message_id'):
            try:
                import json as _json
                cms_pool = _get_cms_pool()
                # Find the email_send record by gmail_message_id
                send_row = await cms_pool.fetchrow(
                    'SELECT id FROM email_sends WHERE gmail_message_id = $1',
                    result.get('message_id'),
                )
                if send_row:
                    trigger_metadata['send_id'] = str(send_row['id'])
                    await cms_pool.execute(
                        'UPDATE email_sends SET trigger_metadata = $1::jsonb WHERE id = $2',
                        _json.dumps(trigger_metadata), send_row['id'],
                    )
                    logger.info(f'Stored trigger metadata on send {send_row["id"]}')
            except Exception as store_err:
                logger.error(f'[send_email] Error storing trigger metadata: {store_err}')

        logger.info(f'Sent email "{template_name}" to {to_email}: {result}')

    elif action_type == 'notify_admin':
        to_email = config.get('to', ADMIN_EMAIL)
        admin_template = config.get('template', 'admin_notification')
        subject = config.get('subject', f"[RFP Admin] {event.get('type', 'event')}")

        html = render_template(admin_template, {**payload, 'event_type': event.get('type', '')})
        if not html:
            # Fall back to generic admin_notification template
            html = render_template('admin_notification', {**payload, 'event_type': event.get('type', '')})
        if html:
            result = await send_email(
                to=to_email,
                subject=f"[RFP Admin] {subject}",
                html=html,
            )
            logger.info(f'Notified admin {to_email}: {result}')
