# RFP Pipeline — Sales / Platform Overview

The prospect-facing **"RFP Pipeline — Platform Overview & Capabilities"** sales document.
Fully branded from the product's own public pages — the real `RFP Pipeline` wordmark
(`frontend/components/marketing/wordmark.tsx`), the `tailwind.config` palette (coral `#e85d4a`,
ink `#1a1816`, green `#2d8b4e`, gold `#d4a843`, cream), Inter/Georgia type, and the real
`MarketingIcon` line-art vectors (`frontend/components/marketing/icons.tsx`). Every capability,
stat, and price is grounded in shipping functionality — no vaporware.

## Deliverables
| File | What it is |
|---|---|
| `RFP-Pipeline-Platform-Overview.pdf` | The 10-page designed brochure (hand-out). Rendered from `sales.html` via Chromium. |
| `RFP-Pipeline-Platform-Overview.docx` | The editable, branded Word version (embeds the rendered logo + section icons). |
| `sales.html` | Source of truth for the 10-page PDF — a self-contained, print-styled page (US Letter, inline SVG icon sprite). |
| `RFP-Pipeline-Cut-Sheet.pdf` | The **2-page print cut sheet** (hook + economics on p1; capabilities-at-a-glance + trust + pricing on p2). Rendered from `cutsheet.html`. |
| `RFP-Pipeline-Cut-Sheet.docx` | Editable, branded Word version of the cut sheet. |
| `cutsheet.html` | Source of truth for the 2-page cut sheet PDF. |

## System document templates (in-product)
`db/migrations/150_*` + `151_*` seed **six SYSTEM** `document_templates` (`is_system=true`,
`tenant_id=NULL`). System templates are **shared**, so a single seed surfaces them in **both** the
RFP-admin platform tenant AND every tenant-admin's **New document → Start from a template** chooser
(the portal `/templates` GET returns tenant + `is_system` rows). `starterFromTemplate` copies the
skeleton into a fresh editable canvas on use.

| Template | Type | Purpose |
|---|---|---|
| **Capability Statement** | custom | Gov one-pager: core competencies, differentiators, past performance, corporate data, contact. |
| **Executive Summary** | abstract | Proposal exec-summary skeleton. |
| **Pitch Deck** | slide_deck | 7-slide 16:9 capability/pitch deck skeleton. |
| **Past Performance** | past_performance | Contract-facts + scope/approach/outcomes/relevance write-up. |
| **Platform Overview & Capabilities** | custom | The RFP Pipeline overview (reference/example canvas). |
| **Platform Cut Sheet (2-page)** | custom | The RFP Pipeline cut sheet (reference/example canvas). |

Verified end-to-end: all six list with `isSystem:true` for **both** a tenant (Lighthouse) and the
RFP-admin tenant, and create-from-template (incl. the slide deck) yields a real editable document.
Skeleton sources: `_src/gen-templates.mjs` (mig 150) + `_src/gen-templates2.mjs` (mig 151).

> **How new tenants get starter content (as-built).** On creation a tenant gets its **buckets**
> (`seedDefaultBuckets`) and **opportunity cards** (`backfillTenant` from the master bridge) copied in,
> and a **starter-set OFFER** (`offerStarterSet`). Library foundations (`system_starter`) and these
> templates are **shared + copy-on-use** — materialized per-tenant when used (`copyFoundationToTenant`
> / `starterFromTemplate`), deliberately *not* deep-copied into every tenant on creation.

## Also shipped in-product (dogfood)
The same content lives as an **editable canvas document in the RFP Pipeline company library**
(tenant `rfp-pipeline`), seeded by **`db/migrations/149_seed_sales_overview_doc.sql`** (idempotent;
no-ops if the tenant is absent). Open it at `/portal/rfp-pipeline/documents/…` and export to
`.docx / .pdf / .xlsx` from the Documents surface. Canvas JSON source: `_src/canvas-seed.json`.

## Regenerate
Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; scripts resolve `docx`/`playwright`
from `frontend/node_modules`. (LibreOffice conversion is broken in the sandbox — the PDF is rendered
by Chromium, the DOCX built by `docx` (npm), not by an Office round-trip.)

```
# 1. brand assets → PNGs (logo + section icons), in _src/assets/
node _src/render-assets.mjs
# 2. the 10-page PDF (edit sales.html first)
node _src/render-sales.mjs
# 3. the branded editable DOCX
node _src/gen-docx.mjs
# 4. the in-product canvas seed JSON (→ paste into the migration if content changes)
node _src/gen-canvas.mjs
```

> The `_src/*.mjs` scripts carry the paths used at build time; adjust the `SP`/output paths to
> point at this directory when re-running from the repo.
