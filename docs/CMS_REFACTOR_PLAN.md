# CMS Refactor Plan — End-to-End Review

**Date**: 2026-05-28  
**Architecture**: CMS SPA (Vite/React/TipTap) at separate Railway URL → FastAPI backend → event bridge → Main DB → RFP Pipeline renders

---

## What Works Today

| Component | Status | Notes |
|-----------|--------|-------|
| CMS SPA (13 pages) | Functional | No login page, no user identity |
| TipTap WYSIWYG editor | Working | Rich text with AI revision |
| Content workflow (draft→review→approved→published) | Working | Full state machine with review audit |
| AI content generation (5 source types) | Working | Claude-powered, polls for completion |
| Event bridge (CMS→Main DB) | **Wired but rule missing** | `_action_publish_content` exists, needs automation_rule seed |
| Event bridge (RFP Pipeline→CMS) | Working | notification.requested + 6 action types |
| Email engine (templates, campaigns, HITL outbox) | Working | Full stack, Gmail API integrated |
| Email queue + sweep workers | Working | Send, track engagement, auto-classify replies |
| Drip engine | Working | Sequence processing, enrollment lifecycle |
| Content generator worker | Working | 5 source types, Claude API |
| Social poster | **Stub** | Framework exists, LinkedIn/Twitter adapters raise NotImplementedError |
| CMS authentication | **Security gap** | Auto-sets cookie for anyone who loads /cms URL |

## What's Broken

1. **No login page** — anyone reaching the CMS URL gets authenticated
2. **publish_content automation rule missing** — content publishes in CMS but never reaches Main DB
3. **Tags bug** — SPA sends comma string, backend expects array
4. **body_format mismatch** — TipTap outputs HTML, schema defaults to 'markdown'
5. **No unpublish bridge** — unpublishing in CMS leaves content live on public site
6. **Next.js /admin/content still editable** — should be view-only per architecture

---

## Refactor TODOs (20 items)

### P0 — Must work for launch (6 items, ~16 hours)

| # | Title | Effort | Impact |
|---|-------|--------|--------|
| 1 | CMS Login Page + auth | 6h | Security — currently open to anyone |
| 2 | Fix tags bug (string→array) | 0.5h | Content creation broken |
| 3 | Seed publish_content automation rule | 1h | Content bridge non-functional without it |
| 4 | Make /admin/content view-only | 4h | Architecture compliance |
| 5 | Fix body_format (HTML not markdown) | 2h | Prevents content corruption on render |
| 6 | Add unpublish bridge | 2h | Unpublished content stays live |
| 19 | Secure CMS URL (stopgap) | 1h | Until login page is built |

### P1 — Should work for launch (7 items, ~37 hours)

| # | Title | Effort | Impact |
|---|-------|--------|--------|
| 7 | Route event emails through HITL | 4h | All outbound email gets human review |
| 8 | Enhance EmailOutbox UI (preview, edit, claim) | 4h | Admins can review email before sending |
| 9 | Email template management UI | 8h | Create/edit/preview/test templates |
| 10 | Automation rules management UI | 8h | Configure event→action mappings |
| 11 | Email campaign create/edit UI | 6h | Build campaigns from the SPA |
| 16 | User identity in CMS actions | 3h | Audit trail shows who did what |
| 18 | Content version history view | 4h | See diffs and who changed what |

### P2 — Post-launch (6 items, ~31 hours)

| # | Title | Effort | Impact |
|---|-------|--------|--------|
| 12 | LinkedIn API adapter | 16h | Auto-post to LinkedIn |
| 13 | Social post create/schedule UI | 4h | Draft and schedule social posts |
| 14 | Email account connect UI | 3h | Add Gmail accounts from UI |
| 15 | Drip campaign builder UI | 6h | Create drip sequences visually |
| 17 | Dashboard count accuracy | 2h | Fix .length vs COUNT(*) |
| 20 | Event namespace compliance | 2h | Align with CLAUDE.md conventions |

---

## Critical Path for Launch

```
Step 1: Secure CMS URL (TODO #19) — 1 hour
  → Basic auth or token gate as stopgap

Step 2: Fix bugs (TODOs #2, #5) — 2.5 hours  
  → Tags array, body_format=html

Step 3: Seed publish rule (TODO #3) — 1 hour
  → Makes the content bridge actually work

Step 4: Test the publish flow end-to-end
  → Create post in CMS → publish → verify in Main DB → verify on marketing site

Step 5: Add unpublish bridge (TODO #6) — 2 hours
  → Unpublish flows through to Main DB

Step 6: Make /admin/content view-only (TODO #4) — 4 hours
  → Remove editing, add "Open in CMS" link

Step 7: Build login page (TODO #1) — 6 hours
  → Real authentication on the CMS SPA
```

**Total critical path: ~16.5 hours**
