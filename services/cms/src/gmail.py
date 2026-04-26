"""Gmail API via OAuth2 refresh token."""
import base64
import logging
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

logger = logging.getLogger('cms.gmail')

_credentials = None

def _get_credentials():
    global _credentials
    if _credentials:
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
        return None

async def send_email(to: str, subject: str, html: str, from_addr: str | None = None) -> dict:
    creds = _get_credentials()
    if not creds:
        logger.error('Gmail not configured — missing GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN')
        return {'provider': 'skipped', 'error': 'not configured'}

    workspace_email = os.getenv('GOOGLE_WORKSPACE_EMAIL', 'platform@rfppipeline.com')
    sender = from_addr or f'RFP Pipeline <{workspace_email}>'

    try:
        from googleapiclient.discovery import build
        from google.auth.transport.requests import Request

        if not creds.valid:
            creds.refresh(Request())

        service = build('gmail', 'v1', credentials=creds)

        msg = MIMEMultipart('alternative')
        msg['To'] = to
        msg['From'] = sender
        msg['Subject'] = subject
        msg.attach(MIMEText(html, 'html'))

        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
        result = service.users().messages().send(userId='me', body={'raw': raw}).execute()

        logger.info(f'Email sent to {to} via Gmail (id: {result.get("id")})')
        return {'provider': 'gmail', 'messageId': result.get('id')}
    except Exception as e:
        logger.error(f'Gmail send failed: {e}')
        return {'provider': 'gmail', 'error': str(e)}
