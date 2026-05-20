"""Pydantic models for request/response validation."""
from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, Field


# ── Posts ────────────────────────────────────────────────────────

class PostCreate(BaseModel):
    title: str
    body: str = ''
    body_format: str = 'markdown'
    excerpt: str | None = None
    category: str = 'tip'
    tags: list[str] = []
    meta_title: str | None = None
    meta_description: str | None = None
    featured_image_id: str | None = None
    author_id: str | None = None
    author_name: str | None = None
    author_email: str | None = None


class PostUpdate(BaseModel):
    title: str | None = None
    body: str | None = None
    body_format: str | None = None
    excerpt: str | None = None
    category: str | None = None
    tags: list[str] | None = None
    meta_title: str | None = None
    meta_description: str | None = None
    canonical_url: str | None = None
    og_image_url: str | None = None
    featured_image_id: str | None = None


# ── Workflow Actions ─────────────────────────────────────────────

class WorkflowAction(BaseModel):
    action: str  # submit_review, approve, reject, publish, unpublish, revert, archive
    notes: str | None = None
    user_id: str
    user_email: str | None = None


# ── Generations ──────────────────────────────────────────────────

class GenerationRequest(BaseModel):
    prompt: str
    category: str = 'tip'
    model: str = 'claude-sonnet-4-20250514'
    temperature: float = 0.7
    system_prompt: str | None = None
    user_id: str
    user_email: str | None = None
    # Multi-input generation fields
    source_type: str = 'prompt'  # prompt, url, email, screenshot, repackage
    source_url: str | None = None
    source_email_id: str | None = None  # email_sends ID for email-driven generation
    source_content: str | None = None  # raw content to repackage
    attachments: list[str] | None = None  # media IDs for screenshots/docs
    tenant_id: str | None = None


class GenerationAction(BaseModel):
    action: str  # accept, reject, retry
    user_id: str
    notes: str | None = None


# ── Media ────────────────────────────────────────────────────────

class MediaOut(BaseModel):
    id: str
    filename: str
    storage_path: str
    content_type: str
    size_bytes: int
    width: int | None
    height: int | None
    alt_text: str | None
    caption: str | None
    post_id: str | None
    usage: str
    uploaded_by: str | None
    created_at: datetime


class MediaUpdate(BaseModel):
    alt_text: str | None = None
    caption: str | None = None
    post_id: str | None = None
    usage: str | None = None


