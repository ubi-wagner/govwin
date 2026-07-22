# Content Distribution & Automation Strategy

**Date**: 2026-05-24
**Status**: Draft recommendation for Eric's review

---

## 1. What's Built Today

### Email System (CMS Service — fully built, needs deployment)
- **6 workers**: campaign executor, drip engine, email queue, email sweep, template drafter, gmail client
- **Gmail API integration**: OAuth2, send/receive, thread tracking, engagement detection
- **Campaign types**: one-time, recurring, drip sequences
- **HITL outbox**: all sends go through admin approval queue
- **Template system**: Jinja2 with AI-powered drafting via Claude
- **Automation rules**: 10 seeded rules triggered by system_events

### Social System (CMS Service — API built, posting not wired)
- **Account CRUD**: LinkedIn, Twitter, Facebook, Instagram schemas
- **Post scheduling**: draft → scheduled → posted lifecycle
- **Social poster worker**: polls for scheduled posts (LinkedIn adapter is TODO)

### Content System (Frontend — fully functional)
- **22 marketing pages** driven by CMS with ISR
- **Admin editor** with inline editing + full editor
- **Preview mode** with admin toolbar (just built)
- **AI content generation** from URL + Claude
- **Markdown rendering** for blog/resources
- **SEO**: sitemap, RSS feed, OG/Twitter meta tags

---

## 2. Recommended Email Strategy

### Phase 1: Transactional Emails (Already Working)
These already fire via the frontend's `sendEmail()`:
- Welcome email (application accepted)
- Collaborator invite (temp password + login URL)
- Proposal creation admin alert (72-hour SLA)
- Password reset

### Phase 2: Lifecycle Emails (Wire CMS automation rules)
Deploy the CMS service and activate these automation rules:

| Trigger Event | Email | Template |
|--------------|-------|----------|
| `capture:application.submitted` | "We received your application" | Confirmation + what to expect |
| `capture:application.accepted` | Welcome (already works) | — |
| `finder:solicitation.pushed` | Spotlight digest | New opportunities matching your profile |
| `capture:opportunity.pinned` | "You pinned {topic}" | Topic details + next steps |
| `proposal:proposal.created` | "Your proposal workspace is ready" | Link + section overview |
| `proposal:proposal.advanced` | "Proposal advanced to {stage}" | What's next, who needs to act |
| `proposal:proposal.locked` | "Proposal locked for submission" | Download instructions |
| `capture:subscription.started` | "Welcome to Spotlight" | Getting started guide |

### Phase 3: Drip Sequences (Already built in CMS)
4 seeded drip campaigns ready to activate:
1. **Welcome/Onboarding** (3 emails over 7 days): platform tour, profile setup, first spotlight
2. **Trial Expiring** (2 emails): reminder at 7 days, final at 1 day
3. **Re-engagement** (3 emails over 14 days): for users inactive 14+ days
4. **Post-Proposal** (2 emails): outcome recording reminder, library review prompt

### Phase 4: Content Distribution
When a blog post is published → auto-create email campaign to all active subscribers with the post excerpt + link.

---

## 3. Recommended LinkedIn Strategy

### What Claude Can Do (as your AI agent)
I can act as a content creation and scheduling assistant, but I **cannot directly post to LinkedIn** or manage your account. Here's the practical architecture:

#### Content Scout Model
Similar to how we scout RFP sources, we can scout content sources:

1. **Government contracting news feeds** — monitor SAM.gov announcements, SBIR solicitation releases, policy changes
2. **Industry analysis** — track win rates, agency spending patterns, SBIR program stats from our own data
3. **Customer success stories** — (with permission) anonymized case studies from proposal outcomes
4. **Educational content** — "How to write a winning SBIR Phase I" series from our compliance matrix knowledge

#### Recommended Content Calendar
| Day | Content Type | Source | Example |
|-----|-------------|--------|---------|
| Monday | Industry Insight | Our scoring data | "AFWERX SBIR topics with TRL roadmaps win at 2.1x the base rate" |
| Wednesday | Educational | Our compliance templates | "3 compliance mistakes that get SBIR proposals desk-rejected" |
| Friday | News/Update | Source scout discoveries | "New DoD SBIR 25.2 topics released — here's what changed from 25.1" |

#### Implementation Approach
1. **Content Generation**: Use our existing AI content pipeline (`/api/admin/content/generate`) to draft LinkedIn posts from:
   - Blog posts we publish (auto-summarize for LinkedIn length)
   - Source scout discoveries (translate RFP changes into industry insights)
   - Scoring data (anonymized trends and patterns)

2. **Content Queue**: Use the CMS social_posts table to queue drafted posts. Admin reviews in the CMS content manager.

