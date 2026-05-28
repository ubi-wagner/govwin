"""
Gmail API client for sending and sweeping emails.

Supports two auth modes (auto-detected from env vars):

1. OAuth2 Refresh Token (current default):
   - GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
   - Uses the token owner's Gmail account directly
   - Simplest setup — works with any Gmail/Workspace account

2. Service Account Delegation (future):
   - GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_PATH
   - Requires Google Workspace domain-wide delegation
   - Better for multi-user send-as scenarios

The auth mode is auto-detected: if GOOGLE_SERVICE_ACCOUNT_JSON is set,
service account mode is used. Otherwise falls back to OAuth2 refresh token.
"""
import asyncio
import os
import json
import base64
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from google.oauth2.credentials import Credentials as OAuthCredentials
from google.oauth2 import service_account
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

logger = logging.getLogger('cms.gmail')

SCOPES = [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.modify',
]

_cached_credentials: OAuthCredentials | service_account.Credentials | None = None


def _get_credentials(delegate_email: str):
    """Build credentials using either service account or OAuth2 refresh token."""
    global _cached_credentials

    # Mode 1: Service account delegation (preferred for Workspace)
    sa_key_json = os.getenv('GOOGLE_SERVICE_ACCOUNT_JSON')
    if sa_key_json:
        sa_info = json.loads(sa_key_json)
        credentials = service_account.Credentials.from_service_account_info(
            sa_info, scopes=SCOPES
        )
        return credentials.with_subject(delegate_email)

    sa_key_path = os.getenv('GOOGLE_SERVICE_ACCOUNT_PATH')
    if sa_key_path:
        with open(sa_key_path) as f:
            sa_info = json.loads(f.read())
        credentials = service_account.Credentials.from_service_account_info(
            sa_info, scopes=SCOPES
        )
        return credentials.with_subject(delegate_email)

    # Mode 2: OAuth2 refresh token (simpler setup)
    client_id = os.getenv('GOOGLE_CLIENT_ID')
    client_secret = os.getenv('GOOGLE_CLIENT_SECRET')
    refresh_token = os.getenv('GOOGLE_REFRESH_TOKEN')

    if not all([client_id, client_secret, refresh_token]):
        raise RuntimeError(
            'Gmail API credentials not configured. Set either:\n'
            '  - GOOGLE_SERVICE_ACCOUNT_JSON (service account delegation), or\n'
            '  - GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN (OAuth2)'
        )

    if _cached_credentials and _cached_credentials.valid:
        return _cached_credentials

    credentials = OAuthCredentials(
        token=None,
        refresh_token=refresh_token,
        token_uri='https://oauth2.googleapis.com/token',
        client_id=client_id,
        client_secret=client_secret,
        scopes=SCOPES,
    )
    credentials.refresh(Request())
    _cached_credentials = credentials
    logger.info('Gmail OAuth2 credentials refreshed successfully')
    return credentials


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
    Send an email via Gmail API.

    Returns: {message_id, thread_id, label_ids}
    """
    try:
        service = _get_gmail_service(delegate_email)

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

        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode('utf-8')
        send_body: dict = {'raw': raw}
        if thread_id:
            send_body['threadId'] = thread_id

        loop = asyncio.get_event_loop()
        result = await asyncio.wait_for(
            loop.run_in_executor(
                None,
                lambda: service.users().messages().send(
                    userId='me', body=send_body
                ).execute()
            ),
            timeout=30,
        )

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
            loop = asyncio.get_event_loop()
            results = await asyncio.wait_for(
                loop.run_in_executor(
                    None,
                    lambda: service.users().history().list(
                        userId='me',
                        startHistoryId=history_id,
                        historyTypes=['messageAdded'],
                        maxResults=max_results,
                    ).execute()
                ),
                timeout=30,
            )

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
            loop = asyncio.get_event_loop()
            results = await asyncio.wait_for(
                loop.run_in_executor(
                    None,
                    lambda: service.users().messages().list(
                        userId='me',
                        labelIds=['INBOX'],
                        maxResults=max_results,
                    ).execute()
                ),
                timeout=30,
            )

            profile = await asyncio.wait_for(
                loop.run_in_executor(
                    None,
                    lambda: service.users().getProfile(userId='me').execute()
                ),
                timeout=30,
            )

            return {
                'messages': results.get('messages', []),
                'new_history_id': profile.get('historyId'),
            }

    except Exception as e:
        logger.error(f'[sweep_inbox] Failed for {delegate_email}: {e}')
        raise


async def get_message(delegate_email: str, message_id: str) -> dict:
    """Fetch a full message by ID."""
    try:
        service = _get_gmail_service(delegate_email)
        loop = asyncio.get_event_loop()
        msg = await asyncio.wait_for(
            loop.run_in_executor(
                None,
                lambda: service.users().messages().get(
                    userId='me', id=message_id, format='full'
                ).execute()
            ),
            timeout=30,
        )
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

    if payload.get('mimeType') == 'text/plain' and payload.get('body', {}).get('data'):
        return base64.urlsafe_b64decode(payload['body']['data']).decode('utf-8', errors='replace')

    for part in payload.get('parts', []):
        if part.get('mimeType') == 'text/plain' and part.get('body', {}).get('data'):
            return base64.urlsafe_b64decode(part['body']['data']).decode('utf-8', errors='replace')
        for subpart in part.get('parts', []):
            if subpart.get('mimeType') == 'text/plain' and subpart.get('body', {}).get('data'):
                return base64.urlsafe_b64decode(subpart['body']['data']).decode('utf-8', errors='replace')

    return ''
