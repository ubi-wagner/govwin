# RFP Pipeline — marketing collateral (eat-our-own-cooking)

Four pieces authored **in our own CanvasDocument model** and installed as templates in the
**RFP-admin library** (`document_templates`, `is_system=true`), with polished self-contained
HTML+SVG renders for viewing. All copy is honest: dollar figures beyond the public SBIR Phase I
range are labeled *illustrative*; no fabricated customers/traction; "Immobileyes" appears only as a
hypothetical example small business.

| Piece | Audience | Canvas template (admin library) | View |
|---|---|---|---|
| EconDev 1-pager | Economic-development orgs supporting small businesses | "EconDev Solution Overview — RFP Pipeline" (custom, 21 nodes) | `econdev-onepager.html` |
| Small-biz 1-pager | New small-business customers (founder/PI) | "RFP Pipeline — Founder's One-Page Solution Overview" (custom, 18 nodes) | `smallbiz-onepager.html` |
| 2-page brief | p1 solution · p2 value props + financial justification | "RFP Pipeline — Two-Page Capture Brief" (custom, 21 nodes) | `solution-businesscase-2page.html` |
| 5-slide deck | Potential investors (generic) | "RFP Pipeline — Investor Overview (5-Slide Deck)" (slide_deck, 27 nodes) | `investor-deck-5page.html` |

**Install into a fresh DB's admin library:**
```
DATABASE_URL=... node scripts/seed_collateral_templates.mjs
```
Source-of-truth canvas data: `scripts/data/collateral_templates.json`. The `.html` files are
standalone (inline SVGs, no external assets) — open directly in a browser.
