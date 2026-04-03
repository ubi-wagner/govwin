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


class PostOut(BaseModel):
    id: str
    slug: str
    title: str
    excerpt: str | None
    body: str
    body_format: str
    category: str
    tags: list[str]
    status: str
    author_id: str | None
    author_name: str | None
    featured_image_id: str | None
    featured_image_url: str | None
    generation_id: str | None
    generated_by_model: str | None
    generation_prompt: str | None
    reviewed_by: str | None
    reviewed_at: datetime | None
    review_notes: str | None
    published_at: datetime | None
    published_by: str | None
    meta_title: str | None
    meta_description: str | None
    version: int
    created_at: datetime
    updated_at: datetime


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


class GenerationOut(BaseModel):
    id: str
    prompt: str
    category: str
    model: str
    temperature: float
    status: str
    generated_title: str | None
    generated_excerpt: str | None
    generated_body: str | None
    generated_tags: list[str]
    post_id: str | None
    error_message: str | None
    retry_count: int
    created_at: datetime
    completed_at: datetime | None


class GenerationAction(BaseModel):
    action: str  # accept, reject, retry
    generation_id: str
    user_id: str
    notes: str | None = None


# ── Reviews ──────────────────────────────────────────────────────

class ReviewOut(BaseModel):
    id: str
    post_id: str
    action: str
    reviewer_id: str
    notes: str | None
    version_at_review: int
    created_at: datetime


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


# ── Generic ──────────────────────────────────────────────────────

class ErrorResponse(BaseModel):
    error: str


class SuccessResponse(BaseModel):
    data: dict | list | None = None
    message: str | None = None
