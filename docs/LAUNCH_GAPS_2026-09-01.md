# Final gaps to launch with real guided customer onboarding

**Measured 2026-09-01** against `main` at `fb203632` (PR #215), on a sandbox rebuilt from that
commit. Every number below came from the running box or the live database. Where something could
not be measured it says so — an unmeasured item is uncovered, not passing.

Companion documents: **docs/MARKETING_SALES_SYSTEM.md** (the commercial spine),
**docs/PRE_LAUNCH_CHECKLIST.md** (the ops/config gate), **docs/CUSTOMER_ONBOARDING_GUIDE.md** (the
script you read aloud).

---

## 0. The short answer

**One thing blocks launch, and it is not code.** Outbound email is not switched on, and the welcome
message carrying the temporary password is the only way a newly accepted customer gets in.

Everything else on this page is either **fixed today** (four items, listed with their evidence) or
**a decision you have already made** (self-serve payment stays descoped; comp codes stand in).

---

## 1. What was verified this pass

| | evidence |
|---|---|
| Every UI route renders as the actor who owns it | **158 screenshots, 158 clean, 0 broken** (`capture-ui-atlas`, 6 lanes) |
| Every addressable surface is free of error boundaries and client throws | `verify-surfaces` — clean for every actor |
| Unit suite | **243 test files** pass |
| Schema | live head **243**, `docs/SCHEMA_MAP.md` regenerated and current |
| Tenant isolation | `check-rls-posture` — two-layer, enforced, connection is `govtech_app` with `rolbypassrls = f` |
| Documentation references | cross-references, `/admin` + `/partner` routes (407 on disk), schema stamp — all resolve |

⚠️ **Two "findings" during this pass were mine, not the product's**, and both are worth knowing
because they will recur:

* a **stale build** produced a convincing customer-facing 404 on
  `/portal/[tenantSlug]/cards/[opportunityId]/solicitation`, driven as the real tenant user on a
  card that tenant owned. The page source was on disk; the route directory in the build output was
  empty. `rehydrate-sandbox` now rebuilds when any source file is newer than the build stamp;
* a **concurrent rebuild** during a capture sweep produced eleven `ERR_CONNECTION_REFUSED`
  "failures". Run mutating instruments one at a time — this is the third occurrence.

---

## 2. Fixed today

### 2a. The attribution chain was fed by nothing
`components/analytics/tracker.tsx` minted `_rfp_sid` into `sessionStorage` on every page view.
**Neither public form ever read it back.** Migration 242's columns, migration 243's `contacts`, the
capture routes and `/admin/funnel` were all complete and correct — and `drive-commercial-path`
passed because *the drive* sends a session id. The funnel would have reported "0 of N contacts
carry a first-touch session" forever: honestly, and uselessly.

Both forms now read `lib/visitor-session` (one shared module, so the next capture form cannot
forget), guarded by a source-scan test. Proven end to end: arriving on
`?utm_source=…&utm_campaign=…`, the browser's own minted session reached `waitlist.session_id`
**and** `contacts.first_session_id`, joining to the UTM on `page_views`.

### 2b. Acceptance dropped the customer's own answers
Measured: **6 of 7 tenants had an empty company profile and zero spotlight buckets.** The exception
to each was hand-seeded.

This was one missing write, not a missing feature. The bucket form already has a *"start from your
company profile"* button; the accept route wrote `tenant_profiles` **zero times**. So on day one the
button found nothing and told a brand-new customer to go and type, on another page, the tech areas
and target agencies they typed on the application ten minutes earlier.

`seedProfileFromApplication` now runs in the accept route's best-effort tail. It does **not** create
buckets — the product deliberately opens those empty (mig 206), and a profile is a different kind of
thing: a record of what the company told us, which is exactly what an application is. Non-destructive
per column, so a curated profile is never overwritten. Proven: 0 keywords before → 3 after → a
curated value survives a re-run.

### 2c. The first-run checklist had no bucket step, and one wrong tick
`hasProfile` tested that a *row existed*, so `foundation` showed "Set up your company profile ☑"
having never opened it — and 2b would have made that wrong tick universal. The predicate now asks
whether the profile says anything.

The checklist also had four steps and no bucket. Without a bucket `/cards` falls back to recency
ordering — a real list, ranked by nothing the customer chose, with nothing anywhere saying so. The
step now sits after "review your matched opportunities", where the bucket form's prefill can do the
typing from the seeded profile. The three pieces only work as one.

### 2d. Five documented routes that 404, and a launch checklist that was wrong about security
Runbooks and click-plans sent an operator to `/admin/rfp-upload`, `/admin/content`,
`/admin/content/editor`, `/admin/email-outbox` and `/admin/activity` — all gone. Repointed
(34 replacements across 7 docs).

`PRE_LAUNCH_CHECKLIST.md` said *"the app runs as the RLS-bypassing owner"* and told the reader to
schedule the `NOBYPASSRLS` cutover after go-live. That cutover landed in **migration 136**, 107
migrations ago. Understating your own security posture and sending someone to redo finished work is
the worst shape a launch checklist can have.

The onboarding guide also described a **different application form** — it listed NAICS codes, years
in business, clearance level and a past-performance summary, none of which the form asks, and omitted
ten fields it does. That guide is read aloud during a guided onboarding.

New instrument: `frontend/scripts/audit-doc-currency.mjs`, so prose gets an instrument like
everything else here. It checks references, not judgements.

---

## 3. What still blocks a real customer

### 3a. ⛔ Outbound email is not switched on — the only hard blocker
On this box: `email_send_ledger` holds **0 sent, 0 failed** — no provider configured.
`docs/RAILWAY_ENV_VARS.md` still lists `EMAIL_DRIVER` as **"➕ ADD (`postmark`, at cutover)"**.

The welcome message carries the temporary password. Onboarding returns that password in the API
response too (so nobody is *fully* locked out), but a guided onboarding where you read a password
down the phone is not the product.

Needed, in the frontend service:
```
EMAIL_DRIVER=postmark
POSTMARK_SERVER_TOKEN     # the SERVER token — the ACCOUNT token cannot send and 401s in a way
                          # that reads exactly like a wrong key
POSTMARK_WEBHOOK_SECRET   # webhook URL: https://postmark:<secret>@<host>/api/webhooks/postmark
```
plus **DKIM and Return-Path DNS** for the sending domain — without them delivery is a coin flip and
`email_suppressions` fills with bounces that were never the recipient's fault.

`/admin/crm` tells you the moment it takes: transport in force, 30-day sent/failed, reserved-never-
confirmed rows, webhook callbacks, and the blocked list.

### 3b. ⚠️ `DATABASE_URL_OWNER` on the frontend service
`sqlBypass` and every legitimate cross-tenant admin read need it. Without it the admin consoles —
including the funnel, the outbound-mail console and the project explorer — read empty rather than
erroring, which is the failure mode that looks like "no data yet".

### 3c. ◻ Self-serve payment — a decision, not a gap
The purchase modal has both paths and degrades honestly: *"Card checkout is not available yet — use
an access code below."* The comp-code path (`rfppipelinetest` → `curation_pending`, 72h SLA) is
complete and drives end to end. Set the Stripe keys or keep the comp motion; both are supported.

---

## 4. Ready, with nothing outstanding

* **The proposal arc** — ingest → curate → publish → fan-out → buy → provision → author → lock →
  package → download, in json/docx/pdf/zip, with the compliance gate reporting zero violations.
* **Post-award projects** — CLINs, WBS, baseline (frozen once, by trigger), milestones,
  deliverables, close-out and reopen; three progress measures side by side, never blended.
* **The commercial surfaces** — a 21-field application form, legal pages, pricing, the funnel and
  contact list, and the outbound-mail console with a working suppression lift.
* **Tenant isolation** — two-layer, enforced, proven at rest and in the app layer.

---

## 5. The one thing I would still not skip

**Drive the guided onboarding the way the proposal path was driven, with Postmark on.**

`drive-commercial-path` walks apply → accept → account → welcome → first sign-in, and it passes.
What it cannot cover is the part that only exists in production: a real mailbox receiving a real
message from a real domain with real DNS. Every defect in §2 was invisible until somebody signed in
as the actual actor and did the actual thing — and §2a in particular was a chain that was complete,
tested, green, and connected to nothing.

The next broken thing is wherever a person's hands have not yet been.
