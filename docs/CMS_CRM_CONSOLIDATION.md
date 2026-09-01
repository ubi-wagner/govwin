# CMS vs CRM — what is actually where, and how they come together

**Swept 2026-08-31**, against the running sandbox (`govtech_intel` at migration 241, `cms_postgres`
stood up locally from `services/cms/db/*.sql`). Companions: **docs/CRM_ANALYSIS.md** (the CRM
service sweep, 2026-08-26), **docs/CRM_INVENTORY.md** (generated), **docs/CRM_MIGRATION_PLAN.md**
(the contacts plan). This document answers the question those three left open: *there are two
content systems and one customer system wearing each other's names — which survives, and what does
retiring the other actually take?*

⚠️ **Every row count here is the SANDBOX.** The production `cms-postgres` on Railway may hold data
this box does not. Nothing in Phase 3 or 4 below should be executed until the same queries have been
run against production. The *code* findings (who writes what, who reads what) are true everywhere,
because they are properties of the source.

---

## 0. The naming is the first problem

| what it is called | what it actually is |
|---|---|
| `services/cms/` — the directory | a service whose Railway name is **`rfp-crm`** |
| `cms-postgres` — its database | the CRM's database: email, campaigns, drip, social |
| `cms_content` — a table in the **main** DB | the **superseded** front-facing content store |
| `content_pages` — a table in the main DB | the **canonical** front-facing content store |
| `/admin/site` — the frontend | the live CMS |
| `/admin/crm` — the frontend | a "Coming soon" placeholder linking out to the CRM console |

So "CMS" names three different things and "CRM" names two. That is not cosmetic: it is why a
half-finished content migration could sit in plain sight for months — the residue is *named* like
the live system.

---

## 1. Content (the CMS half): one system won, and the loser is still wired in

Front-facing content moved to the frontend's `content_pages` store in the main database. That
decision is recorded in CLAUDE.md and it is real — but three things never followed it.

### 1a. `cms_content` is fully superseded — measured, not assumed

130 rows in the sandbox: 14 documents and 116 page-blocks.

* **All 14 documents** (3 blog_post, 2 guide, 8 resource, 1 team_member) have a matching
  `content_pages` row, by `slug` → `page_key` and type. Zero uncovered.
* **All 116 page-blocks** belong to 12 page keys. Nine of those pages have an active
  `content_pages` row whose block array is equal or larger (`homepage` 18/18, `the-expert` 28/16,
  `pricing` 17/8, `value` 22/7 …). The other three — `engine`, `security`, `get-started` — have no
  `content_pages` row at all, and **their routes are redirects**
  (`/engine`→`/value`, `/security`→`/infosec`, `/get-started`→`/pricing`) that never read content.

So the legacy fallback in `getPageBlocks` cannot fire for any live page: the pages that would use it
don't call it, and the pages that call it don't need it.

### 1b. The CRM service is a SECOND WRITER to the main database's content — and its publish is a no-op

`services/cms/src/routers/page_blocks.py` writes `cms_content` **in the main database**, over
`SHARED_DATABASE_URL` (`INSERT … ON CONFLICT (slug) DO UPDATE`, and a paired `DELETE`). The
frontend's Site Content editor writes `content_pages`. Two services, two tables, one product's
marketing site.

And because the frontend reads `content_pages` first, **a page block published from the CRM console
never appears.** Proven rather than argued: a block written exactly the way that router writes it,
tagged for `homepage`, then the live homepage fetched — 65,987 bytes, HTTP 200, and the marker
absent. The console presents a working editor whose output cannot reach the site.

That is worse than a dead feature. A dead feature is discovered the first time somebody tries it; this
one accepts the edit, reports success, and shows nothing.

### 1c. The public sitemap was built from the superseded store — FIXED

`app/sitemap.ts` read `cms_content` only. Every document created in `/admin/site` since the move was
therefore absent from the sitemap: **4 live documents** (3 guides, 1 resource) were reachable and
unlisted. Nothing looks broken, because a sitemap that omits a page renders exactly like one that
does not.

Repointed at `content_pages`. Served entries 29 → 33; dynamic document entries 13 → 17, which is
exactly the active document set. **Verified by counting what the server returns**, not by the build
passing — the first attempt selected `updated_at`, a column `content_pages` does not have, and the
existing `catch` turned that 42703 into "static pages only": a sitemap that looks entirely normal
and silently drops every article. The same failure shape the fix was written to remove.

