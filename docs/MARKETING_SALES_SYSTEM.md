# Marketing & Sales — the integrated CMS/CRM system

**Designed 2026-09-01**, from measurements taken against the running sandbox. Supersedes the
forward-looking half of **docs/CRM_MIGRATION_PLAN.md** (whose Phase 1 remains correct and is
Phase 2 here). The retrospective half — what was consolidated and why — is
**docs/CMS_CRM_CONSOLIDATION.md**.

---

## 0. The thing that is actually wrong

The original CMS was, in the owner's words, *a bandaid to get a public-facing site up*. It did that.
What it left behind is not a content problem — content is settled now, one store, one editor. It is
this:

> **The funnel is complete at both ends and severed in the middle.**

Measured, on the sandbox:

| stage | table | rows | carries |
|---|---|---|---|
| somebody looks | `visitor_sessions` · `page_views` | 46 · 251 | referrer, geo, device on the SESSION; **utm_source/medium/campaign** on each PAGE VIEW |
| — **the sever** — | | | |
| somebody raises a hand | `waitlist` · `applications` | 0 · 1 | email, company, `referral_source`, `source` |
| somebody becomes a customer | `tenants` | 8 | |
| somebody pays | `purchases` | 7 | |
| we contacted them | `email_send_ledger` | 8 | to, template, status, provider id |

Both ends are real and populated. The middle is not missing *data* — the browser has a
`session_id` and the analytics tables already hold everything attribution needs. It is missing
**one write**: neither `POST /api/waitlist` nor `POST /api/applications` references the session at
all (`grep -c session` → **0** in both).

So the question "which campaign produced this customer" is not hard here. It is unanswerable,
because at the single moment where an anonymous session becomes a named person, we throw the
session away.

Everything below follows from fixing that.

---

## 1. Why it stayed severed

Because content, audience and outbound were filed under three different headings in the admin, and
**nobody looks for a missing join between two things under different headings.** `Applications` sat
under *Customers*, beside Billing. `Site Content` sat under *Content*. Analytics sat under *System*.
The CRM was its own section pointing at a placeholder.

That is now one banner — **Marketing & Sales**, ordered as the funnel runs: Site Content · Outbound
Mail · Waitlist · Applications · Analytics. `Customers` keeps what happens *after* somebody buys.
The dividing line is the purchase: above it we are trying to be chosen, below it we are delivering.

The naming collision was the same one that hid the content migration for months — see
CMS_CRM_CONSOLIDATION §0. It is worth stating as a rule: **when two things must be joined, file
them together.**

---

## 2. The spine

One chain, entirely in the main database. No cross-database join anywhere in this design.

```
content_pages  →  visitor_sessions  →  contacts  →  applications  →  tenants  →  purchases
 (what we said)    (who looked,        (who they    (they raised   (they      (they paid)
                    from where)         are)         a hand)        bought)
                                            ↕
                                   email_send_ledger
                                   (what we sent them)
```

`contacts` is the only new table of substance, and it is the subject the CRM has never had.
docs/CRM_ANALYSIS §2 put it plainly: *there is no CRM in the CRM* — 24 tables and not one of them
holds a person. What exists there is a competent **outbound engine**, and it keeps that job.

### The division of labour, settled

| | system of record | written by |
|---|---|---|
| what we published | `content_pages` | the frontend, `/admin/site` |
| who looked, and from where | `visitor_sessions` · `page_views` | the site |
| **who they are** | **`contacts` (new)** | the frontend |
| they raised a hand | `waitlist` · `applications` | the public forms |
| they became a customer | `tenants` · `purchases` | the platform |
| that we contacted them | `email_send_ledger` | both halves, through the one email seam |
| **what we said** — bodies, templates, threads, queue, sequences, social | `cms-postgres` | the CRM service |

The rule: **each capability has one system of record, and the service that is not the system of
record cannot write it.** That is what Phase 1 of the consolidation enforced for content, and it is
what keeps this from drifting back apart.

