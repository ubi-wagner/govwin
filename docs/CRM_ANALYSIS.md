# CRM — end-to-end sweep and functional analysis

**Swept 2026-08-26.** Generated companion: **docs/CRM_INVENTORY.md** (regenerate with
`CMS_DATABASE_URL=… node frontend/scripts/inventory-crm.mjs`).

---

## 0. The reason this was overdue, stated precisely

**No instrument in this repository had ever looked at the CRM**, and the reason is structural
rather than an oversight anyone could have noticed: **its database is not on this box.**

Every lens, audit and reconciliation here — `verify-surfaces`, `verify-api-contract`,
`verify-db-crud`, `verify-ui-vs-db`, `verify-write-contract`, `reconcile-capability`,
`audit-automation-spine`, `check-rls-posture` — connects to `govtech_intel`. The CRM (`rfp-crm`)
has its own FastAPI service, its own Vite console and its own Postgres (`cms-postgres`). `psql -l`
on a fresh sandbox lists `govtech_intel` and nothing else.

So a sweep that "found no problems in the CRM" had not looked at the CRM. This is the same failure
shape as B125 and as the capability lens reading a stale inventory:

> **A lens that cannot see a thing does not report it missing. It reports silence, which reads
> exactly like a pass.**

The database now stands up locally from `services/cms/db/*.sql` (12 migrations, clean), which is
what made the rest of this document measurable rather than narrated.

---

## 1. What the service actually is

`rfp-crm` is a **FastAPI app + six background workers + a Vite admin console**. All six workers
start unconditionally in the app's `lifespan`, each wrapped in a restart loop:

| worker | what it does |
|---|---|
| `content_generator` | AI content drafting |
| `email_queue` | dequeues and sends via Gmail |
| `email_sweep` | polls the inbox, threads replies |
| `campaign_executor` | runs email campaigns |
| `drip_engine` | advances drip enrolments |
| `social_poster` | posts to social accounts |

Plus `event_listener`, which polls `system_events` **on the main database** and fires
`automation_rules` — that listener is the platform's notification engine, and it is the single most
load-bearing thing in the service.

### The measured shape

| | count |
|---|---|
| tables in `cms-postgres` | **24** |
| tables carrying `tenant_id` | **7** |
| …of those with RLS and a policy | **0** |
| API endpoints | **88** |
| …with no caller found anywhere | **48** |
| tables superseded by the frontend content move | **6** |
| orphan tables (no reader, no writer) | 3 (all migration bookkeeping) |
| seams to the platform | **15** |

---

## 2. The headline: there is no CRM in the CRM

`services/cms/db/006_crm_tables.sql` is titled *"CRM operational tables"*. What it creates is
`admin_todos`, `social_accounts` and `social_posts` — a task queue and a social publisher.

Across all 24 tables there is **no `contacts`, no `companies`, no `deals`/pipeline, no `activities`
log, no `lists`/`segments`, and no attribution model.** The service can send an email to an address
string. It cannot answer *who is this person, where did they come from, what have we sent them, and
what happened.*

CLAUDE.md already says the forward scope is "customer identification / acquisition / management,
**still to be built out**". This sweep confirms the stronger statement: it is **entirely** unbuilt.
The name is aspirational, and reading the service's title as a description of its capability is the
single easiest mistake to make about this codebase.

What exists is an **outbound engine** — email, drip, social — with no subject.

### And the funnel is split across two databases with nothing joining it

| stage | where it lives | table |
|---|---|---|
| anonymous visit, UTM source | main DB | `visitor_sessions`, `page_views` |
| early interest | main DB | `waitlist` |
| qualified lead (the application form) | main DB | `applications` (35 columns) |
| accepted customer | main DB | `tenants`, `users`, `user_memberships` |
| revenue | main DB | `purchases` |
| consent | main DB | `consent_records` |
| **outreach to any of the above** | **CRM DB** | `email_sends`, `email_threads`, `drip_enrollments` |

`email_sends.tenant_id` and `.user_id` are **`TEXT`, deliberately without foreign keys** — migration
006's header says so plainly, because they point across a database boundary. So the join that would
answer "which of our leads have we mailed, and did any of them convert" **cannot be written at all**
in SQL today, in either direction.

That is the central finding, and it is what the migration in §5 has to fix.

---

## 3. Isolation: seven tenant-bearing tables, zero protection