### 1d. What was wired to the legacy store — all of it, now repointed or deleted

This was the survey that Phase 2 worked from. Every row is resolved; kept as the record of what had
to move, because "the content migration is done" had been believed once already.

| site | was | now |
|---|---|---|
| `lib/cms.ts` · `getPublishedContent` | `cms_content` fallback, 5 callers | `content_pages` only |
| `lib/cms.ts` · `getPublishedContentByTypes` | `cms_content` fallback, 1 caller | `content_pages` only |
| `lib/cms.ts` · `getContentBySlug` | `cms_content` fallback, 1 caller | `content_pages` only |
| `lib/cms.ts` · `getPageBlocksLegacy` | unreachable (§1a) | deleted |
| `lib/cms.ts` · `getContentBlocks`, `getContentBySlugAdmin`, `getContentByIdAdmin` | 0 callers | deleted |
| `app/api/content/[slug]/route.ts` | its own query, public, unsurfaced | via `getContentBySlug` |
| `app/sitemap.ts` | `cms_content` | `content_pages` — §1c |
| `app/admin/system-state` · Content Pipeline | `cms_content` page-blocks | `content_pages` |

SQL references to `cms_content` in `frontend/` → **0**. In `services/cms/src` → **0**.

---

## 2. Customer (the CRM half): the engine is real, the subject is missing

Unchanged from docs/CRM_ANALYSIS.md §2 and confirmed here: **there is no CRM in the CRM.** No
contacts, no companies, no deals — 24 tables, and the ones that would hold a customer do not exist.
What does exist is a competent *outbound engine*: six workers (campaign executor, drip engine, email
queue, sweep, social poster, template drafter), Gmail send, threads, engagement.

Sandbox row counts: `cms_config` 25, `_cms_migrations` 12, `email_templates` 7, `sender_identities`
3, `deploy_baseline` 2, `_crm_metadata` 1. **Every other table is empty** — no posts, sends,
campaigns, enrolments or social rows.

Two structural facts decide the shape of the merge:

1. **The send record already moved.** `email_send_ledger` (migration 215) lives in the main DB and
   both halves write it — the frontend directly, the CRM through `SHARED_DATABASE_URL`. So "who did
   we contact" is already a main-DB question.
2. **The only frontend→CRM coupling is one hyperlink.** `/admin/crm` renders a placeholder and links
   out when `CMS_PUBLIC_URL` is set. There is no API call, and the pipeline has none either.

The CRM is therefore separable in a way the content half is not: its *engine* can stay where it is,
and its *subject* belongs beside the ledger.

**The subject now exists — migration 243, `contacts`, in the main database beside the ledger.** A
person by normalised email, whether or not they ever convert, written by one function
(`lib/contacts.ts`) called by both capture routes, and surfaced at `/admin/contacts`. It carries
deliberately **no `tenant_id` and no `status`**: conversion is derived through
`applications.contact_id → applications.tenant_id`, because a copy of a fact another table owns is
the copy that goes stale — and because a `tenant_id` here would expose every un-converted prospect
to every tenant through the `OR tenant_id IS NULL` arm of `tenant_isolation_select`. Companies and
deals are not built: a company is `tenants` once they buy and `contacts.company_name` before that,
and there is no deal stage to model while the sale is one comp code. Canonical:
**docs/MARKETING_SALES_SYSTEM.md**, which supersedes the forward half of
docs/CRM_MIGRATION_PLAN.md.

---

## 3. The consolidation

**The principle:** each capability gets ONE system of record, and the service that is not the system
of record loses the ability to write it. Content is the frontend's. Customers are the main DB's.
Outbound *mechanics* — bodies, templates, queues, threads, campaign definitions — stay in the CRM.

| | system of record | who may write it |
|---|---|---|
| front-facing content | `content_pages` (main DB) | the frontend, via `/admin/site` |
| who we contacted | `email_send_ledger` (main DB) | both, through the one email seam |
| who they ARE — contacts, companies, deals | main DB (to build) | the frontend |
| what we said — bodies, templates, threads, queue, campaigns, social | `cms-postgres` | the CRM service |

### Phase 1 — stop the second writer — **DONE**

