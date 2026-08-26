"""The `email_send_ledger` ledger and suppression list, from the CRM.

Same two tables as the frontend seam writes (migration 215, MAIN database) — reached through the
existing `SHARED_DATABASE_URL` event-bridge pool, so this needs no new connection and no
cross-service call. One ledger, both halves of the platform.

── WHY THIS DEGRADES WHERE THE FRONTEND REFUSES ──────────────────────────────────────────────
The TypeScript seam REFUSES to send when it cannot reserve: without the reservation it cannot tell
a first send from a replay, and there is no other guard.

The CRM already has one. `_check_dedup()` in `event_listener.py` has always suppressed a repeated
action for the same `trigger_event_id` against `automation_log`. So a ledger failure here costs the
NEW layer, not the ONLY layer — and failing closed would mean a single misconfigured connection
string silences every customer notification on the platform, which is a far worse outcome than the
duplicate it would be preventing.

So: degrade, send, and shout. `SendResult.degraded` is set, an error is logged on every send, and
the operator has a specific remedy to act on rather than an absence of mail to notice.

── THE PRIVILEGE THIS NEEDS, WHICH IS NOT THE ONE THE BRIDGE HAS TODAY ───────────────────────
Migration 215 gives `email_send_ledger` a SELECT policy and NO write policy, and `email_suppressions` no
policy at all. On the NOBYPASSRLS `govtech_app` role both writes raise 42501. The bridge has
historically written `system_events` and `cms_content`, neither of which has RLS, so nothing has
established which role `SHARED_DATABASE_URL` actually carries.

That is why the 42501 branch below names the remedy explicitly instead of logging "permission
denied". A configuration defect that presents as silence is the failure mode this whole build is
trying to remove.
"""
from __future__ import annotations

import logging
import uuid
from typing import Optional

logger = logging.getLogger('cms.mailer.ledger')

#: Printed once per process rather than once per send — a misconfiguration produces one legible
#: error, not a log flooded with the same line.
_warned_unwritable = False


def normalize_address(email: str) -> str:
    """Addresses are compared lower-cased.

    `email_suppressions.email` carries `CHECK (email = lower(email))` so a mixed-case row cannot
    exist to be missed — but the LOOKUP has to normalise too, or the check only protects one side
    of the comparison.
    """
    return (email or '').strip().lower()


def _pool():
    """The shared-database pool, or None when the bridge is not configured."""
    from ..models.database import get_event_pool
    return get_event_pool()


def _note_unwritable(err: Exception) -> None:
    global _warned_unwritable
    if _warned_unwritable:
        return
    _warned_unwritable = True
    code = getattr(err, 'sqlstate', None)
    if code == '42501':
        logger.error(
            'email ledger is NOT WRITABLE by this connection (SQLSTATE 42501). Migration 215 gives '
            'email_send_ledger no write policy, so the NOBYPASSRLS app role is refused by design. Point '
            'SHARED_DATABASE_URL at the owner role, or grant this role an explicit write policy. '
            'Until then every send runs DEGRADED: mail goes out, but with no idempotency '
            'reservation — the only replay guard left is _check_dedup() on automation_log.'
        )
    else:
        logger.error('email ledger unavailable (%s: %s) — sends run DEGRADED, without an '
                     'idempotency reservation.', type(err).__name__, err)


async def suppression_for(email: str) -> Optional[str]:
    """Is this address suppressed? Returns the reason, or None.

    Fails OPEN, unlike `reserve()`. A suppression list we cannot read is a deliverability risk; a
    notification refused because a read failed is a broken product.
    """
    pool = _pool()
    if not pool:
        return None
    try:
        row = await pool.fetchrow(
            'SELECT reason FROM email_suppressions WHERE email = $1 LIMIT 1',
            normalize_address(email),
        )
        return row['reason'] if row else None
    except Exception as e:                                   # noqa: BLE001 — logged, never raised
        _note_unwritable(e)
        return None