| table | columns | RLS | policies |
|---|---|---|---|
| `admin_todos` | 16 | **off** | 0 |
| `cms_generations` | 27 | **off** | 0 |
| `drip_enrollments` | 13 | **off** | 0 |
| `email_engagement` | 13 | **off** | 0 |
| `email_sends` | 33 | **off** | 0 |
| `email_threads` | 15 | **off** | 0 |
| `social_accounts` | 12 | **off** | 0 |

`cms-postgres` has **no row-level security anywhere** — not disabled-pending-cutover, not
force-RLS-without-policies. It has never had any.

The main database spent migrations 136, 171, 173, 184, 185, 186, 209, 212, 213 and 216 getting to
two-layer enforced isolation, on the principle that *nothing reads or writes cross-tenant, ever*.
The CRM holds recipient addresses, message bodies, engagement history and thread contents for the
same tenants, under a single application role, with the boundary enforced only by whatever `WHERE`
clause each query happens to carry.

**This is not currently a live leak**, and the reason is worth being precise about rather than
reassuring: the CRM's console is a single internal admin surface with no tenant context, and no
tenant user can reach it. The exposure is that the *only* thing standing between one tenant's
outreach history and another is application code that no test asserts — the same "load-bearing
belt" CLAUDE.md warns about for platform rows, minus the RLS backstop that catches it there.

It becomes a real leak the moment anything tenant-facing reads this database. §5 treats that as a
precondition, not a later hardening pass.

---

## 4. What is superseded, and what is unreached

### Superseded — a decision already taken whose cleanup has not happened

CLAUDE.md records that front-facing content moved to the frontend's `content_pages` store in the
main DB, and that the CRM's content and page-block routers are superseded. Six tables are the
residue: `cms_posts` (34 cols), `cms_generations` (27), `cms_media`, `cms_reviews`, `cms_events`,
`cms_config`.

They are not "unused pending investigation". They read as live CRM capability to anyone opening the
service, and they are not. The inventory names each one with its reason so that stops being a trap.

### 48 endpoints with no caller

Whole feature areas of the API are addressable and reached by nothing: 26 email endpoints
(`/api/email/templates`, `/api/email/sends`, `/api/email/threads`, `/api/email/engagement`,
`/api/email/outbox/stats`, bulk-approve), 7 drip endpoints (every enrolment control — enroll, pause,
resume, cancel), 6 media, 4 content, 3 social.

The console renders campaigns, accounts, outbox, todos, social and the page editor. It does not
render templates, sends, threads or engagement. Its `DripCampaigns` page calls exactly two
endpoints — `/email/campaigns?campaign_type=drip` and `/drip/campaigns/{id}/sequences` — so it
**reads the sequence definition and nothing else**.

Every enrolment control (`enroll`, `pause`, `resume`, `cancel`, and the enrolment list itself) is
built, addressable and reached by nothing. The drip engine advances enrolments on a schedule and
**there is no way for a person to stop one** short of a direct database write.

### Write-only tables — data nobody reads

`admin_todos`, `campaign_execution_log`, `drip_enrollments`, `email_outbox`, `email_queue` and
`social_posts` are written by the service and read by nothing in it. Some of that is correct (a
queue is drained by its own worker through a different query shape than this scan detects), but
`campaign_execution_log` and `admin_todos` are worth naming: **`admin_todos` duplicates the
platform's own `tasks` ledger**, in a different database, with no bridge between them.

---

## 5. Every seam to the RFP platform

Fifteen, found rather than listed:

| direction | mechanism | file |
|---|---|---|
| CRM → main DB | reads `system_events`, `automation_rules`, `users`, `tenants` | `event_listener.py` |
| CRM → main DB | writes `system_events` | `event_listener.py`, `models/events.py`, `routers/auth.py`, `routers/page_blocks.py`, `workers/{campaign_executor,content_generator,drip_engine,email_queue}.py` |
| CRM → main DB | reads `users` for authentication | `routers/auth.py` |
| CRM → main DB | reads `tenants`, `users` for campaign recipients | `workers/campaign_executor.py` |
| **CRM → main DB** | **writes `email_send_ledger`, reads `email_suppressions`** | **`src/mailer/ledger.py`** (new this cycle) |
| CRM → frontend | HTTP callback to `/api/cms/revalidate` with `REVALIDATE_SECRET` | `routers/page_blocks.py` |
| platform → CRM | **a link-out card only** — reads `CMS_PUBLIC_URL` | `frontend/app/admin/crm/page.tsx` |