The CRM service can no longer write front-facing content in the main database. There were **three**
writers, not one — the third only turned up by grepping the service for SQL rather than reading its
routers:

| writer | was | now |
|---|---|---|
| `routers/page_blocks.py` · `_bridge_publish` | upserted `cms_content` on publish/approve | **410**, naming `/admin/site` and `content_pages` |
| `routers/page_blocks.py` · `DELETE /{block_id}` | deleted the published copy | touches `cms_posts` only |
| `event_listener.py` · `_action_publish_content` / `_action_unpublish_content` | **automation rules** writing `cms_content` unattended | return without writing, at WARNING |

The automation pair is the one that mattered most. A console at least shows a person a count they
could eventually notice was wrong; a rule runs unattended, reports success in its own log, and the
first sign of trouble is somebody asking why a published article is not on the site.

`grep -E "(INSERT INTO|DELETE FROM|UPDATE) cms_content" services/cms/src` → **0**.

Three tests asserted the old behaviour and failed, which is the suite doing its job. Rewritten to
the new contract — the bridge refuses AND touches neither pool (a refusal that had already flipped
`cms_posts` would leave the two stores disagreeing about what is published), the endpoint answers
410 rather than a reassuring `published: 0`, and delete does not reach the main database.
**164 passed, 3 skipped.**

Still to do, and deliberately not done in this pass: deleting `routers/page_blocks.py`,
`routers/content.py`, `routers/media.py` and their console pages outright. The Vite console cannot
be exercised from the platform sandbox, and deleting a UI you cannot run is how you discover later
that it was load-bearing. The refusal is reversible; a deletion verified by nothing is not.

### Phase 2 — finish the content read migration — **DONE**

* `getPublishedContent`, `getPublishedContentByTypes` and `getContentBySlug` now read
  `content_pages` only; their fallbacks were unreachable (§1a) and are gone
* `getContentBlocks`, `getContentBySlugAdmin`, `getContentByIdAdmin`, `getPageBlocksLegacy` deleted
  — zero callers between them
* `app/api/content/[slug]` (public, unsurfaced) repointed through `getContentBySlug` rather than
  keeping its own second query. It had been serving the pre-migration set, so anything published
  since the move answered 404 there
* `app/sitemap.ts` repointed — §1c
* `/admin/system-state` · Content Pipeline repointed. It had been reporting on the retired store, so
  the operator's content panel showed a fixed 116 published blocks and nothing pending whatever
  anybody did in Site Content. Its headline tiles then read 0 against a correct list beneath them,
  because they still looked for the legacy status names (`published`/`pending`) and `content_pages`
  says active · draft · archived — the same summary-disagrees-with-its-own-table defect found on
  that page's workflow tile. Tiles now read **Live pages 14 · Drafts 1 · Archived 14**, matching the
  database exactly

**Independently confirmed:** `reconcile-capability` — which builds its own picture from the tree and
the live database — now lists `cms_content` under *"tables holding rows that NO code reads"*, 130
rows. Nothing in the app or the pipeline reads it, and nothing writes it.

### Phase 3 — drop `cms_content` (blocked on a production check)

The repo's own rule: *drop ONLY when superseded-with-a-successor AND zero live code refs*, and
*"empty in the sandbox" is not a drop signal*. §1a establishes the successor and Phase 2 removes the
refs. What remains is to run §1a's two coverage queries **against production** and confirm the same
answer there. Archive the 116 orphaned page-blocks with the migration rather than deleting them
outright — they are the last copy of three retired pages' copy.

### Phase 3b — the UI comes into the platform admin — **DONE**

Postmark changed what was possible here, so this moved ahead of Phase 4.

`/admin/crm` was a placeholder that linked out to a separately-deployed console. Meanwhile the email
spine — `email_send_ledger`, `email_suppressions`, the Postmark webhook — was live, wrote on every
send, and **had no UI anywhere**: nothing in the repository read either table. Every question an
operator actually asks about mail ("did it go", "why is this customer getting nothing") was
answerable only with SQL.

Both tables are in the MAIN database — the ledger moved here with migration 215. With Postmark
carrying the mail there is no part of an outbound console that needs `cms-postgres`, so the UI does
not have to live in a second application to be complete. That is the consolidation: not a link out,
a page.

