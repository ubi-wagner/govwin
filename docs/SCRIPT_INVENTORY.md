# SCRIPT_INVENTORY.md — every harness script, and whether anything needs it

> **Generated** by `frontend/scripts/inventory-scripts.mjs`. Do not hand-edit: every column is
> computed evidence, and a hand-maintained version would be wrong the day after it was written —
> invisibly, which is exactly the property that let fixture rot sit unnoticed (B98–B102).
>
> Regenerate: `cd frontend && DATABASE_URL_OWNER=… node scripts/inventory-scripts.mjs`

## What the columns mean

| column | evidence |
|---|---|
| **class** | who references it — the branch-drive runner, package.json, another script, a doc, or nothing |
| **rot** | count of identifiers it drives that the live database no longer has (env-var fallbacks and literals it CREATES do not count) |
| **touched** | git's date for the last commit to that file |

**Nothing here is marked "deprecated."** Deprecation is a decision. This can observe that nothing
references a script and that it can no longer run; the sections at the bottom collect those and ask
for a call rather than announcing one.

**"Validated" is not a column, on purpose.** Whether a script passes is a property of *today's* run,
not of the file, and freezing it here would recreate the problem this document exists to prevent —
a stale green nobody re-checks. The live answer is `bash scripts/run-branch-drives.sh`, whose
table is the record. Everything in **SUITE** below ran in that suite; everything else did not.


## SUITE — 59

Runs on every `run-branch-drives.sh`. This is the regression net.

| script | rot | touched |
|---|---|---|
| `audit-empty-not-null.mjs` | — | 2026-08-30 |
| `audit-env-inventory.mjs` | — | 2026-08-28 |
| `audit-pipeline-coherence.mjs` | — | 2026-08-28 |
| `audit-row-type-truth.mjs` | — | 2026-08-28 |
| `close-e2e-cms.mjs` | — | 2026-08-30 |
| `demo-canvas-capabilities.mts` | — | 2026-08-24 |
| `drive-admin-demand.mts` | — | 2026-08-31 |
| `drive-application-intake.mts` | — | — |
| `drive-atomization.mts` | — | 2026-08-30 |
| `drive-award-to-contract.mts` | — | 2026-08-24 |
| `drive-bridge-buckets.mjs` | — | 2026-08-30 |
| `drive-bucket-authoring.mts` | — | 2026-08-30 |
| `drive-canvas-authoring.mts` | — | 2026-08-24 |
| `drive-card-decision.mts` | — | 2026-08-30 |
| `drive-cms-generate.mts` | — | 2026-08-24 |
| `drive-collaborator-boundary.mts` | — | 2026-08-30 |
| `drive-commercial-path.mts` | — | 2026-09-01 |
| `drive-copy-starter.mts` | — | 2026-08-23 |
| `drive-corpus-copy-inward.mts` | — | 2026-08-30 |
| `drive-curate-baa.mts` | — | 2026-08-30 |
| `drive-curated-ranking.mts` | — | 2026-08-30 |
| `drive-end-to-end.mjs` | — | 2026-08-28 |
| `drive-full-draft.mts` | — | 2026-08-24 |
| `drive-identity-deeplink.mts` | — | 2026-08-24 |
| `drive-library-starter-copy.mts` | — | 2026-08-30 |
| `drive-opp-scout.mts` | — | 2026-08-24 |
| `drive-oversight-surfaces.mts` | — | 2026-08-31 |
| `drive-p3-invite.mts` | — | 2026-08-24 |
| `drive-p3-lifecycle.mts` | — | 2026-08-24 |
| `drive-pin-honesty.mts` | — | 2026-08-30 |
| `drive-pin.mts` | — | 2026-08-24 |
| `drive-project-lifecycle.mts` | 2 | 2026-08-28 |
| `drive-provisioning-cockpit.mts` | — | 2026-08-24 |
| `drive-real-solicitation.mts` | — | 2026-08-30 |
| `drive-review-gate.mts` | — | 2026-08-15 |
| `drive-rls-admin.mjs` | — | 2026-08-24 |
| `drive-rls-app.mjs` | — | 2026-08-24 |
| `drive-rls-pages.mjs` | — | 2026-08-24 |
| `drive-rls-portal.mjs` | — | 2026-08-24 |
| `drive-ruler-overlays.mts` | — | 2026-08-24 |
| `drive-scenario-factory.mts` | — | 2026-08-30 |
| `drive-scout-intake.mts` | — | 2026-08-23 |
| `drive-shadow-tenant-admin.mts` | — | 2026-08-24 |
| `drive-spine-t1-section-todo.mts` | — | 2026-08-24 |
| `drive-spine-t4-buildout.mts` | — | 2026-08-24 |
| `drive-spine-t7-anchor.mts` | — | 2026-08-15 |
| `drive-starter-offer.mts` | — | 2026-08-24 |
| `drive-submit-gate.mts` | — | 2026-08-15 |
| `drive-tenant-workflow-setup.mts` | — | 2026-08-15 |
| `drive-uncovered-triggers.mts` | — | 2026-08-24 |
| `drive-vault-isolation.mts` | — | 2026-08-24 |
| `drive-verdict-and-transfer.mts` | — | 2026-08-31 |
| `estimate-full-build-cost.mts` | — | 2026-08-28 |
| `probe-deck-overlap.mts` | — | 2026-08-25 |
| `probe-interaction-mobile.mts` | — | 2026-08-31 |
| `probe-measure-grid.mts` | — | 2026-08-24 |
| `probe-page-scale.mts` | — | 2026-08-26 |
| `probe-structural-nodes.mts` | — | 2026-08-25 |
| `verify-deck-ruler-live.mts` | — | 2026-08-24 |

