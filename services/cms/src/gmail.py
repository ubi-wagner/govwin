"""Gmail API via OAuth2 refresh token."""
import asyncio
import base64
import logging
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

logger = logging.getLogger('cms.gmail')

_credentials = None
_gmail_service = None


def _get_credentials():
    global _credentials
    if _credentials and _credentials.valid:
        return _credentials

    client_id = os.getenv('GOOGLE_CLIENT_ID')
    client_secret = os.getenv('GOOGLE_CLIENT_SECRET')
    refresh_token = os.getenv('GOOGLE_REFRESH_TOKEN')

    if not all([client_id, client_secret, refresh_token]):
        return None

    try:
        from google.oauth2.credentials import Credentials
        _credentials = Credentials(
            token=None,
            refresh_token=refresh_token,
            client_id=client_id,
            client_secret=client_secret,
            token_uri='https://oauth2.googleapis.com/token',
            scopes=['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/calendar'],
        )
        return _credentials
    except Exception as e:
        logger.error(f'Failed to create credentials: {e}')
        _credentials = None
        return None


def _get_service():
    global _gmail_service
    if _gmail_service:
        return _gmail_service
    try:
        from googleapiclient.discovery import build
        creds = _get_credentials()
        if not creds:
            return None
        _gmail_service = build('gmail', 'v1', credentials=creds)
        return _gmail_service
    except Exception as e:
        logger.error(f'Failed to build Gmail service: {e}')
        return None


async def send_email(to: str, subject: str, html: str, from_addr: str | None = None) -> dict:
    creds = _get_credentials()
    if not creds:
        logger.error('Gmail not configured — missing GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN')
        return {'provider': 'skipped', 'error': 'not configured'}

    workspace_email = os.getenv('GOOGLE_WORKSPACE_EMAIL', 'platform@rfppipeline.com')
    sender = from_addr or f'RFP Pipeline <{workspace_email}>'

    try:
        from google.auth.transport.requests import Request

        # Refresh token in a thread to avoid blocking the event loop
        if not creds.valid:
            loop = asyncio.get_event_loop()
            try:
                await loop.run_in_executor(None, creds.refresh, Request())
            except Exception as e:
                global _credentials
                _credentials = None
                logger.error(f'Token refresh failed: {e}')
                return {'provider': 'gmail', 'error': f'Token refresh failed: {e}'}

        service = _get_service()
        if not service:
            return {'provider': 'gmail', 'error': 'Failed to build Gmail service'}

        msg = MIMEMultipart('alternative')
        msg['To'] = to
        msg['From'] = sender
        msg['Subject'] = subject
        msg.attach(MIMEText(html, 'html'))

        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()

        # Send in a thread to avoid blocking the event loop
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            lambda: service.users().messages().send(userId='me', body={'raw': raw}).execute(),
        )

        logger.info(f'Email sent to {to} via Gmail (id: {result.get("id")})')
        return {'provider': 'gmail', 'messageId': result.get('id')}
    except Exception as e:
        logger.error(f'Gmail send failed: {e}')
        return {'provider': 'gmail', 'error': str(e)}
