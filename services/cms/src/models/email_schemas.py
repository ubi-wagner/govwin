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


class AccountOut(BaseModel):
    id: str
    email_address: str
    display_name: str
    account_type: str
    credentials_type: str
    is_active: bool
    daily_send_limit: int
    sends_today: int
    sweep_enabled: bool
    last_sweep_at: datetime | None
    created_at: datetime


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


class TemplateOut(BaseModel):
    id: str
    name: str
    slug: str
    description: str | None
    category: str
    subject_template: str
    body_html: str
    body_text: str
    ai_drafted: bool
    variables: list
    tags: list[str]
    version: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


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


class CampaignOut(BaseModel):
    id: str
    name: str
    description: str | None
    campaign_type: str
    template_id: str | None
    account_id: str | None
    audience_type: str
    audience_filter: dict
    status: str
    scheduled_at: datetime | None
    cron_expression: str | None
    started_at: datetime | None
    completed_at: datetime | None
    trigger_event: str | None
    total_sent: int
    total_delivered: int
    total_opened: int
    total_clicked: int
    total_replied: int
    total_bounced: int
    created_at: datetime
    updated_at: datetime


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


class SendOut(BaseModel):
    id: str
    campaign_id: str | None
    template_id: str | None
    recipient_email: str
    recipient_name: str | None
    tenant_id: str | None
    subject: str
    status: str
    gmail_message_id: str | None
    gmail_thread_id: str | None
    sent_at: datetime | None
    error_message: str | None
    retry_count: int
    created_at: datetime


# ── Engagement ───────────────────────────────────────────────────

class EngagementOut(BaseModel):
    id: str
    send_id: str
    campaign_id: str | None
    engagement_type: str
    metadata: dict
    reply_body: str | None
    reply_sentiment: str | None
    reply_intent: str | None
    reply_interpreted: bool
    tenant_id: str | None
    created_at: datetime


# ── Threads ──────────────────────────────────────────────────────

class ThreadOut(BaseModel):
    id: str
    gmail_thread_id: str
    recipient_email: str
    tenant_id: str | None
    subject: str | None
    message_count: int
    last_message_at: datetime | None
    last_sender: str | None
    status: str
    campaign_id: str | None
    tags: list[str]
    created_at: datetime