It shows the transport actually in force (the most confusing outage is mail "sending" through a
driver nobody realised was selected), 30-day sent/failed, sends reserved but never confirmed
— reserving BEFORE dispatch is what makes a crash mid-send visible — whether the provider has ever
called back, the last 100 sends, and the blocked addresses.

**And the lift, which did not exist.** `suppress()` shipped with nothing that undid it, in code or
in any UI. One hard bounce or one spam complaint stopped a person's mail permanently: a mailbox
full for an afternoon, an address mistyped once and corrected, a colleague hitting "spam" on a
notification. The customer sees no error — they simply stop receiving things. Suppression is
correct (mailing a dead address damages the sending domain for every other customer), but a correct
guard with no release is a trap, and the person it traps cannot see it happening. There is now
`lift()`, a `DELETE` route, a confirm that shows the reason before re-opening the address, and an
audited `system:email.suppression_lifted` event.

Two guards caught mistakes in this work, both worth recording:
* `audit-env-inventory` reported two env reads no document names — because the status tile invented
  `POSTMARK_WEBHOOK_USER`/`_PASSWORD`. The real variable is `POSTMARK_WEBHOOK_SECRET`, so the tile
  would have read "not configured" on a correctly configured system: a confidently wrong
  operational signal on the page built to show operational truth.
* `email-transport-boundary` refused the console for querying the ledger directly. That rule is not
  bureaucratic — RLS denies those tables to the application role, so a query written outside
  `lib/email` compiles, ships, and fails at run time in front of whoever opened the page. The
  queries moved behind the seam as `recentSends`/`sendTotals`. The test itself then needed fixing
  for the repo's own reason: it scanned raw source, so a header comment *naming* the tables failed
  the check. It strips comments now, and was re-verified against a real query.

### Phase 4 — the CRM's own consolidation — **the subject half is DONE**

**Done:** `contacts` in the main DB beside the ledger (mig 243), with the attribution chain already
attached (mig 242) and read end to end at `/admin/funnel`. Companies and deals were dropped from
scope rather than deferred — see §2 for why neither has anything to model yet.

**Still open:** RLS on the seven tenant-bearing tables in `cms-postgres` that have none; retire the
48 endpoints with no caller or give them a console; and the *sending* half — an audience exists and
nothing composes a campaign against it. Bodies, templates and sequences stay in `cms-postgres`,
which is what it is good at; every send goes through the one `lib/email` seam.

### Phase 5 — rename, so the tree stops lying

`services/cms/` → `services/crm/`. The service is `rfp-crm`; the directory has been telling every
reader it is a CMS since the content moved out. Do this last: it touches deploy config, and it is
the change most likely to be reverted by muscle memory if done while the content half is still
half-in.

### Sequencing

Phase 1 and 2 are independent of each other and both are safe now — 1 removes a writer whose output
cannot appear, 2 removes readers of a table nothing needs. Phase 3 needs both plus a production
check. Phase 4 is orthogonal and can proceed in parallel. Phase 5 is last.

---

## 4. What was done in this pass

**Phases 1 and 2 are complete.** `cms_content` now has no reader and no writer anywhere in either
service — the precondition for Phase 3.

User-visible fixes that fell out of it:

* **4 published documents entered the public sitemap.** 3 guides and 1 resource were live,
  reachable and unlisted. 29 → 33 served entries, 13 → 17 dynamic. Verified by counting what the
  server returns — the first attempt selected `updated_at`, a column `content_pages` does not have,
  and the existing `catch` turned that into "static pages only": a sitemap that looks entirely
  normal and silently drops every article. Exactly the shape being fixed.
* **The public content API stopped serving the pre-migration set.**
* **The admin Content Pipeline panel moves again**, and its tiles agree with its own table.
* **The CRM console tells the truth**: publishing content there now says where content is authored
  instead of accepting the edit and discarding it.

Verification: `tsc` 0 · `vitest` 240 files / 2,538 tests · CRM `pytest` 164 passed / 3 skipped ·
`next build` clean · `verify-surfaces` 83/83 · the oversight drive green for both actors · every
marketing page rendering with content.

**Not done, and gated:** Phase 3 (dropping `cms_content`) needs §1a's coverage queries run against
**production**, not this sandbox. Phase 5 (renaming `services/cms/` → `services/crm/`) is last by
design.