## LENS — 4

One of the four lenses. Run after a UI change or a deploy.

| script | rot | touched |
|---|---|---|
| `verify-api-contract.mjs` | — | 2026-08-30 |
| `verify-db-crud.mjs` | — | 2026-08-30 |
| `verify-surfaces.mjs` | — | 2026-08-30 |
| `verify-ui-vs-db.mjs` | — | 2026-08-30 |

## CROSS-CHECK — 2

Shares no code with the lenses — the thing that can dissent. Not a fifth lens.

| script | rot | touched |
|---|---|---|
| `crosscheck-canvas-normalize.mts` | — | 2026-08-30 |
| `crosscheck-shipped-fixes.sh` | — | 2026-08-23 |

## RULER — 7

Canvas measurement + calibration. Anything touching layout or export runs these.

| script | rot | touched |
|---|---|---|
| `calibrate-page-ruler.mts` | — | 2026-08-23 |
| `calibrate-slide-ruler.mts` | — | 2026-08-22 |
| `diagnose-mold-ruler.mts` | — | 2026-08-23 |
| `sweep-mold-quality.mts` | — | 2026-08-24 |
| `verify-exports-on-stored-artifacts.mts` | — | 2026-08-23 |
| `verify-ruler-on-proposals.mts` | — | 2026-08-23 |
| `verify-ruler-on-stored-artifacts.mts` | — | 2026-08-23 |

## LIBRARY — 7

Imported by other scripts; never run directly.

| script | rot | touched |
|---|---|---|
| `lib/client-ip.mjs` | — | 2026-08-24 |
| `lib/cross-company.mts` | — | 2026-08-24 |
| `lib/drive-actor.mjs` | — | 2026-08-23 |
| `lib/error-surface.mjs` | — | 2026-08-25 |
| `lib/harness-residue.mts` | — | 2026-08-24 |
| `lib/mobile-measure.mts` | — | 2026-08-31 |
| `lib/scenario.mts` | — | 2026-08-24 |

## CALLED-BY-ANOTHER — 28

Invoked by another script rather than by a person.

