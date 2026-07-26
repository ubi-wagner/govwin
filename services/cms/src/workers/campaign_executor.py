"""
Campaign execution engine — polls active campaigns and creates email sends.

Runs as an async background loop:
  1. Poll email_campaigns for active campaigns that need execution
  2. For one_time: enumerate audience, create sends for all recipients
  3. For recurring: check cron schedule, create sends if due
  4. For drip: delegate to drip engine (skip here)
  5. For triggered: handled by event listener (skip here)
  6. Log execution in campaign_execution_log table
"""
import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone

from ..models.database import get_pool, get_event_pool
from ..models.events import emit_event, emit_system_event

logger = logging.getLogger('cms.campaign_executor')

WORKER_ID = f'executor-{os.getpid()}'
POLL_INTERVAL = 60  # seconds
BATCH_SIZE = 5


def _fire_event(event_type: str, **kwargs):
    """Fire-and-forget event emission."""
    asyncio.create_task(emit_event(event_type, entity_type='campaign', **kwargs))


async def _emit_shared_event(*, namespace: str, event_type: str, phase: str,
                              payload: dict, parent_event_id: str | None = None) -> str:
    """Emit an event to the shared system_events table (system actor). Returns event id."""
    return await emit_system_event(
        event_type=event_type, namespace=namespace, phase=phase,
        actor_type='system', actor_id='campaign_executor',
        parent_event_id=parent_event_id, payload=payload,
        ensure_correlation_id=True,
    )


async def _enumerate_audience(campaign) -> list[dict]:
    """
    Enumerate recipients from audience filter.
    Reads from shared DB (tenants + users via event bridge pool).
    Returns list of dicts with 'email', 'name', 'tenant_id' keys.
    """
    shared_pool = get_event_pool()
    if not shared_pool:
        logger.error('Cannot enumerate audience: shared database not connected')
        return []

    audience_type = campaign.get('audience_type', 'all_active')
    audience_filter = campaign.get('audience_filter')
    if isinstance(audience_filter, str):
        try:
            audience_filter = json.loads(audience_filter)
        except (json.JSONDecodeError, TypeError):
            audience_filter = {}
    if not audience_filter:
        audience_filter = {}

    recipients = []

    try:
        if audience_type == 'all_active':
            rows = await shared_pool.fetch(
                '''SELECT t.id as tenant_id, t.name,
                          COALESCE(t.billing_email, u.email) as email,
                          COALESCE(u.name, t.name) as name
                   FROM tenants t
                   LEFT JOIN users u ON u.tenant_id = t.id AND u.role = 'tenant_admin'
                   WHERE t.status = 'active'
                   ORDER BY t.created_at'''
            )
            for r in rows:
                if r['email']:
                    recipients.append({
                        'email': r['email'],
                        'name': r['name'] or '',
                        'tenant_id': str(r['tenant_id']),
                    })

        elif audience_type == 'tier_based':
            tiers = audience_filter.get('tiers', [])
            if not tiers:
                logger.warning('tier_based audience with no tiers specified')
                return []
            rows = await shared_pool.fetch(
                '''SELECT t.id as tenant_id, t.name,
                          COALESCE(t.billing_email, u.email) as email,
                          COALESCE(u.name, t.name) as name
                   FROM tenants t
                   LEFT JOIN users u ON u.tenant_id = t.id AND u.role = 'tenant_admin'
                   WHERE t.status = 'active' AND t.product_tier = ANY($1)
                   ORDER BY t.created_at''',
                tiers,
            )
            for r in rows:
                if r['email']:
                    recipients.append({
                        'email': r['email'],
                        'name': r['name'] or '',
                        'tenant_id': str(r['tenant_id']),
                    })

        elif audience_type == 'segment':
            criteria = audience_filter.get('criteria', {})
            if not criteria:
                logger.warning('segment audience with no criteria specified')
                return []
            rows = await shared_pool.fetch(
                '''SELECT t.id as tenant_id, t.name,
                          COALESCE(t.billing_email, u.email) as email,
                          COALESCE(u.name, t.name) as name
                   FROM tenants t
                   LEFT JOIN users u ON u.tenant_id = t.id AND u.role = 'tenant_admin'
                   WHERE t.status = 'active'
                     AND t.product_tier = ANY($1::text[])
                   ORDER BY t.created_at''',
                criteria if isinstance(criteria, list) else [str(criteria)],
            )
            for r in rows:
                if r['email']:
                    recipients.append({
                        'email': r['email'],
                        'name': r['name'] or '',
                        'tenant_id': str(r['tenant_id']),
                    })

        elif audience_type == 'lifecycle_stage':
            stage = audience_filter.get('stage', '')
            if not stage:
                logger.warning('lifecycle_stage audience with no stage specified')
                return []
            rows = await shared_pool.fetch(
                '''SELECT t.id as tenant_id, t.name,
                          COALESCE(t.billing_email, u.email) as email,
                          COALESCE(u.name, t.name) as name
                   FROM tenants t
                   LEFT JOIN users u ON u.tenant_id = t.id AND u.role = 'tenant_admin'
                   WHERE t.lifecycle_stage = $1
                   ORDER BY t.created_at''',
                stage,
            )
            for r in rows:
                if r['email']:
                    recipients.append({
                        'email': r['email'],
                        'name': r['name'] or '',
                        'tenant_id': str(r['tenant_id']),
                    })

        elif audience_type == 'individual':
            emails = audience_filter.get('emails', [])
            for email_addr in emails:
                recipients.append({
                    'email': email_addr,
                    'name': audience_filter.get('name', ''),
                    'tenant_id': None,
                })

        else:
            logger.warning(f'Unknown audience type: {audience_type}')

    except Exception as e:
        logger.error(f'Error enumerating audience ({audience_type}): {e}')

    return recipients


