# End-to-End Full-Scope Run — the plan

**Scope:** everything except the CRM service (`rfp-crm` / `services/cms/`). That includes the
front-facing content plane, which is frontend-owned and therefore in.

---

## Why this shape

Two measurements set the design:

- **Of 31 logged bugs, 0 were found by a unit test.** Roughly half fell out of driving something
  live; the rest out of reading code adversarially. The suites were green the whole time every one
  of those bugs existed.
- **~72% of 243 API routes have never been called by any test or drive** (upper bound — a crude
  string match, and a route can be exercised through the UI without its path appearing anywhere).

So this run is organised as **journeys, not routes**. A journey has an actor, a goal, and a
terminal state that is either reached or not. Coverage is a by-product; the point is to find the
places where the product does not do what it says.

## The rule when a bridge is out

When a journey fails partway, **finish it if it can be finished** — a failure often hides three
more behind it. But everything downstream of the break is marked **UNPROVEN**, never passed. A bus
that fell off bridge 3 did not get the kids to school, and journeys 4–13 do not get to report green
on the strength of a workaround.

Every journey produces:
- a PASS/FAIL line per assertion, with the observed value on failure
- screenshots at each human-visible step
- DB assertions for the state that is supposed to exist afterwards
- an **audit check** — did `system_events` actually record what just happened? (an action nobody
  can see happened is its own defect class, and this product's contract says every actor,
  automation and agent action posts)

---

## The journeys

### J1 · Cold start — does the bus leave the depot
Bring the whole system up from nothing: migration chain 001→197, seeds, four processes
(Postgres · emulator · pipeline worker · frontend). Then every seeded role logs in and lands where
it should.
**Terminal state:** 7 roles × successful login × correct landing surface.
**What this alone tests:** migration integrity, seed correctness, bootstrap, auth, role routing.

### J1b · A new customer is created through the product
Public application → `rfp_admin` sees it in `/admin/applications` → approves → tenant provisioned
with its starter library copied inward → invite → the new `tenant_admin` accepts and logs in.
**Terminal state:** a tenant that exists only because the product made it. Covers the
customer-creation routes nothing has ever called.

### J2 · An opportunity is born — the discovery spine, admin side
`rfp_admin`: register a source → scout it → a finding lands in the review queue → classified
NEW → released as an intake → curated (compliance matrix extracted from a real solicitation PDF,
with per-field provenance) → volumes + section molds authored → build-out readiness bar goes green
→ approved → pushed.
**Terminal state:** an `opportunity_bridge` row, and a `tenant_opportunity_cards` row for every
active tenant, each auto-scored against that tenant's buckets.
**Also proves:** ingest provenance (read-from-source vs unverified default vs deferred), the
`SOURCE_TEXT_NOT_READY` refusal, the scout classifier's UPDATE path against a tracked opp.

### J3 · A customer finds it — the discovery spine, tenant side
`tenant_admin`: sees the new card ranked; authors a bucket; hits the cap; delegates authoring to a
designee; the list reshuffles; pins an opp for updates; receives the notification; a
hot-and-closing-soon card fires the start-nudge, and a second sweep does not re-fire it.
**Terminal state:** the right card at the top of the right bucket lens, with an in-app + email
record and a watermark that says "new since you looked".

### J4 · Buying — comp code to launched portal
`tenant_admin` enters the comp code → `proposal_portals` lands `curation_pending` with a live 72h
SLA → `rfp_admin` opens the provisioning cockpit → readiness bar → **Complete & Release**:
`completeBuildOut` broadcasts `provisionReady` to every tenant's mirror card, then
`provisionAndReleasePortal` provisions this buyer's private portal and kicks off their workflow.
**Terminal state:** portal `launched`, compliance matrix + molds instantiated, the required Workflow
Setup ToDo raised. **Also proves:** the shared-master vs private-portal segregation, and that the
provision tail is `runInTenant`-scoped so a cross-tenant admin caller does not trip RLS.

### J5 · Setting up the workflow — the tenant's own plan
`tenant_admin` opens Workflow Setup → reviews the history-recommended plan (own history only) →
edits stage dates, gate closers, per-ToDo owners and nudges → rebaselines ±N days → **Accept &
Start**. Then a day-two edit re-projects onto the live rows.
**Terminal state:** `process_instances` + `tasks` matching the accepted plan; an edit resets
`nudges_sent` so the sweep re-fires against the new due date.

### J6 · Filling the library
`tenant_user` uploads a past proposal PDF and a capability deck → atomize → figures harvested from
the PDF → tags applied → librarian review → approve. A solicitation package is also atomized, and
its agency boilerplate is stamped `corpus_verbatim` and drops out of draft retrieval while staying
insertable by hand.
**Terminal state:** atoms + figures + embeddings present, correctly scoped, correctly fenced.

### J7 · Writing the proposal
Draft all sections (the agent cohort) → edit in the canvas across **all three surfaces**: a flowing
document, a slide deck, a cost workbook → insert a harvested figure with a caption → open a comment
thread and resolve it → run AI review (text reviewers + the visual page reviewer) → land the
proposed revisions through read-on-review → compliance check → autosave, 409 on a concurrent edit,
version restore → lock every section.
**Terminal state:** all sections locked, submission readiness green, the cost volume computed (not
typed) and rendered in the form the solicitation requires.