| script | rot | touched | called by |
|---|---|---|---|
| `analyze-node-demand.mjs` | — | 2026-08-23 | verify-ruler-composition.mts |
| `audit-card-fields.mjs` | — | 2026-08-30 | run-branch-drives.sh |
| `audit-pinned-fixtures.mjs` | — | 2026-08-28 | run-branch-drives.sh |
| `build-ui-contact-sheets.mjs` | — | 2026-08-25 | write-ui-docs.mjs |
| `capture-ui-atlas.mjs` | — | 2026-08-30 | drive-ui-states.mjs, write-ui-docs.mjs |
| `catalog-ui.mjs` | — | 2026-08-25 | capture-ui-atlas.mjs |
| `check-office-filters.mjs` | — | 2026-08-25 | run-branch-drives.sh |
| `check-rig-hydration.mjs` | — | 2026-08-24 | run-branch-drives.sh |
| `check-rls-posture.mjs` | — | 2026-09-01 | run-branch-drives.sh |
| `check-tenant-isolation-invariant.mjs` | — | 2026-08-23 | run-branch-drives.sh |
| `drive-amendment.mjs` | — | 2026-08-30 | run-branch-drives.sh |
| `drive-baa-forward.mjs` | — | 2026-08-30 | drive-end-to-end.mjs |
| `drive-buy-and-build.mjs` | — | 2026-08-30 | drive-end-to-end.mjs |
| `drive-finish-build.mjs` | — | 2026-08-30 | drive-end-to-end.mjs |
| `drive-ingest-scenario.mjs` | — | 2026-08-30 | drive-end-to-end.mjs, drive-full-journey.mts |
| `health-manager.sh` | — | 2026-08-11 | rehydrate-sandbox.sh |
| `inventory-frontend.mjs` | — | 2026-08-28 | audit-pipeline-coherence.mjs, reconcile-capability.mjs |
| `measure-char-width.mts` | — | 2026-08-23 | calibrate-page-ruler.mts |
| `probe-node-vocabulary.mts` | — | 2026-08-23 | drive-canvas-authoring.mts |
| `reconcile-capability.mjs` | — | 2026-08-30 | audit-producer-consumer.mjs |
| `rehydrate-sandbox.sh` | — | 2026-09-01 | health-manager.sh, sandbox-heartbeat.sh |
| `run-branch-drives.sh` | — | 2026-09-01 | audit-pinned-fixtures.mjs, inventory-scripts.mjs |
| `sandbox-heartbeat.sh` | — | 2026-09-01 | audit-producer-consumer.mjs |
| `seed-isolation-fixture.mts` | 1 | 2026-08-24 | drive-agent-flows.mjs |
| `seed-project-scenario.mjs` | — | 2026-08-28 | verify-ui-vs-db.mjs |
| `seed-sheet-doc.mts` | — | 2026-08-11 | audit-producer-consumer.mjs |
| `stage-collaborator-fixture.mts` | 1 | 2026-08-31 | capture-collab.mjs |
| `verify-scorer-parity.mjs` | — | 2026-08-29 | run-branch-drives.sh |

## NPM-WIRED — 1

Reachable via `npm run` — package.json names it.

| script | rot | touched |
|---|---|---|
| `sync-pdf-worker.mjs` | — | 2026-08-18 |

## DOCUMENTED — 95

No code references it, but a document tells someone to run it.

