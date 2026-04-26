/**
 * Email + Calendar via Google Workspace APIs.
 *
 * Uses OAuth2 with a refresh token to send email as
 * platform@rfppipeline.com via Gmail API and create calendar events.
 *
 * Setup:
 * 1. GCP Console → create OAuth2 Web App credentials
 * 2. OAuth Playground → authorize as platform@rfppipeline.com
 * 3. Exchange code for tokens → copy the refresh token
 * 4. Set env vars on Railway:
 *    GOOGLE_CLIENT_ID=...apps.googleusercontent.com
 *    GOOGLE_CLIENT_SECRET=GOCSPX-...
 *    GOOGLE_REFRESH_TOKEN=1//...
 *    GOOGLE_WORKSPACE_EMAIL=platform@rfppipeline.com
 */

import { google } from 'googleapis';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const WORKSPACE_EMAIL = process.env.GOOGLE_WORKSPACE_EMAIL || 'platform@rfppipeline.com';
const FALLBACK_RESEND_KEY = process.env.RESEND_API_KEY;

let _cachedAuth: InstanceType<typeof google.auth.OAuth2> | null = null;

function getAuth() {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) return null;

  if (_cachedAuth) return _cachedAuth;

  try {
    const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
    oauth2.setCredentials({ refresh_token: REFRESH_TOKEN });
    _cachedAuth = oauth2;
    return oauth2;
  } catch (err) {
    console.error('[google] Failed to create OAuth2 client:', err);
    return null;
  }
}

function buildMimeMessage(params: {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
}): string {
  const from = params.from || `RFP Pipeline <${WORKSPACE_EMAIL}>`;
  const boundary = '----=_Part_' + Date.now().toString(36);

  const lines = [
    `From: ${from}`,
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    params.replyTo ? `Reply-To: ${params.replyTo}` : '',
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    params.html,
    '',
    `--${boundary}--`,
  ].filter(Boolean);

  return lines.join('\r\n');
}

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
}

export interface SendEmailResult {
  provider: 'gmail' | 'resend' | 'skipped';
  messageId?: string;
  error?: string;
}

/**
 * Send an email via Google Workspace Gmail API.
 * Falls back to Resend if Google is not configured.
 * Never throws — returns a result object.
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  // Try Gmail API first
  const auth = getAuth();
  if (auth) {
    try {
      const gmail = google.gmail({ version: 'v1', auth });
      const raw = Buffer.from(buildMimeMessage(params))
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const res = await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw },
      });

      return {
        provider: 'gmail',
        messageId: res.data.id ?? undefined,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[email] Gmail API send failed:', msg);
      // Fall through to Resend
    }
  }

  // Fallback: Resend API
  if (FALLBACK_RESEND_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${FALLBACK_RESEND_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: params.from || `RFP Pipeline <noreply@rfppipeline.com>`,
          to: params.to,
          subject: params.subject,
          html: params.html,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('[email] Resend send failed:', err);
        return { provider: 'resend', error: String(err?.message ?? 'unknown') };
      }
      const data = await res.json();
      return { provider: 'resend', messageId: data?.id };
    } catch (err) {
      console.error('[email] Resend error:', err);
      return { provider: 'resend', error: String(err) };
    }
  }

  console.error('[email] No email provider configured (need GOOGLE_SERVICE_ACCOUNT_KEY or RESEND_API_KEY)');
  return { provider: 'skipped' };
}

/**
 * Create a Google Calendar event (for deadlines, reviews, meetings).
 */
export interface CalendarEventParams {
  summary: string;
  description?: string;
  start: Date;
  end: Date;
  attendees?: string[];
  location?: string;
  reminders?: Array<{ method: 'email' | 'popup'; minutes: number }>;
}

export async function createCalendarEvent(
  params: CalendarEventParams,
): Promise<{ eventId: string; htmlLink: string } | null> {
  const auth = getAuth();
  if (!auth) {
    console.error('[calendar] Google service account not configured');
    return null;
  }

  try {
    const calendar = google.calendar({ version: 'v3', auth });
    const event = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: params.summary,
        description: params.description,
        start: { dateTime: params.start.toISOString() },
        end: { dateTime: params.end.toISOString() },
        attendees: params.attendees?.map((email) => ({ email })),
        location: params.location,
        reminders: params.reminders
          ? { useDefault: false, overrides: params.reminders }
          : { useDefault: true },
      },
      sendUpdates: params.attendees?.length ? 'all' : 'none',
    });

    return {
      eventId: event.data.id ?? '',
      htmlLink: event.data.htmlLink ?? '',
    };
  } catch (err) {
    console.error('[calendar] Failed to create event:', err);
    return null;
  }
}

/**
 * Convenience: create a deadline reminder for a solicitation close date.
 */
export async function createDeadlineReminder(params: {
  title: string;
  closeDate: Date;
  tenantName?: string;
  topicNumber?: string;
}): Promise<{ eventId: string } | null> {
  const result = await createCalendarEvent({
    summary: `[RFP Deadline] ${params.title}`,
    description: [
      params.tenantName ? `Customer: ${params.tenantName}` : '',
      params.topicNumber ? `Topic: ${params.topicNumber}` : '',
      'RFP Pipeline automated deadline reminder',
    ].filter(Boolean).join('\n'),
    start: params.closeDate,
    end: new Date(params.closeDate.getTime() + 60 * 60 * 1000),
    reminders: [
      { method: 'email', minutes: 7 * 24 * 60 },
      { method: 'email', minutes: 3 * 24 * 60 },
      { method: 'email', minutes: 24 * 60 },
      { method: 'popup', minutes: 60 },
    ],
  });

  return result ? { eventId: result.eventId } : null;
}
