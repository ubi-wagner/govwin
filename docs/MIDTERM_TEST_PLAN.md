# Midterm drive — test plan

**Principle: the data IS the test.** Nothing is seeded that a user could create. Every tenant,
user, opportunity, card, bucket, atom, portal, section, review and export in this run is composed
by driving a real UI as a named actor, and the screenshot of that UI is the evidence. A row that
appears without a screenshot behind it did not get tested — it got fabricated.

That rules out the shortcut I took on the first attempt: the earlier baseline carried 7 tenants,
43 opportunities and 540 atoms *before any driving*, which meant most of what the later phases
"verified" was migration seed data wearing the costume of an outcome.

---

## 0 · Reset — what a minimal start actually means

Rebuild the schema from migration 001, then strip everything a user would compose. Measured, not
assumed:

| kept — structural platform config | why |
|---|---|
| schema at head (202 migrations) | the product |
| `automation_rules` (17) | platform event→action config, not customer data |
| `document_templates` (9) | the master template catalog admins fan forward |
| `source_profiles` (6) | scout targets |
| `content_pages` (58) | front-facing marketing site |
| `rfp-pipeline` house tenant + its **303 system_starter atoms** | a copy-forward *source shelf* tenants copy from — platform content, not tenant state (CLAUDE.md) |
| 1 `master_admin` (`eric@rfppipeline.com`) | you cannot drive a UI without a way in |

| removed — must be composed by driving | count today |
|---|---|
| demo tenants (`foundation`, `lighthouse`, `immobileyes`, `ubihere`, `acme-navy-systems`, `entrepreneurs-center`, `youngstown-business-incubator`) | 7 |
| their users | 19 |
| opportunities / curated solicitations / opportunity cards | 43 / 29 / 74 |
| proposals | 9 |
| tenant-owned library atoms | 237 |
| tasks | 5 |

**External inputs are not seed data.** Four solicitation PDFs and six company documents are files a
real user brings to the product — they are uploaded through the UI, not inserted. They are authored
so each states different rules with different values, which is what makes a passing extraction mean
"it read *this* document" rather than "the default happened to match".

---

## Phases

Each phase names the **actor**, the **UI path walked**, what gets **composed** (the data that did
not exist before), what is **asserted**, and what is **read on screen**.

### MT-1 · Admin composes the opportunity supply
- **Actor** master_admin · **UI** `/admin/rfp-curation/upload` → workspace → Ingest Assist → approve → push
- **Composes** 4 curated solicitations, their opportunities, the compliance matrix per solicitation
- **Asserts** each stated rule is sourced `pattern_match` with a page-anchored citation; the DoW
  page limit — which the document *defers* — must land as a deferral with no number; an unstated
  character limit stays absent
- **On screen** the matrix badges: "Read from source" vs the red "Default — unverified", and the
  "Set elsewhere" deferral

### MT-2 · Companies onboard themselves
- **Actor** anonymous visitor, then master_admin · **UI** `/apply` → `/admin/applications`
- **Composes** 3 applications → 3 tenants + 3 tenant_admin users (this is what creates a tenant)
- **Asserts** the Accept gate really requires review notes; the applicant is **named** in the admin's
  triage ToDo (B49 regression, checked where it was found); the temp password is issued
- **On screen** the public form, the admin queue, the named ToDos

### MT-3 · Each tenant builds its own library
- **Actor** each new tenant_admin (first login through the forced password reset)
- **UI** `/portal/<slug>/atoms` — upload → deconstruct → select grain → atomize; `/buckets` — author
  scoring lenses
- **Composes** per-tenant atoms from that company's own documents, spotlight buckets, bucket scores
- **Asserts** the starter shelf copied inward on tenant creation; atoms are tenant-scoped at rest,
  under RLS, and in the UI — a cross-tenant read returns nothing
- **On screen** three libraries whose contents are visibly about three different companies

### MT-4 · Portals + divergent completion paths
- **Composes** 3+ proposal portals from comp-code purchase → cockpit release → provision
- **Path A** full-auto: Studio Draft → Refine → Compliance, each landing in a HITL gate the actor
  comments on and regenerates, or approves
- **Path B** manual: the tenant writes sections by hand, uses agent *assist* only, and a
  `partner_user` collaborator contributes under a stage-scoped grant
- **Path C** mixed, different actor
- **Asserts** advancement is task-completion-driven; agent output lands as *proposed* revisions a
  human accepts, never auto-written
- **On screen** the three gates, the collaborator's scoped view, the readiness panel

### MT-5 · Descend and ascend
- **Actors** partner_admin over its stable; master_admin shadow-descending into a tenant
- **Asserts** the Exit-to-console banner; scope never widens on descent; the descent is audited;
  a partner_admin still has no `/admin` reach
- **On screen** the banner, the console, the audit trail

### MT-6 · The unified canvas
- **UI** doc · pdf · ppt · xls surfaces — overlay, act-on-selection, assist panel, version restore,
  accept-AI, autosave/recover, the non-destructive 409, images
- **On screen** each surface and each interaction, read rather than assumed

### MT-7 · Color teams and reviews
- **Composes** color-team, compliance and packaging reviews landing through their HITL gates
- **Asserts** advisory-only: a review never advances a stage or locks a section by itself

### MT-8 · Complete every volume, export, and CHECK the documents
- **Composes** every volume authored to completion; exports in json · docx · pdf · zip
- **Asserts** — and this is the part that is usually skipped — the artifacts are **opened and
  inspected**: section order by integer `sort_index`, numbering, figures present, the cost form
  matching the agency (burden waterfall vs SF-424A vs Ohio state budget), page budgets honoured.
  Byte counts prove a file exists, not that it is right.

### MT-9 · Document and code-check
- Guides rebuilt from screenshots actually read; every defect logged with proof; committed and pushed

---

## Rules for this run

1. **No fabricated success.** A check that cannot fail is not a check. Every fix gets
   mutation-tested — revert it, watch the test go red.
2. **Capture the exit code of the thing being tested**, never a pipeline's (`| grep` returns grep's
   status; that already burned me once — bug log B57).
3. **Read the screenshot.** A DB query saying "healthy" while the screen says `HEALTHY 0` is how the
   dead scout-health tile survived this long.
4. **Report the count that is true**, including partials — "3 of 4 verified, 4th timed out" beats
   "verified".
5. **Distinguish my own interference from a product defect.** The Ohio timeout in the first attempt
   was me restarting the server mid-run, and is not a finding.