| script | rot | touched |
|---|---|---|
| `audit-automation-spine.mjs` | — | 2026-08-28 |
| `audit-doc-currency.mjs` | — | 2026-09-01 |
| `audit-env-parity.mjs` | — | 2026-08-29 |
| `audit-producer-consumer.mjs` | — | 2026-09-01 |
| `backfill-buckets.mts` | — | 2026-08-15 |
| `bug-log-status.mjs` | — | 2026-08-24 |
| `capture-guides.mjs` | — | 2026-08-30 |
| `capture-mobile-guide.mts` | — | 2026-08-28 |
| `capture-projects-guide.mjs` | — | 2026-08-28 |
| `capture-shots.mts` | 14 | 2026-07-19 |
| `capture-templates.mts` | — | 2026-08-24 |
| `capture-vaults.mjs` | 2 | 2026-07-25 |
| `check-cms-content-retirable.mjs` | — | 2026-09-01 |
| `check-harness-syntax.mjs` | — | 2026-08-27 |
| `classify-migrations.mjs` | — | 2026-08-29 |
| `close-e2e-marketing.mjs` | — | 2026-08-30 |
| `close-e2e-proposal.mjs` | — | 2026-08-30 |
| `drive-agent-flows.mjs` | — | 2026-08-26 |
| `drive-canvas-overlays.mjs` | — | 2026-08-25 |
| `drive-control-reachability.mts` | — | 2026-08-24 |
| `drive-corpus-verbatim.mts` | — | 2026-08-19 |
| `drive-dormant-surface.mjs` | — | 2026-08-26 |
| `drive-email-spine.mts` | — | 2026-08-26 |
| `drive-foundation-tvsf.mts` | — | 2026-08-19 |
| `drive-item-template-picker.mts` | 1 | 2026-08-30 |
| `drive-milestone-construct.mts` | — | 2026-08-27 |
| `drive-navair-build.mts` | — | 2026-08-19 |
| `drive-past-proposal-templify.mts` | 1 | 2026-08-30 |
| `drive-remaining-cohorts.mts` | 1 | 2026-08-15 |
| `drive-rls-admin-fnd.mjs` | — | 2026-08-30 |
| `drive-rls-context.mts` | — | 2026-07-25 |
| `drive-rls-pages-fnd.mjs` | — | 2026-08-30 |
| `drive-rls-portal-fnd.mjs` | — | 2026-08-30 |
| `drive-scenario-matrix.mts` | — | 2026-08-24 |
| `drive-scout.mjs` | — | 2026-08-30 |
| `drive-starter-bulk.mts` | — | 2026-07-25 |
| `drive-ui-responsive.mjs` | — | 2026-08-28 |
| `drive-ui-states.mjs` | — | 2026-08-31 |
| `embed-atoms.mts` | — | 2026-08-11 |
| `fire-uncovered-lib-triggers.mts` | — | 2026-08-23 |
| `fire-uncovered-triggers.mjs` | — | 2026-08-23 |
| `fix-open-event-brackets.mjs` | — | 2026-08-25 |
| `gen-guide-queue-seed.mts` | — | 2026-08-24 |
| `gen-navy-sttr-proposal.mts` | — | 2026-07-19 |
| `gen-sample-proposal.mts` | — | 2026-07-19 |
| `gen-starter-set-seed.mts` | — | 2026-08-04 |
| `hitl-setup.mts` | 1 | 2026-07-19 |
| `ingest-assist-e2e.mts` | — | 2026-07-19 |
| `inventory-crm.mjs` | — | 2026-08-26 |
| `inventory-scripts.mjs` | — | 2026-08-24 |
| `measure-canvas-flow.mts` | — | 2026-07-19 |
| `measure-image-placeholder.mts` | — | 2026-08-23 |
| `measure-ranking-change.mts` | — | 2026-08-29 |
| `measure-table-row-height.mts` | — | 2026-08-22 |
| `monday-journey-e2e.mts` | 1 | 2026-07-19 |
| `navy-sttr-e2e.mts` | 2 | 2026-07-19 |
| `probe-bucket-rerank.mjs` | — | 2026-08-30 |
| `probe-build-or-mark.mjs` | 1 | 2026-08-30 |
| `probe-deliverable-artifacts.mts` | 1 | 2026-08-27 |
| `probe-pattern-extract.mts` | — | 2026-08-22 |
| `probe-project-mobile.mts` | — | 2026-08-31 |
| `probe-style-matrix.mts` | — | 2026-08-24 |
| `prove-pdf-export.mts` | — | 2026-08-15 |
| `render-artifact-pages.mts` | — | 2026-08-24 |
| `render-tv-preview.mjs` | — | 2026-07-20 |
| `seed-cuas-immobileyes.mts` | 1 | 2026-08-18 |
| `seed-dsip-opps.mts` | — | 2026-07-19 |
| `seed-followon-guides.mts` | 1 | 2026-08-24 |
| `seed-practice-guides.mts` | 1 | 2026-08-24 |
| `seed-program-guides.mts` | 1 | 2026-08-24 |
| `seed-template-masters.mts` | — | 2026-08-14 |
| `seed-vault-demo.mts` | 3 | 2026-07-25 |
| `shot-provisioning-cockpit.mjs` | — | 2026-08-30 |
| `usaf-cso-e2e.mts` | 2 | 2026-07-19 |
| `ux-ops-mobile.mjs` | — | 2026-08-30 |
| `verify-assemble-from-library.mjs` | — | 2026-08-30 |
| `verify-collaborator-blast-radius.mjs` | — | 2026-08-30 |
| `verify-compliance-matrix.mts` | — | 2026-08-23 |
| `verify-email-ledger-rls.mjs` | 2 | 2026-08-26 |
| `verify-embeddings.mts` | — | 2026-08-11 |
| `verify-groups-overlay.mjs` | — | 2026-08-30 |
| `verify-ingest-coverage.mts` | — | 2026-08-18 |
| `verify-keep-copy.mts` | — | 2026-08-04 |
| `verify-local-storage.mts` | — | 2026-08-11 |
| `verify-project-isolation.mjs` | — | 2026-08-28 |
| `verify-project-rollup.mjs` | — | 2026-08-28 |
| `verify-scope-bar.mjs` | — | 2026-08-30 |
| `verify-scope-end-to-end.mjs` | — | 2026-08-30 |
| `verify-scoped-gates.mjs` | — | 2026-08-30 |
| `verify-scoped-review.mjs` | — | 2026-08-30 |
| `verify-storage-server.mts` | — | 2026-08-11 |
| `verify-studio-voice.mts` | — | 2026-08-23 |
| `verify-surfaced-capability.mjs` | — | 2026-08-25 |
| `verify-write-contract.mjs` | — | 2026-08-30 |
| `write-ui-docs.mjs` | — | 2026-08-31 |

