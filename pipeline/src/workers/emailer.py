"""
Email Delivery Worker — Gmail API via Google Workspace service account.

Sends from:   admin@rfppipeline.com (primary sender)
Service acct: automation@rfppipeline.com (domain-wide delegation)

Consumes notifications_queue rows with status='pending'.
Updates status to 'sent' or 'failed' with error details.

Environment:
  GOOGLE_SERVICE_ACCOUNT_KEY  — Base64-encoded service account JSON
  GOOGLE_DELEGATED_ADMIN      — Email to send as (default: admin@rfppipeline.com)

Usage:
  Called from main.py execute_job() for source='email_delivery' or 'digest'.
  Also runs as an event worker consuming customer_events for real-time alerts.
"""

import asyncio
import base64
import html as html_module
import json
import logging
import os
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from functools import partial

from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

log = logging.getLogger("workers.emailer")

SENDER_EMAIL = os.environ.get("GOOGLE_DELEGATED_ADMIN", "admin@rfppipeline.com")
MAX_BATCH_SIZE = 50  # Max emails per flush cycle
MAX_RETRIES = 3       # Max attempts per notification


def _esc(value: object) -> str:
    """HTML-escape any value for safe template insertion."""
    return html_module.escape(str(value)) if value else ""


def _get_gmail_service():
    """
    Build a Gmail API service using the service account with domain-wide delegation.
    Impersonates SENDER_EMAIL so emails come from admin@rfppipeline.com.

    This is a synchronous function — callers in async contexts should use
    _send_message_async() which runs the blocking call in an executor.
    """
    key_b64 = os.environ.get("GOOGLE_SERVICE_ACCOUNT_KEY")
    if not key_b64:
        raise RuntimeError("GOOGLE_SERVICE_ACCOUNT_KEY not set — cannot send email")

    try:
        creds_json = json.loads(base64.b64decode(key_b64).decode())
    except Exception as e:
        raise RuntimeError(f"Failed to decode GOOGLE_SERVICE_ACCOUNT_KEY: {e}")

    credentials = service_account.Credentials.from_service_account_info(
        creds_json,
        scopes=["https://www.googleapis.com/auth/gmail.send"],
        subject=SENDER_EMAIL,
    )

    # Refresh is synchronous (HTTP call to Google token endpoint)
    credentials.refresh(GoogleAuthRequest())

    return build("gmail", "v1", credentials=credentials, cache_discovery=False)


def _send_message_sync(gmail, raw_message: str) -> dict:
    """Synchronous Gmail send — meant to be called via run_in_executor."""
    return gmail.users().messages().send(
        userId="me",
        body={"raw": raw_message},
    ).execute()