---

## 3. The plan

### Phase 1 — the keystone: carry the session across the sever

**One field, at two write sites, and the whole funnel joins.**

**BUILT — migration 242.** `session_id text` on `waitlist` and `applications`, nullable, plus
`applications.tenant_id`. The capture routes and the accept route write all three.

Nullable is deliberate: somebody who phones, is met at a conference, or arrives with the referrer
stripped has no session. A NOT NULL column would push the client into inventing one, and an
invented attribution is worse than an absent one — indistinguishable from a real one, and it
quietly poisons every campaign number computed from the chain.

⚠️ The UTM fields are on **`page_views`**, not `visitor_sessions` — the session row carries
referrer, geo and device, and the campaign is per page view, because a visitor can arrive on one
campaign and return on another. Both are keyed by `session_id`, so the chain is unchanged, but a
join written against the wrong table fails with 42703. An earlier draft of this document said
otherwise; `drive-commercial-path` found it.

Proven end to end by that drive: **`hn/launch-week → the company`**, in one join, from a campaign
to a customer.

What this buys immediately, with no other work: *which page, campaign, referrer and geography
produced every hand raised*, and — via `applications → tenants` (Phase 1b) — every customer.

**Phase 1b — BUILT.** `applications.tenant_id`, written in the same statement that records the
accept decision, inside the same transaction that created the tenant, so the two can never
disagree. `ON DELETE SET NULL`, not CASCADE: if a company is ever removed, the application is still
a record that somebody applied and was accepted, and losing it would delete the evidence of the
very conversion this column exists to measure. The migration backfills only where unambiguous — an
accepted application whose contact email matches exactly one tenant admin; two candidates is left
NULL rather than guessed.

### Phase 2 — `contacts`: the subject

A person, by normalised email, independent of whether they ever become a customer.

* `contacts(id, email UNIQUE, name, company_name, first_session_id, first_seen_at, source, status)`
* backfilled from `waitlist`, `applications`, `users` and `email_send_ledger.to_email`
* `contact_id` on `waitlist` and `applications`; `contacts.tenant_id` set when they convert
* **RLS from the same migration.** Contacts are platform scope (`tenant_id IS NULL` until
  conversion) — an admin's prospect list is not a customer's data, and a contact who belongs to no
  tenant yet must not be readable from a tenant context

This is where docs/CRM_MIGRATION_PLAN.md Phase 1 lands, unchanged in substance and now with the
attribution chain already attached.

### Phase 3 — the funnel view

One page under Marketing & Sales that reads the spine end to end:

> sessions → hands raised → applications accepted → customers → revenue, **by source and campaign**,
> with drop-off stated at each step.

The rule from the Projects rollups applies here and is not negotiable: **a rate with no denominator
reads "not measured", never a confident 0%.** A conversion rate computed over three sessions is
noise, and a dashboard that prints it as `0.0%` invents a fact.

### Phase 4 — outbound to contacts

The engine exists and the transport is now Postmark. What is missing is the *audience*: a send goes
to an address, and there is no list.

* segment on `contacts` (source, campaign, status, has-applied, has-purchased)
* send through the existing `lib/email` seam — reserve, dispatch, confirm, ledger. **Never a second
  transport**
* sequences and message bodies stay in `cms-postgres`, which is what it is good at
* suppression already works and can now be lifted (shipped)

### Phase 5 — finish retiring the content half

The gate is now a command: `node frontend/scripts/check-cms-content-retirable.mjs` against
**production**. Sandbox says SAFE TO DROP. Then delete `routers/page_blocks.py`, `content.py`,
`media.py` and their console pages, and drop `cms_posts`/`cms_media`/`cms_reviews`/`cms_events`/
`cms_generations`.

### Phase 6 — rename

`services/cms/` → `services/crm/`. Last, because it touches deploy config and is the change most
likely to be undone by muscle memory while anything else is half-done.