Two things stand out.

**The platform does not call the CRM's API at all.** `CMS_API_KEY` exists and is enforced
fail-closed by the CRM's middleware, and nothing on the platform side ever sends it. The only
platform-side reference to the CRM is a page that renders a link.

**The bridge is a database bridge, not a service bridge.** Everything real flows through
`system_events` on the shared main database. That is a sound choice — it is durable, replayable and
already audited — but it means the CRM's own HTTP surface is, in practice, an admin console backend
and nothing more.

### The privilege question this raises, again

`src/mailer/ledger.py` (the new mail seam) writes `email_send_ledger` in the main DB, and migration
215 gives that table **no write policy** — the NOBYPASSRLS app role is refused by design. Nothing in
the repository records which role `SHARED_DATABASE_URL` carries; the bridge has only ever written
`system_events` and `cms_content`, neither of which has RLS.

**If it is not the owner, every CRM send runs degraded** (mail goes, no idempotency reservation) and
logs a 42501 once per process naming the remedy. This is the one item in this document that blocks
something already built.

---

## 6. What a CRM here actually needs

Working backwards from what the platform already knows and cannot currently join:

**The subject.** A `contact` — a person, with an email address, resolvable to a `user` and a
`tenant` in the main DB when they become one, and standing alone when they have not yet. Every
outreach row hangs off it. Today outreach hangs off a string.

**The organisation.** A `company` distinct from a `tenant`: a prospect is a company before it is a
tenant, and after a rejected application it is a company that is not one.

**The pipeline.** Stage, owner, value, next action. The platform already has the two ends —
`applications` and `purchases` — and nothing between them.

**The activity log.** One timeline per contact: emails sent and opened, replies swept, calls, notes,
application submitted, portal purchased, proposal locked. Most of these events **already exist** in
`system_events`; what is missing is the contact to attach them to.

**Segments.** A saved query over contacts that a campaign targets. Today `campaign_executor.py`
resolves recipients by four hard-coded audience shapes — `all_active`, `tier_based`, `segment`,
`lifecycle_stage` — and **every one of them is a `SELECT … FROM tenants`**.

That is worth stating on its own, because it is the "no CRM" finding in its most concrete form:

> **The marketing engine can only mail existing customers. There is no code path by which it can
> mail a lead.**

An `applications` row — someone who filled in the 35-field form and has not been accepted — is
unreachable by any campaign, drip or otherwise. So is a `waitlist` row. So is anyone who visited
with a UTM tag and never applied. The acquisition half of "customer identification / acquisition /
management" has no mechanism at all.

**Attribution.** `page_views` already carries `utm_source`/`utm_medium`/`utm_campaign` and
`visitor_sessions` carries the referrer. Nothing carries them forward to the application, so the
question "which campaign produced this customer" is unanswerable despite both halves being recorded.

---

## 7. The decision the migration turns on

**Where does a contact live — `cms-postgres`, or the main database?**

The honest answer is that the current split is the problem, not a constraint to design around. Three
readings:

**(a) Contacts in `cms-postgres`.** Keeps the CRM self-contained. But every useful question crosses
the boundary — did this contact apply, purchase, log in — and none of those joins can be written.
It also means building tenant isolation from scratch in a database that has none.

**(b) Contacts in the main DB, CRM reads them over the existing bridge.** The joins become ordinary
SQL. Contacts inherit the isolation model that is already enforced and already audited by five
lenses. The CRM keeps the outbound engine — campaigns, templates, threads, drip, social — which is
genuinely its own domain, and gains a subject to point at.

**(c) Collapse the CRM into the platform.** Tempting given that the platform does not call its API
and the console is one internal surface. But the workers are real, the Gmail integration is real,
and the inbox sweep is genuinely a different runtime shape. Merging is a large move justified by
tidiness rather than by a problem.

**Recommendation: (b).** It is the smallest change that makes the unanswerable questions answerable,
it puts customer PII under the isolation model that has been hardened for twenty migrations, and it
leaves the outbound engine where it works. The CRM DB keeps what is genuinely its own — message
bodies, thread state, queue state, campaign state, social state — and stops trying to hold identity
it cannot join.

The concrete schema and sequencing are in **docs/CRM_MIGRATION_PLAN.md**.
