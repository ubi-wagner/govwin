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
            result = result.replace('{{' + key + '}}', str(val) if val is not None else '')
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
      - matched_opportunities: count from tenant_pipeline_items table

    Args:
        profile_variables: list of field names to resolve
        tenant_id: tenant UUID (optional)
        user_email: user email for contact lookup (optional)
        shared_pool: asyncpg pool connected to main database

    Returns: flat dict of resolved values (missing fields are empty strings)
    """
    if not profile_variables or not shared_pool:
        return {}

    result = {var: '' for var in profile_variables}

    try:
        # Resolve tenant-level fields
        tenant_fields = {'company_name', 'lifecycle_stage', 'tier', 'application_date'}
        needs_tenant = bool(tenant_fields & set(profile_variables))

        if needs_tenant and tenant_id:
            tenant_row = await shared_pool.fetchrow(
                '''SELECT name, lifecycle_stage, product_tier, created_at
                   FROM tenants WHERE id = $1''',
                tenant_id,
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
        if 'active_proposals' in profile_variables and tenant_id:
            try:
                count = await shared_pool.fetchval(
                    '''SELECT COUNT(*) FROM proposals
                       WHERE tenant_id = $1 AND stage NOT IN ('archived')''',
                    tenant_id,
                )
                result['active_proposals'] = str(count or 0)
            except Exception:
                result['active_proposals'] = '0'

        if 'matched_opportunities' in profile_variables and tenant_id:
            try:
                count = await shared_pool.fetchval(
                    '''SELECT COUNT(*) FROM tenant_pipeline_items
                       WHERE tenant_id = $1''',
                    tenant_id,
                )
                result['matched_opportunities'] = str(count or 0)
            except Exception:
                result['matched_opportunities'] = '0'

    except Exception as e:
        logger.error(f'[resolve_profile_variables] Error resolving profile for tenant={tenant_id}: {e}')

    return result