## UNREFERENCED — 94

Nothing references it and it holds no dead identifier. It may still work — nobody knows. **Needs a call.**

| script | rot | touched |
|---|---|---|
| `audit-dead-code.mjs` | — | 2026-09-01 |
| `audit-ranking-readiness.mjs` | — | 2026-08-30 |
| `audit-wipe-impact.mjs` | — | 2026-08-29 |
| `backfill-corpus-verbatim.mts` | — | 2026-08-19 |
| `build-doc-guide.mjs` | — | 2026-08-11 |
| `capture-collab.mjs` | — | 2026-08-31 |
| `capture-guide-crops.mts` | — | 2026-08-31 |
| `capture-stage-walk.mjs` | — | 2026-08-30 |
| `demo-atoms-ui.mjs` | — | 2026-08-30 |
| `derive-capability-map.mjs` | — | 2026-08-30 |
| `drive-b1-auto-advance.mts` | — | 2026-08-15 |
| `drive-box-pdf.mts` | — | 2026-08-11 |
| `drive-box-upload.mts` | — | 2026-08-11 |
| `drive-box2-suggest.mts` | — | 2026-08-11 |
| `drive-box3-nudge.mts` | — | 2026-08-11 |
| `drive-capability-deck.mts` | — | 2026-08-25 |
| `drive-enrich-prod.mts` | — | 2026-08-11 |
| `drive-f1-fluid.mts` | — | 2026-08-30 |
| `drive-f2-annotate.mts` | — | 2026-08-30 |
| `drive-full-journey.mts` | — | 2026-08-24 |
| `drive-immobileyes.mts` | — | 2026-07-19 |
| `drive-leakage.mts` | — | 2026-08-11 |
| `drive-librarian-review.mts` | — | 2026-08-30 |
| `drive-library-review.mts` | — | 2026-08-30 |
| `drive-navair-draft-proof.mts` | — | 2026-07-21 |
| `drive-navair-faithful-bd.mts` | — | 2026-07-21 |
| `drive-navair-faithful.mts` | — | 2026-07-21 |
| `drive-preview-atomize.mts` | — | 2026-08-30 |
| `drive-sheet-numfmt.mts` | — | 2026-08-30 |
| `drive-sheet-style.mts` | — | 2026-08-30 |
| `drive-slides-frame.mts` | — | 2026-08-30 |
| `drive-tw8c-gate-close.mts` | — | 2026-08-15 |
| `dsip-plan-check.mts` | — | 2026-08-18 |
| `gen-immobileyes-seed.mts` | — | 2026-08-18 |
| `immo-ingest-drive.mts` | — | 2026-08-30 |
| `j1-cold-start.mjs` | — | 2026-08-30 |
| `make-dsip-fixture.mts` | — | 2026-08-18 |
| `measure-volumes.mts` | — | 2026-08-19 |
| `mirage-ingest.mts` | — | 2026-08-19 |
| `parity-score-ts.mts` | — | 2026-08-30 |
| `probe-bucket-merge.mjs` | — | 2026-08-30 |
| `probe-comp-codes.mjs` | — | 2026-08-30 |
| `probe-disposition-ui.mjs` | — | 2026-08-30 |
| `probe-mobile-overflow.mjs` | — | 2026-08-30 |
| `probe-partner-multi.mjs` | — | 2026-08-30 |
| `probe-portal-forms.mjs` | — | 2026-08-30 |
| `probe-preview-download.mjs` | — | 2026-08-30 |
| `probe-provision-elsewhere.mts` | — | 2026-08-20 |
| `probe-review-and-land.mjs` | — | 2026-08-30 |
| `repair-card-dates.mts` | — | 2026-08-20 |
| `repair-section-page-caps.mts` | — | 2026-08-19 |
| `repair-truncated-source-text.mts` | — | 2026-08-20 |
| `seed-demo-automation.mts` | — | 2026-07-19 |
| `seed-house-library.mts` | — | 2026-07-25 |
| `seed-librarian-catalog.mjs` | — | 2026-08-11 |
| `seed-review-junk.mjs` | — | 2026-08-11 |
| `seed-slide-deck.mts` | — | 2026-08-11 |
| `setup-tw11-browser-portal.mts` | — | 2026-08-15 |
| `shoot-immobileyes.mjs` | — | 2026-08-30 |
| `shot-content-queue.mjs` | — | 2026-08-30 |
| `shot-doc.mts` | — | 2026-08-30 |
| `shot-scout-intake.mjs` | — | 2026-08-30 |
| `shot-workflow-setup.mjs` | — | 2026-08-30 |
| `stage-guide-fixtures.mts` | — | 2026-08-31 |
| `t3cp-agent-config.mjs` | — | 2026-08-21 |
| `t3cp-archive-atoms.mjs` | — | 2026-08-19 |
| `t3cp-archive-goldstandard.mjs` | — | 2026-08-19 |
| `t3cp-attach-docs.mjs` | — | 2026-08-19 |
| `t3cp-color-team.mjs` | — | 2026-08-19 |
| `t3cp-fulldraft.mjs` | — | 2026-08-19 |
| `t3cp-ingest.mts` | — | 2026-08-30 |
| `t3cp-lock-and-package.mjs` | — | 2026-08-19 |
| `t3cp-reatomize.mjs` | — | 2026-08-19 |
| `t3cp-reset-build.sh` | — | 2026-08-19 |
| `t3cp-restore-sections.mjs` | — | 2026-08-19 |
| `tier2-documents-e2e.mts` | — | 2026-07-19 |
| `ux-capture-supp.mjs` | — | 2026-08-30 |
| `ux-capture.mjs` | — | 2026-08-30 |
| `ux-nav-proof.mjs` | — | 2026-08-13 |
| `ux-ops-proof.mjs` | — | 2026-08-30 |
| `ux-polish2-proof.mjs` | — | 2026-08-30 |
| `ux-polish3-proof.mjs` | — | 2026-08-30 |
| `verify-assembled-flow.mts` | — | 2026-07-19 |
| `verify-atom-enrich.mts` | — | 2026-08-11 |
| `verify-capture-backend.mts` | — | 2026-08-11 |
| `verify-insert-fidelity.mts` | — | 2026-08-11 |
| `verify-library-soundness.mts` | — | 2026-08-11 |
| `verify-media-export.mts` | — | 2026-08-11 |
| `verify-mt1-compliance.mts` | — | 2026-08-22 |
| `verify-pptx-tables.mts` | — | 2026-08-11 |
| `verify-public-links.mjs` | — | 2026-08-25 |
| `verify-ruler-composition.mts` | — | 2026-08-23 |
| `verify-studio-voice-route.mjs` | — | 2026-08-30 |
| `verify-unextractable.mts` | — | 2026-08-11 |

