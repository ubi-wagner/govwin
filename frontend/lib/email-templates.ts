/**
 * Email template functions for the RFP Pipeline platform.
 *
 * Each function returns { subject, html } ready for sendEmail().
 * All templates use inline styles only (no external CSS) for
 * maximum email-client compatibility.
 *
 * Brand colors: navy (#1e293b), brand blue (#2563eb), cream (#faf7f2).
 */

const BRAND_NAVY = '#1e293b';
const BRAND_BLUE = '#2563eb';
const BRAND_CREAM = '#faf7f2';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:${BRAND_CREAM};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND_CREAM};">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color:${BRAND_NAVY};padding:24px 32px;">
              <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">RFP Pipeline</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;color:${BRAND_NAVY};font-size:15px;line-height:1.6;">
              ${body}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #e2e8f0;font-size:13px;color:#64748b;text-align:center;">
              Questions? Contact <a href="mailto:eric@rfppipeline.com" style="color:${BRAND_BLUE};text-decoration:none;">eric@rfppipeline.com</a>
              <br style="margin-top:8px;">
              <span style="color:#94a3b8;">&copy; RFP Pipeline</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function button(text: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
  <tr>
    <td style="background-color:${BRAND_BLUE};border-radius:6px;">
      <a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
        ${escapeHtml(text)}
      </a>
    </td>
  </tr>
</table>`;
}

// ---------------------------------------------------------------------------
// 1. Application Accepted
// ---------------------------------------------------------------------------

export function applicationAcceptedEmail(params: {
  contactName: string;
  companyName: string;
  tempPassword: string;
  tenantSlug: string;
  loginUrl: string;
}): { subject: string; html: string } {
  const { contactName, companyName, tempPassword, tenantSlug, loginUrl } = params;

  const subject = `Welcome to RFP Pipeline — ${escapeHtml(companyName)} is approved!`;

  const body = `
<h2 style="margin:0 0 16px;font-size:20px;color:${BRAND_NAVY};">Congratulations, ${escapeHtml(contactName)}!</h2>
<p>Your application for <strong>${escapeHtml(companyName)}</strong> has been approved. Your tenant workspace (<code style="background:#f1f5f9;padding:2px 6px;border-radius:3px;font-size:14px;">${escapeHtml(tenantSlug)}</code>) is ready to go.</p>

<p style="margin-top:24px;font-weight:600;">Your login credentials:</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px;width:100%;margin-bottom:8px;">
  <tr>
    <td style="padding:12px 16px;">
      <span style="font-size:13px;color:#64748b;">Email</span><br>
      <span style="font-size:15px;font-weight:600;color:${BRAND_NAVY};">${escapeHtml(params.contactName)}</span>
    </td>
  </tr>
  <tr>
    <td style="padding:0 16px 12px;">
      <span style="font-size:13px;color:#64748b;">Temporary Password</span><br>
      <code style="font-size:16px;font-weight:700;color:${BRAND_BLUE};font-family:'Courier New',Courier,monospace;letter-spacing:1px;">${escapeHtml(tempPassword)}</code>
    </td>
  </tr>
</table>
<p style="font-size:13px;color:#ef4444;margin-top:4px;">This temporary password expires on first use. You will be prompted to set a permanent password.</p>

<p style="margin-top:24px;font-weight:600;">Getting started:</p>
<ol style="padding-left:20px;margin:8px 0 0;">
  <li style="margin-bottom:6px;">Log in at the link below</li>
  <li style="margin-bottom:6px;">Set your permanent password</li>
  <li style="margin-bottom:6px;">Upload your company documents</li>
  <li style="margin-bottom:6px;">Review your Spotlight for matched opportunities</li>
</ol>

${button('Log In to RFP Pipeline', loginUrl)}
`;

  return { subject, html: layout(body) };
}

// ---------------------------------------------------------------------------
// 2. Application Rejected
// ---------------------------------------------------------------------------

export function applicationRejectedEmail(params: {
  contactName: string;
  companyName: string;
  reason: string;
}): { subject: string; html: string } {
  const { contactName, companyName, reason } = params;

  const subject = `Update on your RFP Pipeline application`;

  const body = `
<h2 style="margin:0 0 16px;font-size:20px;color:${BRAND_NAVY};">Hi ${escapeHtml(contactName)},</h2>
<p>Thank you for your interest in RFP Pipeline and for taking the time to apply on behalf of <strong>${escapeHtml(companyName)}</strong>.</p>

<p>After careful review, we are unable to approve your application at this time. Here is the feedback from our review team:</p>

<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0;">
  <tr>
    <td style="background:#f8fafc;border-left:4px solid ${BRAND_BLUE};padding:16px;border-radius:0 6px 6px 0;font-size:14px;color:${BRAND_NAVY};line-height:1.6;">
      ${escapeHtml(reason)}
    </td>
  </tr>
</table>

<p>This does not have to be the end of the road. If your circumstances change or you have additional information to share, we welcome you to reapply or reach out directly.</p>

<p>We appreciate your time and wish you success in your government contracting endeavors.</p>

<p style="margin-top:24px;">Best regards,<br><strong>The RFP Pipeline Team</strong></p>
`;

  return { subject, html: layout(body) };
}

// ---------------------------------------------------------------------------
// 3. Welcome / Onboarded
// ---------------------------------------------------------------------------

export function welcomeOnboardedEmail(params: {
  contactName: string;
  companyName: string;
  tenantSlug: string;
  dashboardUrl: string;
}): { subject: string; html: string } {
  const { contactName, companyName, tenantSlug, dashboardUrl } = params;

  const subject = `${escapeHtml(companyName)} is live on RFP Pipeline`;

  const body = `
<h2 style="margin:0 0 16px;font-size:20px;color:${BRAND_NAVY};">You're all set, ${escapeHtml(contactName)}!</h2>
<p>Your workspace for <strong>${escapeHtml(companyName)}</strong> (<code style="background:#f1f5f9;padding:2px 6px;border-radius:3px;font-size:14px;">${escapeHtml(tenantSlug)}</code>) is fully configured and ready.</p>

<p>Here is what you can do now:</p>
<ul style="padding-left:20px;margin:8px 0;">
  <li style="margin-bottom:6px;">Browse your personalized Spotlight for matched opportunities</li>
  <li style="margin-bottom:6px;">Invite team members from your dashboard</li>
  <li style="margin-bottom:6px;">Upload company capability documents to improve match quality</li>
  <li style="margin-bottom:6px;">Start building proposals with AI-assisted workflows</li>
</ul>

${button('Go to Dashboard', dashboardUrl)}
`;

  return { subject, html: layout(body) };
}

// ---------------------------------------------------------------------------
// 4. Admin New Application Alert
// ---------------------------------------------------------------------------

export function adminNewApplicationAlert(params: {
  companyName: string;
  contactName: string;
  contactEmail: string;
  techSummary: string;
  adminDashboardUrl: string;
}): { subject: string; html: string } {
  const { companyName, contactName, contactEmail, techSummary, adminDashboardUrl } = params;

  const subject = `New application: ${companyName} (${contactName})`;

  const body = `
<h2 style="margin:0 0 16px;font-size:20px;color:${BRAND_NAVY};">New Application Received</h2>

<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:16px;">
  <tr>
    <td style="padding:8px 0;font-size:13px;color:#64748b;width:120px;vertical-align:top;">Company</td>
    <td style="padding:8px 0;font-size:15px;font-weight:600;color:${BRAND_NAVY};">${escapeHtml(companyName)}</td>
  </tr>
  <tr>
    <td style="padding:8px 0;font-size:13px;color:#64748b;vertical-align:top;">Contact</td>
    <td style="padding:8px 0;font-size:15px;color:${BRAND_NAVY};">${escapeHtml(contactName)}</td>
  </tr>
  <tr>
    <td style="padding:8px 0;font-size:13px;color:#64748b;vertical-align:top;">Email</td>
    <td style="padding:8px 0;font-size:15px;color:${BRAND_NAVY};"><a href="mailto:${escapeHtml(contactEmail)}" style="color:${BRAND_BLUE};text-decoration:none;">${escapeHtml(contactEmail)}</a></td>
  </tr>
</table>

<p style="font-size:13px;color:#64748b;margin-bottom:4px;">Tech Summary Preview</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:16px;">
  <tr>
    <td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px;font-size:14px;color:${BRAND_NAVY};line-height:1.6;">
      ${escapeHtml(techSummary)}
    </td>
  </tr>
</table>

${button('Review in Admin Dashboard', adminDashboardUrl)}
`;

  return { subject, html: layout(body) };
}

// ---------------------------------------------------------------------------
// 5. Spotlight Digest
// ---------------------------------------------------------------------------

export function spotlightDigestEmail(params: {
  contactName: string;
  companyName: string;
  topics: Array<{ title: string; agency: string; closeDate: string; matchScore: number; url: string }>;
  dashboardUrl: string;
}): { subject: string; html: string } {
  const { contactName, companyName, topics, dashboardUrl } = params;

  const subject = `Your Spotlight: ${topics.length} matched opportunities for ${escapeHtml(companyName)}`;

  const topicRows = topics
    .map(
      (t) => `
  <tr>
    <td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;">
      <a href="${escapeHtml(t.url)}" style="color:${BRAND_BLUE};text-decoration:none;font-weight:600;font-size:14px;">${escapeHtml(t.title)}</a>
      <br>
      <span style="font-size:13px;color:#64748b;">${escapeHtml(t.agency)} &middot; Closes ${escapeHtml(t.closeDate)}</span>
    </td>
    <td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;text-align:right;vertical-align:top;">
      <span style="display:inline-block;background:${t.matchScore >= 80 ? '#dcfce7' : t.matchScore >= 60 ? '#fef9c3' : '#f1f5f9'};color:${t.matchScore >= 80 ? '#166534' : t.matchScore >= 60 ? '#854d0e' : '#475569'};font-size:13px;font-weight:700;padding:4px 10px;border-radius:12px;">${t.matchScore}%</span>
    </td>
  </tr>`,
    )
    .join('');

  const body = `
<h2 style="margin:0 0 16px;font-size:20px;color:${BRAND_NAVY};">Hi ${escapeHtml(contactName)},</h2>
<p>Here are the latest matched opportunities for <strong>${escapeHtml(companyName)}</strong> from your RFP Pipeline Spotlight:</p>

<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;margin:16px 0;">
  <tr>
    <td style="padding:10px 16px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e2e8f0;">Opportunity</td>
    <td style="padding:10px 16px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e2e8f0;text-align:right;">Match</td>
  </tr>
  ${topicRows}
</table>

${button('Log In to View All Matches', dashboardUrl)}

<p style="font-size:13px;color:#64748b;margin-top:8px;">Scores are based on your company profile and uploaded documents. Upload more capability statements to improve match accuracy.</p>
`;

  return { subject, html: layout(body) };
}