async def _send_message_async(gmail, raw_message: str) -> dict:
    """Run the synchronous Gmail send in a thread pool to avoid blocking the event loop."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None, partial(_send_message_sync, gmail, raw_message)
    )


def _build_mime_message(
    to_email: str,
    subject: str,
    body_html: str | None,
    body_text: str | None,
    from_email: str = SENDER_EMAIL,
) -> str:
    """Build a MIME message and return base64url-encoded raw string."""
    msg = MIMEMultipart("alternative")
    msg["From"] = f"GovWin Pipeline <{from_email}>"
    msg["To"] = to_email
    msg["Subject"] = subject

    # Always include text part (fallback)
    text_body = body_text or _strip_html(body_html or "")
    msg.attach(MIMEText(text_body, "plain"))

    # Include HTML part if available
    if body_html:
        msg.attach(MIMEText(body_html, "html"))

    return base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii")


def _strip_html(html: str) -> str:
    """Basic HTML to text conversion for fallback."""
    import re
    text = re.sub(r"<br\s*/?>", "\n", html)
    text = re.sub(r"<[^>]+>", "", text)
    return text.strip()


def _generate_notification_html(notification: dict, opp_details: dict | None) -> str:
    """Generate HTML email body from a notification_queue row."""
    ntype = notification.get("notification_type", "")
    subject = _esc(notification.get("subject", ""))

    if ntype == "deadline_nudge":
        return _render_deadline_nudge(notification, opp_details)
    elif ntype == "amendment_alert":
        return _render_amendment_alert(notification, opp_details)
    else:
        # Generic notification
        body_text = _esc(notification.get("body_text", "You have a new notification from GovWin Pipeline."))
        return f"""
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #1a1a2e; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
                <h2 style="margin: 0;">GovWin Pipeline</h2>
            </div>
            <div style="padding: 20px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px;">
                <h3>{subject}</h3>
                <p>{body_text}</p>
                <p style="color: #666; font-size: 12px; margin-top: 20px;">
                    This is an automated message from GovWin Pipeline.
                </p>
            </div>
        </div>
        """


def _render_deadline_nudge(notification: dict, opp: dict | None) -> str:
    """Render a deadline nudge email."""
    subject = _esc(notification.get("subject", "Deadline Approaching"))
    title = _esc(opp.get("title", "Unknown Opportunity") if opp else "Unknown Opportunity")
    sol_num = _esc(opp.get("solicitation_number", "") if opp else "")
    agency = _esc(opp.get("agency", "") if opp else "")
    close_date = _esc(opp.get("close_date", "") if opp else "")

    raw_subject = notification.get("subject", "")
    urgency_color = "#dc3545" if "URGENT" in raw_subject else "#ffc107" if "Reminder" in raw_subject else "#17a2b8"

    return f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #1a1a2e; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
            <h2 style="margin: 0;">GovWin Pipeline</h2>
            <p style="margin: 5px 0 0; opacity: 0.8;">Deadline Alert</p>
        </div>
        <div style="padding: 20px; border: 1px solid #e0e0e0; border-top: none;">
            <div style="background: {urgency_color}; color: white; padding: 10px 15px; border-radius: 4px; margin-bottom: 15px;">
                <strong>{subject}</strong>
            </div>
            <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 8px 0; color: #666;">Opportunity</td><td style="padding: 8px 0;"><strong>{title}</strong></td></tr>
                {'<tr><td style="padding: 8px 0; color: #666;">Sol #</td><td style="padding: 8px 0;">' + sol_num + '</td></tr>' if sol_num else ''}
                {'<tr><td style="padding: 8px 0; color: #666;">Agency</td><td style="padding: 8px 0;">' + agency + '</td></tr>' if agency else ''}
                {'<tr><td style="padding: 8px 0; color: #666;">Closes</td><td style="padding: 8px 0;"><strong>' + close_date + '</strong></td></tr>' if close_date else ''}
            </table>
            <p style="margin-top: 15px;">Log in to your GovWin Portal to review this opportunity and take action.</p>
        </div>
        <div style="padding: 15px 20px; background: #f8f9fa; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px;">
            <p style="color: #666; font-size: 12px; margin: 0;">
                This is an automated deadline reminder from GovWin Pipeline.
            </p>
        </div>
    </div>
    """


