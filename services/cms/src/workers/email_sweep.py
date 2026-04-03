"""
Email sweep worker — monitors Gmail inbox for replies and engagement.

Runs as an async background loop:
  1. For each sweep-enabled account, check inbox via History API
  2. Match incoming messages to existing sends/threads
  3. Record engagement events (replies, bounces)
  4. Queue uninterpreted replies for Claude classification
  5. Update thread state and emit automation events
"""
import asyncio
import json
import logging
from datetime import datetime, timezone

from ..models.database import get_pool
from ..models.events import emit_event


def _fire_event(event_type: str, **kwargs):
    """Fire-and-forget event emission."""
    asyncio.create_task(emit_event(event_type, entity_type='email', **kwargs))

logger = logging.getLogger('cms.email_sweep')

SWEEP_INTERVAL = 300  # 5 minutes default


async def sweep_account(account_id: str, email_address: str, history_id: str | None) -> str | None:
    """
    Sweep a single account's inbox. Returns new history_id for incremental sync.
    """
    pool = get_pool()
    now = datetime.now(timezone.utc)

    try:
        from .gmail_client import sweep_inbox, get_message, extract_headers, extract_body_text

        result = await sweep_inbox(
            delegate_email=email_address,
            history_id=history_id,
            max_results=100,
        )

        messages = result.get('messages', [])
        new_history_id = result.get('new_history_id', history_id)

        if not messages:
            return new_history_id

        logger.info(f'Sweep {email_address}: {len(messages)} new messages')

        for msg_stub in messages:
            msg_id = msg_stub.get('id')
            if not msg_id:
                continue

            try:
                full_msg = await get_message(email_address, msg_id)
                headers = extract_headers(full_msg)
                body_text = extract_body_text(full_msg)

                from_addr = headers.get('from', '')
                subject = headers.get('subject', '')
                in_reply_to = headers.get('in-reply-to', '')
                gmail_thread_id = full_msg.get('threadId', '')

                # Skip messages we sent ourselves
                if email_address.lower() in from_addr.lower():
                    continue

                # Try to match to an existing send via thread ID or in-reply-to
                matched_send = None
                if gmail_thread_id:
                    matched_send = await pool.fetchrow(
                        'SELECT * FROM email_sends WHERE gmail_thread_id = $1 ORDER BY created_at DESC LIMIT 1',
                        gmail_thread_id,
                    )
                if not matched_send and in_reply_to:
                    matched_send = await pool.fetchrow(
                        'SELECT * FROM email_sends WHERE gmail_message_id = $1',
                        in_reply_to,
                    )

                if not matched_send:
                    logger.debug(f'No matching send for message {msg_id} from {from_addr}')
                    continue

                # Check if we already recorded this engagement
                existing = await pool.fetchrow(
                    "SELECT id FROM email_engagement WHERE send_id = $1 AND engagement_type = 'reply' AND metadata->>'gmail_message_id' = $2",
                    matched_send['id'], msg_id,
                )
                if existing:
                    continue

                # Record reply engagement
                await pool.execute(
                    '''INSERT INTO email_engagement (send_id, campaign_id, engagement_type,
                           metadata, reply_body, tenant_id, user_id)
                       VALUES ($1, $2, 'reply', $3::jsonb, $4, $5, $6)''',
                    matched_send['id'],
                    matched_send.get('campaign_id'),
                    json.dumps({
                        'gmail_message_id': msg_id,
                        'from': from_addr,
                        'subject': subject,
                        'body_preview': body_text[:200] if body_text else '',
                    }),
                    body_text[:5000] if body_text else None,
                    matched_send.get('tenant_id'),
                    matched_send.get('user_id'),
                )

                # Update thread
                await _update_thread_on_reply(
                    pool, account_id, gmail_thread_id,
                    matched_send, from_addr, subject, now,
                )

                # Update campaign stats
                if matched_send.get('campaign_id'):
                    await pool.execute(
                        'UPDATE email_campaigns SET total_replied = total_replied + 1, updated_at = $1 WHERE id = $2',
                        now, matched_send['campaign_id'],
                    )

                _fire_event(
                    'email.reply.received',
                    entity_id=str(matched_send['id']),
                    diff_summary=f'Reply received from {from_addr}',
                    payload={
                        'send_id': str(matched_send['id']),
                        'recipient': matched_send['recipient_email'],
                        'from': from_addr,
                        'tenant_id': matched_send.get('tenant_id'),
                        'campaign_id': str(matched_send['campaign_id']) if matched_send.get('campaign_id') else None,
                    },
                )

                logger.info(f'Reply recorded: {msg_id} from {from_addr} (send: {matched_send["id"]})')

            except Exception as e:
                logger.error(f'[sweep] Error processing message {msg_id}: {e}')
                continue

        # Update account sweep state
        await pool.execute(
            'UPDATE email_accounts SET last_sweep_at = $1, sweep_history_id = $2, updated_at = $1 WHERE id = $3',
            now, new_history_id, account_id,
        )

        return new_history_id

    except Exception as e:
        logger.error(f'[sweep_account] Error sweeping {email_address}: {e}')
        return history_id


