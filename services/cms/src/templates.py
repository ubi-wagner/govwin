"""Email template renderer for automation rules."""

TEMPLATES = {
    'application_accepted': lambda p: f'''
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1e293b;">Welcome to RFP Pipeline!</h2>
            <p>Hi {p.get('contactName', 'there')},</p>
            <p>Your application for <strong>{p.get('tenantName', p.get('companyName', 'your company'))}</strong> has been accepted.</p>
            <p>Your workspace is ready. Log in to get started:</p>
            <div style="background: #f8fafc; padding: 16px; border-radius: 8px; margin: 16px 0;">
                <p style="margin: 4px 0;"><strong>Email:</strong> {p.get('contactEmail', '')}</p>
                <p style="margin: 4px 0;"><strong>Workspace:</strong> /portal/{p.get('tenantSlug', '')}</p>
            </div>
            <p style="color: #64748b; font-size: 14px;">Questions? Reply to this email or contact eric@rfppipeline.com</p>
        </div>
    ''',
    'application_rejected': lambda p: f'''
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1e293b;">Application Update</h2>
            <p>Hi {p.get('contactName', 'there')},</p>
            <p>Thank you for your interest in RFP Pipeline. After careful review, we're unable to accept your application at this time.</p>
            {f'<p><strong>Feedback:</strong> {p.get("reason", "")}</p>' if p.get('reason') else ''}
            <p>We encourage you to reapply in the future. Contact eric@rfppipeline.com if you have questions.</p>
        </div>
    ''',
    'admin_notification': lambda p: f'''
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1e293b;">Admin Alert</h2>
            <p><strong>Event:</strong> {p.get('event_type', 'unknown')}</p>
            <p><strong>Company:</strong> {p.get('companyName', 'N/A')}</p>
            <p><strong>Contact:</strong> {p.get('contactEmail', 'N/A')}</p>
            <p style="color: #64748b; font-size: 14px;">View details in the admin dashboard.</p>
        </div>
    ''',
}

def render_template(name: str, payload: dict) -> str | None:
    fn = TEMPLATES.get(name)
    if not fn:
        return None
    try:
        return fn(payload)
    except Exception:
        return None
