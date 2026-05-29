"""
Drip campaign sequence processor — advances enrollments through drip steps.

Runs as an async background loop:
  1. Poll drip_enrollments where next_send_at <= now() AND status = 'active'
  2. Look up the next drip_sequence step for current_step + 1
  3. Create an email_send for the recipient
  4. Update enrollment: current_step++, compute next_send_at
  5. If no more steps, mark enrollment as 'completed'
  6. Log to campaign_execution_log
"""
import asyncio
import json
import logging
import os
import time
import uuid as uuid_mod
from datetime import datetime, timedelta, timezone

from ..models.database import get_pool, get_event_pool
from ..models.events import emit_event

logger = logging.getLogger('cms.drip_engine')

WORKER_ID = f'drip-{os.getpid()}'
POLL_INTERVAL = 60  # seconds
BATCH_SIZE = 20


def _fire_event(event_type: str, **kwargs):
    """Fire-and-forget event emission."""
    asyncio.create_task(emit_event(event_type, entity_type='drip', **kwargs))


async def _emit_shared_event(*, namespace: str, event_type: str, phase: str,
                              payload: dict, parent_event_id: str | None = None) -> str:
    """Emit an event to the shared system_events table. Returns event id."""
    pool = get_event_pool()
    if not pool:
        return ""
    event_id = str(uuid_mod.uuid4())
    try:
        payload['correlationId'] = payload.get('correlationId', str(uuid_mod.uuid4()))
        await pool.execute(
            """INSERT INTO system_events
                (id, namespace, type, phase, actor_type, actor_id, parent_event_id, payload)
               VALUES ($1, $2, $3, $4, 'system', 'drip_engine', $5, $6::jsonb)""",
            uuid_mod.UUID(event_id), namespace, event_type, phase,
            uuid_mod.UUID(parent_event_id) if parent_event_id else None,
            json.dumps(payload),
        )
        return event_id
    except Exception as e:
        logger.error('_emit_shared_event failed: %s', e)
        return ""


