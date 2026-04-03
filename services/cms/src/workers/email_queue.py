"""
Email queue worker — dequeues pending sends and delivers via Gmail API.

Runs as an async background loop:
  1. Poll email_queue for unlocked items past their scheduled_for time
  2. Lock a batch, send each via Gmail API
  3. Update email_sends with Gmail message/thread IDs
  4. Increment account send counters and campaign stats
  5. On failure, increment retry count or mark as failed
"""
import asyncio
import logging
import os
from datetime import datetime, timezone

from ..models.database import get_pool
from ..models.events import emit_event


def _fire_event(event_type: str, **kwargs):
    """Fire-and-forget event emission."""
    asyncio.create_task(emit_event(event_type, entity_type='email', **kwargs))

logger = logging.getLogger('cms.email_queue')

WORKER_ID = f'queue-{os.getpid()}'
BATCH_SIZE = 10
POLL_INTERVAL = 15  # seconds


async def process_queue_batch() -> int:
    """Process one batch of queued emails. Returns count processed."""
    pool = get_pool()
    now = datetime.now(timezone.utc)

    # Lock a batch of ready items
    rows = await pool.fetch(
        '''UPDATE email_queue SET locked_at = $1, locked_by = $2
           WHERE id IN (
               SELECT id FROM email_queue
               WHERE locked_at IS NULL
                 AND attempts < max_attempts
                 AND scheduled_for <= $1
               ORDER BY priority ASC, created_at ASC
               LIMIT $3
               FOR UPDATE SKIP LOCKED
           )
           RETURNING id, send_id, attempts, max_attempts''',
        now, WORKER_ID, BATCH_SIZE,
    )

    if not rows:
        return 0

    processed = 0
    for queue_item in rows:
        send_id = queue_item['send_id']
        try:
            # Fetch the send record
            send = await pool.fetchrow(
                '''SELECT s.*, a.email_address as delegate_email, a.display_name as from_name,
                          a.daily_send_limit, a.sends_today, a.sends_today_reset
                   FROM email_sends s
                   LEFT JOIN email_accounts a ON s.account_id = a.id
                   WHERE s.id = $1''',
                send_id,
            )

            if not send:
                logger.warning(f'Send {send_id} not found, removing from queue')
                await pool.execute('DELETE FROM email_queue WHERE id = $1', queue_item['id'])
                continue

            # HITL gate: only send approved (queued) items
            if send['status'] != 'queued':
                logger.warning(f'Send {send_id} status is "{send["status"]}" (not queued), skipping')
                await pool.execute('DELETE FROM email_queue WHERE id = $1', queue_item['id'])
                continue

            delegate_email = send['delegate_email']
            if not delegate_email:
                # Use default account
                default_account = await pool.fetchrow(
                    'SELECT * FROM email_accounts WHERE is_active = TRUE ORDER BY created_at LIMIT 1'
                )
                if not default_account:
                    raise RuntimeError('No active email account available')
                delegate_email = default_account['email_address']

            # Check daily send limit
            if send['sends_today_reset'] and send['sends_today_reset'] < now.date():
                # Reset counter for new day
                await pool.execute(
                    'UPDATE email_accounts SET sends_today = 0, sends_today_reset = $1 WHERE email_address = $2',
                    now.date(), delegate_email,
                )
            elif send.get('sends_today', 0) >= send.get('daily_send_limit', 500):
                logger.warning(f'Daily send limit reached for {delegate_email}, skipping')
                await pool.execute(
                    'UPDATE email_queue SET locked_at = NULL, locked_by = NULL WHERE id = $1',
                    queue_item['id'],
                )
                continue

            # Mark as sending
            await pool.execute(
                "UPDATE email_sends SET status = 'sending' WHERE id = $1",
                send_id,
            )

            # Send via Gmail
            from .gmail_client import send_email
            result = await send_email(
                delegate_email=delegate_email,
                to_email=send['recipient_email'],
                subject=send['subject'],
                body_html=send['body_html'] or '',
                body_text=send['body_text'] or '',
                from_name=send.get('from_name'),
                in_reply_to=send['in_reply_to'],
                thread_id=send['gmail_thread_id'],
            )

            # Update send record with Gmail IDs
            await pool.execute(
                '''UPDATE email_sends
                   SET status = 'sent', gmail_message_id = $1, gmail_thread_id = $2, sent_at = $3
                   WHERE id = $4''',
                result['message_id'], result['thread_id'], now, send_id,
            )

            # Update or create thread record
            await _upsert_thread(pool, send, result, delegate_email, now)

            # Increment account counter
            await pool.execute(
                'UPDATE email_accounts SET sends_today = sends_today + 1 WHERE email_address = $1',
                delegate_email,
            )

            # Increment campaign stats if applicable
            if send['campaign_id']:
                await pool.execute(
                    'UPDATE email_campaigns SET total_sent = total_sent + 1, updated_at = $1 WHERE id = $2',
                    now, send['campaign_id'],
                )

            # Remove from queue
            await pool.execute('DELETE FROM email_queue WHERE id = $1', queue_item['id'])

            _fire_event(
                'email.sent',
                entity_id=str(send_id),
                diff_summary=f'Email sent to {send["recipient_email"]}',
                payload={
                    'send_id': str(send_id),
                    'recipient': send['recipient_email'],
                    'tenant_id': send.get('tenant_id'),
                    'campaign_id': str(send['campaign_id']) if send['campaign_id'] else None,
                },
            )

            processed += 1
            logger.info(f'Sent email {send_id} to {send["recipient_email"]}')

        except Exception as e:
            logger.error(f'[email_queue] Failed to send {send_id}: {e}')
            attempts = queue_item['attempts'] + 1

            if attempts >= queue_item['max_attempts']:
                # Mark as failed
                await pool.execute(
                    "UPDATE email_sends SET status = 'failed', error_message = $1 WHERE id = $2",
                    str(e)[:500], send_id,
                )
                await pool.execute('DELETE FROM email_queue WHERE id = $1', queue_item['id'])
                logger.error(f'Send {send_id} failed permanently after {attempts} attempts')
            else:
                # Unlock and increment attempts for retry
                await pool.execute(
                    'UPDATE email_queue SET locked_at = NULL, locked_by = NULL, attempts = $1 WHERE id = $2',
                    attempts, queue_item['id'],
                )

    return processed