async def _create_send_for_recipient(
    pool, campaign, recipient: dict, hitl_required: bool
) -> bool:
    """Create an email_send (and optionally outbox/queue entry) for a recipient.
    Returns True on success."""
    try:
        now = datetime.now(timezone.utc)
        campaign_id = campaign['id']
        template_id = campaign.get('template_id')
        account_id = campaign.get('account_id')

        # Resolve subject and body from template
        subject = ''
        body_html = ''
        body_text = ''

        if template_id:
            template = await pool.fetchrow(
                'SELECT subject_template, body_html, body_text FROM email_templates WHERE id = $1 AND is_active = TRUE',
                template_id,
            )
            if template:
                subject = template['subject_template'] or ''
                body_html = template['body_html'] or ''
                body_text = template['body_text'] or ''

                # Basic variable substitution
                for var_name, var_value in [
                    ('recipient_name', recipient.get('name', '')),
                    ('recipient_email', recipient.get('email', '')),
                    ('company_name', recipient.get('name', '')),
                ]:
                    placeholder = '{{' + var_name + '}}'
                    subject = subject.replace(placeholder, str(var_value))
                    body_html = body_html.replace(placeholder, str(var_value))
                    body_text = body_text.replace(placeholder, str(var_value))

        if not subject:
            subject = campaign.get('name', 'Campaign Email')

        # Determine initial status
        if hitl_required:
            initial_status = 'pending_approval'
        else:
            initial_status = 'queued'

        send_row = await pool.fetchrow(
            '''INSERT INTO email_sends (campaign_id, template_id, account_id,
                   recipient_email, recipient_name, tenant_id,
                   subject, body_html, body_text, status,
                   original_subject, original_body_html, original_body_text)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $7, $8, $9)
               RETURNING id''',
            campaign_id, template_id, account_id,
            recipient['email'], recipient.get('name'),
            recipient.get('tenant_id'),
            subject, body_html, body_text, initial_status,
        )

        send_id = send_row['id']

        if hitl_required:
            # Route to HITL outbox
            default_account_id = account_id
            if not default_account_id:
                default_acct = await pool.fetchrow(
                    'SELECT id FROM email_accounts WHERE is_active = TRUE ORDER BY created_at LIMIT 1'
                )
                if default_acct:
                    default_account_id = default_acct['id']

            await pool.execute(
                '''INSERT INTO email_outbox (send_id, priority, category,
                       recipient_preview, subject_preview, default_account_id)
                   VALUES ($1, 50, $2, $3, $4, $5)''',
                send_id,
                campaign.get('campaign_type', 'one_time'),
                f'{recipient.get("name", "")} <{recipient["email"]}>',
                subject[:120],
                default_account_id,
            )
        else:
            # Insert directly into email_queue for immediate delivery
            await pool.execute(
                'INSERT INTO email_queue (send_id, priority) VALUES ($1, 50)',
                send_id,
            )

        return True

    except Exception as e:
        logger.error(f'Error creating send for {recipient.get("email")}: {e}')
        return False