### J8 · Shipping it — does the kid actually get off the bus
Package every volume × every format: `json` · `docx` · `pdf` · `zip`. Render each, count the pages
against the cap, confirm the figures survived, confirm the furniture is right.
**Terminal state:** files on disk, 0 compliance violations at the export gate, page counts within
caps **measured on the rendered file**.

### J9 · The other people at the stop
`partner_user` invited to one stage — can comment where scoped, cannot reach anything else.
`rfp_admin` descends into a tenant as shadow admin and exits. `partner_admin` runs a stable of
companies from the owner-scoped console, descends into one, requests an existing company via the
manager handshake.
**Terminal state:** each actor sees exactly their scope and nothing beyond it, with the descent
audited.

### J10 · After the bell — lifecycle
An amendment is detected → confirmed → fanned out to every affected tenant → acknowledged. An
outcome is recorded: **won** → contract entity + kickoff workflow; **lost** → the material feeds
reuse into the next build. Then archive a portal (cascading its build workflows), an atom, and a
tenant (licence slumber) — and restore each.
**Terminal state:** correct transitions, no orphans, nothing hard-deleted.

### J11 · The front of house
Content generated → queued for review → an admin reads and publishes it in the Content Studio →
live on the public marketing site. Every public page and every published guide renders.
**Terminal state:** draft → active → 200 on the public URL, and nothing public that a human did not
publish.

### J12 · The control room
The Workflow Map renders all templates as DAGs; a live instance overlays its step status; the
monitor sorts/filters. Agent workforce roster + per-tenant usage. Event/audit completeness per
journey. Storage. The three Command Centers (tenant · admin · partner) with their unread
watermarks. The failed-workflow alert row.
**Terminal state:** an operator can see what happened in J1–J11 without being told.

### J13 · The adversarial pass — drive it wrong on purpose
This is where the bugs are. Every surface above, re-run hostile:
- **wrong role** for every gated action (the button that renders to a role the API refuses)
- **foreign ids** — another tenant's proposal, atom, portal, card, section
- **no tenant context** — RLS probes as `govtech_app` with nothing set
- **malformed input** — missing fields, wrong types, oversized payloads, NUL bytes, lone surrogates
- **injection strings** in every field an agent will later read
- **concurrency** — two editors on one section, two gate-closes on one stage
- **missing prerequisites** — package an unlocked proposal, release an un-built master, publish
  content with no draft
- **expired/absent session** on every route

### J14 · Synthesis
Bug log entries with proof and class for everything found; fixes; re-run the affected journeys;
honest report of what is proven, what is fixed, and what is still open.

---

## Sequencing

J1 → J1b → J2 → J3 → J4 → J5 → J6 → J7 → J8 are a **chain**: each consumes the previous one's
terminal state. J9–J12 branch off the chain once a portal exists. J13 runs against everything. J14
closes.

Parallelism is limited by the chain, not by effort — this is one bus on one road, which is the
point.

---

## What this run will NOT prove

Stated up front so it is not discovered as a surprise at the end:

- **AI output quality.** No real `ANTHROPIC_API_KEY` in this environment. The emulator mirrors the
  production wiring exactly, so every gated flow *runs* — but the prose it composes and the visual
  reviewer's eyesight are unmeasured. (docs/CLOSEOUT_2026-08-19.md §4.)
- **Anything CRM.** Out of scope by instruction.
- **Stripe self-serve checkout.** Descoped; the comp code stands in.
- **Production infrastructure** — Railway, R2, real email delivery, real domains.

---

## Decisions (confirmed before the run)

**Starting line — cold rebuild + a new tenant through the product.**
Drop the schema, run all 197 migrations, restore the seeded demo tenants, **and** create one
brand-new customer through the real product path: application → rfp_admin approval → tenant →
invite → first login. That covers the customer-creation routes nothing has ever called, without
spending the run re-typing demo data that migrations already carry.

**Fix policy — fix small and proven, batch the structural.**
A bug with a small, proven cause is fixed and its journey re-driven immediately. A bug with real
blast radius is logged with its class and deferred to J14. A test run must not smuggle a semantics
change into the thing it is testing (B30 is the standing example).

**Check-ins — at phase boundaries.**
Four reports: after the J1–J8 chain, after J9–J12, after the adversarial pass, and the close-out.
Anything catastrophic surfaces immediately regardless of where the boundary falls.

---

## Environment durability (learned the hard way, twice, on day one)

The container restarted mid-planning and took `/tmp` back to an older snapshot **and** rolled the
local git checkout back several hours. Nothing was lost because the work had been pushed — but two
rules follow and they apply for the rest of this run:

1. **Push after every commit.** The remote is the only durable copy. A local commit is not saved.
2. **Nothing the run depends on lives in `/tmp`.** The sandbox env file and the local storage root
   both did, and both are re-created by `scripts/sandbox-env.sh` at a durable path now. (This is
   the same `/tmp` ephemerality that broke the crypto tests earlier — third strike.)

The task tracker also rolled back and cannot be trusted across a restart; `docs/` + git are the
durable record, and the tracker is a convenience on top of them.
