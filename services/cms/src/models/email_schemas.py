"""Pydantic models for email engine request/response validation."""
from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, EmailStr


# ── Accounts ─────────────────────────────────────────────────────

class AccountCreate(BaseModel):
    email_address: EmailStr
    display_name: str
    account_type: str = 'sweep'
    credentials_type: str = 'service_account'
    delegate_subject: str | None = None
    daily_send_limit: int = 500
    sweep_enabled: bool = False


class AccountUpdate(BaseModel):
    display_name: str | None = None
    is_active: bool | None = None
    daily_send_limit: int | None = None
    sweep_enabled: bool | None = None
    sweep_inbox: bool | None = None
    sweep_sent: bool | None = None


# ── Templates ────────────────────────────────────────────────────

class TemplateCreate(BaseModel):
    name: str
    slug: str
    description: str | None = None
    category: str = 'transactional'
    subject_template: str
    body_html: str = ''
    body_text: str = ''
    variables: list[dict] = []
    tags: list[str] = []
    trigger_config: dict = {}
    response_map: dict = {}
    profile_variables: list[str] = []
    template_category: str = 'outreach'


class TemplateUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    category: str | None = None
    subject_template: str | None = None
    body_html: str | None = None
    body_text: str | None = None
    variables: list[dict] | None = None
    tags: list[str] | None = None
    is_active: bool | None = None
    trigger_config: dict | None = None
    response_map: dict | None = None
    profile_variables: list[str] | None = None
    template_category: str | None = None


class TemplateDraftRequest(BaseModel):
    """Request Claude to draft a template."""
    prompt: str
    category: str = 'transactional'
    name: str | None = None
    tone: str = 'professional'  # professional, friendly, urgent, casual
    variables: list[str] = []   # expected template variables
    model: str = 'claude-sonnet-4-20250514'
    temperature: float = 0.7
    user_id: str | None = None


class TemplatePreviewRequest(BaseModel):
    """Preview a template with sample data."""
    sample_profile: dict = {}
    sample_context: dict = {}


class TemplateTestSendRequest(BaseModel):
    """Send a test email with a rendered template."""
    to_email: EmailStr
    sample_profile: dict = {}
    sample_context: dict = {}


# ── Campaigns ────────────────────────────────────────────────────

class CampaignCreate(BaseModel):
    name: str
    description: str | None = None
    campaign_type: str = 'one_time'
    template_id: str | None = None
    account_id: str | None = None
    audience_type: str = 'all_active'
    audience_filter: dict = {}
    scheduled_at: datetime | None = None
    cron_expression: str | None = None
    timezone: str = 'UTC'
    trigger_event: str | None = None
    trigger_delay_hours: int = 0
    created_by: str | None = None


class CampaignUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    template_id: str | None = None
    account_id: str | None = None
    audience_type: str | None = None
    audience_filter: dict | None = None
    scheduled_at: datetime | None = None
    cron_expression: str | None = None
    trigger_event: str | None = None
    trigger_delay_hours: int | None = None


class CampaignAction(BaseModel):
    action: str  # activate, pause, resume, cancel, complete
    user_id: str | None = None


# ── Sends ────────────────────────────────────────────────────────

class SendCreate(BaseModel):
    """Manual send — enqueues an email."""
    template_id: str | None = None
    account_id: str | None = None
    campaign_id: str | None = None
    recipient_email: EmailStr
    recipient_name: str | None = None
    tenant_id: str | None = None
    user_id: str | None = None
    subject: str | None = None          # override template subject
    body_html: str | None = None        # override template body
    body_text: str | None = None
    template_variables: dict = {}
    in_reply_to: str | None = None      # for threading
    priority: int = 50


# ── Engagement ───────────────────────────────────────────────────

# ── Outbox (HITL Approval Queue) ───────────────────────────────

class OutboxClaim(BaseModel):
    """Claim an outbox item — it sends as YOUR account."""
    claimed_by: str               # admin user ID or email
    claimed_by_name: str          # display name
    account_id: str | None = None # their email account ID (if different from default)


class OutboxModify(BaseModel):
    """Modify the email content before approval."""
    subject: str | None = None
    body_html: str | None = None
    body_text: str | None = None
    review_notes: str | None = None


class OutboxApprove(BaseModel):
    """Approve one or more outbox items for sending."""
    approved_by: str              # admin user ID or email
    review_notes: str | None = None


class OutboxBulkApprove(BaseModel):
    """Bulk approve multiple outbox items."""
    outbox_ids: list[str]
    approved_by: str
    review_notes: str | None = None


class OutboxReject(BaseModel):
    """Reject an outbox item — it will NOT be sent."""
    rejected_by: str
    reason: str