### Sequencing

1 → 1b → 2 → 3 unlock each other in order and are the whole of the marketing capability. 4 depends
on 2. 5 and 6 are independent cleanup and can happen whenever. **Nothing in 1–4 requires touching
`cms-postgres` at all**, which is the point: the growth system is a main-database system.

---

## 4. Is the product launch ready?

**The product is. The go-to-market system is not built.** Those are different answers and the
distinction is the useful part.

### What the evidence supports

The core arc is proven end to end, this week, on a real 433-page DoW SBIR BAA nobody wrote for the
test: ingest → shred → curate → HITL gate → publish → fan-out → buy → provision → author → lock →
package → download, **27/27 assertions across database, events, filesystem and object storage**,
with the export gate reporting zero compliance violations in four formats. Around it: 59 branch
drives, five lenses on a running box, 2,538 unit tests, RLS enforced two-layer and verified, cross
tenant isolation proven at rest and in the app layer, and artifacts opened by engines that did not
write them. Post-award Projects drive through a complete lifecycle including close-out and reopen.

That is a real product and it works.

### What gives me pause, stated honestly

Every verification pass this week found capabilities that were **built and never exercised**:

* the domain audit trail wrote to a table dropped 74 migrations earlier — 45 call sites, silent
* `billableHours` never once ran; the invoicing page said there was nothing to bill
* a suppressed address could never be un-suppressed, in code or UI
* the admin had no post-award project explorer at all
* company details were displayed and could not be edited, though the route existed
* 33 event types reached customers as de-punctuated identifiers
* the public sitemap silently dropped every article published since the content migration
* the CRM console's publish button accepted edits and discarded them

None of those were in the core arc. All were in the periphery. The pattern is consistent enough to
state as a finding: **what has been driven works; what has not been driven is roughly a coin flip.**

### What that means for launching

The proposal pipeline — the thing a customer pays for — is the most heavily driven part of the
system and I would ship it. The **commercial surfaces are the least-driven part, and they are the
ones a prospect touches first.**

Concretely, today:

| a prospect can… | |
|---|---|
| reach the site, read it, apply | ✅ works |
| be accepted, provisioned, and build a real submission | ✅ proven end to end |
| be attributed to a campaign | ❌ the sever |
| be emailed as part of a list | ❌ no contacts |
| pay self-serve | ❌ descoped by decision — comp codes stand in |
| receive mail at all, in production | ⚠️ Postmark configured in code, not switched on |

**So: launch-ready to sell the way you are selling now** — high touch, comp codes, a named person
doing the outreach, the EconDev partner channel. That is a real motion and the product supports it
fully.

**Not yet ready to run a marketing funnel**, because the funnel cannot measure itself. Phase 1 is
small and changes that. Phase 2–3 make it a system.

### Before any launch, whatever the motion

* switch Postmark on: `EMAIL_DRIVER=postmark`, `POSTMARK_SERVER_TOKEN` (**Server** token — the
  Account token cannot send and 401s in a way that reads like a wrong key),
  `POSTMARK_WEBHOOK_SECRET`, and the webhook URL as
  `https://postmark:<secret>@<host>/api/webhooks/postmark` (Postmark does not sign webhooks; Basic
  auth on the URL is the mechanism). `/admin/crm` tells you when it took
* DKIM and Return-Path DNS for `rfppipeline.com` — without them, deliverability is a coin flip and
  the suppression list will fill up with bounces that were never the recipient's fault
* `DATABASE_URL_OWNER` on `govtech-frontend`
* run the drop gate against production before dropping anything

### The one thing I would not skip

**Drive the commercial path the way the proposal path was driven.** Every defect listed above was
invisible until somebody signed in as the actual actor and did the actual thing. The sign-up form,
the acceptance email, the welcome mail, the first login — none of those have a drive. On current
evidence that is where the next broken thing is.