def _render_amendment_alert(notification: dict, opp: dict | None) -> str:
    """Render an amendment alert email."""
    title = _esc(opp.get("title", "Unknown Opportunity") if opp else "Unknown Opportunity")
    sol_num = _esc(opp.get("solicitation_number", "") if opp else "")
    agency = _esc(opp.get("agency", "") if opp else "")

    return f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #1a1a2e; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
            <h2 style="margin: 0;">GovWin Pipeline</h2>
            <p style="margin: 5px 0 0; opacity: 0.8;">Amendment Alert</p>
        </div>
        <div style="padding: 20px; border: 1px solid #e0e0e0; border-top: none;">
            <div style="background: #fd7e14; color: white; padding: 10px 15px; border-radius: 4px; margin-bottom: 15px;">
                <strong>Amendment Detected</strong>
            </div>
            <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 8px 0; color: #666;">Opportunity</td><td style="padding: 8px 0;"><strong>{title}</strong></td></tr>
                {'<tr><td style="padding: 8px 0; color: #666;">Sol #</td><td style="padding: 8px 0;">' + sol_num + '</td></tr>' if sol_num else ''}
                {'<tr><td style="padding: 8px 0; color: #666;">Agency</td><td style="padding: 8px 0;">' + agency + '</td></tr>' if agency else ''}
            </table>
            <p style="margin-top: 15px;">
                This opportunity has been amended on SAM.gov. Please review the changes
                in your GovWin Portal to ensure your response strategy is up to date.
            </p>
        </div>
        <div style="padding: 15px 20px; background: #f8f9fa; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px;">
            <p style="color: #666; font-size: 12px; margin: 0;">
                This is an automated amendment notification from GovWin Pipeline.
            </p>
        </div>
    </div>
    """


async def deliver_pending_notifications(conn) -> dict:
    """
    Flush notifications_queue: fetch pending rows, send via Gmail, update status.

    Called from main.py execute_job() for email_delivery/digest jobs.

    Returns: { 'delivered': N, 'failed': N, 'skipped': N }
    """
    result = {"delivered": 0, "failed": 0, "skipped": 0}

    # Fetch pending notifications, oldest first, up to batch size
    try:
        rows = await conn.fetch(
            """
            SELECT nq.id, nq.tenant_id, nq.user_id, nq.notification_type,
                   nq.subject, nq.body_html, nq.body_text,
                   nq.related_ids, nq.priority, nq.attempt,
                   t.primary_email AS tenant_email, t.name AS tenant_name
            FROM notifications_queue nq
            JOIN tenants t ON t.id = nq.tenant_id
            WHERE nq.status = 'pending'
              AND nq.scheduled_for <= NOW()
              AND nq.attempt < $1
            ORDER BY nq.priority ASC, nq.created_at ASC
            LIMIT $2
            """,
            MAX_RETRIES,
            MAX_BATCH_SIZE,
        )
    except Exception as e:
        log.error(f"[emailer] Failed to fetch pending notifications: {e}")
        return result

    if not rows:
        return result

    log.info(f"[emailer] Processing {len(rows)} pending notifications")

    # Build Gmail service once for the batch (sync call — run in executor)
    try:
        loop = asyncio.get_running_loop()
        gmail = await loop.run_in_executor(None, _get_gmail_service)
    except Exception as e:
        log.error(f"[emailer] Gmail service init failed: {e}")
        # Mark all as failed with the auth error
        for row in rows:
            try:
                await conn.execute(
                    """
                    UPDATE notifications_queue
                    SET status = 'failed', error_message = $1, attempt = attempt + 1
                    WHERE id = $2
                    """,
                    f"Gmail auth failed: {e}"[:500],
                    row["id"],
                )
            except Exception:
                pass
        result["failed"] = len(rows)
        return result

    for row in rows:
        notif_id = row["id"]
        to_email = row["tenant_email"]

        if not to_email:
            log.warning(f"[emailer] No email for tenant {row['tenant_id']}, skipping notif {notif_id}")
            try:
                await conn.execute(
                    """
                    UPDATE notifications_queue
                    SET status = 'failed', error_message = 'No tenant email configured'
                    WHERE id = $1
                    """,
                    notif_id,
                )
            except Exception:
                pass
            result["skipped"] += 1
            continue

        # If no body_html, generate one from notification type + related opp data
        body_html = row["body_html"]
        if not body_html:
            opp_details = None
            related_ids = row["related_ids"] or []
            if related_ids:
                try:
                    opp_id = related_ids[0] if isinstance(related_ids, list) else None
                    if opp_id:
                        opp_row = await conn.fetchrow(
                            "SELECT title, solicitation_number, agency, close_date FROM opportunities WHERE id = $1::uuid",
                            opp_id,
                        )
                        if opp_row:
                            opp_details = dict(opp_row)
                except Exception as e:
                    log.warning(f"[emailer] Failed to fetch opp details for notif {notif_id}: {e}")

            body_html = _generate_notification_html(dict(row), opp_details)

        subject = row["subject"] or f"GovWin Pipeline Notification"

        try:
            raw_message = _build_mime_message(
                to_email=to_email,
                subject=subject,
                body_html=body_html,
                body_text=row["body_text"],
            )

            await _send_message_async(gmail, raw_message)

            # Mark as sent
            await conn.execute(
                """
                UPDATE notifications_queue
                SET status = 'sent', sent_at = NOW(), attempt = attempt + 1
                WHERE id = $1
                """,
                notif_id,
            )
            result["delivered"] += 1
            log.info(f"[emailer] Sent {row['notification_type']} to {to_email}")

        except HttpError as e:
            error_msg = f"Gmail API error: {e.status_code} {e.reason}"
            log.error(f"[emailer] {error_msg} for notif {notif_id}")

            new_attempt = (row["attempt"] or 0) + 1
            new_status = "failed" if new_attempt >= MAX_RETRIES else "pending"

            try:
                await conn.execute(
                    """
                    UPDATE notifications_queue
                    SET status = $1, error_message = $2, attempt = $3
                    WHERE id = $4
                    """,
                    new_status, error_msg[:500], new_attempt, notif_id,
                )
            except Exception as db_err:
                log.error(f"[emailer] DB update failed for notif {notif_id}: {db_err}")

            result["failed"] += 1

        except Exception as e:
            error_msg = f"Send error: {e}"
            log.error(f"[emailer] {error_msg} for notif {notif_id}")

            new_attempt = (row["attempt"] or 0) + 1
            new_status = "failed" if new_attempt >= MAX_RETRIES else "pending"

            try:
                await conn.execute(
                    """
                    UPDATE notifications_queue
                    SET status = $1, error_message = $2, attempt = $3
                    WHERE id = $4
                    """,
                    new_status, error_msg[:500], new_attempt, notif_id,
                )
            except Exception as db_err:
                log.error(f"[emailer] DB update failed for notif {notif_id}: {db_err}")

            result["failed"] += 1

    log.info(
        f"[emailer] Batch complete: {result['delivered']} delivered, "
        f"{result['failed']} failed, {result['skipped']} skipped"
    )
    return result
