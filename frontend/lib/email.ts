/**
 * Email + Calendar via Google Workspace APIs.
 *
 * Uses a service account with domain-wide delegation to send email
 * as eric@rfppipeline.com via Gmail API and create calendar events.
 *
 * Setup (one-time in Google Admin Console):
 * 1. Create a GCP project → enable Gmail API + Calendar API
 * 2. Create a service account → download JSON key
 * 3. In Google Admin → Security → API controls → Domain-wide delegation
 *    → Add the service account client_id with scopes:
 *      https://www.googleapis.com/auth/gmail.send
 *      https://www.googleapis.com/auth/calendar
 * 4. Set env vars on Railway:
 *    GOOGLE_SERVICE_ACCOUNT_EMAIL=svc@project.iam.gserviceaccount.com
 *    GOOGLE_SERVICE_ACCOUNT_KEY=<base64-encoded JSON key>
 *    GOOGLE_WORKSPACE_EMAIL=eric@rfppipeline.com
 */

import { google } from 'googleapis';

const SVC_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SVC_KEY_B64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
const WORKSPACE_EMAIL = process.env.GOOGLE_WORKSPACE_EMAIL || 'eric@rfppipeline.com';
const FALLBACK_RESEND_KEY = process.env.RESEND_API_KEY;

function getAuth() {
  if (!SVC_EMAIL || !SVC_KEY_B64) return null;

  try {
    const keyJson = JSON.parse(
      Buffer.from(SVC_KEY_B64, 'base64').toString('utf-8'),
    );

    return new google.auth.JWT({
      email: SVC_EMAIL,
      key: keyJson.private_key,
      scopes: [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/calendar',
      ],
      subject: WORKSPACE_EMAIL,
    });
  } catch (err) {
    console.error('[google] Failed to parse service account key:', err);
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