async def _upsert_thread(pool, send, gmail_result, delegate_email, now):
    """Create or update a thread record after sending."""
    thread_id = gmail_result['thread_id']
    if not thread_id:
        return

    account = await pool.fetchrow(
        'SELECT id FROM email_accounts WHERE email_address = $1', delegate_email
    )
    if not account:
        return

    existing = await pool.fetchrow(
        'SELECT id FROM email_threads WHERE gmail_thread_id = $1 AND account_id = $2',
        thread_id, account['id'],
    )

    if existing:
        await pool.execute(
            '''UPDATE email_threads
               SET message_count = message_count + 1, last_message_at = $1,
                   last_sender = 'us', updated_at = $1
               WHERE id = $2''',
            now, existing['id'],
        )
    else:
        await pool.execute(
            '''INSERT INTO email_threads (gmail_thread_id, account_id, recipient_email,
                   tenant_id, user_id, subject, message_count, last_message_at,
                   last_sender, status, campaign_id)
               VALUES ($1, $2, $3, $4, $5, $6, 1, $7, 'us', 'waiting_reply', $8)''',
            thread_id, account['id'], send['recipient_email'],
            send.get('tenant_id'), send.get('user_id'),
            send['subject'], now, send.get('campaign_id'),
        )


async def queue_loop():
    """Main loop — polls queue and processes batches."""
    logger.info(f'Email queue worker started (worker_id={WORKER_ID})')

    while True:
        try:
            count = await process_queue_batch()
            if count > 0:
                logger.info(f'Processed {count} queued emails')
                # If we processed a full batch, check again immediately
                if count >= BATCH_SIZE:
                    continue
        except Exception as e:
            logger.error(f'[queue_loop] Error: {e}')

        await asyncio.sleep(POLL_INTERVAL)
