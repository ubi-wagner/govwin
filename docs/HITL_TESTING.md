# HITL testing — run the whole workflow off seeded DSIP OPPs

Two real DoD SBIR 2026 (DSIP) opportunities are wired **release-ready** so you can
drive the entire loop by hand — **card → purchase → release → build the canvases →
lock → export** — with the canvas work as the focus.

## Prep (once, sandbox)

```bash
cd frontend
# 1. seed the real DSIP opportunities (cards + triage queue) — see scripts/seed-dsip-opps.mts
DATABASE_URL=… node --import tsx scripts/seed-dsip-opps.mts
# 2. make MANTRAS + ExCAIPE release-ready (skeleton: 2 volumes, 8 section molds) + dress-rehearse
DATABASE_URL=… node --import tsx scripts/hitl-setup.mts
```

`hitl-setup.mts` dress-rehearses a full provision (asserts **8 section canvases
across 2 volumes**) and cleans it up, so the OPP is left fresh for your run.

## The two ready OPPs

| Topic | Code | Provisions |
|---|---|---|
| **MANTRAS** — Rydberg atomic sensors | `DPA26BZ03-DV011` | Technical Volume (7 sections) + Cost Volume (1) = **8 canvases** |
| **ExCAIPE** — air-independent power | `DPA26BZ03-DV013` | same 8-canvas skeleton |

The other 5 seeded DSIP topics are left **bare** (`new` in the triage queue). Buy
one of those to test the *full curation* path, or to see the single-canvas
fallback build.

## The HITL click-path

**Personas** (demo sandbox logins, password `DemoPass123!`):
- **Tenant admin** — `admin@acme-navy.test` (Acme Navy Systems)
- **RFP admin** — `eric@rfppipeline.com`

1. **Tenant admin → Opportunities.** Open the **MANTRAS** card → **Build →** (or
   purchase with the comp code `rfppipelinetest`). The portal goes
   `curation_pending`.
2. **RFP admin → the tenant's `/portal/acme-navy-systems/portals`.** Click
   **Release to customer** (or *Open portal* with the opportunity id). Release
   **provisions the build unlocked** — 2 volumes, 8 molded section canvases, and
   the compliance matrix, all from the skeleton.
3. **Tenant admin → Proposals → the new build.** Now the canvas work:
   - **Draft All Sections** (grounds on your library), or **Open** a section and
     write by hand.
   - Exercise the canvas: **Insert** blocks, **Format**, **+ From Library**,
     **AI Assist**, **Sections & Budget**, **Floorplan**, comments, **Save**.
   - **Accept & Lock** a section / **Lock Volume** / **Lock All**.
4. **Export** — per section (docx/pdf), per volume (docx/pptx/xlsx/pdf), or the
   whole proposal (.docx / .zip).

## Reset between runs

To re-run cleanly, delete the provisioned proposal for the tenant and (optionally)
re-run `hitl-setup.mts`:

```sql
-- drop a rehearsal/run build for Acme so the OPP is fresh
DELETE FROM proposal_compliance_matrix WHERE proposal_id IN (SELECT id FROM proposals WHERE tenant_id=(SELECT id FROM tenants WHERE slug='acme-navy-systems') AND title ILIKE 'DPA26BZ03-DV011%');
DELETE FROM proposal_sections  WHERE proposal_id IN (SELECT id FROM proposals WHERE tenant_id=(SELECT id FROM tenants WHERE slug='acme-navy-systems') AND title ILIKE 'DPA26BZ03-DV011%');
DELETE FROM proposal_artifacts WHERE proposal_id IN (SELECT id FROM proposals WHERE tenant_id=(SELECT id FROM tenants WHERE slug='acme-navy-systems') AND title ILIKE 'DPA26BZ03-DV011%');
DELETE FROM proposals WHERE tenant_id=(SELECT id FROM tenants WHERE slug='acme-navy-systems') AND title ILIKE 'DPA26BZ03-DV011%';
```

## Notes

- Data is real current DSIP topics; **the skeleton (volumes/section molds/page
  limits) is a representative DARPA SBIR Phase I structure** authored for the run,
  not scraped from the solicitation PDF — live solicitation parsing is the Scouts
  work, later.
- All sandbox-only. Nothing here touches production.