async def _update_thread_on_reply(pool, account_id, gmail_thread_id, send, from_addr, subject, now):
    """Update thread record when a reply is received."""
    if not gmail_thread_id:
        return

    existing = await pool.fetchrow(
        'SELECT id FROM email_threads WHERE gmail_thread_id = $1 AND account_id = $2',
        gmail_thread_id, account_id,
    )

    if existing:
        await pool.execute(
            '''UPDATE email_threads
               SET message_count = message_count + 1, last_message_at = $1,
                   last_sender = 'them', status = 'needs_attention', updated_at = $1
               WHERE id = $2''',
            now, existing['id'],
        )
    else:
        await pool.execute(
            '''INSERT INTO email_threads (gmail_thread_id, account_id, recipient_email,
                   tenant_id, user_id, subject, message_count, last_message_at,
                   last_sender, status, campaign_id)
               VALUES ($1, $2, $3, $4, $5, $6, 1, $7, 'them', 'needs_attention', $8)''',
            gmail_thread_id, account_id, send['recipient_email'],
            send.get('tenant_id'), send.get('user_id'),
            subject or send.get('subject'), now, send.get('campaign_id'),
        )


async def interpret_unprocessed_replies():
    """Find uninterpreted replies and classify them with Claude."""
    pool = get_pool()
    now = datetime.now(timezone.utc)

    rows = await pool.fetch(
        '''SELECT e.id, e.send_id, e.reply_body, e.metadata,
                  s.subject as original_subject, s.body_text as original_body_preview
           FROM email_engagement e
           JOIN email_sends s ON e.send_id = s.id
           WHERE e.engagement_type = 'reply'
             AND e.reply_interpreted = FALSE
             AND e.reply_body IS NOT NULL
           ORDER BY e.created_at
           LIMIT 20''',
    )

    if not rows:
        return 0

    from .template_drafter import interpret_reply

    count = 0
    for row in rows:
        try:
            result = await interpret_reply(
                reply_body=row['reply_body'],
                original_subject=row.get('original_subject'),
                original_body_preview=row.get('original_body_preview'),
            )

            await pool.execute(
                '''UPDATE email_engagement
                   SET reply_sentiment = $1, reply_intent = $2,
                       reply_interpreted = TRUE, reply_interpreted_at = $3
                   WHERE id = $4''',
                result.get('sentiment', 'neutral'),
                result.get('intent', 'other'),
                now, row['id'],
            )

            # Emit event for automation triggers
            _fire_event(
                'email.reply.interpreted',
                entity_id=str(row['id']),
                diff_summary=f'Reply interpreted: {result.get("sentiment")}/{result.get("intent")}',
                payload={
                    'engagement_id': str(row['id']),
                    'send_id': str(row['send_id']),
                    'sentiment': result.get('sentiment'),
                    'intent': result.get('intent'),
                    'action_needed': result.get('action_needed', False),
                    'summary': result.get('summary', ''),
                },
            )

            count += 1
            logger.info(f'Interpreted reply {row["id"]}: {result.get("sentiment")}/{result.get("intent")}')

        except Exception as e:
            logger.error(f'[interpret] Error interpreting reply {row["id"]}: {e}')
            continue

    return count


async def sweep_loop():
    """Main loop — sweeps all enabled accounts and interprets replies."""
    logger.info('Email sweep worker started')

    while True:
        try:
            pool = get_pool()

            # Get all sweep-enabled accounts
            accounts = await pool.fetch(
                'SELECT id, email_address, sweep_history_id FROM email_accounts WHERE sweep_enabled = TRUE AND is_active = TRUE'
            )

            for account in accounts:
                await sweep_account(
                    account_id=str(account['id']),
                    email_address=account['email_address'],
                    history_id=account.get('sweep_history_id'),
                )

            # Interpret any unprocessed replies
            interpreted = await interpret_unprocessed_replies()
            if interpreted > 0:
                logger.info(f'Interpreted {interpreted} replies')

        except Exception as e:
            logger.error(f'[sweep_loop] Error: {e}')

        await asyncio.sleep(SWEEP_INTERVAL)
