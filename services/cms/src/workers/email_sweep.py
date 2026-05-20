"""
Email sweep worker — monitors Gmail inbox for replies and engagement.

Runs as an async background loop:
  1. For each sweep-enabled account, check inbox via History API
  2. Match incoming messages to existing sends/threads
  3. Record engagement events (replies, bounces)
  4. Queue uninterpreted replies for Claude classification
  5. Update thread state and emit automation events
  6. Auto-draft trigger-based responses for HITL review
  7. Detect content generation requests via email
"""
import asyncio
import json
import logging
import uuid as uuid_mod
from datetime import datetime, timezone

from ..models.database import get_pool, get_event_pool
from ..models.events import emit_event
from ..templates import (
    extract_trigger_flags,
    render_db_template,
    build_trigger_metadata,
    embed_trigger_flags,
    resolve_profile_variables,
)


def _fire_event(event_type: str, **kwargs):
    """Fire-and-forget event emission."""
    asyncio.create_task(emit_event(event_type, entity_type='email', **kwargs))

logger = logging.getLogger('cms.email_sweep')

SWEEP_INTERVAL = 300  # 5 minutes default

# ── Content Request Detection ─────────────────────────────────────────
CONTENT_REQUEST_ADDRESSES = {'content@rfppipeline.com', 'blog@rfppipeline.com'}
CONTENT_REQUEST_SUBJECT_PREFIX = '[CONTENT REQUEST]'


async def _check_content_request(message_headers: dict, body_text: str, pool) -> bool:
    """Check if an email is a content generation request and process it.

    Content requests are detected by:
      - Email sent TO a known content request address
      - Subject line starting with [CONTENT REQUEST]

    Returns True if the email was handled as a content request.
    """
    to_addr = message_headers.get('to', '').lower()
    subject = message_headers.get('subject', '')

    is_content_request = (
        any(addr in to_addr for addr in CONTENT_REQUEST_ADDRESSES)
        or subject.upper().startswith(CONTENT_REQUEST_SUBJECT_PREFIX)
    )

    if not is_content_request:
        return False

    # Extract category from subject if present
    category = 'blog_post'
    subject_upper = subject.upper()
    if '[TIP]' in subject_upper:
        category = 'tip'
    elif '[GUIDE]' in subject_upper:
        category = 'guide'
    elif '[RESOURCE]' in subject_upper:
        category = 'resource'

    # Clean up subject for prompt
    clean_subject = subject
    for prefix in ['[CONTENT REQUEST]', '[TIP]', '[GUIDE]', '[RESOURCE]', 'Re:', 'Fwd:']:
        clean_subject = clean_subject.replace(prefix, '').strip()

    gen_id = str(uuid_mod.uuid4())
    try:
        await pool.execute(
            """INSERT INTO cms_generations (id, prompt, category, source_type, source_content, status)
               VALUES ($1::uuid, $2, $3, 'email', $4, 'pending')""",
            gen_id, clean_subject or (body_text[:200] if body_text else 'Content request via email'),
            category, body_text or '',
        )
    except Exception as e:
        logger.error(f'[content_request] Failed to create generation from email: {e}')
        return False

    await emit_event(
        'content_pipeline.generation.requested_via_email',
        entity_type='generation',
        entity_id=gen_id,
        diff_summary=f'Content request via email: {clean_subject[:80]}',
        payload={'category': category, 'source': 'email_sweep'},
    )

    logger.info(f'Content request detected from email, created generation {gen_id}')
    return True