async def _execute_one_time_campaign(pool, campaign) -> dict:
    """Execute a one-time campaign: enumerate all recipients, create sends."""
    now = datetime.now(timezone.utc)
    campaign_id = campaign['id']
    hitl_required = campaign.get('hitl_required', True)

    recipients = await _enumerate_audience(campaign)
    if not recipients:
        logger.warning(f'Campaign {campaign_id}: no recipients found')
        return {'targeted': 0, 'created': 0, 'errors': 0}

    created = 0
    errors = 0
    skipped = 0

    for recipient in recipients:
        recipient_email = recipient['email']
        # Dedup check: skip if a send already exists for this campaign + recipient
        existing = await pool.fetchrow(
            "SELECT id FROM email_sends WHERE campaign_id = $1 AND recipient_email = $2",
            campaign_id, recipient_email,
        )
        if existing:
            skipped += 1
            continue

        success = await _create_send_for_recipient(pool, campaign, recipient, hitl_required)
        if success:
            created += 1
        else:
            errors += 1

    # Mark campaign as completed after one-time execution
    await pool.execute(
        "UPDATE email_campaigns SET status = 'completed', completed_at = $1, updated_at = $1 WHERE id = $2",
        now, campaign_id,
    )

    return {'targeted': len(recipients), 'created': created, 'errors': errors}


async def _execute_recurring_campaign(pool, campaign) -> dict:
    """Execute a recurring campaign: check cron schedule, create sends if due."""
    now = datetime.now(timezone.utc)
    campaign_id = campaign['id']
    hitl_required = campaign.get('hitl_required', True)

    # Check if a recent execution log exists (within the last hour)
    # to avoid double-execution between polls
    recent = await pool.fetchrow(
        '''SELECT id FROM campaign_execution_log
           WHERE campaign_id = $1 AND execution_type = 'recurring'
             AND started_at > NOW() - INTERVAL '1 hour'
           ORDER BY started_at DESC LIMIT 1''',
        campaign_id,
    )
    if recent:
        return {'targeted': 0, 'created': 0, 'errors': 0}

    # For V1, recurring campaigns execute on each poll if active
    # Full cron parsing deferred to V2
    recipients = await _enumerate_audience(campaign)
    if not recipients:
        return {'targeted': 0, 'created': 0, 'errors': 0}

    created = 0
    errors = 0
    skipped = 0

    for recipient in recipients:
        recipient_email = recipient['email']
        # Dedup check: skip if a send already exists for this campaign + recipient
        existing = await pool.fetchrow(
            "SELECT id FROM email_sends WHERE campaign_id = $1 AND recipient_email = $2",
            campaign_id, recipient_email,
        )
        if existing:
            skipped += 1
            continue

        success = await _create_send_for_recipient(pool, campaign, recipient, hitl_required)
        if success:
            created += 1
        else:
            errors += 1

    return {'targeted': len(recipients), 'created': created, 'errors': errors}


