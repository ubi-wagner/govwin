# Templates — launch walkthrough (#151)

The starter templates ("molds") are the structured canvas skeletons that pre-populate a proposal
artifact or a standalone document with the right headings, tables, page/slide budgets, and
`{merge_field}` placeholders. Two complementary systems, both wired and reachable:

## 1. Code catalog — `lib/templates/` (18 molds)

The launch-facing starter catalog (`TEMPLATE_CATALOG` in `lib/templates/index.ts`), grouped by
category, each with a `title` + `format` (document / deck / spreadsheet):

| Category | Molds |
|---|---|
| **DoD/DoW** | SBIR Phase I — Technical · SBIR Phase I — Cost · SBIR Phase II — Technical · STTR Phase I — Technical · STTR Phase II — Technical · Direct-to-Phase-II — Technical · CSO Phase I — Briefing (deck) |
| **NSF** | Project Pitch · SBIR/STTR Phase I — Project Description |
| **DOE** | SBIR Phase I — Technical · STTR Phase I — Technical |
| **Marketing** | One-Pager · Capability Statement (Two-Pager) · Whitepaper · Sales Deck |
| **Commercialization** | Commercialization Plan |
| **Investment** | One-Pager · Pitch Deck |

- **Reached from:** the tenant **New Document** chooser (`/portal/[slug]/documents/new` — all 18 surface,
  verified) and proposal creation (`/api/portal/[slug]/proposals/create`).
- **Auto-selected at provision:** `resolveTemplateKey(programType, itemType, itemName)` maps a solicitation's
  program + volume to the right narrative/cost/deck mold — with a **guard** so cover sheets / certs / cost
  sheets / CCR / SF-424 never inherit a narrative template (the "15-page template in a 1-page cover sheet"
  bug class).
- **Interpolation:** `interpolateTemplate` fills `{company_name}`, `{topic_number}`, `{pi_name}`, etc. from
  the tenant profile + opportunity at create time.

![tenant New Document chooser — 18 molds](assets/tmpl/02-tenant-newdoc.png)

## 2. DB templates — `document_templates` (admin-managed)

The **admin Templates** surface (`/admin/templates`) lists the `document_templates` rows (system molds +
captured proposal/collateral canvases), filterable by Type / Agency / Program, each with a live **Preview**.
These are the templates a curated solicitation's items reference by `template_id` at provisioning, and the
"Save as template" target from a proposal section (Studio publish-to-library, #100).

![admin Templates — catalog + preview](assets/tmpl/01-admin-templates.png)

## Verdict
All 18 code molds surface in the tenant chooser; the admin catalog renders + previews the DB templates;
provisioning auto-resolves the right mold per volume with the form-item guard; merge fields interpolate.
Backbone green (tsc 0 · vitest 1038). The molds are launch-ready.
