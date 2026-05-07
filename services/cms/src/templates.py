"""Email template renderer for automation rules."""
from html import escape as _esc


# ── Brand constants (matching frontend email-templates.ts) ────────
BRAND_NAVY = '#1e293b'
BRAND_BLUE = '#2563eb'
BRAND_CREAM = '#faf7f2'


def _e(val: object) -> str:
    """Escape a value for safe HTML embedding."""
    return _esc(str(val)) if val else ''


def _layout(body: str) -> str:
    """Wrap email body in the branded layout matching the frontend templates."""
    return f'''<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:{BRAND_CREAM};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:{BRAND_CREAM};">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="background-color:{BRAND_NAVY};padding:24px 32px;">
              <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">RFP Pipeline</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;color:{BRAND_NAVY};font-size:15px;line-height:1.6;">
              {body}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #e2e8f0;font-size:13px;color:#64748b;text-align:center;">
              Questions? Contact <a href="mailto:eric@rfppipeline.com" style="color:{BRAND_BLUE};text-decoration:none;">eric@rfppipeline.com</a>
              <br style="margin-top:8px;">
              <span style="color:#94a3b8;">&copy; RFP Pipeline</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>'''


def _button(text: str, href: str) -> str:
    """Render a CTA button matching the frontend template style."""
    return f'''<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
  <tr>
    <td style="background-color:{BRAND_BLUE};border-radius:6px;">
      <a href="{_e(href)}" target="_blank" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
        {_e(text)}
      </a>
    </td>
  </tr>
</table>'''


# ── Templates ─────────────────────────────────────────────────────

