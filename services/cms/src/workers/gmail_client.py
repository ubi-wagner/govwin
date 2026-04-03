"""
Gmail API client for sending and sweeping emails.

Uses Google Workspace domain-wide delegation:
  1. Service account authenticates
  2. Impersonates the sweep account email
  3. Sends on behalf of the sweep account
  4. Sweeps inbox/sent for reply tracking

Requires:
  - Google Cloud service account with Gmail API enabled
  - Domain-wide delegation configured in Google Admin
  - Scopes: gmail.send, gmail.readonly, gmail.modify
"""
import os
import json
import base64
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from google.oauth2 import service_account
from googleapiclient.discovery import build

logger = logging.getLogger('cms.gmail')

SCOPES = [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.modify',
]


def _get_credentials(delegate_email: str) -> service_account.Credentials:
    """Build delegated credentials for the given email address."""
    sa_key_json = os.getenv('GOOGLE_SERVICE_ACCOUNT_JSON')
    if not sa_key_json:
        sa_key_path = os.getenv('GOOGLE_SERVICE_ACCOUNT_PATH')
        if not sa_key_path:
            raise RuntimeError(
                'Set GOOGLE_SERVICE_ACCOUNT_JSON (inline JSON) or '
                'GOOGLE_SERVICE_ACCOUNT_PATH (file path) for Gmail API access'
            )
        with open(sa_key_path) as f:
            sa_key_json = f.read()

    sa_info = json.loads(sa_key_json)
    credentials = service_account.Credentials.from_service_account_info(
        sa_info, scopes=SCOPES
    )
    return credentials.with_subject(delegate_email)


def _get_gmail_service(delegate_email: str):
    """Build an authenticated Gmail API service."""
    credentials = _get_credentials(delegate_email)
    return build('gmail', 'v1', credentials=credentials, cache_discovery=False)


async def send_email(
    delegate_email: str,
    to_email: str,
    subject: str,
    body_html: str,
    body_text: str = '',
    from_name: str | None = None,
    in_reply_to: str | None = None,
    thread_id: str | None = None,
) -> dict:
    """
    Send an email via Gmail API using delegated credentials.

    Returns: {message_id, thread_id, label_ids}
    """
    try:
        service = _get_gmail_service(delegate_email)

        # Build MIME message
        msg = MIMEMultipart('alternative')
        msg['To'] = to_email
        from_header = f'{from_name} <{delegate_email}>' if from_name else delegate_email
        msg['From'] = from_header
        msg['Subject'] = subject

        if in_reply_to:
            msg['In-Reply-To'] = in_reply_to
            msg['References'] = in_reply_to

        if body_text:
            msg.attach(MIMEText(body_text, 'plain'))
        msg.attach(MIMEText(body_html, 'html'))

        # Encode and send
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode('utf-8')
        send_body: dict = {'raw': raw}
        if thread_id:
            send_body['threadId'] = thread_id

        result = service.users().messages().send(
            userId='me', body=send_body
        ).execute()

        logger.info(f'Email sent: {result.get("id")} to {to_email} (thread: {result.get("threadId")})')

        return {
            'message_id': result.get('id'),
            'thread_id': result.get('threadId'),
            'label_ids': result.get('labelIds', []),
        }

    except Exception as e:
        logger.error(f'[send_email] Failed to send to {to_email}: {e}')
        raise


async def sweep_inbox(
    delegate_email: str,
    history_id: str | None = None,
    max_results: int = 100,
) -> dict:
    """
    Sweep inbox for new messages since last history_id.

    Returns: {messages: [...], new_history_id: str}
    """
    try:
        service = _get_gmail_service(delegate_email)

        if history_id:
            # Incremental sync via history API
            results = service.users().history().list(
                userId='me',
                startHistoryId=history_id,
                historyTypes=['messageAdded'],
                maxResults=max_results,
            ).execute()

            messages = []
            for record in results.get('history', []):
                for msg_added in record.get('messagesAdded', []):
                    msg_data = msg_added.get('message', {})
                    if 'INBOX' in msg_data.get('labelIds', []):
                        messages.append(msg_data)

            return {
                'messages': messages,
                'new_history_id': results.get('historyId', history_id),
            }
        else:
            # Full sync — get recent inbox messages
            results = service.users().messages().list(
                userId='me',
                labelIds=['INBOX'],
                maxResults=max_results,
            ).execute()

            return {
                'messages': results.get('messages', []),
                'new_history_id': results.get('resultSizeEstimate', '0'),
            }

    except Exception as e:
        logger.error(f'[sweep_inbox] Failed for {delegate_email}: {e}')
        raise


async def get_message(delegate_email: str, message_id: str) -> dict:
    """Fetch a full message by ID."""
    try:
        service = _get_gmail_service(delegate_email)
        msg = service.users().messages().get(
            userId='me', id=message_id, format='full'
        ).execute()
        return msg
    except Exception as e:
        logger.error(f'[get_message] Failed for {message_id}: {e}')
        raise


def extract_headers(message: dict) -> dict:
    """Extract common headers from a Gmail message."""
    headers = {}
    for header in message.get('payload', {}).get('headers', []):
        name = header.get('name', '').lower()
        if name in ('from', 'to', 'subject', 'date', 'message-id', 'in-reply-to', 'references'):
            headers[name] = header.get('value', '')
    return headers


def extract_body_text(message: dict) -> str:
    """Extract plain text body from a Gmail message."""
    payload = message.get('payload', {})

    # Simple single-part message
    if payload.get('mimeType') == 'text/plain' and payload.get('body', {}).get('data'):
        return base64.urlsafe_b64decode(payload['body']['data']).decode('utf-8', errors='replace')

    # Multipart — find text/plain part
    for part in payload.get('parts', []):
        if part.get('mimeType') == 'text/plain' and part.get('body', {}).get('data'):
            return base64.urlsafe_b64decode(part['body']['data']).decode('utf-8', errors='replace')
        # Nested multipart
        for subpart in part.get('parts', []):
            if subpart.get('mimeType') == 'text/plain' and subpart.get('body', {}).get('data'):
                return base64.urlsafe_b64decode(subpart['body']['data']).decode('utf-8', errors='replace')

    return ''
