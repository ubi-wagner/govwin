"""CMS-01 regression tests — social_poster NotImplementedError handling.

Verifies:
- NotImplementedError from a platform adapter marks the post as 'failed'
  with error_message='oauth_not_configured' (not the raw exception text).
- The loop continues after the stub failure — sibling posts are still processed.
- Other (non-NotImplementedError) adapter exceptions go through the retry path.
- social_loop itself does not propagate adapter errors (process-level stability).

Adapter dispatch note: process_scheduled_posts looks up the adapter via
  PLATFORM_ADAPTERS.get(platform)
so patches must target PLATFORM_ADAPTERS (the dict), not the individual
adapter functions. Patching `linkedin_post` alone won't intercept the call
because PLATFORM_ADAPTERS already holds the original reference at import time.
"""
import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_post(post_id='post-1', platform='linkedin', retry_count=0, account_id='acct-1'):
    """Return a dict that mimics an asyncpg Record row."""
    return {
        'id': post_id,
        'platform': platform,
        'social_account_id': account_id,
        'post_text': 'Hello LinkedIn!',
        'link_url': None,
        'retry_count': retry_count,
    }


def _make_account(account_id='acct-1', status='active', token_expires_at=None):
    return {
        'id': account_id,
        'status': status,
        'access_token': 'tok',
        'platform_account_id': 'org-123',
        'token_expires_at': token_expires_at,
    }


async def _raise_not_implemented(*_):
    raise NotImplementedError('Adapter stub — OAuth not configured')


# ---------------------------------------------------------------------------
# CMS-01 core: NotImplementedError → status='failed', reason='oauth_not_configured'
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_not_implemented_sets_failed_with_oauth_reason():
    """A NotImplementedError from the adapter marks the post 'failed'
    with error_message='oauth_not_configured', not the raw exception text."""
    from src.workers.social_poster import process_scheduled_posts

    post = _make_post()
    account = _make_account()

    cms_pool = AsyncMock()
    cms_pool.fetch = AsyncMock(return_value=[post])
    cms_pool.fetchrow = AsyncMock(return_value=account)
    cms_pool.execute = AsyncMock()

    fake_adapters = {'linkedin': _raise_not_implemented}

    with patch('src.workers.social_poster.get_pool', return_value=cms_pool), \
         patch('src.workers.social_poster.PLATFORM_ADAPTERS', fake_adapters), \
         patch('src.workers.social_poster.asyncio.create_task'):

        count = await process_scheduled_posts()

    # Should have called execute to mark post failed
    execute_calls = cms_pool.execute.call_args_list
    assert len(execute_calls) >= 1, "Expected at least one execute() call"

    # Find the UPDATE call that sets status='failed'
    failed_call = next(
        (c for c in execute_calls if 'failed' in str(c.args[0])),
        None,
    )
    assert failed_call is not None, "Expected an UPDATE...SET status='failed' call"
    # The error_message argument (second positional param after SQL) must be 'oauth_not_configured'
    error_message_arg = failed_call.args[1]
    assert error_message_arg == 'oauth_not_configured', (
        f"Expected 'oauth_not_configured', got {error_message_arg!r}"
    )


@pytest.mark.asyncio
async def test_not_implemented_does_not_count_as_processed():
    """A post that raises NotImplementedError is NOT counted as successfully processed."""
    from src.workers.social_poster import process_scheduled_posts

    post = _make_post()
    account = _make_account()

    cms_pool = AsyncMock()
    cms_pool.fetch = AsyncMock(return_value=[post])
    cms_pool.fetchrow = AsyncMock(return_value=account)
    cms_pool.execute = AsyncMock()

    fake_adapters = {'linkedin': _raise_not_implemented}

    with patch('src.workers.social_poster.get_pool', return_value=cms_pool), \
         patch('src.workers.social_poster.PLATFORM_ADAPTERS', fake_adapters), \
         patch('src.workers.social_poster.asyncio.create_task'):

        count = await process_scheduled_posts()

    assert count == 0