3. **Posting**: Two options:
   - **Manual V1**: Admin copies approved post text to LinkedIn (safest, no API needed)
   - **API V2**: Implement LinkedIn OAuth2 + Company Page posting via the social_poster worker (requires LinkedIn app approval, typically 2-4 weeks)

4. **LinkedIn OAuth2 Flow** (for V2):
   - Register app at LinkedIn Developer Portal
   - Scopes needed: `w_member_social` (personal) or `w_organization_social` (company page)
   - OAuth2 callback → store access_token + refresh_token in `social_accounts`
   - Social poster worker calls LinkedIn UGC Share API
   - **Note**: LinkedIn rate limits to ~100 posts/day per member, refresh tokens expire every 60 days

### What I'd Recommend for Launch
**Start with Manual V1**: Use the AI to generate the content, admin reviews and approves, then manually posts to LinkedIn. This gets content flowing immediately with zero API risk. Wire the LinkedIn API in month 2 when you have a content rhythm established.

---

## 4. Content Find & Analysis Architecture

### Auto-Generate Content from Platform Activity

The platform already generates valuable content signals:

| Signal | Content Opportunity | Auto-Generate? |
|--------|-------------------|----------------|
| New solicitation pushed | "New {agency} {program_type} opportunity: {title}" | Yes — from push event |
| Scoring trends | "Top 5 agencies with highest match rates this month" | Yes — from tenant_pipeline_items aggregation |
| Compliance patterns | "Most common page limit for {agency} SBIR Phase I: {value}" | Yes — from solicitation_compliance aggregation |
| Proposal outcomes | "Win rate for proposals using AI drafting: {pct}%" | Yes — from proposals.stage='archived' with outcome data |
| Source scout changes | "{source} updated their SBIR portal — here's what changed" | Yes — from source_diffs |

### Implementation Plan

1. **Content Scout Workflow**: New workflow `OnContentOpportunityDetected`:
   - Triggers on key events (solicitation pushed, outcome recorded, source changed)
   - Calls Claude to generate a blog post draft from the event data
   - Stores as `cms_content` with `status='draft'`
   - Admin gets notified → previews → edits → publishes

2. **Analytics Dashboard Content**: Monthly auto-generated reports:
   - "This month in government contracting" from our data
   - Agency-specific insights from scoring patterns
   - Content repurposed as blog posts + LinkedIn posts + email digest

3. **Content Repurposing Pipeline**:
   ```
   Blog Post → AI Summarize → LinkedIn Post (short)
                             → Email Newsletter (medium)
                             → Resource Guide (long, compile monthly)
   ```

---

## 5. Recommended Implementation Priority

| Priority | What | Effort | Impact |
|----------|------|--------|--------|
| 1 | Deploy CMS service + activate lifecycle emails | 1 day | Immediate — customers get email updates |
| 2 | Wire automation rules for spotlight digest + proposal alerts | 2-3 hours | High — proactive customer engagement |
| 3 | Set up content calendar + AI draft pipeline | 1 day | Medium — consistent content output |
| 4 | LinkedIn manual posting workflow | 2 hours | Medium — social presence |
| 5 | LinkedIn API integration | 2-3 days | Low urgency — manual posting works fine |
| 6 | Content scout auto-generation | 2-3 days | Medium — scales content creation |
| 7 | Monthly analytics reports | 1 day | Low — nice-to-have for authority building |

---

## 6. Architecture Diagram

```
                    ┌─────────────────────────────────────┐
                    │         CONTENT SOURCES              │
                    ├─────────────────────────────────────┤
                    │ Source Scout Discoveries              │
                    │ Solicitation Push Events              │
                    │ Scoring Trend Data                    │
                    │ Proposal Outcomes                     │
                    │ Admin Manual Drafts                   │
                    │ AI URL Import                         │
                    └───────────────┬─────────────────────┘
                                    │
                                    ▼
                    ┌─────────────────────────────────────┐
                    │         AI CONTENT GENERATION         │
                    │  Claude drafts blog post / social     │
                    │  post from source data                │
                    └───────────────┬─────────────────────┘
                                    │
                                    ▼
                    ┌─────────────────────────────────────┐
                    │         ADMIN REVIEW (HITL)           │
                    │  Preview → Edit → Approve → Publish   │
                    └───────────────┬─────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
              ┌──────────┐  ┌──────────┐  ┌──────────┐
              │  Website  │  │  Email   │  │ LinkedIn │
              │ /blog     │  │ Campaign │  │  Post    │
              │ /resources│  │ Digest   │  │ (manual  │
              │ ISR 60s   │  │ Drip     │  │  or API) │
              └──────────┘  └──────────┘  └──────────┘
```
