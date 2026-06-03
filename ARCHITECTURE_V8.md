# RFP Pipeline Portal — V8: Consolidated Content Architecture

**Date:** 2026-06-02
**Status:** Authoritative for **website content management**. Supersedes the V6 dual-editor and the V7-era `cms_posts ⇄ cms_content` bridge for page/site content.
**Scope:** This document covers **only what changes in V8** — the website content subsystem and its service boundaries. Everything else (proposals, RFP curation, scoring, agents, email/CRM automation, events infra, auth) is **unchanged from V7**.

---

## 0. Why V8 — the problem with V6/V7 content

V6/V7 split website content across **two databases** (CMS `cms_posts` ⇄ Main `cms_content`) connected by a cross-service **bridge**, with **two editors** writing the live table directly. That bought us:

- a **sync problem** (the bridge had to keep two stores consistent),
- a **footgun** (editing wrote the live row, so drafts disturbed the public site),
- **two sources of truth** (admin editor + CMS portal, both on `cms_content`).

High complexity, minimal return. V8 collapses it.

---

## 1. Principles

- **One source of truth.** Website content lives in the **Main DB only**. No cross-DB content bridge.
- **Page-versioned.** Every **save snapshots the whole page** as an immutable version with an audit note. **Publish** promotes a draft to `active`; the prior `active` is `archived` (dated + noted).
- **Editing never touches live.** The public reads the single `active` version; drafts are separate rows. The footgun is gone by construction.
- **Clean lanes:**
  - **Frontend (Next.js)** = content editor UI + content API + public rendering + preview.
  - **Pipeline (Python)** = AI content-generation jobs.
  - **Main DB** = the content store.
  - **CMS/CRM service** = email, campaigns, drip, social — **CRM only**. No content.
- **Events = audit trail only.** `system` namespace, start/end phase, `tenantId = null`. They **record** updates/postings; they do **not** actuate them. The legacy closed-loop content bridge is **parked inactive** (§6).

---

## 2. Data model (Main DB) — `content_pages`

One row per page **version**:

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `page_key` | text | `homepage`, `about`, … or a post slug |
| `content_type` | text | `page` \| `blog_post` \| `resource` |
| `version_no` | int | increments per `page_key` |
| `status` | text | `draft` \| `active` \| `archived` |
| `title` | text | |
| `blocks` | jsonb | whole-page content: `[{ section, displayOrder, title, body, excerpt, metadata }]` |
| `metadata` | jsonb | page-level meta (SEO etc.) |
| `audit_note` | text | the save/publish note |
| `created_by` | text | editor email |
| `created_at` | timestamptz | |
| `published_at` | timestamptz | when it became active |
| `archived_at` | timestamptz | when retired |

**Constraints / reads:**
- Partial unique index → **at most one `active` per `page_key`**.
- **Public read:** `WHERE page_key=$1 AND status='active'` → exactly one row → render `blocks`.
- **Preview read:** latest `draft` row for the page (fallback to `active`).

**Lifecycle:**
- **Save** → `INSERT` status=`draft`, `version_no = max+1`, with `audit_note`.
- **Publish** → newest `draft` → `active` (`published_at=now`); prior `active` → `archived` (`archived_at=now`, note).
- **Rollback** → reactivate an `archived` version (archives the current active).
- **History** → all rows for `page_key` ordered by `version_no`.

`cms_content` is retained **read-only** during transition, then retired; `cms_posts` content usage is deprecated.

---

## 3. Editor (Frontend, isolated)

- **Entry:** the **CMS link on `/admin`** routes to one dedicated content landing page (`/admin/site`), isolated from RFP/proposal operations.
- **Functions:** pick a page → edit blocks → **Save** (whole page → new draft + note) → **Preview** → **Publish** → version history / rollback.
- **Save-all semantics:** any block change saves the **entire page** as one new draft version with a note. (Last-write-wins per page; every save is a noted version, so nothing is ever lost.)

---

## 4. Preview

- A **live second instance of the public page** rendered in **draft mode** (inline frame or modal), showing the working draft's blocks.
- **Mechanism:** the public route reads the draft version when a preview flag is set (Next.js draft mode / `?_preview=1` + version).
- **Publish** from the editor → revalidate the page → preview closes → **near-time** public refresh.

---

## 5. AI generation (Pipeline)

- The **pipeline owns AI content generation** and writes directly into `content_pages` — AI drafts and hand-written drafts share **one** store and **one** lifecycle.
- The keystone vertical `OnCmsContentRequested` (`pipeline/src/workflows/`) runs the chain **draft → human-review ToDo → publish → notify**:
  - `draft_content` runs Claude (CMS `content_generator` contract: title/excerpt/body/tags/meta; falls back to the brief with no API key) and inserts a **`status='draft'`** `content_pages` version (body in a `body` block; tags/excerpt/author/SEO in `metadata`). Each call is a new version snapshot.
  - The review ToDo parks for `rfp_admin`; completing it is the approval.
  - `publish_content` promotes that draft to **`active`** and archives the prior active + sibling drafts in one transaction — same promote/archive semantics as the admin editor's Publish, so the one-active-per-page invariant always holds.
- Result: a generated article shows up as a **draft** in the admin Site Content editor (Documents), reviewable/editable/previewable exactly like any other draft before it goes live.

---

## 6. Events (audit ledger) + parked bridge

- Content actions emit **`system`** events, **start/end** phase — e.g. `system:content.page_saved:start/end`, `system:content.page_published:start/end`. These are the **audit ledger** (admin activity stream), `tenantId = null`.
- The legacy closed-loop **content bridge** (CMS `_action_publish_content` / `_action_unpublish_content`, the `cms_posts → cms_content` sync, and `content.page_blocks_*` triggers) is **LEFT STANDING BUT INACTIVE** — no content path triggers it. Retained for reference; removed in a later cleanup.

---

## 7. Service boundary changes

| Service | V7 | V8 |
|---------|-----|-----|
| **Frontend** | reads `cms_content`; admin content editor | **owns** content editor + API + preview + public rendering |
| **Pipeline** | content vertical (draft/publish) | **owns** AI content-generation jobs |
| **CMS/CRM** | content routers + SPA editor + generation worker + email/CRM | **CRM only** — email, campaigns, drip, social, outbox |
| **Main DB** | `cms_content` (per-block) | `content_pages` (page-versioned) — single content store |

---

## 8. What V8 supersedes / retains

- **Supersedes:** V6 §2.3 Dual-Editor, V6 §8.5 direct-`cms_content` editing, the V7-era `cms_posts` page-block rework + migration 010 + the cross-DB content bridge.
- **Retains:** Phase-1 admin cleanup, the revalidate webhook (repurposed for `content_pages`), the `crypto` lazy-import fix.
- **Data migration:** backfill `content_pages` `active` rows from current `cms_content` published page blocks — same Main DB, pure SQL.

---

## 9. Build phases (test-gated)

1. **Data layer** — `content_pages` table + backfill + repoint public read. *Public site renders identically.* ✅
2. **Editor + API** — list / get / save-draft / publish / versions + the `/admin` nav link. ✅
3. **Preview** — draft-mode iframe/modal + publish → revalidate. ✅
4. **AI generation** — pipeline content vertical (`OnCmsContentRequested`) drafts/publishes into `content_pages`; generated articles land as reviewable drafts in the editor. ✅ *(in-editor "generate" button that enqueues a job is a follow-up.)*
5. **Cleanup** — CMS → CRM-only; park the bridge; finalize docs. ✅

---

*End of ARCHITECTURE_V8.md*