@pytest.mark.asyncio
async def test_loop_continues_after_not_implemented():
    """A NotImplementedError on post-1 does not prevent post-2 from being processed."""
    from src.workers.social_poster import process_scheduled_posts

    post1 = _make_post(post_id='post-1', platform='linkedin')
    post2 = _make_post(post_id='post-2', platform='twitter')
    account = _make_account()

    cms_pool = AsyncMock()
    cms_pool.fetch = AsyncMock(return_value=[post1, post2])
    cms_pool.fetchrow = AsyncMock(return_value=account)
    cms_pool.execute = AsyncMock()

    call_log = []

    async def fake_linkedin(account, post):
        call_log.append(('linkedin', post['id']))
        raise NotImplementedError('LinkedIn stub')

    async def fake_twitter(account, post):
        call_log.append(('twitter', post['id']))
        raise NotImplementedError('Twitter stub')

    fake_adapters = {'linkedin': fake_linkedin, 'twitter': fake_twitter}

    with patch('src.workers.social_poster.get_pool', return_value=cms_pool), \
         patch('src.workers.social_poster.PLATFORM_ADAPTERS', fake_adapters), \
         patch('src.workers.social_poster.asyncio.create_task'):

        count = await process_scheduled_posts()

    # Both adapters were attempted despite first one raising NotImplementedError
    adapter_ids = [entry[1] for entry in call_log]
    assert 'post-1' in adapter_ids, "post-1 was not attempted"
    assert 'post-2' in adapter_ids, "post-2 was not attempted — loop stopped early"


@pytest.mark.asyncio
async def test_both_linkedin_and_twitter_set_oauth_reason():
    """Both LinkedIn and Twitter stub adapters set error_message='oauth_not_configured'."""
    from src.workers.social_poster import process_scheduled_posts

    for platform in ('linkedin', 'twitter'):
        post = _make_post(platform=platform)
        account = _make_account()

        cms_pool = AsyncMock()
        cms_pool.fetch = AsyncMock(return_value=[post])
        cms_pool.fetchrow = AsyncMock(return_value=account)
        cms_pool.execute = AsyncMock()

        fake_adapters = {platform: _raise_not_implemented}

        with patch('src.workers.social_poster.get_pool', return_value=cms_pool), \
             patch('src.workers.social_poster.PLATFORM_ADAPTERS', fake_adapters), \
             patch('src.workers.social_poster.asyncio.create_task'):

            await process_scheduled_posts()

        failed_call = next(
            (c for c in cms_pool.execute.call_args_list if 'failed' in str(c.args[0])),
            None,
        )
        assert failed_call is not None, f"No failed UPDATE for {platform}"
        assert failed_call.args[1] == 'oauth_not_configured', (
            f"Platform {platform}: expected 'oauth_not_configured', got {failed_call.args[1]!r}"
        )


@pytest.mark.asyncio
async def test_other_exception_uses_retry_path():
    """Non-NotImplementedError exceptions use the retry path (not oauth_not_configured).

    Patches PLATFORM_ADAPTERS so the non-NotImplementedError exception
    actually reaches the retry branch.
    """
    from src.workers.social_poster import process_scheduled_posts

    post = _make_post(retry_count=0, platform='linkedin')
    account = _make_account()

    cms_pool = AsyncMock()
    cms_pool.fetch = AsyncMock(return_value=[post])
    cms_pool.fetchrow = AsyncMock(return_value=account)
    cms_pool.execute = AsyncMock()

    async def _raise_runtime(*_):
        raise RuntimeError('network timeout')

    fake_adapters = {'linkedin': _raise_runtime}

    with patch('src.workers.social_poster.get_pool', return_value=cms_pool), \
         patch('src.workers.social_poster.PLATFORM_ADAPTERS', fake_adapters), \
         patch('src.workers.social_poster.asyncio.create_task'):

        count = await process_scheduled_posts()

    # Should reschedule for retry (retry_count=0 < MAX_RETRIES=3)
    execute_calls = cms_pool.execute.call_args_list
    assert len(execute_calls) >= 1
    # The rescheduled call should NOT have 'oauth_not_configured'
    all_args = str(execute_calls)
    assert 'oauth_not_configured' not in all_args, (
        f"Should not use oauth_not_configured for RuntimeError; calls: {execute_calls}"
    )
    # Should set status back to 'scheduled' for retry
    rescheduled = any("'scheduled'" in str(c) for c in execute_calls)
    assert rescheduled, f"Expected a rescheduled UPDATE; calls: {execute_calls}"


