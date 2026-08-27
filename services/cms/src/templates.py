"""
Email template renderer with Jinja2 and trigger flag system.

Provides:
  - Jinja2-based template rendering (DB templates + inline fallbacks)
  - Trigger flag embedding/extraction for closed-loop email automation
  - Profile variable resolution from Main Postgres
  - Backward-compatible render_template() for existing callers
"""
import base64
import json
import logging
import re
from datetime import datetime, timezone
from html import escape as _esc

from jinja2 import Environment, BaseLoader, TemplateSyntaxError, Undefined, UndefinedError

logger = logging.getLogger('cms.templates')

# ── Brand constants (matching frontend email-templates.ts) ────────
BRAND_NAVY = '#1e293b'
BRAND_BLUE = '#2563eb'
BRAND_CREAM = '#faf7f2'

# ── Jinja2 environments ──────────────────────────────────────────
# HTML environment: autoescape ON so user-supplied variables are escaped
_jinja_env = Environment(
    loader=BaseLoader(),
    autoescape=True,
    variable_start_string='{{',
    variable_end_string='}}',
    undefined=Undefined,  # silently renders undefined as empty string
)

# Plain-text environment: autoescape OFF for subjects and non-HTML output
_jinja_env_text = Environment(
    loader=BaseLoader(),
    autoescape=False,
    variable_start_string='{{',
    variable_end_string='}}',
    undefined=Undefined,
)

# Regex for extracting trigger flags from email body
_TRIGGER_PATTERN = re.compile(r'<!--RFP-TRIGGER:([A-Za-z0-9+/=]+)-->')


# ── HTML helpers ─────────────────────────────────────────────────

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


# ── Legacy templates (backward compatibility) ────────────────────
# These are the original lambda-based templates. They remain functional
# for existing callers that use render_template('template_name', payload).

