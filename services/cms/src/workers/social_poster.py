"""
Social media posting worker — publishes scheduled posts to platform APIs.

Runs as an async background loop:
  1. Poll social_posts where scheduled_at <= now() AND status = 'scheduled'
  2. Lock each post, dispatch to platform adapter
  3. On success: update status='posted', store platform_post_id
  4. On failure: retry up to 3 times, then mark as 'failed'

Social posts and accounts live in Main Postgres (shared DB / event bridge pool).
"""
import asyncio
import json
import logging
import os
from datetime import datetime, timedelta, timezone

from ..models.database import get_event_pool
from ..models.events import emit_event

logger = logging.getLogger('cms.social_poster')

WORKER_ID = f'social-{os.getpid()}'
POLL_INTERVAL = 60  # seconds
BATCH_SIZE = 10
MAX_RETRIES = 3
RETRY_DELAY_MINUTES = 5


def _fire_event(event_type: str, **kwargs):
    """Fire-and-forget event emission."""
    asyncio.create_task(emit_event(event_type, entity_type='social', **kwargs))


# ── Platform Adapters ──────────────────────────────────────────────

async def linkedin_post(account: dict, post: dict) -> dict:
    """
    Post to LinkedIn via API v2 ugcPosts endpoint.

    TODO: Complete OAuth token exchange and actual API call.
    For V1, this builds the full request structure but does not send.
    """
    access_token = account.get('access_token')
    if not access_token:
        raise RuntimeError('LinkedIn account has no access token')

    platform_account_id = account.get('platform_account_id')
    if not platform_account_id:
        raise RuntimeError('LinkedIn account has no platform_account_id (organization URN)')

    # Build ugcPost payload per LinkedIn API v2
    ugc_payload = {
        'author': f'urn:li:organization:{platform_account_id}',
        'lifecycleState': 'PUBLISHED',
        'specificContent': {
            'com.linkedin.ugc.ShareContent': {
                'shareCommentary': {
                    'text': post['post_text'],
                },
                'shareMediaCategory': 'NONE',
            },
        },
        'visibility': {
            'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
        },
    }

    # If there's a link_url, attach it as media
    if post.get('link_url'):
        ugc_payload['specificContent']['com.linkedin.ugc.ShareContent']['shareMediaCategory'] = 'ARTICLE'
        ugc_payload['specificContent']['com.linkedin.ugc.ShareContent']['media'] = [{
            'status': 'READY',
            'originalUrl': post['link_url'],
        }]

    # TODO: Make actual HTTP request when OAuth is wired
    # headers = {
    #     'Authorization': f'Bearer {access_token}',
    #     'Content-Type': 'application/json',
    #     'X-Restli-Protocol-Version': '2.0.0',
    # }
    # async with httpx.AsyncClient() as client:
    #     resp = await client.post(
    #         'https://api.linkedin.com/v2/ugcPosts',
    #         headers=headers,
    #         json=ugc_payload,
    #     )
    #     resp.raise_for_status()
    #     return {'platform_post_id': resp.json().get('id', '')}

    logger.info(f'LinkedIn post prepared (stub): {json.dumps(ugc_payload)[:200]}...')
    raise NotImplementedError(
        'LinkedIn API posting not yet implemented — OAuth token exchange pending'
    )


async def twitter_post(account: dict, post: dict) -> dict:
    """Post to Twitter/X. Not yet implemented."""
    raise NotImplementedError('Twitter/X posting not yet implemented')


PLATFORM_ADAPTERS = {
    'linkedin': linkedin_post,
    'twitter': twitter_post,
}


# ── Worker Logic ───────────────────────────────────────────────────