@pytest.mark.asyncio
async def test_max_retries_exceeded_marks_permanently_failed():
    """After MAX_RETRIES, a RuntimeError post is permanently failed (no more rescheduling)."""
    from src.workers.social_poster import process_scheduled_posts, MAX_RETRIES

    post = _make_post(retry_count=MAX_RETRIES - 1, platform='linkedin')
    account = _make_account()

    cms_pool = AsyncMock()
    cms_pool.fetch = AsyncMock(return_value=[post])
    cms_pool.fetchrow = AsyncMock(return_value=account)
    cms_pool.execute = AsyncMock()

    async def _raise_runtime(*_):
        raise RuntimeError('persistent failure')

    fake_adapters = {'linkedin': _raise_runtime}

    with patch('src.workers.social_poster.get_pool', return_value=cms_pool), \
         patch('src.workers.social_poster.PLATFORM_ADAPTERS', fake_adapters), \
         patch('src.workers.social_poster.asyncio.create_task'):

        await process_scheduled_posts()

    execute_calls = cms_pool.execute.call_args_list
    # Should NOT reschedule — should permanently fail
    rescheduled = any("'scheduled'" in str(c) for c in execute_calls)
    assert not rescheduled, "Should NOT reschedule when max retries exceeded"
    failed_permanently = any(
        'failed' in str(c.args[0]) and "'scheduled'" not in str(c)
        for c in execute_calls
    )
    assert failed_permanently, f"Expected permanent failure UPDATE; calls: {execute_calls}"


@pytest.mark.asyncio
async def test_social_loop_does_not_raise_on_adapter_error():
    """social_loop itself must not propagate exceptions — it is a stable loop."""
    from src.workers import social_poster

    call_count = 0

    async def fake_process():
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise RuntimeError('unexpected adapter crash')
        # Cancel after second iteration to stop the infinite loop
        raise asyncio.CancelledError()

    with patch.object(social_poster, 'process_scheduled_posts', side_effect=fake_process), \
         patch.object(social_poster.asyncio, 'sleep', new_callable=AsyncMock):

        try:
            await social_poster.social_loop()
        except asyncio.CancelledError:
            pass  # expected termination

    assert call_count == 2, f"Loop should have continued after error; call_count={call_count}"


@pytest.mark.asyncio
async def test_no_rows_returns_zero():
    """When no posts are due, process_scheduled_posts returns 0 without calling adapters."""
    from src.workers.social_poster import process_scheduled_posts

    cms_pool = AsyncMock()
    cms_pool.fetch = AsyncMock(return_value=[])
    cms_pool.execute = AsyncMock()

    with patch('src.workers.social_poster.get_pool', return_value=cms_pool):
        count = await process_scheduled_posts()

    assert count == 0
    cms_pool.execute.assert_not_called()


@pytest.mark.asyncio
async def test_pool_unavailable_returns_zero():
    """If get_pool raises RuntimeError (not initialised), return 0 gracefully."""
    from src.workers.social_poster import process_scheduled_posts

    with patch('src.workers.social_poster.get_pool', side_effect=RuntimeError('pool not ready')):
        count = await process_scheduled_posts()

    assert count == 0