async def reserve(
    *,
    correlation_id: str,
    idempotency_key: str,
    tenant_id: Optional[str],
    provider: str,
    kind: str,
    to_email: str,
    subject: str,
    template: Optional[str],
    metadata: dict,
) -> tuple[str, Optional[str]]:
    """Reserve the send BEFORE dispatch.

    Returns ``(outcome, send_id)`` where outcome is one of:
        'ok'        — reserved; `send_id` is the row
        'duplicate' — the key is taken by a pending or completed send; DO NOT dispatch
        'degraded'  — the ledger could not be written; dispatch anyway, see the module header

    A row that already exists and reads `failed` is RECLAIMED by compare-and-swap, so a transient
    provider outage does not permanently burn its idempotency key.
    """
    import json

    pool = _pool()
    if not pool:
        return ('degraded', None)
    try:
        row = await pool.fetchrow(
            """
            INSERT INTO email_send_ledger
              (correlation_id, idempotency_key, tenant_id, provider, kind, status, to_email,
               subject, template, metadata)
            VALUES ($1::uuid, $2, $3::uuid, $4, $5, 'pending', $6, $7, $8, $9::jsonb)
            ON CONFLICT (idempotency_key) DO NOTHING
            RETURNING id
            """,
            correlation_id, idempotency_key, tenant_id, provider, kind, to_email,
            subject, template, json.dumps(metadata or {}),
        )
        if row:
            return ('ok', str(row['id']))

        reclaimed = await pool.fetchrow(
            """
            UPDATE email_send_ledger
               SET status = 'pending', error = NULL, provider = $2, correlation_id = $3::uuid
             WHERE idempotency_key = $1 AND status = 'failed'
            RETURNING id
            """,
            idempotency_key, provider, correlation_id,
        )
        if reclaimed:
            return ('ok', str(reclaimed['id']))
        return ('duplicate', None)
    except Exception as e:                                   # noqa: BLE001
        _note_unwritable(e)
        return ('degraded', None)


async def confirm(
    *, send_id: str, status: str, provider: str,
    provider_message_id: Optional[str], error: Optional[str],
) -> None:
    """Record the outcome against a reserved row.

    Best-effort: the message has already gone, and raising here would turn a bookkeeping failure
    into a caller-visible send failure for a send that actually succeeded. The one thing that must
    not happen is silence.
    """
    pool = _pool()
    if not pool or not send_id:
        return
    try:
        await pool.execute(
            """
            UPDATE email_send_ledger
               SET status = $2, provider = $3, provider_message_id = $4, error = $5,
                   sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END
             WHERE id = $1::uuid
            """,
            send_id, status, provider, provider_message_id, error,
        )
    except Exception as e:                                   # noqa: BLE001
        logger.error('email ledger confirm failed — the message was sent but the ledger did not '
                     'record it (send %s): %s', send_id, e)


async def record_suppressed(
    *, correlation_id: str, idempotency_key: str, tenant_id: Optional[str], kind: str,
    to_email: str, subject: str, template: Optional[str], reason: str, metadata: dict,
) -> Optional[str]:
    """Record a send refused before dispatch, so a suppressed address still leaves a trace.

    The operator question this table exists to answer is "why did this notification not go?", and an
    absent row answers it with silence.
    """
    import json

    pool = _pool()
    if not pool:
        return None
    try:
        row = await pool.fetchrow(
            """
            INSERT INTO email_send_ledger
              (correlation_id, idempotency_key, tenant_id, provider, kind, status, to_email,
               subject, template, error, metadata)
            VALUES ($1::uuid, $2, $3::uuid, 'skipped', $4, 'suppressed', $5, $6, $7, $8, $9::jsonb)
            ON CONFLICT (idempotency_key) DO NOTHING
            RETURNING id
            """,
            correlation_id, idempotency_key, tenant_id, kind, to_email, subject, template,
            f'suppressed: {reason}', json.dumps(metadata or {}),
        )
        return str(row['id']) if row else None
    except Exception as e:                                   # noqa: BLE001
        _note_unwritable(e)
        return None


async def suppress(*, email: str, reason: str, source: str, detail: Optional[dict] = None) -> bool:
    """Add an address to the suppression list. Idempotent — a second bounce is not an error."""
    import json

    pool = _pool()
    if not pool:
        return False
    try:
        await pool.execute(
            """
            INSERT INTO email_suppressions (email, reason, source, detail)
            VALUES ($1, $2, $3, $4::jsonb)
            ON CONFLICT (email) DO NOTHING
            """,
            normalize_address(email), reason, source, json.dumps(detail or {}),
        )
        return True
    except Exception as e:                                   # noqa: BLE001
        _note_unwritable(e)
        return False


def new_id() -> str:
    return str(uuid.uuid4())