---

## ⚠ Documented but rotted — 17

A document tells someone to run these, and each drives at least one identifier the database no
longer has. They will fail confusingly rather than loudly. Either the script needs the
"build the scenario it needs" treatment, or the document should stop pointing at it.

| script | rot | touched |
|---|---|---|
| `capture-shots.mts` | 14 | 2026-07-19 |
| `seed-vault-demo.mts` | 3 | 2026-07-25 |
| `capture-vaults.mjs` | 2 | 2026-07-25 |
| `navy-sttr-e2e.mts` | 2 | 2026-07-19 |
| `usaf-cso-e2e.mts` | 2 | 2026-07-19 |
| `verify-email-ledger-rls.mjs` | 2 | 2026-08-26 |
| `drive-item-template-picker.mts` | 1 | 2026-08-30 |
| `drive-past-proposal-templify.mts` | 1 | 2026-08-30 |
| `drive-remaining-cohorts.mts` | 1 | 2026-08-15 |
| `hitl-setup.mts` | 1 | 2026-07-19 |
| `monday-journey-e2e.mts` | 1 | 2026-07-19 |
| `probe-build-or-mark.mjs` | 1 | 2026-08-30 |
| `probe-deliverable-artifacts.mts` | 1 | 2026-08-27 |
| `seed-cuas-immobileyes.mts` | 1 | 2026-08-18 |
| `seed-followon-guides.mts` | 1 | 2026-08-24 |
| `seed-practice-guides.mts` | 1 | 2026-08-24 |
| `seed-program-guides.mts` | 1 | 2026-08-24 |

---

## Totals

| class | count |
|---|---|
| SUITE | 59 |
| LENS | 4 |
| CROSS-CHECK | 2 |
| RULER | 7 |
| LIBRARY | 7 |
| CALLED-BY-ANOTHER | 28 |
| NPM-WIRED | 1 |
| DOCUMENTED | 95 |
| UNREFERENCED | 94 |
| **total** | **297** |