async def process_due_enrollments() -> int:
    """Process enrollments where next_send_at is due. Returns count processed."""
    pool = get_pool()
    now = datetime.now(timezone.utc)

    # Lock a batch of due enrollments
    rows = await pool.fetch(
        '''UPDATE drip_enrollments SET updated_at = $1
           WHERE id IN (
               SELECT id FROM drip_enrollments
               WHERE status = 'active'
                 AND next_send_at IS NOT NULL
                 AND next_send_at <= $1
               ORDER BY next_send_at ASC
               LIMIT $2
               FOR UPDATE SKIP LOCKED
           )
           RETURNING *''',
        now, BATCH_SIZE,
    )

    if not rows:
        return 0

    processed = 0
    for enrollment in rows:
        enrollment_id = enrollment['id']
        campaign_id = enrollment['campaign_id']
        current_step = enrollment['current_step']
        next_step_number = current_step + 1
        step_start_ms = time.monotonic()

        start_event_id = await _emit_shared_event(
            namespace="system", event_type="drip.step_sent", phase="start",
            payload={"enrollmentId": str(enrollment_id),
                     "campaignId": str(campaign_id),
                     "stepNumber": next_step_number},
        )

        try:
            # Look up the next step in the drip sequence
            step = await pool.fetchrow(
                '''SELECT * FROM drip_sequences
                   WHERE campaign_id = $1 AND step_number = $2''',
                campaign_id, next_step_number,
            )

            if not step:
                # No more steps — mark as completed
                await pool.execute(
                    '''UPDATE drip_enrollments
                       SET status = 'completed', next_send_at = NULL, updated_at = $1
                       WHERE id = $2''',
                    now, enrollment_id,
                )

                _fire_event(
                    'drip.enrollment.completed',
                    entity_id=str(enrollment_id),
                    diff_summary=f'Drip enrollment completed after {current_step} steps',
                    payload={
                        'enrollment_id': str(enrollment_id),
                        'campaign_id': str(campaign_id),
                        'total_steps': current_step,
                    },
                )

                logger.info(f'Enrollment {enrollment_id} completed (campaign {campaign_id}, {current_step} steps)')
                processed += 1
                continue

            # Resolve subject and body
            subject = step.get('subject_override') or ''
            body_html = step.get('body_override') or ''
            body_text = ''

            template_id = step.get('template_id')
            if template_id and not subject:
                template = await pool.fetchrow(
                    'SELECT subject_template, body_html, body_text FROM email_templates WHERE id = $1 AND is_active = TRUE',
                    template_id,
                )
                if template:
                    subject = subject or template['subject_template'] or ''
                    body_html = body_html or template['body_html'] or ''
                    body_text = template['body_text'] or ''

            if not subject:
                subject = f'Step {next_step_number}'

            # Basic variable substitution
            recipient_name = enrollment.get('recipient_name', '')
            recipient_email = enrollment['recipient_email']
            for var_name, var_value in [
                ('recipient_name', recipient_name),
                ('recipient_email', recipient_email),
            ]:
                placeholder = '{{' + var_name + '}}'
                subject = subject.replace(placeholder, str(var_value))
                body_html = body_html.replace(placeholder, str(var_value))
                body_text = body_text.replace(placeholder, str(var_value))

            # Look up campaign for account_id and hitl setting
            campaign = await pool.fetchrow(
                'SELECT account_id, hitl_required FROM email_campaigns WHERE id = $1',
                campaign_id,
            )
            hitl_required = campaign.get('hitl_required', True) if campaign else True
            account_id = campaign.get('account_id') if campaign else None

            # Determine initial status
            initial_status = 'pending_approval' if hitl_required else 'queued'

            # Create email_send
            send_row = await pool.fetchrow(
                '''INSERT INTO email_sends (campaign_id, template_id, account_id,
                       recipient_email, recipient_name, tenant_id,
                       subject, body_html, body_text, status,
                       original_subject, original_body_html, original_body_text)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $7, $8, $9)
                   RETURNING id''',
                campaign_id, template_id, account_id,
                recipient_email, recipient_name,
                enrollment.get('tenant_id'),
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
                       VALUES ($1, 50, 'drip', $2, $3, $4)''',
                    send_id,
                    f'{recipient_name} <{recipient_email}>',
                    subject[:120],
                    default_account_id,
                )
            else:
                # Insert directly into email_queue
                await pool.execute(
                    'INSERT INTO email_queue (send_id, priority) VALUES ($1, 50)',
                    send_id,
                )

            # Compute next_send_at from the step after this one
            next_next_step = await pool.fetchrow(
                '''SELECT delay_hours, delay_from FROM drip_sequences
                   WHERE campaign_id = $1 AND step_number = $2''',
                campaign_id, next_step_number + 1,
            )

            if next_next_step:
                delay_hours = next_next_step['delay_hours'] or 0
                delay_from = next_next_step.get('delay_from', 'previous_step')
                if delay_from == 'enrollment':
                    base_time = enrollment['enrolled_at']
                else:
                    base_time = now
                new_next_send_at = base_time + timedelta(hours=delay_hours)
            else:
                # No more steps after this; next poll will complete the enrollment
                new_next_send_at = now + timedelta(seconds=30)

            # Update enrollment
            await pool.execute(
                '''UPDATE drip_enrollments
                   SET current_step = $1, last_sent_at = $2, next_send_at = $3, updated_at = $2
                   WHERE id = $4''',
                next_step_number, now, new_next_send_at, enrollment_id,
            )

            # Log to campaign_execution_log
            await pool.execute(
                '''INSERT INTO campaign_execution_log
                       (campaign_id, execution_type, step_number,
                        recipients_targeted, sends_created, started_at, completed_at)
                   VALUES ($1, 'drip_step', $2, 1, 1, $3, $3)''',
                campaign_id, next_step_number, now,
            )

            _fire_event(
                'drip.step.sent',
                entity_id=str(enrollment_id),
                diff_summary=f'Drip step {next_step_number} sent to {recipient_email}',
                payload={
                    'enrollment_id': str(enrollment_id),
                    'campaign_id': str(campaign_id),
                    'step_number': next_step_number,
                    'send_id': str(send_id),
                    'recipient': recipient_email,
                },
            )

            step_duration_ms = int((time.monotonic() - step_start_ms) * 1000)
            await _emit_shared_event(
                namespace="system", event_type="drip.step_sent", phase="end",
                parent_event_id=start_event_id,
                payload={"enrollmentId": str(enrollment_id),
                         "campaignId": str(campaign_id),
                         "stepNumber": next_step_number,
                         "recipient": recipient_email,
                         "durationMs": step_duration_ms},
            )

            processed += 1
            logger.info(
                f'Drip step {next_step_number} sent for enrollment {enrollment_id} '
                f'(campaign {campaign_id}, recipient {recipient_email})'
            )

        except Exception as e:
            logger.error(f'[drip_engine] Error processing enrollment {enrollment_id}: {e}')
            step_duration_ms = int((time.monotonic() - step_start_ms) * 1000)
            await _emit_shared_event(
                namespace="system", event_type="drip.step_sent", phase="end",
                parent_event_id=start_event_id,
                payload={"enrollmentId": str(enrollment_id),
                         "campaignId": str(campaign_id),
                         "error": str(e)[:500],
                         "durationMs": step_duration_ms},
            )
            # Don't fail the whole batch — mark this enrollment as failed if persistent
            try:
                await pool.execute(
                    '''UPDATE drip_enrollments
                       SET status = 'failed', updated_at = $1,
                           metadata = metadata || $2::jsonb
                       WHERE id = $3''',
                    now,
                    json.dumps({'last_error': str(e)[:500]}),
                    enrollment_id,
                )
            except Exception:
                pass

    return processed


async def drip_loop():
    """Main loop — polls due enrollments and advances drip sequences."""
    logger.info(f'Drip engine started (worker_id={WORKER_ID})')

    while True:
        try:
            count = await process_due_enrollments()
            if count > 0:
                logger.info(f'Processed {count} drip enrollments')
        except Exception as e:
            logger.error(f'[drip_loop] Error: {e}')

        await asyncio.sleep(POLL_INTERVAL)