async def sweep_account(account_id: str, email_address: str, history_id: str | None) -> str | None:
    """
    Sweep a single account's inbox. Returns new history_id for incremental sync.
    """
    pool = get_pool()
    shared_pool = get_event_pool()
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

                # Check if this is a content generation request email
                # (before normal reply matching so it gets routed to generation)
                try:
                    is_content_req = await _check_content_request(headers, body_text, pool)
                    if is_content_req:
                        continue
                except Exception as content_err:
                    logger.error(f'[sweep] Content request check error for {msg_id}: {content_err}')

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
    shared_pool = get_event_pool()
    now = datetime.now(timezone.utc)

    rows = await pool.fetch(
        '''SELECT e.id, e.send_id, e.reply_body, e.metadata,
                  s.subject as original_subject, s.body_text as original_body_preview,
                  s.trigger_metadata
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

            # ── Trigger-based auto-response ──────────────────────
            # After interpreting the reply, check if the original send
            # has trigger metadata that enables auto-response.
            trigger_meta = row.get('trigger_metadata')
            if isinstance(trigger_meta, str):
                try:
                    trigger_meta = json.loads(trigger_meta)
                except (json.JSONDecodeError, TypeError):
                    trigger_meta = None

            if trigger_meta and trigger_meta.get('auto_response_enabled'):
                try:
                    # Build the send record as a dict for _auto_draft_response
                    send_record = await pool.fetchrow(
                        'SELECT * FROM email_sends WHERE id = $1',
                        row['send_id'],
                    )
                    if send_record:
                        reply_data = {
                            'sentiment': result.get('sentiment', 'neutral'),
                            'intent': result.get('intent', 'other'),
                            'reply_body': row['reply_body'],
                            'from': (json.loads(row['metadata']).get('from', '') if isinstance(row['metadata'], str) else row['metadata'].get('from', '')) if row.get('metadata') else '',
                            'subject': row.get('original_subject', ''),
                            'engagement_id': str(row['id']),
                        }
                        await _auto_draft_response(send_record, reply_data, pool, shared_pool)
                except Exception as auto_err:
                    logger.error(f'[interpret] Auto-response error for reply {row["id"]}: {auto_err}')

        except Exception as e:
            logger.error(f'[interpret] Error interpreting reply {row["id"]}: {e}')
            continue

    return count


async def _auto_draft_response(send_record, reply_data: dict, pool, shared_pool) -> bool:
    """
    Auto-draft a response based on trigger metadata from the original send.

    Steps:
      1. Look up the original template's response_map
      2. Map the reply classification to a response template
      3. Resolve profile variables
      4. Render the response template
      5. Queue for HITL review (email_outbox)
      6. Emit event to the appropriate namespace

    Args:
        send_record: asyncpg Record for the original email_sends row
        reply_data: dict with sentiment, intent, reply_body, from, subject, engagement_id
        pool: CMS database pool
        shared_pool: shared/main database pool (for profile resolution)

    Returns: True if auto-response was queued, False otherwise
    """
    import uuid as uuid_mod
    now = datetime.now(timezone.utc)

    try:
        # Get trigger metadata from the send
        trigger_meta = send_record.get('trigger_metadata')
        if isinstance(trigger_meta, str):
            trigger_meta = json.loads(trigger_meta)
        if not trigger_meta or not trigger_meta.get('auto_response_enabled'):
            return False

        # Get the original template to access response_map
        template_id = send_record.get('template_id')
        if not template_id:
            # Try to get template_id from trigger_metadata
            template_id_str = trigger_meta.get('template_id')
            if template_id_str:
                try:
                    template_id = uuid_mod.UUID(template_id_str)
                except (ValueError, AttributeError):
                    template_id = None

        if not template_id:
            logger.warning(f'[auto_draft] No template_id found for send {send_record["id"]}')
            return False

        original_template = await pool.fetchrow(
            'SELECT * FROM email_templates WHERE id = $1',
            template_id,
        )
        if not original_template:
            logger.warning(f'[auto_draft] Template {template_id} not found')
            return False

        # Get response_map from the original template
        response_map = original_template.get('response_map')
        if isinstance(response_map, str):
            response_map = json.loads(response_map)
        if not response_map:
            logger.debug(f'[auto_draft] No response_map on template {template_id}')
            return False

        # Map the classification to a response template
        classification = reply_data.get('intent') or reply_data.get('sentiment') or 'default'
        response_config = response_map.get(classification) or response_map.get('default')
        if not response_config:
            logger.debug(f'[auto_draft] No response mapping for classification "{classification}"')
            return False

        response_slug = response_config.get('template_slug')
        if not response_slug:
            logger.warning(f'[auto_draft] No template_slug in response config for "{classification}"')
            return False

        # Fetch the response template
        response_template = await pool.fetchrow(
            'SELECT * FROM email_templates WHERE slug = $1 AND is_active = TRUE',
            response_slug,
        )
        if not response_template:
            logger.warning(f'[auto_draft] Response template "{response_slug}" not found or inactive')
            return False

        # Resolve profile variables
        profile_vars = response_template.get('profile_variables') or []
        profile = {}
        if profile_vars and shared_pool:
            profile = await resolve_profile_variables(
                profile_variables=profile_vars,
                tenant_id=send_record.get('tenant_id'),
                user_email=send_record.get('recipient_email'),
                shared_pool=shared_pool,
            )

        # Build context for rendering
        render_context = {
            **profile,
            'original_subject': reply_data.get('subject', ''),
            'reply_body': reply_data.get('reply_body', ''),
            'reply_sentiment': reply_data.get('sentiment', ''),
            'reply_intent': reply_data.get('intent', ''),
        }

        # Render the response template
        rendered = await render_db_template(response_slug, render_context, pool, profile)
        if not rendered:
            logger.warning(f'[auto_draft] Failed to render response template "{response_slug}"')
            return False

        # Build trigger metadata for the response
        response_trigger_meta = build_trigger_metadata(
            template={
                'trigger_config': response_template.get('trigger_config') or {},
                'response_map': response_template.get('response_map') or {},
                'id': response_template['id'],
                'slug': response_template['slug'],
            },
            send_context={
                'send_id': '',  # will be filled after insert
                'tenant_id': send_record.get('tenant_id'),
                'campaign_id': str(send_record['campaign_id']) if send_record.get('campaign_id') else None,
                'template_id': str(response_template['id']),
            },
        )

        # Override the type to indicate this is a response
        if response_trigger_meta:
            ns = trigger_meta.get('namespace', 'capture')
            orig_type = trigger_meta.get('type', 'email')
            response_trigger_meta['namespace'] = ns
            response_trigger_meta['type'] = f'{orig_type}.responded'
            response_trigger_meta['in_response_to_send_id'] = str(send_record['id'])
            response_trigger_meta['reply_classification'] = classification

        # Determine priority from response_config
        priority_map = {'critical': 10, 'high': 20, 'medium': 50, 'low': 80}
        priority = priority_map.get(response_config.get('priority', 'medium'), 50)

        # Resolve default account
        default_account = await pool.fetchrow(
            'SELECT id FROM email_accounts WHERE is_active = TRUE ORDER BY created_at LIMIT 1'
        )
        default_account_id = default_account['id'] if default_account else None

        # Create the email_send record with pending_approval status
        send_row = await pool.fetchrow(
            '''INSERT INTO email_sends (
                   campaign_id, template_id, account_id,
                   recipient_email, recipient_name, tenant_id, user_id,
                   subject, body_html, body_text, template_variables,
                   in_reply_to, gmail_thread_id,
                   status, original_subject, original_body_html, original_body_text,
                   trigger_metadata
               ) VALUES (
                   $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb,
                   $12, $13,
                   'pending_approval', $8, $9, $10,
                   $14::jsonb
               ) RETURNING *''',
            send_record.get('campaign_id'),
            response_template['id'],
            send_record.get('account_id'),
            send_record['recipient_email'],
            send_record.get('recipient_name'),
            send_record.get('tenant_id'),
            send_record.get('user_id'),
            rendered['subject'],
            rendered['body_html'],
            rendered.get('body_text', ''),
            json.dumps(render_context),
            send_record.get('gmail_message_id'),  # in_reply_to the original message
            send_record.get('gmail_thread_id'),    # stay in the same thread
            json.dumps(response_trigger_meta) if response_trigger_meta else '{}',
        )

        # Update trigger_metadata with the actual send_id
        if response_trigger_meta and send_row:
            response_trigger_meta['send_id'] = str(send_row['id'])
            await pool.execute(
                'UPDATE email_sends SET trigger_metadata = $1::jsonb WHERE id = $2',
                json.dumps(response_trigger_meta), send_row['id'],
            )

        # Create outbox entry for HITL review
        await pool.execute(
            '''INSERT INTO email_outbox (
                   send_id, priority, category, recipient_preview,
                   subject_preview, default_account_id
               ) VALUES ($1, $2, $3, $4, $5, $6)''',
            send_row['id'],
            priority,
            'auto_response',
            f'{send_record.get("recipient_name", "")} <{send_record["recipient_email"]}>',
            rendered['subject'][:120],
            default_account_id,
        )

        # Emit event to the namespace from trigger metadata
        ns = trigger_meta.get('namespace', 'capture')
        orig_type = trigger_meta.get('type', 'email')
        event_type = f'{ns}.{orig_type}.reply_received'

        _fire_event(
            event_type,
            entity_id=str(send_record['id']),
            diff_summary=f'Auto-response queued for {classification} reply to {send_record["recipient_email"]}',
            payload={
                'send_id': str(send_record['id']),
                'reply_classification': classification,
                'auto_response_queued': True,
                'response_send_id': str(send_row['id']),
                'response_template_slug': response_slug,
                'tenant_id': send_record.get('tenant_id'),
                'template_slug': original_template['slug'],
            },
        )

        logger.info(
            f'[auto_draft] Queued auto-response "{response_slug}" for {classification} reply '
            f'to send {send_record["id"]} (new send: {send_row["id"]})'
        )
        return True

    except Exception as e:
        logger.error(f'[auto_draft] Error drafting response for send {send_record["id"]}: {e}')
        return False


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
