const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@rfppipeline.com';

export async function sendEmail(params: { to: string; subject: string; html: string }) {
  if (!RESEND_API_KEY) {
    console.error('[email] RESEND_API_KEY not configured, skipping email');
    return null;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: EMAIL_FROM, to: params.to, subject: params.subject, html: params.html }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[email] Send failed:', err);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error('[email] Error:', e);
    return null;
  }
}