async def process_campaigns() -> int:
    """Process active campaigns that need execution. Returns count processed."""
    pool = get_pool()
    now = datetime.now(timezone.utc)

    # Lock a batch of active campaigns for processing
    rows = await pool.fetch(
        '''SELECT * FROM email_campaigns
           WHERE id IN (
               SELECT id FROM email_campaigns
               WHERE status = 'active'
                 AND campaign_type IN ('one_time', 'recurring')
               ORDER BY updated_at ASC
               LIMIT $1
               FOR UPDATE SKIP LOCKED
           )''',
        BATCH_SIZE,
    )

    if not rows:
        return 0

    processed = 0
    for campaign in rows:
        campaign_id = campaign['id']
        campaign_type = campaign['campaign_type']
        campaign_start_ms = time.monotonic()

        start_event_id = await _emit_shared_event(
            namespace="system", event_type="campaign.executed", phase="start",
            payload={"campaignId": str(campaign_id), "campaignType": campaign_type},
        )

        try:
            # Log execution start
            log_id = await pool.fetchval(
                '''INSERT INTO campaign_execution_log
                       (campaign_id, execution_type, started_at)
                   VALUES ($1, $2, $3)
                   RETURNING id''',
                campaign_id, campaign_type, now,
            )

            if campaign_type == 'one_time':
                result = await _execute_one_time_campaign(pool, campaign)
            elif campaign_type == 'recurring':
                result = await _execute_recurring_campaign(pool, campaign)
            else:
                # drip and triggered are handled elsewhere
                logger.debug(f'Skipping campaign {campaign_id} (type={campaign_type})')
                continue

            # Update execution log
            await pool.execute(
                '''UPDATE campaign_execution_log
                   SET recipients_targeted = $1, sends_created = $2, errors = $3,
                       completed_at = $4
                   WHERE id = $5''',
                result['targeted'], result['created'], result['errors'],
                datetime.now(timezone.utc), log_id,
            )

            _fire_event(
                'campaign.executed',
                entity_id=str(campaign_id),
                diff_summary=f'Campaign "{campaign["name"]}" executed: {result["created"]} sends created',
                payload={
                    'campaign_id': str(campaign_id),
                    'campaign_type': campaign_type,
                    **result,
                },
            )

            campaign_duration_ms = int((time.monotonic() - campaign_start_ms) * 1000)
            await _emit_shared_event(
                namespace="system", event_type="campaign.executed", phase="end",
                parent_event_id=start_event_id,
                payload={"campaignId": str(campaign_id), "campaignType": campaign_type,
                         "sendsCreated": result['created'], "targeted": result['targeted'],
                         "durationMs": campaign_duration_ms},
            )

            processed += 1
            logger.info(
                f'Campaign {campaign_id} ({campaign_type}): '
                f'{result["targeted"]} targeted, {result["created"]} created, {result["errors"]} errors'
            )

        except Exception as e:
            logger.error(f'[campaign_executor] Error executing campaign {campaign_id}: {e}')
            campaign_duration_ms = int((time.monotonic() - campaign_start_ms) * 1000)
            await _emit_shared_event(
                namespace="system", event_type="campaign.executed", phase="end",
                parent_event_id=start_event_id,
                payload={"campaignId": str(campaign_id), "error": str(e)[:500],
                         "durationMs": campaign_duration_ms},
            )
            # Update log with error
            try:
                await pool.execute(
                    '''UPDATE campaign_execution_log
                       SET errors = 1, completed_at = $1,
                           metadata = $2::jsonb
                       WHERE id = $3''',
                    datetime.now(timezone.utc),
                    json.dumps({'error': str(e)[:500]}),
                    log_id,
                )
            except Exception:
                pass

    return processed


async def executor_loop():
    """Main loop — polls active campaigns and executes them."""
    logger.info(f'Campaign executor started (worker_id={WORKER_ID})')

    while True:
        try:
            count = await process_campaigns()
            if count > 0:
                logger.info(f'Executed {count} campaigns')
        except Exception as e:
            logger.error(f'[executor_loop] Error: {e}')

        await asyncio.sleep(POLL_INTERVAL)
