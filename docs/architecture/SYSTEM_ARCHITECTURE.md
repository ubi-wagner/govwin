# GovWin — End-to-End System Architecture

**Version:** 1.0 — February 2025
**Status:** Strawman for review

---

## 1. System Overview

GovWin is a multi-tenant government opportunity intelligence platform that:

1. **Discovers** opportunities from SAM.gov, Grants.gov, SBIR, and USASpending
2. **Scores & ranks** each opportunity against each tenant's unique company profile
3. **Summarizes** high-scoring opportunities using Claude LLM analysis
4. **Notifies** tenants of relevant new/changed opportunities via email digest
5. **Stores** all tenant artifacts in a Google Workspace Drive filing system
6. *(Future)* **Generates** proposal drafts using in-Drive agents

The platform uses **Google Workspace as the CMS backbone** — every tenant gets
an identical, templated folder structure in Drive, and the application UI embeds
Drive natively rather than building custom document management.

**Stripe** handles all subscription billing. The baseline tier ($499/mo) covers
opportunity hunting, ranking, and notification.

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              INTERNET / USERS                               │
│                                                                             │
│  Tenant Users ──→ https://app.govwin.io/portal/{slug}/...                  │
│  Master Admin ──→ https://app.govwin.io/admin/...                          │
│  New Signups  ──→ https://app.govwin.io/signup                             │
│                                                                             │
└────────┬───────────────────────────┬────────────────────────────────────────┘
         │                           │
         │  HTTPS                    │  Stripe Webhooks (HTTPS)
         ▼                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        NEXT.JS 14 APPLICATION                               │