async def process_scheduled_posts() -> int:
    """Process posts that are due for publishing. Returns count processed."""
    shared_pool = get_event_pool()
    if not shared_pool:
        return 0

    now = datetime.now(timezone.utc)

    # Lock a batch of scheduled posts that are due
    rows = await shared_pool.fetch(
        '''UPDATE social_posts SET status = 'posting', updated_at = $1
           WHERE id IN (
               SELECT id FROM social_posts
               WHERE status = 'scheduled'
                 AND scheduled_at IS NOT NULL
                 AND scheduled_at <= $1
               ORDER BY scheduled_at ASC
               LIMIT $2
               FOR UPDATE SKIP LOCKED
           )
           RETURNING *''',
        now, BATCH_SIZE,
    )

    if not rows:
        return 0

    processed = 0
    for post in rows:
        post_id = post['id']
        platform = post['platform']

        try:
            # Look up the social account for credentials
            account = await shared_pool.fetchrow(
                'SELECT * FROM social_accounts WHERE id = $1',
                post['social_account_id'],
            )

            if not account:
                raise RuntimeError(f'Social account {post["social_account_id"]} not found')

            if account['status'] != 'active':
                raise RuntimeError(f'Social account {account["id"]} is {account["status"]}, not active')

            # Check token expiry — warn if expiring soon
            token_expires = account.get('token_expires_at')
            if token_expires and token_expires < now:
                raise RuntimeError(f'Access token for account {account["id"]} has expired')

            # Dispatch to platform adapter
            adapter = PLATFORM_ADAPTERS.get(platform)
            if not adapter:
                raise RuntimeError(f'No adapter for platform: {platform}')

            result = await adapter(account, dict(post))

            # Success — update post
            await shared_pool.execute(
                '''UPDATE social_posts
                   SET status = 'posted', posted_at = $1,
                       platform_post_id = $2, error_message = NULL, updated_at = $1
                   WHERE id = $3''',
                now, result.get('platform_post_id', ''), post_id,
            )

            _fire_event(
                'social.post.published',
                entity_id=str(post_id),
                diff_summary=f'Posted to {platform}: {post["post_text"][:80]}',
                payload={
                    'post_id': str(post_id),
                    'platform': platform,
                    'platform_post_id': result.get('platform_post_id', ''),
                    'account_id': str(post['social_account_id']),
                },
            )

            processed += 1
            logger.info(f'Posted {post_id} to {platform}')

        except NotImplementedError as e:
            # Platform not yet implemented — don't retry, mark as failed
            await shared_pool.execute(
                '''UPDATE social_posts
                   SET status = 'failed', error_message = $1, updated_at = $2
                   WHERE id = $3''',
                str(e)[:500], now, post_id,
            )
            logger.warning(f'Post {post_id} failed (not implemented): {e}')

        except Exception as e:
            logger.error(f'[social_poster] Error posting {post_id}: {e}')
            retry_count = (post.get('retry_count') or 0) + 1

            if retry_count < MAX_RETRIES:
                # Reschedule for retry
                retry_at = now + timedelta(minutes=RETRY_DELAY_MINUTES)
                await shared_pool.execute(
                    '''UPDATE social_posts
                       SET status = 'scheduled', retry_count = $1,
                           scheduled_at = $2, error_message = $3, updated_at = $4
                       WHERE id = $5''',
                    retry_count, retry_at, str(e)[:500], now, post_id,
                )
                logger.info(f'Post {post_id} rescheduled for retry {retry_count}/{MAX_RETRIES} at {retry_at}')
            else:
                # Max retries exceeded — mark as failed
                await shared_pool.execute(
                    '''UPDATE social_posts
                       SET status = 'failed', retry_count = $1,
                           error_message = $2, updated_at = $3
                       WHERE id = $4''',
                    retry_count, str(e)[:500], now, post_id,
                )
                logger.error(f'Post {post_id} failed permanently after {retry_count} attempts')

    return processed


async def social_loop():
    """Main loop — polls scheduled social posts and dispatches to platform adapters."""
    logger.info(f'Social poster started (worker_id={WORKER_ID})')

    while True:
        try:
            count = await process_scheduled_posts()
            if count > 0:
                logger.info(f'Published {count} social posts')
        except Exception as e:
            logger.error(f'[social_loop] Error: {e}')

        await asyncio.sleep(POLL_INTERVAL)
