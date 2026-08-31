/**
 * Google Calendar events, via the same Workspace OAuth credentials the Gmail driver uses.
 *
 * Moved out of `lib/email.ts` when that file became the email seam (`lib/email/`). Calendar is not
 * a mail transport and does not belong behind the send seam; leaving it in a module named `email`
 * would have made the transport-boundary test either wrong or full of exceptions.
 *
 * NOT `lib/calendar.ts` — that name is taken by the expert-time scheduling primitive (Terms §7),
 * which is a database feature with no connection to Google. Two different calendars, and only one
 * of them talks to Google.
 *
 * ⚠️ NOTHING CALLS THESE. Both exports have zero call sites in the tree — an unsurfaced capability
 * in the sense of docs/CAPABILITY_RECONCILIATION.md. They are moved rather than deleted because
 * deleting is a decision, not a side effect of a refactor, and `createDeadlineReminder` is the
 * obvious consumer for a solicitation close date the product already tracks.
 */
import { google } from 'googleapis';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

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
    console.error('[google-calendar] Failed to create OAuth2 client:', err);
    return null;
  }
}

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
    console.error('[google-calendar] Google service account not configured');
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
    console.error('[google-calendar] Failed to create event:', err);
    return null;
  }
}

/** Convenience: a deadline reminder for a solicitation close date. */
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