│                        (Railway — Web Service)                              │
│                                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ (auth)       │  │ (admin)      │  │ (portal)     │  │ (public)      │  │
│  │  /login      │  │  /dashboard  │  │  /[slug]/    │  │  /signup      │  │
│  │  /signup     │  │  /tenants    │  │   dashboard  │  │  /pricing     │  │
│  │  /reset-pw   │  │  /pipeline   │  │   pipeline   │  │               │  │
│  │              │  │  /sources    │  │   documents  │  │               │  │
│  │              │  │  /billing    │  │   profile    │  │               │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └───────────────┘  │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ API ROUTES                                                           │   │
│  │  /api/auth/[...nextauth]     NextAuth.js sessions                   │   │
│  │  /api/tenants                CRUD + user management                 │   │
│  │  /api/opportunities          Scored pipeline queries                │   │
│  │  /api/pipeline               Job queue + run history                │   │
│  │  /api/system                 System status + health                 │   │
│  │  /api/portal/[slug]/*        Tenant-scoped portal APIs             │   │
│  │  /api/stripe/webhooks        Subscription lifecycle events          │   │
│  │  /api/stripe/checkout        Checkout session creation              │   │
│  │  /api/stripe/portal          Customer billing portal redirect       │   │
│  │  /api/onboarding/provision   Trigger Drive + DB provisioning        │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ MIDDLEWARE                                                           │   │
│  │  Session check → role routing → x-tenant-id / x-tenant-slug headers │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└───────┬──────────────────┬──────────────────┬───────────────────────────────┘
        │                  │                  │
        │ SQL              │ Google APIs      │ Stripe API
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────────┐
│ POSTGRESQL 16 │  │ GOOGLE        │  │ STRIPE            │
│ + pgvector    │  │ WORKSPACE     │  │                   │
│               │  │               │  │  Products:        │
│ Auth tables   │  │ Domain-wide   │  │   - Hunt & Rank   │
│ Tenant tables │  │ delegation    │  │     ($499/mo)     │
│ Opportunities │  │ via service   │  │   - Pro tier      │
│ Scoring data  │  │ account       │  │     (future)      │
│ Pipeline jobs │  │               │  │   - Enterprise    │
│ Audit log     │  │ Drive API     │  │     (future)      │
│ Notifications │  │ Docs API      │  │                   │
│               │  │ Sheets API    │  │  Webhooks:        │
│ LISTEN/NOTIFY │  │ Gmail API     │  │   checkout.done   │
│ (job queue)   │  │               │  │   sub.updated     │
└───────┬───────┘  └───────────────┘  │   sub.deleted     │
        │                              │   invoice.paid    │
        │ LISTEN pipeline_worker       │   payment.failed  │
        ▼                              └───────────────────┘
┌─────────────────────────────────────────────────────────────────────────────┐
│                       PYTHON PIPELINE WORKER                                │
│                       (Railway — Worker Service, no PORT)                   │
│                                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ SAM.gov  │  │ Grants   │  │ SBIR     │  │ USA      │  │ Scoring    │  │
│  │ Ingester │  │ .gov     │  │ Ingester │  │ Spending │  │ Engine     │  │
│  │          │  │ Ingester │  │          │  │ Intel    │  │            │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └────────────┘  │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ NOTIFICATION ENGINE                                                  │   │
│  │  Reads notifications_queue → sends via Google Workspace Gmail API    │   │
│  │  Daily digest + urgent alerts + amendment notifications              │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ GOOGLE DRIVE PROVISIONER                                             │   │
│  │  On tenant onboard → create folder skeleton → store drive_folder_id  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ ANTHROPIC CLAUDE (LLM)                                               │   │
│  │  Opportunity analysis, scoring adjustment, key requirements extract  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Subscription & Billing (Stripe)

### 3.1 Product Tiers

| Tier | Price | Includes |
|------|-------|----------|
| **Hunt & Rank** (baseline) | $499/mo | Opportunity scraping, scoring, ranking, email digests, portal access, Drive filing |
| **Professional** (future) | TBD | + Self-service profile editing, proposal workspace, deeper LLM analysis |
| **Enterprise** (future) | TBD | + In-Drive proposal agents, team management, custom integrations |

### 3.2 Stripe Data Model

```
Stripe Product: "GovWin Hunt & Rank"
  └─ Price: $499/mo recurring (USD)

Stripe Customer  ←→  tenants.stripe_customer_id
Stripe Subscription  ←→  tenants.stripe_subscription_id
```

### 3.3 New Columns on `tenants` Table

```sql
ALTER TABLE tenants ADD COLUMN stripe_customer_id    TEXT UNIQUE;
ALTER TABLE tenants ADD COLUMN stripe_subscription_id TEXT UNIQUE;
ALTER TABLE tenants ADD COLUMN stripe_price_id        TEXT;
ALTER TABLE tenants ADD COLUMN subscription_status    TEXT DEFAULT 'incomplete';
    -- 'incomplete' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid'
ALTER TABLE tenants ADD COLUMN current_period_end     TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN drive_folder_id        TEXT;
ALTER TABLE tenants ADD COLUMN gmail_thread_label_id  TEXT;
```

### 3.4 Checkout & Webhook Flow

```
                    SIGNUP / CHECKOUT FLOW
                    ══════════════════════

  ┌──────────┐      ┌──────────────┐      ┌──────────────┐
  │ /signup  │─────→│ Collect Info │─────→│ Stripe       │
  │ page     │      │              │      │ Checkout     │
  │          │      │ Company name │      │ Session      │
  │          │      │ Email        │      │              │
  │          │      │ NAICS codes  │      │ $499/mo      │
  │          │      │ Keywords     │      │ recurring    │
  │          │      │ Set-asides   │      │              │
  └──────────┘      └──────────────┘      └──────┬───────┘
                                                  │
                              Stripe hosted page  │
                              Card entry + submit │
                                                  │
                                                  ▼
                    ┌─────────────────────────────────────┐
                    │  STRIPE WEBHOOK: checkout.completed  │
                    └────────────────┬────────────────────┘
                                     │
                    ┌────────────────▼────────────────────┐
                    │  /api/stripe/webhooks handler        │
                    │                                      │
                    │  1. Verify webhook signature          │
                    │  2. Extract customer + subscription   │
                    │  3. Create tenant row (status=active) │
                    │  4. Create tenant_profile from        │
                    │     signup metadata                   │
                    │  5. Create admin user with temp pw    │
                    │  6. Queue onboarding job:             │
                    │     - Provision Drive folder tree     │
                    │     - Copy template docs              │
                    │     - Send welcome email              │
                    │  7. Run first scoring pass            │
                    └─────────────────────────────────────┘

                    RECURRING BILLING WEBHOOKS
                    ═════════════════════════

  invoice.paid           → tenants.subscription_status = 'active'
                           tenants.current_period_end = period_end
                           Log to audit_log

  invoice.payment_failed → tenants.subscription_status = 'past_due'
                           Send payment failure email
                           Log to audit_log

  customer.subscription  → Update tenants.subscription_status
    .updated               Check for plan changes (upgrade/downgrade)
                           Update tenants.plan accordingly

  customer.subscription  → tenants.subscription_status = 'canceled'
    .deleted               tenants.status = 'churned'
                           Archive Drive folder (move to /Archive/)
                           Stop scoring for this tenant
                           Send churn confirmation email
```

---

## 4. Customer Onboarding Flow (End-to-End)

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                    CUSTOMER ONBOARDING SEQUENCE                     │
  └─────────────────────────────────────────────────────────────────────┘

  STEP 1: DISCOVERY
  ─────────────────
  Prospect finds GovWin → lands on /pricing or /signup

  STEP 2: REGISTRATION + PAYMENT
  ───────────────────────────────
  /signup collects:
    ├── Company legal name, DBA, website
    ├── UEI number, CAGE code (optional)
    ├── Primary contact name + email
    ├── Primary NAICS codes (multi-select with search)
    ├── Secondary NAICS codes
    ├── Keyword domains (guided: "What do you do?")
    │     e.g., { "cybersecurity": ["penetration testing", "STIG", "RMF"],
    │             "cloud": ["AWS GovCloud", "FedRAMP", "migration"] }
    ├── Set-aside qualifications (checkboxes)
    │     □ Small Business  □ SDVOSB  □ WOSB  □ HUBZone  □ 8(a)
    ├── Agency priorities (optional: "Which agencies do you target?")
    └── Contract value range (min/max)

  All of this is stored as Stripe Checkout metadata so the webhook
  handler can create the tenant_profile without a second round-trip.

  User clicks "Subscribe — $499/month" → Stripe Checkout → payment

  STEP 3: PROVISIONING (triggered by webhook)
  ────────────────────────────────────────────
  Pipeline worker picks up onboarding job:

  3a. DATABASE
      ├── INSERT tenants (slug auto-generated from company name)
      ├── INSERT tenant_profiles (from checkout metadata)
      ├── INSERT users (primary contact, role=tenant_admin, temp_password)
      └── INSERT audit_log (tenant.created)

  3b. GOOGLE DRIVE (via domain-wide delegation service account)
      ├── Create root folder: /GovWin Tenants/{tenant-slug}/
      ├── Create subfolder tree (from template):
      │     /01 – Company Profile/
      │       ├── Capability Statement.gdoc          ← cloned from template
      │       ├── Past Performance Register.gsheet    ← cloned from template
      │       ├── Key Personnel.gsheet                ← cloned from template
      │       └── /Certifications/
      │       └── /Resumes/
      │     /02 – Proposals/
      │       ├── /Templates/                         ← master copies
      │       ├── /Active/
      │       ├── /Submitted/
      │       └── /Archive/
      │     /03 – Pipeline/
      │       ├── Pipeline Dashboard.gsheet           ← live-linked
      │       └── /Opportunity Files/                 ← solicitation PDFs
      │     /04 – Resources/
      │       ├── /Boilerplate/
      │       └── /Guidance & Templates/
      ├── Store root folder ID → tenants.drive_folder_id
      └── Share folder with tenant admin's email (Editor role)

  3c. GOOGLE WORKSPACE EMAIL
      ├── Create Gmail label for tenant: "Tenants/{tenant-slug}"
      ├── Store label ID → tenants.gmail_thread_label_id
      └── Send welcome email FROM platform domain:
            To: {primary_email}
            Subject: "Welcome to GovWin — Your portal is ready"
            Body: Login credentials + quick start guide

  3d. INITIAL SCORING
      ├── Queue scoring job for new tenant
      ├── Score all active opportunities against new tenant profile
      └── If any high-priority hits, include in welcome email

  STEP 4: FIRST LOGIN
  ───────────────────
  Tenant admin logs in with temp password → forced reset →
  lands on /portal/{slug}/dashboard showing their first scored results

  STEP 5: PROFILE REFINEMENT (optional, self-service when enabled)
  ─────────────────────────────────────────────────────────────────
  Tenant reviews scored opportunities → provides feedback (thumbs up/down)
  → scoring model learns from feedback over time
  Admin may fine-tune profile based on tenant conversations
```

---

## 5. Google Workspace Integration

### 5.1 Authentication Model

```
┌─────────────────────────────────────────────────────────────────┐
│  GOOGLE WORKSPACE DOMAIN: govwin.io (new domain)               │
│                                                                 │
│  Service Account: pipeline@govwin.iam.gserviceaccount.com      │
│                                                                 │
│  Domain-Wide Delegation Scopes:                                 │
│    • https://www.googleapis.com/auth/drive                     │
│    • https://www.googleapis.com/auth/documents                 │
│    • https://www.googleapis.com/auth/spreadsheets              │
│    • https://www.googleapis.com/auth/gmail.send                │
│    • https://www.googleapis.com/auth/gmail.labels              │
│                                                                 │
│  Impersonation: service account impersonates                   │
│    noreply@govwin.io for sending email                         │
│    admin@govwin.io for Drive folder ownership                  │
│                                                                 │
│  NO per-user OAuth required. Tenants never authenticate        │
│  with Google. All Drive access is through embedded views        │
│  or service-account-generated sharing links.                    │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Drive as CMS — Access Pattern

```
  User hits /portal/acme-corp/documents
    │
    ▼
  Middleware: session.tenantId matches 'acme-corp'? ✓
    │
    ▼
  Page loads: reads tenants.drive_folder_id for acme-corp
    │
    ▼
  Renders embedded Drive view (iframe or Drive Picker)
    │
    ▼
  User browses/opens/edits files natively in Google's UI
    │
    ▼
  Edits save directly to Drive (Google handles versioning,
  collaboration, offline, mobile, etc.)

  ┌─────────────────────────────────────────┐
  │  WHAT THE APP MANAGES:                  │
  │  ├── Folder provisioning (create tree)  │
  │  ├── Template cloning (new docs)        │
  │  ├── Sharing permissions (add/remove)   │
  │  └── File discovery (list for UI)       │
  │                                         │
  │  WHAT GOOGLE MANAGES:                   │
  │  ├── Document editing (Docs/Sheets)     │
  │  ├── Version history                    │
  │  ├── Collaboration (real-time)          │
  │  ├── File storage & durability          │
  │  ├── Search within documents            │
  │  └── Mobile access                      │
  └─────────────────────────────────────────┘
```

### 5.3 Email via Google Workspace Gmail

```
  OUTBOUND EMAIL (platform → tenant)
  ───────────────────────────────────

  All emails sent via Gmail API (not SMTP, not third-party ESP).
  Service account impersonates noreply@govwin.io.

  Email types:
    ├── Welcome email (onboarding)
    ├── Daily digest (new high-scoring opportunities)
    ├── Urgent alerts (closing <7 days, amendments)
    ├── Payment confirmations/failures (from Stripe, relayed)
    ├── Password reset links
    └── (Future) Proposal status updates

  Each tenant's emails are labeled in Gmail:
    "Tenants/acme-corp" — searchable, archivable, auditable

  ┌──────────────────────────────────────────────────────────────┐
  │  WHY GMAIL API INSTEAD OF RESEND/SENDGRID:                  │
  │  ├── Full audit trail in platform's own Gmail               │
  │  ├── Reply handling: tenants can reply → lands in inbox     │
  │  ├── Thread continuity: all emails to a tenant are threaded │
  │  ├── Label-based organization per tenant                    │
  │  ├── No additional vendor cost                              │
  │  ├── Domain reputation managed in one place                 │
  │  └── Admin can review any sent email in Gmail UI            │
  └──────────────────────────────────────────────────────────────┘

  INBOUND EMAIL (tenant → platform)
  ──────────────────────────────────

  Tenants reply to digest/alert emails → arrives in Gmail inbox.

  Processing options (phased):
    Phase 1: Manual — admin checks inbox, filtered by label
    Phase 2: Automation — Gmail push notification → pipeline worker
             parses reply, routes to appropriate handler:
             ├── "interested" → update pursuit_status to 'pursuing'
             ├── "pass" → update pursuit_status to 'passed'
             ├── Attachment → save to tenant's Drive folder
             └── Question → flag for admin review
```

---

## 6. Recurring Pipeline — Scrape / Analyze / Score / Notify

### 6.1 Pipeline Schedule

```
  ┌────────────────────────────────────────────────────────────────────────┐
  │  DAILY PIPELINE SEQUENCE (UTC)                                        │
  │                                                                        │
  │  05:00  ┄┄┄  Re-score all tenants against existing opportunities      │
  │  06:00  ┄┄┄  SAM.gov ingest (new + updated opportunities)             │
  │  06:00  ┄┄┄  Grants.gov ingest (parallel with SAM.gov)                │
  │  07:00  ┄┄┄  SBIR ingest (weekly on Mondays)                          │
  │  07:00  ┄┄┄  Email digests sent to all active tenants                 │
  │  08:00  ┄┄┄  USASpending intelligence pull (weekly on Sundays)        │
  │  */4hr  ┄┄┄  Open opportunity refresh (detect amendments/closures)    │
  └────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Full Pipeline Data Flow

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                    DAILY PIPELINE DATA FLOW                         │
  └─────────────────────────────────────────────────────────────────────┘

  PHASE 1: INGEST
  ════════════════

  SAM.gov API ──────────────┐
  Grants.gov API ───────────┤
  SBIR API ─────────────────┤──→  RAW OPPORTUNITY DATA
  USASpending API ──────────┘
        │
        ▼
  ┌─────────────────────────────────────────┐
  │  DEDUPLICATION                          │
  │  content_hash = SHA256(raw_json)[:16]   │
  │                                         │
  │  Hash match?                            │
  │    ├── Yes → skip (unchanged)           │
  │    └── No  → new or amended             │
  │              ├── New → INSERT            │
  │              └── Amended → UPDATE +      │
  │                  INSERT amendment record │
  └────────────────┬────────────────────────┘
                   │
                   ▼
  ┌─────────────────────────────────────────┐
  │  GLOBAL OPPORTUNITIES TABLE             │
  │  (one canonical record per source_id)   │
  │                                         │
  │  Currently: ~5 stub records             │
  │  Production: thousands, growing daily   │
  └────────────────┬────────────────────────┘
                   │
                   ▼
  PHASE 2: SCORE PER TENANT
  ═════════════════════════

  For each active tenant (with a profile):
  ┌─────────────────────────────────────────────────────────────────┐
  │                                                                 │
  │  For each active opportunity:                                   │
  │    ├── NAICS match      (0-25)  primary=25, secondary=15       │
  │    ├── Keyword match    (0-25)  domain-weighted                │
  │    ├── Set-aside match  (0-15)  exact=15, partial=8            │
  │    ├── Agency priority  (0-15)  tier 1=15, tier 2=10, tier 3=5│
  │    ├── Opportunity type (0-10)  solicitation=10, SS=5          │
  │    ├── Timeline urgency (0-10)  <7d=10, <14d=7, <30d=4        │
  │    │                    ─────                                   │
  │    │   Surface score     0-100                                  │
  │    │                                                            │
  │    │   If surface_score >= 50:                                  │
  │    │     └── Claude LLM analysis                               │
  │    │         ├── Score adjustment    (-20 to +20)              │
  │    │         ├── Rationale           (1 sentence)              │
  │    │         ├── Key requirements    (2-4 items)               │
  │    │         ├── Competitive risks   (1-3 items)               │
  │    │         └── RFI questions       (1-3 items)               │
  │    │                                                            │
  │    └── UPSERT tenant_opportunities                             │
  │        ├── total_score (clamped 0-100)                         │
  │        ├── All sub-scores                                       │
  │        ├── pursuit_recommendation (pursue/monitor/pass)        │
  │        ├── LLM analysis fields                                 │
  │        └── priority_tier (generated: high/medium/low)          │
  │                                                                 │
  └─────────────────────────────────────────────────────────────────┘
                   │
                   ▼
  PHASE 3: SUMMARIZE
  ══════════════════

  For each tenant's new high-priority opportunities (score >= 75):
  ┌─────────────────────────────────────────┐
  │  Already done in Phase 2 (LLM pass)     │
  │  Key deliverables per opportunity:      │
  │  ├── One-sentence rationale             │
  │  ├── Key requirements bullet list       │
  │  ├── Competitive risk assessment        │
  │  └── Suggested RFI questions            │
  │                                         │
  │  Stored in tenant_opportunities for     │
  │  portal display AND digest email        │
  └────────────────┬────────────────────────┘
                   │
                   ▼
  PHASE 4: NOTIFY
  ═══════════════

  ┌─────────────────────────────────────────────────────────────────┐
  │  For each active tenant with new scored opportunities:          │
  │                                                                 │
  │  BUILD DIGEST:                                                  │
  │    ├── New high-priority opportunities (score >= 75)           │
  │    │     Title, agency, score, deadline, rationale              │
  │    │     Link to portal opportunity detail                     │
  │    │                                                            │
  │    ├── Amendments to tracked opportunities                     │
  │    │     What changed, when, link to updated listing           │
  │    │                                                            │
  │    ├── Closing soon (< 7 days, tenant is pursuing/monitoring)  │
  │    │     Deadline countdown, current status                    │
  │    │                                                            │
  │    └── Pipeline summary stats                                  │
  │          Total in pipeline, high priority count, new this week │
  │                                                                 │
  │  SEND VIA:                                                      │
  │    Gmail API → noreply@govwin.io → tenant primary_email        │
  │    Label: "Tenants/{slug}/Digests"                             │
  │    Thread: continues existing digest thread for month          │
  │                                                                 │
  │  URGENT ALERTS (separate from digest, sent immediately):       │
  │    ├── Amendment to opportunity tenant is "pursuing"           │
  │    ├── New opportunity scoring >= 90                           │
  │    └── Opportunity closing in < 48 hours                       │
  └─────────────────────────────────────────────────────────────────┘
                   │
                   ▼
  PHASE 5: FILE (Drive sync)
  ══════════════════════════

  ┌─────────────────────────────────────────────────────────────────┐
  │  For high-priority opportunities with downloadable documents:   │
  │                                                                 │
  │  1. Download solicitation PDFs from SAM.gov                    │
  │  2. Upload to tenant's Drive:                                  │
  │     /03 – Pipeline/Opportunity Files/{Solicitation #}/         │
  │       ├── Solicitation.pdf                                     │
  │       ├── Amendments/                                          │
  │       └── AI_Summary.gdoc  ← generated from LLM analysis      │
  │                                                                 │
  │  3. Update Pipeline Dashboard.gsheet in tenant's Drive         │
  │     with latest scoring data (append new rows, update scores)  │
  └─────────────────────────────────────────────────────────────────┘
```

### 6.3 Amendment Detection & Propagation

```
  SAM.gov returns opportunity with different content_hash
    │
    ├── UPDATE opportunities table (single global record)
    ├── INSERT amendments row (change_type, old_value, new_value)
    │
    └── For every tenant who has this opportunity scored:
        ├── Re-score with updated data
        ├── If tenant pursuit_status = 'pursuing':
        │   └── Queue urgent amendment notification
        ├── Update Pipeline Dashboard.gsheet (if syncing)
        └── Upload new/amended docs to tenant's Drive
```

---

## 7. Database Schema — Additions for Full System

### 7.1 Existing Tables (unchanged)

```
  ── Auth ──────────────────
  users, accounts, sessions, verification_tokens

  ── Tenants ───────────────
  tenants (+new columns below), tenant_profiles
  download_links, tenant_uploads

  ── Opportunities ─────────
  opportunities, tenant_opportunities, tenant_actions
  documents, amendments

  ── Control Plane ─────────
  system_config, api_key_registry, pipeline_schedules
  pipeline_jobs, pipeline_runs
  rate_limit_state, source_health
  notifications_queue, audit_log

  ── Knowledge Base ────────
  past_performance, capabilities, key_personnel, boilerplate_sections
```

### 7.2 New / Modified Tables

```sql
-- ═══════════════════════════════════════════════════════════════
-- tenants: add Stripe + Google Workspace columns
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE tenants ADD COLUMN stripe_customer_id     TEXT UNIQUE;
ALTER TABLE tenants ADD COLUMN stripe_subscription_id  TEXT UNIQUE;
ALTER TABLE tenants ADD COLUMN stripe_price_id         TEXT;
ALTER TABLE tenants ADD COLUMN subscription_status     TEXT DEFAULT 'incomplete';
ALTER TABLE tenants ADD COLUMN current_period_end      TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN drive_folder_id         TEXT;
ALTER TABLE tenants ADD COLUMN gmail_thread_label_id   TEXT;
ALTER TABLE tenants ADD COLUMN onboarding_step         TEXT DEFAULT 'pending';
    -- 'pending' | 'payment_received' | 'db_provisioned'
    -- | 'drive_provisioned' | 'welcome_sent' | 'complete'

-- ═══════════════════════════════════════════════════════════════
-- subscription_events: Stripe event log (idempotency + audit)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE subscription_events (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stripe_event_id  TEXT UNIQUE NOT NULL,   -- idempotency key
    event_type       TEXT NOT NULL,
    tenant_id        UUID REFERENCES tenants(id),
    customer_id      TEXT,
    subscription_id  TEXT,
    payload          JSONB NOT NULL,
    processed_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sub_events_tenant ON subscription_events(tenant_id);
CREATE INDEX idx_sub_events_type   ON subscription_events(event_type);

-- ═══════════════════════════════════════════════════════════════
-- drive_files: index of files in each tenant's Drive tree
-- (optional — used for fast lookups without hitting Drive API)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE drive_files (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    drive_file_id    TEXT NOT NULL,           -- Google Drive file ID
    drive_parent_id  TEXT,                    -- Parent folder ID
    name             TEXT NOT NULL,
    mime_type        TEXT,
    folder_path      TEXT,                    -- e.g., "/01 – Company Profile/"
    file_type        TEXT,                    -- 'template' | 'generated' | 'uploaded' | 'folder'
    related_opp_id   UUID REFERENCES opportunities(id),
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    synced_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, drive_file_id)
);

CREATE INDEX idx_drive_files_tenant ON drive_files(tenant_id, folder_path);

-- ═══════════════════════════════════════════════════════════════
-- email_log: track all emails sent (mirrors Gmail but queryable)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE email_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID REFERENCES tenants(id),
    user_id         TEXT REFERENCES users(id),
    email_type      TEXT NOT NULL,
    to_address      TEXT NOT NULL,
    subject         TEXT NOT NULL,
    gmail_message_id TEXT,                   -- Gmail API message ID
    gmail_thread_id  TEXT,                   -- For threading
    status          TEXT DEFAULT 'sent',     -- 'sent' | 'failed' | 'bounced'
    error_message   TEXT,
    sent_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_email_log_tenant ON email_log(tenant_id, sent_at DESC);
```

---

## 8. Environment Variables — Full Set

```
# ── Database ─────────────────────────────────────────────
DATABASE_URL=postgresql://govtech:password@host:5432/govtech_intel

# ── Auth ─────────────────────────────────────────────────
AUTH_SECRET=<openssl rand -base64 32>
NEXTAUTH_URL=https://app.govwin.io

# ── Stripe ───────────────────────────────────────────────
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...                 # $499/mo Hunt & Rank price ID
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...

# ── Google Workspace ─────────────────────────────────────
GOOGLE_SERVICE_ACCOUNT_KEY=<base64 encoded JSON key>
GOOGLE_DELEGATED_ADMIN=admin@govwin.io    # For Drive ownership
GOOGLE_DELEGATED_SENDER=noreply@govwin.io # For Gmail send
GOOGLE_DRIVE_TEMPLATE_FOLDER_ID=<folder ID of master templates>
GOOGLE_WORKSPACE_DOMAIN=govwin.io

# ── Pipeline ─────────────────────────────────────────────
SAM_GOV_API_KEY=<api key>
ANTHROPIC_API_KEY=<api key>
CLAUDE_MODEL=claude-sonnet-4-20250514

# ── App ──────────────────────────────────────────────────
APP_URL=https://app.govwin.io
EMAIL_FROM=noreply@govwin.io
```

---

## 9. Security Model

```
  ┌─────────────────────────────────────────────────────────────────┐
  │                     ACCESS CONTROL LAYERS                       │
  └─────────────────────────────────────────────────────────────────┘

  LAYER 1: AUTHENTICATION (NextAuth.js)
  ──────────────────────────────────────
  ├── Credentials provider (email + bcrypt password)
  ├── Magic link provider (email verification)
  ├── Sessions stored in PostgreSQL (not JWT)
  └── Session includes: userId, email, role, tenantId

  LAYER 2: AUTHORIZATION (middleware)
  ───────────────────────────────────
  ├── master_admin → can access /admin/* and /portal/{own-slug}/*
  ├── tenant_admin → can access /portal/{own-slug}/* only
  ├── tenant_user  → can access /portal/{own-slug}/* only
  ├── Middleware injects x-tenant-id, x-tenant-slug headers
  └── Every API route verifies session.tenantId matches request

  LAYER 3: SUBSCRIPTION GATE
  ──────────────────────────
  ├── Portal routes check: tenants.subscription_status = 'active'
  ├── Past-due tenants: read-only access (can view, can't act)
  ├── Canceled tenants: redirected to resubscribe page
  └── Pipeline worker skips scoring for non-active subscriptions

  LAYER 4: GOOGLE DRIVE ISOLATION
  ────────────────────────────────
  ├── Each tenant's folder owned by service account
  ├── Shared only with that tenant's users (by email)
  ├── Tenant A cannot see Tenant B's folder (Drive permissions)
  ├── App only reveals drive_folder_id if session.tenantId matches
  └── Service account can access all folders (for agents, sync)

  LAYER 5: DATA ISOLATION (PostgreSQL)
  ─────────────────────────────────────
  ├── All tenant-scoped queries include WHERE tenant_id = $session.tenantId
  ├── API routes enforce tenant scoping before any query
  ├── Opportunities table is global (shared read)
  ├── tenant_opportunities, tenant_actions are per-tenant
  └── (Future) Row-level security policies as additional guard
```

---

## 10. Deployment Topology (Railway)

```
  ┌───────────────────────────────────────────────────────────────────┐
  │  RAILWAY PROJECT                                                  │
  │                                                                   │
  │  ┌─────────────────────────────────────────────────────────────┐  │
  │  │  Service: web (Next.js)                                     │  │
  │  │  Build: npm run build                                       │  │
  │  │  Start: npm start                                           │  │
  │  │  Port: 3000                                                 │  │
  │  │  Domain: app.govwin.io                                      │  │
  │  │  Env: all frontend + Stripe + Google vars                   │  │
  │  └─────────────────────────────────────────────────────────────┘  │
  │                                                                   │
  │  ┌─────────────────────────────────────────────────────────────┐  │
  │  │  Service: pipeline (Python worker)                          │  │
  │  │  Build: pip install -r requirements.txt                     │  │
  │  │  Start: python -m src.main                                  │  │
  │  │  Port: none (worker, no HTTP)                               │  │
  │  │  Env: DATABASE_URL + SAM_GOV + ANTHROPIC + Google vars      │  │
  │  └─────────────────────────────────────────────────────────────┘  │
  │                                                                   │
  │  ┌─────────────────────────────────────────────────────────────┐  │
  │  │  Service: postgres (Railway managed)                        │  │
  │  │  PostgreSQL 16 + pgvector extension                         │  │
  │  │  Persistent volume                                          │  │
  │  └─────────────────────────────────────────────────────────────┘  │
  └───────────────────────────────────────────────────────────────────┘

  External services (not in Railway):
  ├── Stripe (billing)
  ├── Google Workspace (Drive, Docs, Sheets, Gmail)
  ├── SAM.gov API (opportunity data)
  ├── Anthropic API (Claude LLM)
  └── DNS: govwin.io (Cloudflare or Google Domains)
```

---

## 11. Mapping Existing Tables to Google Workspace

The following tables become **sync targets** rather than primary stores once
Drive is provisioned:

| Existing Table | Role After Workspace Integration |
|---|---|
| `tenant_uploads` | **Deprecated** — files live in Drive. Table becomes index/cache. |
| `download_links` | **Remains** for admin-curated external links. Resources also land in Drive `/04 – Resources/`. |
| `past_performance` | **Sync target** — human-editable source of truth is the Past Performance Register.gsheet. Pipeline reads sheet → updates table for scoring queries. |
| `capabilities` | **Sync target** — mirrors Capability Statement.gdoc structured data. |
| `key_personnel` | **Sync target** — mirrors Key Personnel.gsheet. |
| `boilerplate_sections` | **Sync target** — sections extracted from Capability Statement.gdoc. |
| `documents` (global) | **Remains** — tracks solicitation docs downloaded from SAM.gov. Copies are uploaded to tenant Drive folders. |
| `notifications_queue` | **Replaced by** email_log + Gmail API direct send. |

---

## 12. Future: In-Drive Proposal Agents (Phase 3)

This architecture explicitly sets the stage for proposal generation agents:

```
  ┌─────────────────────────────────────────────────────────────────┐
  │  PROPOSAL AGENT FLOW (Future)                                   │
  │                                                                 │
  │  1. Scoring engine flags Opp X as high-priority for Tenant Y   │
  │  2. Agent job queued: "Generate proposal draft"                │
  │  3. Agent (Python + Google APIs via domain-wide delegation):   │
  │     a. Clone proposal template from /02 – Proposals/Templates/ │
  │     b. Read tenant's Drive KB:                                 │
  │        - Capability Statement.gdoc                             │
  │        - Past Performance Register.gsheet                      │
  │        - Key Personnel.gsheet                                  │
  │     c. Read solicitation docs from /03 – Pipeline/{opp}/       │
  │     d. Call Claude with full context:                          │
  │        - Tenant capabilities + past performance                │
  │        - Solicitation requirements                             │
  │        - Boilerplate sections                                  │
  │     e. Write proposal sections into cloned doc via Docs API   │
  │     f. Move completed draft to /02 – Proposals/Active/{opp}/   │
  │  4. Notify tenant: "Draft ready — [Open in Docs]"             │
  │  5. Team edits collaboratively in Google Docs                  │
  │                                                                 │
  │  KEY INSIGHT: Agents read from AND write to the SAME Drive     │
  │  tree the humans use. Single source of truth. No export/import │
  │  cycle. No format conversion.                                  │
  └─────────────────────────────────────────────────────────────────┘
```

---

## 13. Implementation Priority

```
  PHASE 1: Hunt & Rank ($499/mo baseline)
  ════════════════════════════════════════
  ✅ Database schema (migrations 001-004)
  ✅ Auth + middleware + session management
  ✅ Admin panel (tenants, pipeline, sources)
  ✅ Portal (dashboard, pipeline, documents, profile)
  ✅ Pipeline worker (SAM.gov ingest + scoring engine)
  🔲 Stripe integration (checkout, webhooks, subscription lifecycle)
  🔲 Google Drive provisioning (folder skeleton + template cloning)
  🔲 Gmail email sending (digests, alerts, welcome emails)
  🔲 Signup flow (public page → Stripe checkout → auto-provision)
  🔲 Subscription gate (middleware checks active subscription)

  PHASE 2: Profile Intelligence
  ══════════════════════════════
  🔲 Onboarding wizard (guided profile setup during signup)
  🔲 Drive ↔ DB sync (Sheets → past_performance, capabilities, etc.)
  🔲 Pipeline Dashboard.gsheet live sync
  🔲 Solicitation doc download → tenant Drive upload
  🔲 Gmail inbound processing (reply parsing)
  🔲 Grants.gov + SBIR ingesters
  🔲 Feedback loop scoring adjustments

  PHASE 3: Proposal Agents
  ═════════════════════════
  🔲 Proposal template system (master templates in Drive)
  🔲 Agent: gap analysis (requirements vs capabilities)
  🔲 Agent: draft generation (populate proposal from KB)
  🔲 Agent: compliance matrix builder
  🔲 Upgraded Stripe tiers (Professional, Enterprise)
```

---

## 14. Key Architectural Decisions

| Decision | Rationale |
|---|---|
| Google Drive as CMS, not custom file storage | Proven pattern. No file upload UI to build. Google handles versioning, collaboration, mobile, durability. Embed, don't rebuild. |
| Gmail API for email, not Resend/SendGrid | Full audit trail in platform Gmail. Reply handling. Thread continuity. Per-tenant labels. One less vendor. |
| Domain-wide delegation, not per-user OAuth | No consent screens. No token refresh headaches. Service account manages all folders. Users never authenticate with Google directly. |
| Stripe Checkout (hosted), not custom payment form | PCI compliance handled by Stripe. Fastest path to revenue. Signup metadata carries profile data through to webhook. |
| Pipeline worker provisions Drive (not Next.js API) | Heavy I/O (folder creation, file cloning) belongs in the worker. Webhook handler just queues the job. Non-blocking for the user. |
| KB tables as sync targets, not primary stores | Humans edit in Google Docs/Sheets (rich UI they already know). Pipeline syncs structured data to Postgres for fast scoring queries. Best of both worlds. |
| PostgreSQL sessions, not JWT | Sessions are revocable. Subscription gate checks happen at DB level. No token-refresh timing issues. Middleware can check subscription status on every request. |