TEMPLATES = {
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

    # The active "Admin alert on new application" rule names this template; without
    # it the notify_admin handler silently fell back to the generic admin_notification.
    'admin_new_application': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">New founding-cohort application</h2>
        <p>A new company has applied to the RFP Pipeline:</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px;margin:16px 0;">
            <p style="margin:4px 0;"><strong>{_e(p.get('companyName', p.get('tenantName', 'A company')))}</strong></p>
            <p style="margin:4px 0;color:#64748b;">{_e(p.get('contactName', ''))} · {_e(p.get('contactEmail', ''))}</p>
        </div>
        <p>Review and accept or reject it in the admin console.</p>
        {_button('Review applications', '/admin/applications')}
    '''),

    # ── Task nudges (W-N/O) ────────────────────────────────────────────
    # Escalating reminder for an assigned task. The login link points at the
    # in-between landing page (/go?task=...) which routes to the task after login.
    'task_nudge': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">
          {'Final reminder' if p.get('is_final') else 'Reminder'}: a task needs your attention
        </h2>
        <p>This is {('the final reminder' if p.get('is_final') else f"reminder #{_e(str(p.get('nudge_index', 1)))}")}
           for a task assigned to you:</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px;margin:16px 0;">
            <p style="margin:4px 0;"><strong>{_e(p.get('title', 'Your task'))}</strong></p>
            {f"<p style='margin:4px 0;color:#64748b;'>Due {_e(str(p.get('due_at',''))[:10])}</p>" if p.get('due_at') else ''}
        </div>
        <p>Log in to pick it up — you'll land right on it:</p>
        {_button('Open my task', p.get('login_url', '/login'))}
    '''),

    'task_nudge_manager': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">A task on your team is overdue for action</h2>
        <p>A task assigned to a member of your team has reached its final reminder without being completed:</p>
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:16px;margin:16px 0;">
            <p style="margin:4px 0;"><strong>{_e(p.get('title', 'A task'))}</strong></p>
            {f"<p style='margin:4px 0;color:#b91c1c;'>Due {_e(str(p.get('due_at',''))[:10])}</p>" if p.get('due_at') else ''}
        </div>
        <p>You may want to follow up or reassign it.</p>
        {_button('Review in the workspace', p.get('login_url', '/login'))}
    '''),

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


# ── Jinja2 Template Rendering ───────────────────────────────────

def render_jinja2(template_body: str, context: dict, *, text_mode: bool = False) -> str:
    """
    Render a Jinja2 template string with the given context.
    Handles {{variable}} syntax used in DB templates.

    Args:
        text_mode: If True, use the plain-text Jinja2 env (no HTML escaping).
                   Use for email subjects and other non-HTML output.
    """
    env = _jinja_env_text if text_mode else _jinja_env
    try:
        tmpl = env.from_string(template_body)
        return tmpl.render(**context)
    except (TemplateSyntaxError, UndefinedError) as e:
        logger.error(f'[render_jinja2] Template error: {e}')
        # Fallback: simple string replacement for {{var}} patterns
        result = template_body
        for key, val in context.items():
            replacement = str(val) if val is not None else ''
            if not text_mode:
                replacement = _esc(replacement)
            result = result.replace('{{' + key + '}}', replacement)
        return result
    except Exception as e:
        logger.error(f'[render_jinja2] Unexpected error: {e}')
        return template_body


async def render_db_template(slug: str, context: dict, pool, profile: dict | None = None) -> dict | None:
    """
    Fetch a template from the DB by slug and render it with Jinja2.

    Returns: {subject, body_html, body_text, template_id, trigger_config, response_map, profile_variables, template_category}
    or None if template not found.
    """
    try:
        row = await pool.fetchrow(
            '''SELECT id, slug, subject_template, body_html, body_text,
                      trigger_config, response_map, profile_variables, template_category
               FROM email_templates
               WHERE slug = $1 AND is_active = TRUE''',
            slug,
        )
        if not row:
            return None

        # Merge profile data into context
        merged = {**context}
        if profile:
            merged.update(profile)

        subject = render_jinja2(row['subject_template'], merged, text_mode=True)
        body_html = render_jinja2(row['body_html'], merged)
        body_text = render_jinja2(row['body_text'], merged, text_mode=True) if row['body_text'] else ''

        return {
            'subject': subject,
            'body_html': body_html,
            'body_text': body_text,
            'template_id': str(row['id']),
            'trigger_config': row['trigger_config'] or {},
            'response_map': row['response_map'] or {},
            'profile_variables': row['profile_variables'] or [],
            'template_category': row['template_category'] or 'outreach',
        }
    except Exception as e:
        logger.error(f'[render_db_template] Error rendering slug={slug}: {e}')
        return None


def render_template(name: str, payload: dict) -> str | None:
    """
    Backward-compatible template renderer.

    Tries legacy lambda templates first, then falls back to Jinja2
    rendering of the body if the name looks like a template body.
    Existing callers (event_listener, etc.) continue to work unchanged.
    """
    fn = TEMPLATES.get(name)
    if fn:
        try:
            if not isinstance(payload, dict):
                return None
            return fn(payload)
        except Exception:
            return None

    # If name contains HTML or {{, treat it as an inline template body
    if '{{' in name or '<' in name:
        try:
            rendered_body = render_jinja2(name, payload)
            return _layout(rendered_body)
        except Exception:
            return None

    return None


# ── Trigger Flag System ──────────────────────────────────────────

def embed_trigger_flags(html: str, trigger_meta: dict) -> str:
    """
    Inject a hidden HTML comment containing base64-encoded trigger metadata
    at the end of the email body. This survives email forwarding and quoting.

    The comment is placed just before </body> if present, otherwise appended.

    Format: <!--RFP-TRIGGER:base64_encoded_json-->
    """
    if not trigger_meta:
        return html

    try:
        meta_json = json.dumps(trigger_meta, separators=(',', ':'), sort_keys=True)
        encoded = base64.b64encode(meta_json.encode('utf-8')).decode('ascii')
        comment = f'<!--RFP-TRIGGER:{encoded}-->'

        # Insert before </body> if present, otherwise append
        if '</body>' in html:
            return html.replace('</body>', f'{comment}\n</body>')
        else:
            return html + '\n' + comment
    except Exception as e:
        logger.error(f'[embed_trigger_flags] Error encoding trigger: {e}')
        return html


def extract_trigger_flags(email_body: str) -> dict | None:
    """
    Parse the hidden HTML comment to extract trigger metadata from an email body.

    Searches the entire body for <!--RFP-TRIGGER:base64--> pattern.
    Returns the decoded dict, or None if no trigger found.
    """
    if not email_body:
        return None

    match = _TRIGGER_PATTERN.search(email_body)
    if not match:
        return None

    try:
        decoded = base64.b64decode(match.group(1)).decode('utf-8')
        return json.loads(decoded)
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as e:
        logger.error(f'[extract_trigger_flags] Error decoding trigger: {e}')
        return None


def build_trigger_metadata(template: dict, send_context: dict) -> dict:
    """
    Build the full trigger metadata dict from a template's trigger_config
    and the send context.

    Args:
        template: dict with trigger_config, response_map, id, etc.
                  Can be a DB row dict or a render_db_template result.
        send_context: dict with send_id, tenant_id, campaign_id, etc.

    Returns: dict suitable for storing in email_sends.trigger_metadata
             and embedding in the email body.
    """
    trigger_config = template.get('trigger_config') or {}
    if not trigger_config:
        return {}

    now = datetime.now(timezone.utc).isoformat()

    metadata = {
        'namespace': trigger_config.get('namespace', 'system'),
        'type': trigger_config.get('type', 'email.sent'),
        'send_id': send_context.get('send_id', ''),
        'tenant_id': send_context.get('tenant_id'),
        'campaign_id': send_context.get('campaign_id'),
        'template_id': send_context.get('template_id') or str(template.get('id', '')),
        'template_slug': template.get('slug', ''),
        'timestamp': now,
        'expected_responses': trigger_config.get('expected_responses', []),
        'auto_response_enabled': trigger_config.get('auto_response_enabled', False),
        'escalation_on': trigger_config.get('escalation_on', []),
    }

    # Include step if present (for drip campaigns)
    step = trigger_config.get('step') or send_context.get('step')
    if step:
        metadata['step'] = step

    # Include context_fields values if specified
    context_fields = trigger_config.get('context_fields', [])
    if context_fields:
        metadata['context'] = {
            f: send_context.get(f) for f in context_fields if send_context.get(f) is not None
        }

    return metadata


async def resolve_profile_variables(
    profile_variables: list[str],
    tenant_id: str | None,
    user_email: str | None,
    shared_pool,
) -> dict:
    """
    Fetch customer profile data from Main Postgres via the shared (event bridge) pool.

    Resolves known profile fields:
      - company_name, lifecycle_stage, tier (product_tier): from tenants table
      - contact_name, contact_email: from users table
      - application_date: from tenants table
      - active_proposals: count from proposals table (by stage)
      - matched_opportunities: count from tenant_opportunity_cards table

    Args:
        profile_variables: list of field names to resolve
        tenant_id: tenant UUID (optional)
        user_email: user email for contact lookup (optional)
        shared_pool: asyncpg pool connected to main database

    Returns: flat dict of resolved values (missing fields are empty strings)
    """
    if not profile_variables or not shared_pool:
        return {}

    import uuid as uuid_mod

    _tenant_uuid = None
    if tenant_id:
        try:
            _tenant_uuid = uuid_mod.UUID(tenant_id) if isinstance(tenant_id, str) else tenant_id
        except (ValueError, AttributeError):
            pass

    result = {var: '' for var in profile_variables}

    try:
        # Resolve tenant-level fields
        tenant_fields = {'company_name', 'lifecycle_stage', 'tier', 'application_date'}
        needs_tenant = bool(tenant_fields & set(profile_variables))

        if needs_tenant and _tenant_uuid:
            tenant_row = await shared_pool.fetchrow(
                '''SELECT name, lifecycle_stage, product_tier, created_at
                   FROM tenants WHERE id = $1''',
                _tenant_uuid,
            )
            if tenant_row:
                if 'company_name' in profile_variables:
                    result['company_name'] = tenant_row['name'] or ''
                if 'lifecycle_stage' in profile_variables:
                    result['lifecycle_stage'] = tenant_row['lifecycle_stage'] or ''
                if 'tier' in profile_variables:
                    result['tier'] = tenant_row['product_tier'] or ''
                if 'application_date' in profile_variables:
                    result['application_date'] = (
                        tenant_row['created_at'].strftime('%Y-%m-%d')
                        if tenant_row['created_at'] else ''
                    )

        # Resolve user/contact fields
        contact_fields = {'contact_name', 'contact_email'}
        needs_contact = bool(contact_fields & set(profile_variables))

        if needs_contact and user_email:
            user_row = await shared_pool.fetchrow(
                '''SELECT name, email FROM users WHERE email = $1''',
                user_email,
            )
            if user_row:
                if 'contact_name' in profile_variables:
                    result['contact_name'] = user_row['name'] or ''
                if 'contact_email' in profile_variables:
                    result['contact_email'] = user_row['email'] or ''

        # Resolve aggregate fields
        if 'active_proposals' in profile_variables and _tenant_uuid:
            try:
                count = await shared_pool.fetchval(
                    '''SELECT COUNT(*) FROM proposals
                       WHERE tenant_id = $1 AND stage NOT IN ('archived')''',
                    _tenant_uuid,
                )
                result['active_proposals'] = str(count or 0)
            except Exception:
                result['active_proposals'] = '0'

        if 'matched_opportunities' in profile_variables and _tenant_uuid:
            try:
                count = await shared_pool.fetchval(
                    '''SELECT COUNT(*) FROM tenant_opportunity_cards
                       WHERE tenant_id = $1 AND lifecycle_status <> 'archived' ''',
                    _tenant_uuid,
                )
                result['matched_opportunities'] = str(count or 0)
            except Exception:
                result['matched_opportunities'] = '0'

    except Exception as e:
        logger.error(f'[resolve_profile_variables] Error resolving profile for tenant={tenant_id}: {e}')

    return result


# ── Launch Review Fix 2: workflow NOTIFY-step templates ──────────────────────
# These 6 templates back NOTIFY steps in the Process Templates. They were absent
# from TEMPLATES, so render_template returned None -> silent no-send. After
# migration 052 made these NOTIFY steps the sole notification owners, their
# absence meant rfp_admin stopped being notified (the 052 regression). _layout()
# takes only the body; defensive p.get(...) guarantees a render. (Launch Review #2.)
TEMPLATES.update({
    # ── Post-award projects (D6) ─────────────────────────────────────────────────────────────
    #
    # The award bridge's NOTIFY step names this template. A NOTIFY naming a template that exists
    # nowhere does not error — `render_template()` returns None and the listener emits
    # `system:notification.failed` instead of sending mail. That has happened twice (the 052
    # regression, then eight more found by audit join 7), which is why the template is written in
    # the same change as the workflow that names it.
    # ── Project work assigned to a person (G1) ──────────────────────────────────────────────
    # WRITTEN IN THE SAME CHANGE AS `lib/projects/todos.ts`, which names it. A template referenced
    # by code and defined nowhere emits `notification.failed` instead of sending — B141, twice.
    #
    # One task, one mail, because this one IS per-person and per-item: "you have been given this".
    # The GROUPED mail is `project_nudge`, which chases what is already known.
    'project_task_assigned': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">A task is yours</h2>
        <p><strong>{_e(str(p.get('title') or 'A project task'))}</strong>
        {' on ' + _e(str(p.get('project'))) if p.get('project') else ''}.</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px;margin:16px 0;">
            <p style="margin:4px 0;font-size:14px;color:#475569;">
            {'Due <strong>' + _e(str(p.get('dueOn'))) + '</strong>.' if p.get('dueOn')
             else 'No due date set.'}
            It is in your to-do queue, and the project workspace is where you tick it off.</p>
        </div>
        {_button('Open the project', p.get('workspaceUrl', '/portal'))}
    '''),
    # ── The project nudge (M2) ──────────────────────────────────────────────────────────────
    # WRITTEN IN THE SAME CHANGE AS THE SWEEP THAT NAMES IT. B141: eight NOTIFY steps named a
    # template that existed nowhere, so the mail emitted `notification.failed` instead of sending —
    # twice. A template referenced by a code path and defined nowhere is a silent no-send.
    #
    # One mail per tenant per sweep, grouping every milestone and task that came due or went late.
    # Per-row mail would be the fastest possible way to teach someone to filter this sender.
    'project_nudge': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">Coming due on your projects</h2>
        <p>{_e(str(p.get('summary') or 'Some project work is due soon or already late.'))}</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px;margin:16px 0;">
            {''.join(
                f'<p style="margin:6px 0;font-size:14px;color:#475569;">'
                f'<strong>{_e(str(i.get("title") or "Untitled"))}</strong>'
                f'{" &mdash; " + _e(str(i.get("project"))) if i.get("project") else ""}'
                f'<br><span style="color:{"#b91c1c" if i.get("overdue") else "#475569"};">'
                f'{"overdue" if i.get("overdue") else "due"} {_e(str(i.get("dueOn") or ""))}'
                f' &middot; {_e(str(i.get("kind") or "item"))}</span></p>'
                for i in (p.get('items') or [])[:20]
            ) or '<p style="margin:4px 0;font-size:14px;color:#475569;">Nothing outstanding.</p>'}
        </div>
        <p style="font-size:13px;color:#64748b;">You are seeing this because you own or are assigned
        to this work. Ticking a task off, or closing the milestone, stops the reminder.</p>
        {_button('Open your projects', p.get('workspaceUrl', '/portal'))}
    '''),
    # ── The mention (H1) ────────────────────────────────────────────────────────────────────
    # WRITTEN IN THE SAME CHANGE AS `lib/projects/comments.ts`, which names it. B141 twice over:
    # a template referenced by a code path and defined nowhere emits `notification.failed` instead
    # of sending, and nothing downstream notices.
    #
    # One mail per mentioned person. Unlike the nudge this is NOT grouped and NOT repeated: a
    # mention happens once, somebody chose to say it to you, and a digest would strip exactly the
    # thing that makes it worth reading.
    'project_comment_mention': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">You were mentioned</h2>
        <p>Somebody mentioned you in a comment
        {' on ' + _e(str(p.get('project'))) if p.get('project') else ' on a project'}.</p>
        <div style="background:#f8fafc;border-left:3px solid {BRAND_NAVY};border-radius:4px;padding:16px;margin:16px 0;">
            <p style="margin:0;font-size:14px;color:#334155;white-space:pre-wrap;">{_e(str(p.get('excerpt') or ''))}</p>
        </div>
        <p style="font-size:13px;color:#64748b;">It is in your to-do queue as well. Replying in the
        workspace, or resolving the thread, clears it.</p>
        {_button('Open the conversation', p.get('workspaceUrl', '/portal'))}
    '''),
    'project_setup_ready': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">Congratulations &mdash; you won</h2>
        <p><strong>{_e(str(p.get('title') or 'Your proposal'))}</strong> has been recorded as awarded,
        and a project is ready to set up.</p>
        <p>Two documents start it off: the <strong>executed contract</strong> and the
        <strong>proposal as submitted</strong>. Everything the workspace tracks &mdash; CLINs,
        milestones, deliverables &mdash; is measured against those two files, so the workspace asks
        for them before it will let you baseline the schedule.</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px;margin:16px 0;">
            <p style="margin:4px 0;font-size:14px;color:#475569;">A task has been added to your
            queue: <strong>Set up project</strong>.</p>
        </div>
        {_button('Set up the workspace', p.get('workspaceUrl', '/portal'))}
    '''),
    'rfp_ready_for_curation': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">RFP ready for curation</h2>
        <p>An uploaded RFP has been shredded and is ready for triage.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:16px;">
          <tr><td style="padding:8px 0;font-size:13px;color:#64748b;width:140px;">Solicitation</td>
              <td style="padding:8px 0;font-size:15px;font-weight:600;color:{BRAND_NAVY};">{_e(str(p.get('solicitationId') or p.get('title') or 'see triage queue'))}</td></tr>
          <tr><td style="padding:8px 0;font-size:13px;color:#64748b;">Documents</td>
              <td style="padding:8px 0;font-size:15px;color:{BRAND_NAVY};">{_e(str(p.get('documentCount', '')))}</td></tr>
        </table>
        {_button('Review in Admin Dashboard', '/admin/curation')}
    '''),
    'review_ready': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">Proposal ready for review</h2>
        <p><strong>{_e(str(p.get('proposalTitle') or 'A proposal'))}</strong> has advanced to the review stage.</p>
        <p>Open the proposal workspace to complete your review and advance it to the next gate.</p>
        {_button('Open Workspace', p.get('workspaceUrl', '/portal'))}
    '''),
    'proposal_final_ready': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">Final package ready</h2>
        <p><strong>{_e(str(p.get('proposalTitle') or 'A proposal'))}</strong> reached the final stage and its
        compliance-checked export package has been generated.</p>
        {_button('Open Workspace', p.get('workspaceUrl', '/portal'))}
    '''),
    'document_locked_team_notify': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">A proposal document is locked</h2>
        <p>Good news &mdash; a document on your proposal has been fully reviewed and locked.</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px;margin:16px 0;">
            {f'<p style="margin:4px 0;"><strong>Document:</strong> {_e(p.get("volumeName"))}</p>' if p.get('volumeName') else ''}
            <p style="margin:4px 0;"><strong>Sections locked:</strong> {_e(p.get('sectionCount', 'N/A'))}</p>
            <p style="margin:4px 0;"><strong>Current stage:</strong> {_e(p.get('stage', 'N/A'))}</p>
        </div>
        <p>Locked sections are captured and snapshotted. When every document is locked, the proposal is ready to advance.</p>
        {_button('Open Workspace', p.get('workspaceUrl', '/portal'))}
    '''),
    'collaborator_get_ready': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">Your proposal is ready to advance</h2>
        <p>Every section of your proposal is now accepted and locked. It is ready to move to the next stage.</p>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:16px;margin:16px 0;">
            <p style="margin:0;font-weight:600;color:#166534;">All {_e(p.get('sectionCount', ''))} sections locked &mdash; ready at the <strong>{_e(p.get('stage', 'current'))}</strong> gate.</p>
        </div>
        <p>Get your team ready: open the workspace to review the locked package and advance the proposal when you are set.</p>
        {_button('Open Workspace', p.get('workspaceUrl', '/portal'))}
    '''),
    'admin_proposal_review_required': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">New proposal &mdash; admin review required</h2>
        <p>A new proposal workspace was created and needs admin review.</p>
        <p><strong>Proposal:</strong> {_e(str(p.get('proposalId') or 'see admin dashboard'))}</p>
        {_button('View in Admin Dashboard', '/admin')}
    '''),
    'spotlight_new_topics': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">New topics in Spotlight</h2>
        <p>A solicitation was pushed with new topics for matched tenants.</p>
        <p><strong>Solicitation:</strong> {_e(str(p.get('solicitationId') or p.get('title') or 'see Spotlight'))}</p>
    '''),
    # RANK-9 pre-purchase start nudge: a high-fit opportunity is closing soon and the customer hasn't
    # started a proposal. Generic urgency + a CTA into their pipeline (multi-tenant: one render, sent per
    # tenant, gated by notify_on_new_priority_opp).
    'start_nudge': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">A high-fit opportunity is closing soon</h2>
        <p>One or more opportunities that score well against your spotlight buckets are approaching their
        close date, and you haven't started a proposal yet. There's still time — starting now gives you
        the runway to put together a strong submission.</p>
        {_button('Review your pipeline', '/portal')}
    '''),
    'source_scout_changes': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">Source Scout detected changes</h2>
        <p>Source Scout found changes on a monitored source and created draft solicitations for review.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:16px;">
          <tr><td style="padding:8px 0;font-size:13px;color:#64748b;width:140px;">Source</td>
              <td style="padding:8px 0;font-size:15px;font-weight:600;color:{BRAND_NAVY};">{_e(str(p.get('sourceName') or p.get('sourceId') or 'see Sources'))}</td></tr>
          <tr><td style="padding:8px 0;font-size:13px;color:#64748b;">Drafts created</td>
              <td style="padding:8px 0;font-size:15px;color:{BRAND_NAVY};">{_e(str(p.get('draftsCreated', '')))}</td></tr>
        </table>
        {_button('Review in Admin Dashboard', '/admin/curation')}
    '''),
    # Scouting Spine M2 (C2.b): backs the NOTIFY step of the OnOpportunitiesDetected
    # workflow. A scheduled ingest/scout run that created >=1 new triage row emits
    # finder:opportunities.detected, whose workflow posts notification.requested with
    # this template name. Payload fields { source, newSolicitations, newTopics,
    # sampleTitles }. Defensive p.get(...) so the render never returns falsy.
    'new_opportunities_to_triage': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">New opportunities to triage</h2>
        <p>A scouting run found new opportunities that are waiting in the triage queue.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:16px;">
          <tr><td style="padding:8px 0;font-size:13px;color:#64748b;width:160px;">Source</td>
              <td style="padding:8px 0;font-size:15px;font-weight:600;color:{BRAND_NAVY};">{_e(str(p.get('source') or p.get('sourceName') or p.get('sourceId') or 'see triage queue'))}</td></tr>
          <tr><td style="padding:8px 0;font-size:13px;color:#64748b;">New solicitations</td>
              <td style="padding:8px 0;font-size:15px;color:{BRAND_NAVY};">{_e(str(p.get('newSolicitations', 0)))}</td></tr>
          <tr><td style="padding:8px 0;font-size:13px;color:#64748b;">New topics</td>
              <td style="padding:8px 0;font-size:15px;color:{BRAND_NAVY};">{_e(str(p.get('newTopics', 0)))}</td></tr>
        </table>
        {(
            '<p style="margin:0 0 6px;font-weight:600;">Sample titles</p>'
            '<ul style="padding-left:20px;margin:0 0 8px;">'
            + ''.join(
                f'<li style="margin-bottom:4px;">{_e(str(_t))}</li>'
                for _t in (p.get('sampleTitles') or [])[:5]
            )
            + '</ul>'
        ) if (p.get('sampleTitles') or []) else ''}
        <p>Review and curate these in the admin triage queue, then decide which to push to Spotlight.</p>
        {_button('Open Triage Queue', '/admin/rfp-curation')}
    '''),
})


# ─────────────────────────────────────────────────────────────────────────────
# THE EIGHT WORKFLOW NOTIFY STEPS THAT HAD NO RENDERER.
#
# Found by joining every registered workflow's NOTIFY step against this registry
# (frontend/scripts/audit-automation-spine.mjs, join 7). Fifteen NOTIFY steps name a template;
# eight of those names existed nowhere here, so `render_template()` returned None and
# `_handle_notification_requested` emitted `system:notification.failed` instead of an email. Six of
# the eight had already been requested in the sandbox corpus — 13 of its 30 notification requests.
#
# This is the same defect the `TEMPLATES.update({...})` block above was written to fix ("absence
# meant rfp_admin stopped being notified — the 052 regression"). It recurs because the two sides
# live in different services with no shared type: the workflow names a string, this file defines
# one, and nothing compared them until now.
#
# Payload keys are the NOTIFY step's `input_map` keys, verbatim — `_execute_notify` spreads inputs
# into the event payload unchanged. Every field read defensively via p.get(), because a template
# that raises renders as None and drops the mail exactly like a missing one.
# ─────────────────────────────────────────────────────────────────────────────
TEMPLATES.update({
    # OnCmsContentRequested.notify_author — input_map: slug
    'content_published': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">Content published</h2>
        <p>A generated content piece has been published and is live on the site.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:16px;">
          <tr><td style="padding:8px 0;font-size:13px;color:#64748b;width:140px;">Slug</td>
              <td style="padding:8px 0;font-size:15px;font-weight:600;color:{BRAND_NAVY};">{_e(str(p.get('slug') or 'see site content'))}</td></tr>
        </table>
        {_button('Open Site Content', '/admin/site')}
    '''),

    # OnCollaboratorInvited.notify_admin_partner_draft — tenant_id, proposal_id,
    # collaborator_email, collaborator_name
    'partner_onboarding_ready': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">Partner collaborator invited</h2>
        <p><strong>{_e(str(p.get('collaborator_name') or p.get('collaborator_email') or 'A collaborator'))}</strong>
        has been invited to a proposal and needs partner onboarding.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:16px;">
          <tr><td style="padding:8px 0;font-size:13px;color:#64748b;width:140px;">Email</td>
              <td style="padding:8px 0;font-size:15px;color:{BRAND_NAVY};">{_e(str(p.get('collaborator_email') or '—'))}</td></tr>
          <tr><td style="padding:8px 0;font-size:13px;color:#64748b;">Proposal</td>
              <td style="padding:8px 0;font-size:15px;color:{BRAND_NAVY};">{_e(str(p.get('proposal_id') or '—'))}</td></tr>
        </table>
        {_button('Open Admin Dashboard', '/admin/tenants')}
    '''),

    # OnContentResurfaceRequested.email_curation — no entity fields; a scheduled cue.
    'content_reshare_ready': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">Content ready to resurface</h2>
        <p>The scheduled resurface pass has selected published content worth resharing.</p>
        <p>Review the queue and pick what goes out.</p>
        {_button('Open Site Content', '/admin/site')}
    '''),

    # OnIngestAssessmentRequested.notify_admin — solicitation_id
    'ingest_assessment_ready': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">Ingest assessment ready</h2>
        <p>The ingest manager has assessed a solicitation and planned the next steps.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:16px;">
          <tr><td style="padding:8px 0;font-size:13px;color:#64748b;width:140px;">Solicitation</td>
              <td style="padding:8px 0;font-size:15px;font-weight:600;color:{BRAND_NAVY};">{_e(str(p.get('solicitation_id') or 'see curation queue'))}</td></tr>
        </table>
        <p style="font-size:13px;color:#64748b;">The assessment is advisory — nothing has been ingested or
        published on its own.</p>
        {_button('Open Curation', '/admin/rfp-curation')}
    '''),

    # OnOpsDigestRequested.notify_master_admin — scheduled, no entity fields.
    'ops_digest_ready': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">Operations digest ready</h2>
        <p>The scheduled operations digest has been generated.</p>
        {_button('Open Admin Dashboard', '/admin')}
    '''),

    # OnSocialScheduleRequested.email_social_queue — scheduled, no entity fields.
    'social_queue_ready': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">Social queue ready</h2>
        <p>The scheduled social pass has prepared a queue of posts for review.</p>
        <p>Nothing is published until someone approves it.</p>
        {_button('Open Site Content', '/admin/site')}
    '''),

    # OnSolicitationReviewRequested.notify_reviewer — solicitation_id
    'curation_qa_ready': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">Curation QA ready</h2>
        <p>A curated solicitation is ready for quality review before it is pushed.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:16px;">
          <tr><td style="padding:8px 0;font-size:13px;color:#64748b;width:140px;">Solicitation</td>
              <td style="padding:8px 0;font-size:15px;font-weight:600;color:{BRAND_NAVY};">{_e(str(p.get('solicitation_id') or 'see curation queue'))}</td></tr>
        </table>
        {_button('Review in Curation', '/admin/rfp-curation')}
    '''),

    # OnSolicitationUpdateScan.notify_admin — scheduled scan; counts when present.
    'amendment_delta_ready': lambda p: _layout(f'''
        <h2 style="margin:0 0 16px;font-size:20px;color:{BRAND_NAVY};">Solicitation changes detected</h2>
        <p>The scheduled update scan found changes on tracked solicitations.</p>
        {(
            '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:16px;">'
            f'<tr><td style="padding:8px 0;font-size:13px;color:#64748b;width:140px;">Changed</td>'
            f'<td style="padding:8px 0;font-size:15px;font-weight:600;color:{BRAND_NAVY};">'
            f'{_e(str(p.get("changed") or p.get("count")))}</td></tr></table>'
        ) if (p.get('changed') or p.get('count')) else ''}
        <p>Confirm each amendment before it fans out to the tenants holding that opportunity.</p>
        {_button('Open Curation', '/admin/rfp-curation')}
    '''),
})
