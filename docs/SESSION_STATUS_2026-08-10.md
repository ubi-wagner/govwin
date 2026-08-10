# Session Status — 2026-08-10 (continuity)

> Durable "where I am" note for resume. Branch **`claude/nice-hamilton-kBqtD`**, HEAD **`8020f1e`**, pushed.
> Green backbone at every commit: `tsc` 0 · `vitest` 917 · `next build` 0.

## What shipped this session (commit trail)
1. `65c4e04` / `e86def5` — corrected DoD SBIR/STTR compliance to real DSIP; cover-sheet `artifact_type=form`; apply-preset persists `custom_variables`/`required_documents`/`min_font_size`.
2. `7eda112` — **Form fidelity** fixes: (a) provision sets `sort_index` → sections order 1..N numerically (not string-sorted); (b) section glyph comes from the authored `meta.itemType` (not the title heuristic that mis-fired "Budget *Narrative*"→XLS, "Pro-*forma*"→FORM); (c) save route flips `empty`→`in_progress` when content lands so readiness stops under-counting. Smoke tests updated for the cost-template mapping.
3. `a6785b1` — provision recognizes `training|fraud|waste|abuse` volumes as **forms** (real DoW Vol 6 FWA Training). Surfaced by ingesting the real BAA.
4. `a1fdd36` — **Seed mig 167**: durable DoW 2026 SBIR + STTR solicitations (RFP-admin authored side + Foundation-tenant submitted build). Generator: `scripts/gen-dow-seed-migration.mjs`.
5. `8020f1e` — **Guidebooks rebuilt**: RFP-admin (48pp, new §19 worked example) + Customer-admin (45pp, new §16). Python `_src` builders → JSON → HTML/PDF + `manuals.html`.

## The two real DoD solicitations (the flagship demo now)
Ingested from the **uploaded** BAAs (NOT WebSearch): `docs/DoW 2026 SBIR BAA FULL_R1_04132026.pdf`, `docs/DoW 2026 STTR BAA FULL_04132026.pdf`. Extract text with **PyMuPDF** (`import fitz`) — `pdftotext`/`pandoc`/`pdftoppm` are NOT installed after a reclaim; PyMuPDF + PIL are.

| | Real BAA structure (all quoted from the PDF) |
|---|---|
| **DoW 2026 SBIR** — Navy (DON) Phase I, `N261-EXP01` | 6 DSIP volumes; Technical Volume **10pp** (component-specific — Navy); 12 technical sections; 10-pt min font, 8.5×11, 1" margins, single-column, single-spaced, per-page header. Vol 6 = **Fraud, Waste & Abuse Training**. |
| **DoW 2026 STTR** — Direct to Phase II, `N26D-CAM07` | 6 volumes; Technical **30pp** = 20pp Proof-of-Feasibility + 10pp Phase-II snapshot; **SB≥40% / RI≥30%** work-split (direct+indirect costs); SBC↔RI Allocation-of-Rights in Vol 5. |

Key correction vs. my earlier WebSearch-synthesized version: **6 volumes not 5** (missed FWA), **12 sections not 11**, **component-specific page limits** (10pp Navy, not a generic 20pp).

### Live IDs (current sandbox DB; seeded by mig 167)
- SBIR: opp `74afe7dc-5ea8-4bcd-a01f-d6e0b9920b3f` · sol `7b70cdbf-cf08-40f2-96a7-dc92c0b10703` · foundation proposal `73d587b2-66ba-44f7-b935-329aef0aadc1` (submitted, 17 sections locked).
- STTR: opp `48405118-8816-449c-a4e5-17f7243e4ece` · sol `2df2a5f9-9e37-4953-b827-cdfaaf9522e0` · proposal `fa1461c9-806c-4541-b914-15d4bd39749a` (submitted, 16 sections locked).
- Source_id prefix for both opps: `dow-%`. Earlier WebSearch-synthesized DoD proposals were **soft-archived** (not deleted).

## The two-actor per-solicitation process (proven end-to-end, all live)
- **RFP admin** (ingest admin + compliance builder + template builder + adversarial review): `/api/admin/intake` (or direct rows) → `POST /api/admin/rfp-curation/<sol>/apply-preset` with a DIRECT `{topicIds, compliance, volumes}` payload (NOT a preset) → `POST /api/admin/templates` (per-solicitation Technical template) → adversarial-review asserts authored numbers == real BAA → `POST /api/admin/opportunities/<opp>/publish {eventType:'solicitation.push'}` fans the OPP card.
- **Tenant admin** (separate actor): `POST /api/portal/<slug>/purchase {opportunityId, promoCode:'rfppipelinetest'}` → admin `POST …/portals/<portal>?action=release` provisions the mirror bounded by the spec → draft (`PUT …/sections/<s>/save`) → lock (`POST …/sections/<s>/lock`) → readiness (`GET …/readiness`) → advance (`POST …/advance {targetStage:'final'}` → submitted+locked) → package (`POST …/package?format=docx|pdf|zip`, **POST not GET**).
- Package proven: docx (combined), pdf (Chromium 2-page), zip (per-volume-native — Cost Volume as native `.xlsx`).

## Environment recovery (after a container reclaim)
1. **Postgres** (survives on `/tmp/pgs_gov/data`): `rm -f /tmp/pgs_gov/data/postmaster.pid; su claude -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pgs_gov/data -o '-p 5433 -k /tmp/pgs_sock' -l /tmp/pgs_gov/log start"`. `DATABASE_URL=postgresql://claude@127.0.0.1:5433/govtech_intel`. Run `node db/migrations/migrate.mjs` to reach head (167).
2. **Server**: rebuild only if source changed (`cd frontend && npx next build`, ~2min, run in background); stage static (`cp -r .next/static .next/standalone/.next/static; cp -r public/* .next/standalone/public/`); start via `scratchpad/start_server.sh` (has the full env). Hit **localhost:3000** (not 127.0.0.1) for auth.
3. Full recipe: `docs/CONTINUATION.md §2`.

## Accounts (verified)
- `eric@rfppipeline.com` / `RFPAdmin2026!` — master_admin.
- `kate.ulepic@foundation3dp.com` / `DemoPass123!` — Foundation tenant_admin.
- Comp code: `rfppipelinetest`.

## Standing constraints
- **`ANTHROPIC_API_KEY` is empty** in the sandbox → the AI ingest/shredder and AI drafting agents can't run; I act as the human admin/tenant (author compliance + draft content by hand).
- **Outbound egress blocks `.mil`** (dodsbirsttr.mil, media.defense.gov, navysbir.com…) → can't live-pull from DSIP; use the uploaded `docs/DoW 2026 *.pdf`.
- Sharing is **copy-inward only** (standing guardrail) — no cross-tenant shared objects.
- Nothing hard-deleted — archive is soft + reversible.

## Open gaps
See `docs/HUMAN_GAP_ANALYSIS.md` (written this session) — the honest what's-proven / what's-assumed / what's-missing from each human role's perspective.