TEMPLATES = {
    # ── Existing templates (upgraded to branded layout) ────────────

    'application_accepted': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">Congratulations, {_e(p.get('contactName', 'there'))}!</h2>
        <p>Your application for <strong>{_e(p.get('tenantName', p.get('companyName', 'your company')))}</strong> has been approved.</p>
        <p>Your workspace is ready. Log in to get started:</p>
        <div style="background: #f8fafc; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p style="margin: 4px 0;"><strong>Email:</strong> {_e(p.get('contactEmail', ''))}</p>
            <p style="margin: 4px 0;"><strong>Workspace:</strong> /portal/{_e(p.get('tenantSlug', ''))}</p>
        </div>
        {_button('Log In to RFP Pipeline', p.get('loginUrl', '/login'))}
    '''),

    'application_rejected': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">Hi {_e(p.get('contactName', 'there'))},</h2>
        <p>Thank you for your interest in RFP Pipeline. After careful review, we are unable to accept your application at this time.</p>
        {f'<p><strong>Feedback:</strong> {_e(p.get("reason", ""))}</p>' if p.get('reason') else ''}
        <p>We encourage you to reapply in the future.</p>
    '''),

    'admin_notification': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">Admin Alert</h2>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:16px;">
          <tr>
            <td style="padding:8px 0;font-size:13px;color:#64748b;width:120px;">Event</td>
            <td style="padding:8px 0;font-size:15px;font-weight:600;color:{BRAND_NAVY};">{_e(p.get('event_type', 'unknown'))}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;font-size:13px;color:#64748b;">Company</td>
            <td style="padding:8px 0;font-size:15px;color:{BRAND_NAVY};">{_e(p.get('companyName', 'N/A'))}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;font-size:13px;color:#64748b;">Contact</td>
            <td style="padding:8px 0;font-size:15px;color:{BRAND_NAVY};">{_e(p.get('contactEmail', 'N/A'))}</td>
          </tr>
        </table>
        {_button('View in Admin Dashboard', '/admin')}
    '''),

    # ── New templates ─────────────────────────────────────────────

    'welcome_accepted': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">Welcome to RFP Pipeline!</h2>
        <p>Hi {_e(p.get('contactName', 'there'))},</p>
        <p>Your application for <strong>{_e(p.get('tenantName', p.get('companyName', 'your company')))}</strong>
           has been approved. Your account is ready.</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px;margin:16px 0;">
            <p style="margin:4px 0;"><strong>Email:</strong> {_e(p.get('contactEmail', ''))}</p>
            <p style="margin:4px 0;"><strong>Workspace:</strong> /portal/{_e(p.get('tenantSlug', ''))}</p>
        </div>
        <p style="margin-top:24px;font-weight:600;">Getting started:</p>
        <ol style="padding-left:20px;margin:8px 0 0;">
          <li style="margin-bottom:6px;">Log in at the link below</li>
          <li style="margin-bottom:6px;">Set your permanent password</li>
          <li style="margin-bottom:6px;">Upload your company documents</li>
          <li style="margin-bottom:6px;">Review your Spotlight for matched opportunities</li>
        </ol>
        {_button('Log In to RFP Pipeline', p.get('loginUrl', '/login'))}
    '''),

    'proposal_workspace_ready': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">Your proposal workspace is ready!</h2>
        <p>Hi {_e(p.get('contactName', 'there'))},</p>
        <p>Your proposal workspace for <strong>{_e(p.get('proposalTitle', p.get('title', 'your opportunity')))}</strong>
           has been created{f" with {_e(p.get('sectionCount', ''))} sections" if p.get('sectionCount') else ''}.</p>
        <p>Our AI assistants have drafted initial content for each section based on the solicitation
           requirements and your company library. You can review and refine each section in the workspace.</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px;margin:16px 0;">
            <p style="margin:4px 0;"><strong>Proposal:</strong> {_e(p.get('proposalTitle', p.get('title', 'N/A')))}</p>
            <p style="margin:4px 0;"><strong>Agency:</strong> {_e(p.get('agency', 'N/A'))}</p>
            <p style="margin:4px 0;"><strong>Close Date:</strong> {_e(p.get('closeDate', 'N/A'))}</p>
        </div>
        {_button('Open Workspace', p.get('workspaceUrl', '/portal'))}
    '''),

    'stage_advanced': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">Proposal stage updated</h2>
        <p>Hi {_e(p.get('contactName', 'there'))},</p>
        <p>Your proposal <strong>{_e(p.get('proposalTitle', p.get('title', 'your proposal')))}</strong>
           has moved to the <strong>{_e(p.get('toStage', p.get('stage', 'next')))}</strong> stage.</p>
        {f"""<p>Previous stage: {_e(p.get('fromStage', ''))}</p>""" if p.get('fromStage') else ''}
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:16px;margin:16px 0;">
            <p style="margin:0;font-weight:600;color:#166534;">
                {_e(p.get('fromStage', '?'))} &rarr; {_e(p.get('toStage', p.get('stage', '?')))}
            </p>
        </div>
        {_button('View Proposal', p.get('workspaceUrl', '/portal'))}
    '''),

    'source_change_detected': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">Source Scout: Changes Detected</h2>
        <p>Source Scout has detected meaningful changes on a monitored source.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:16px;">
          <tr>
            <td style="padding:8px 0;font-size:13px;color:#64748b;width:140px;">Source</td>
            <td style="padding:8px 0;font-size:15px;font-weight:600;color:{BRAND_NAVY};">{_e(p.get('sourceName', p.get('source_name', 'Unknown source')))}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;font-size:13px;color:#64748b;">Changes found</td>
            <td style="padding:8px 0;font-size:15px;color:{BRAND_NAVY};">{_e(p.get('meaningfulChanges', p.get('meaningful_changes', 'N/A')))}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;font-size:13px;color:#64748b;">Drafts created</td>
            <td style="padding:8px 0;font-size:15px;color:{BRAND_NAVY};">{_e(p.get('draftsCreated', p.get('drafts_created', 'N/A')))}</td>
          </tr>
        </table>
        <p>Review the new draft solicitations in the admin dashboard and decide which ones to curate and push to Spotlight.</p>
        {_button('Review in Admin Dashboard', '/admin/curation')}
    '''),

    'new_rfp_uploaded': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">New RFP Uploaded</h2>
        <p>A new RFP document has been uploaded and is ready for curation.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:16px;">
          <tr>
            <td style="padding:8px 0;font-size:13px;color:#64748b;width:140px;">Solicitation</td>
            <td style="padding:8px 0;font-size:15px;font-weight:600;color:{BRAND_NAVY};">{_e(p.get('solicitationTitle', p.get('title', 'N/A')))}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;font-size:13px;color:#64748b;">Agency</td>
            <td style="padding:8px 0;font-size:15px;color:{BRAND_NAVY};">{_e(p.get('agency', 'N/A'))}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;font-size:13px;color:#64748b;">Documents</td>
            <td style="padding:8px 0;font-size:15px;color:{BRAND_NAVY};">{_e(p.get('documentCount', len(p.get('documentIds', []))))}</td>
          </tr>
        </table>
        <p>The document has been shredded and compliance variables extracted. Review and curate in the admin dashboard.</p>
        {_button('Review in Admin Dashboard', '/admin/curation')}
    '''),
}


def render_template(name: str, payload: dict) -> str | None:
    fn = TEMPLATES.get(name)
    if not fn:
        return None
    try:
        if not isinstance(payload, dict):
            return None
        return fn(payload)
    except Exception:
        return None
