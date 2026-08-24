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


## SUITE — 27

Runs on every `run-branch-drives.sh`. This is the regression net.

| script | rot | touched |
|---|---|---|
| `drive-atomization.mts` | — | 2026-08-24 |
| `drive-award-to-contract.mts` | — | 2026-08-24 |
| `drive-bridge-buckets.mjs` | — | 2026-08-24 |
| `drive-collaborator-boundary.mts` | — | 2026-08-24 |
| `drive-copy-starter.mts` | — | 2026-08-23 |
| `drive-full-draft.mts` | — | 2026-08-24 |
| `drive-identity-deeplink.mts` | — | 2026-08-24 |
| `drive-opp-scout.mts` | — | 2026-08-24 |
| `drive-p3-invite.mts` | — | 2026-08-24 |
| `drive-p3-lifecycle.mts` | — | 2026-08-24 |
| `drive-pin.mts` | — | 2026-08-24 |
| `drive-provisioning-cockpit.mts` | — | 2026-08-24 |
| `drive-review-gate.mts` | — | 2026-08-14 |
| `drive-rls-admin.mjs` | — | 2026-08-24 |
| `drive-rls-app.mjs` | — | 2026-08-24 |
| `drive-rls-pages.mjs` | — | 2026-08-24 |
| `drive-rls-portal.mjs` | — | 2026-08-24 |
| `drive-scenario-factory.mts` | — | 2026-08-24 |
| `drive-scout-intake.mts` | — | 2026-08-23 |
| `drive-shadow-tenant-admin.mts` | — | 2026-08-24 |
| `drive-spine-t1-section-todo.mts` | — | 2026-08-24 |
| `drive-spine-t4-buildout.mts` | — | 2026-08-15 |
| `drive-spine-t7-anchor.mts` | — | 2026-08-15 |
| `drive-starter-offer.mts` | — | 2026-08-24 |
| `drive-submit-gate.mts` | — | 2026-08-14 |
| `drive-tenant-workflow-setup.mts` | — | 2026-08-15 |
| `drive-vault-isolation.mts` | — | 2026-08-24 |

## LENS — 4

One of the four lenses. Run after a UI change or a deploy.

| script | rot | touched |
|---|---|---|
| `verify-api-contract.mjs` | — | 2026-08-23 |
| `verify-db-crud.mjs` | — | 2026-08-23 |
| `verify-surfaces.mjs` | — | 2026-08-23 |
| `verify-ui-vs-db.mjs` | — | 2026-08-23 |

## CROSS-CHECK — 2

Shares no code with the lenses — the thing that can dissent. Not a fifth lens.

| script | rot | touched |
|---|---|---|
| `crosscheck-canvas-normalize.mts` | — | 2026-08-23 |
| `crosscheck-shipped-fixes.sh` | — | 2026-08-23 |

## RULER — 7

Canvas measurement + calibration. Anything touching layout or export runs these.

| script | rot | touched |
|---|---|---|
| `calibrate-page-ruler.mts` | — | 2026-08-23 |
| `calibrate-slide-ruler.mts` | — | 2026-08-22 |
| `diagnose-mold-ruler.mts` | — | 2026-08-23 |
| `sweep-mold-quality.mts` | — | 2026-08-19 |
| `verify-exports-on-stored-artifacts.mts` | — | 2026-08-23 |
| `verify-ruler-on-proposals.mts` | — | 2026-08-23 |
| `verify-ruler-on-stored-artifacts.mts` | — | 2026-08-23 |

## LIBRARY — 5

Imported by other scripts; never run directly.

| script | rot | touched |
|---|---|---|
| `lib/client-ip.mjs` | — | 2026-08-24 |
| `lib/cross-company.mts` | — | 2026-08-24 |
| `lib/drive-actor.mjs` | — | 2026-08-23 |
| `lib/error-surface.mjs` | — | 2026-08-23 |
| `lib/scenario.mts` | — | 2026-08-24 |

## CALLED-BY-ANOTHER — 15

Invoked by another script rather than by a person.

| script | rot | touched | called by |
|---|---|---|---|
| `analyze-node-demand.mjs` | — | 2026-08-23 | verify-ruler-composition.mts |
| `audit-pinned-fixtures.mjs` | — | 2026-08-24 | run-branch-drives.sh |
| `check-rls-posture.mjs` | — | 2026-08-23 | run-branch-drives.sh |
| `check-tenant-isolation-invariant.mjs` | — | 2026-08-23 | run-branch-drives.sh |
| `drive-amendment.mjs` | — | 2026-08-21 | run-branch-drives.sh |
| `drive-baa-forward.mjs` | — | 2026-08-22 | drive-end-to-end.mjs |
| `drive-buy-and-build.mjs` | — | 2026-08-22 | drive-end-to-end.mjs |
| `drive-finish-build.mjs` | — | 2026-08-21 | drive-end-to-end.mjs |
| `drive-ingest-scenario.mjs` | — | 2026-08-21 | drive-end-to-end.mjs |
| `health-manager.sh` | — | 2026-08-11 | rehydrate-sandbox.sh |
| `immo-content.mts` | — | 2026-08-19 | immo-author.mts |
| `measure-char-width.mts` | — | 2026-08-23 | calibrate-page-ruler.mts |
| `probe-temp-password.mjs` | — | 2026-08-20 | j1b-new-customer.mjs |
| `rehydrate-sandbox.sh` | — | 2026-08-23 | health-manager.sh, sandbox-heartbeat.sh |
| `run-branch-drives.sh` | — | 2026-08-24 | audit-pinned-fixtures.mjs, inventory-scripts.mjs |

## NPM-WIRED — 1

Reachable via `npm run` — package.json names it.

| script | rot | touched |
|---|---|---|
| `sync-pdf-worker.mjs` | — | 2026-08-18 |

## DOCUMENTED — 63

No code references it, but a document tells someone to run it.

| script | rot | touched |
|---|---|---|
| `backfill-buckets.mts` | — | 2026-08-15 |
| `bug-log-status.mjs` | — | 2026-08-22 |
| `capture-guides.mjs` | — | 2026-08-23 |
| `capture-shots.mts` | 14 | 2026-07-19 |
| `capture-vaults.mjs` | 2 | 2026-07-25 |
| `close-e2e-cms.mjs` | — | 2026-08-21 |
| `close-e2e-marketing.mjs` | — | 2026-08-13 |
| `close-e2e-proposal.mjs` | — | 2026-08-13 |
| `drive-corpus-verbatim.mts` | — | 2026-08-19 |
| `drive-end-to-end.mjs` | — | 2026-08-23 |
| `drive-foundation-tvsf.mts` | — | 2026-08-19 |
| `drive-item-template-picker.mts` | 1 | 2026-07-19 |
| `drive-navair-build.mts` | — | 2026-08-19 |
| `drive-past-proposal-templify.mts` | 1 | 2026-07-19 |
| `drive-remaining-cohorts.mts` | 1 | 2026-08-14 |
| `drive-rls-admin-fnd.mjs` | — | 2026-08-21 |
| `drive-rls-context.mts` | — | 2026-07-25 |
| `drive-rls-pages-fnd.mjs` | — | 2026-08-21 |
| `drive-rls-portal-fnd.mjs` | — | 2026-08-13 |
| `drive-scenario-matrix.mts` | — | 2026-08-24 |
| `drive-scout.mjs` | — | 2026-08-21 |
| `drive-starter-bulk.mts` | — | 2026-07-25 |
| `embed-atoms.mts` | — | 2026-08-11 |
| `fire-uncovered-lib-triggers.mts` | — | 2026-08-23 |
| `fire-uncovered-triggers.mjs` | — | 2026-08-23 |
| `gen-navy-sttr-proposal.mts` | — | 2026-07-19 |
| `gen-sample-proposal.mts` | — | 2026-07-19 |
| `gen-starter-set-seed.mts` | — | 2026-08-04 |
| `hitl-setup.mts` | 1 | 2026-07-19 |
| `ingest-assist-e2e.mts` | — | 2026-07-19 |
| `measure-canvas-flow.mts` | — | 2026-07-19 |
| `measure-image-placeholder.mts` | — | 2026-08-23 |
| `measure-table-row-height.mts` | — | 2026-08-22 |
| `monday-journey-e2e.mts` | 1 | 2026-07-19 |
| `navy-sttr-e2e.mts` | 2 | 2026-07-19 |
| `probe-bucket-rerank.mjs` | — | 2026-08-20 |
| `probe-build-or-mark.mjs` | 1 | 2026-08-20 |
| `probe-pattern-extract.mts` | — | 2026-08-22 |
| `prove-pdf-export.mts` | — | 2026-08-14 |
| `render-tv-preview.mjs` | — | 2026-07-20 |
| `sandbox-heartbeat.sh` | — | 2026-08-19 |
| `seed-cuas-immobileyes.mts` | 1 | 2026-08-18 |
| `seed-dsip-opps.mts` | — | 2026-07-19 |
| `seed-program-guides.mts` | — | 2026-08-13 |
| `seed-template-masters.mts` | — | 2026-08-14 |
| `seed-vault-demo.mts` | 3 | 2026-07-25 |
| `shot-provisioning-cockpit.mjs` | — | 2026-08-21 |
| `usaf-cso-e2e.mts` | 2 | 2026-07-19 |
| `ux-ops-mobile.mjs` | — | 2026-08-21 |
| `verify-assemble-from-library.mjs` | — | 2026-08-23 |
| `verify-collaborator-blast-radius.mjs` | — | 2026-08-23 |
| `verify-compliance-matrix.mts` | — | 2026-08-23 |
| `verify-embeddings.mts` | — | 2026-08-11 |
| `verify-groups-overlay.mjs` | — | 2026-08-23 |
| `verify-ingest-coverage.mts` | — | 2026-08-18 |
| `verify-keep-copy.mts` | — | 2026-08-04 |
| `verify-local-storage.mts` | — | 2026-08-11 |
| `verify-scope-bar.mjs` | — | 2026-08-23 |
| `verify-scope-end-to-end.mjs` | — | 2026-08-23 |
| `verify-scoped-gates.mjs` | — | 2026-08-23 |
| `verify-scoped-review.mjs` | — | 2026-08-23 |
| `verify-storage-server.mts` | — | 2026-08-11 |
| `verify-studio-voice.mts` | — | 2026-08-23 |

## UNREFERENCED — 86

Nothing references it and it holds no dead identifier. It may still work — nobody knows. **Needs a call.**

| script | rot | touched |
|---|---|---|
| `backfill-corpus-verbatim.mts` | — | 2026-08-19 |
| `build-doc-guide.mjs` | — | 2026-08-11 |
| `demo-atoms-ui.mjs` | — | 2026-07-20 |
| `drive-b1-auto-advance.mts` | — | 2026-08-15 |
| `drive-box-pdf.mts` | — | 2026-08-11 |
| `drive-box-upload.mts` | — | 2026-08-11 |
| `drive-box2-suggest.mts` | — | 2026-08-11 |
| `drive-box3-nudge.mts` | — | 2026-08-11 |
| `drive-enrich-prod.mts` | — | 2026-08-11 |
| `drive-f1-fluid.mts` | — | 2026-08-10 |
| `drive-f2-annotate.mts` | — | 2026-08-11 |
| `drive-immobileyes.mts` | — | 2026-07-19 |
| `drive-leakage.mts` | — | 2026-08-11 |
| `drive-librarian-review.mts` | — | 2026-08-11 |
| `drive-library-review.mts` | — | 2026-08-11 |
| `drive-navair-draft-proof.mts` | — | 2026-07-20 |
| `drive-navair-faithful-bd.mts` | — | 2026-07-20 |
| `drive-navair-faithful.mts` | — | 2026-07-20 |
| `drive-preview-atomize.mts` | — | 2026-08-11 |
| `drive-sheet-numfmt.mts` | — | 2026-08-11 |
| `drive-sheet-style.mts` | — | 2026-08-11 |
| `drive-slides-frame.mts` | — | 2026-08-10 |
| `drive-tw8c-gate-close.mts` | — | 2026-08-15 |
| `dsip-plan-check.mts` | — | 2026-08-18 |
| `gen-immobileyes-seed.mts` | — | 2026-08-18 |
| `immo-ingest-drive.mts` | — | 2026-08-18 |
| `inventory-scripts.mjs` | — | — |
| `j1-cold-start.mjs` | — | 2026-08-20 |
| `make-dsip-fixture.mts` | — | 2026-08-18 |
| `measure-volumes.mts` | — | 2026-08-19 |
| `mirage-ingest.mts` | — | 2026-08-19 |
| `probe-bucket-merge.mjs` | — | 2026-08-20 |
| `probe-comp-codes.mjs` | — | 2026-08-20 |
| `probe-disposition-ui.mjs` | — | 2026-08-20 |
| `probe-node-vocabulary.mts` | — | 2026-08-23 |
| `probe-partner-multi.mjs` | — | 2026-08-20 |
| `probe-portal-forms.mjs` | — | 2026-08-20 |
| `probe-preview-download.mjs` | — | 2026-08-20 |
| `probe-provision-elsewhere.mts` | — | 2026-08-20 |
| `probe-review-and-land.mjs` | — | 2026-08-20 |
| `repair-card-dates.mts` | — | 2026-08-20 |
| `repair-section-page-caps.mts` | — | 2026-08-19 |
| `repair-truncated-source-text.mts` | — | 2026-08-20 |
| `seed-demo-automation.mts` | — | 2026-07-19 |
| `seed-followon-guides.mts` | — | 2026-08-19 |
| `seed-house-library.mts` | — | 2026-07-23 |
| `seed-librarian-catalog.mjs` | — | 2026-08-11 |
| `seed-review-junk.mjs` | — | 2026-08-11 |
| `seed-scout-candidates.mts` | — | 2026-08-13 |
| `seed-sheet-doc.mts` | — | 2026-08-11 |
| `seed-slide-deck.mts` | — | 2026-08-10 |
| `setup-tw11-browser-portal.mts` | — | 2026-08-15 |
| `shoot-immobileyes.mjs` | — | 2026-07-20 |
| `shot-content-queue.mjs` | — | 2026-08-21 |
| `shot-doc.mts` | — | 2026-08-11 |
| `shot-scout-intake.mjs` | — | 2026-08-21 |
| `shot-workflow-setup.mjs` | — | 2026-08-15 |
| `t3cp-agent-config.mjs` | — | 2026-08-21 |
| `t3cp-archive-atoms.mjs` | — | 2026-08-19 |
| `t3cp-archive-goldstandard.mjs` | — | 2026-08-19 |
| `t3cp-attach-docs.mjs` | — | 2026-08-19 |
| `t3cp-color-team.mjs` | — | 2026-08-19 |
| `t3cp-fulldraft.mjs` | — | 2026-08-19 |
| `t3cp-ingest.mts` | — | 2026-08-21 |
| `t3cp-lock-and-package.mjs` | — | 2026-08-19 |
| `t3cp-reatomize.mjs` | — | 2026-08-19 |
| `t3cp-reset-build.sh` | — | 2026-08-19 |
| `t3cp-restore-sections.mjs` | — | 2026-08-19 |
| `tier2-documents-e2e.mts` | — | 2026-07-19 |
| `ux-capture-supp.mjs` | — | 2026-08-13 |
| `ux-capture.mjs` | — | 2026-08-21 |
| `ux-nav-proof.mjs` | — | 2026-08-13 |
| `ux-ops-proof.mjs` | — | 2026-08-21 |
| `ux-polish2-proof.mjs` | — | 2026-08-13 |
| `ux-polish3-proof.mjs` | — | 2026-08-13 |
| `verify-assembled-flow.mts` | — | 2026-07-19 |
| `verify-atom-enrich.mts` | — | 2026-08-11 |
| `verify-capture-backend.mts` | — | 2026-08-11 |
| `verify-insert-fidelity.mts` | — | 2026-08-11 |
| `verify-library-soundness.mts` | — | 2026-08-11 |
| `verify-media-export.mts` | — | 2026-08-11 |
| `verify-mt1-compliance.mts` | — | 2026-08-22 |
| `verify-pptx-tables.mts` | — | 2026-08-11 |
| `verify-ruler-composition.mts` | — | 2026-08-23 |
| `verify-studio-voice-route.mjs` | — | 2026-08-23 |
| `verify-unextractable.mts` | — | 2026-08-11 |

## CANNOT-RUN — 41

Nothing references it AND it drives an identifier the database no longer has. It cannot do what it says. **Needs a call.**

| script | rot | touched |
|---|---|---|
| `capture-admin.mjs` | 4 | 2026-08-21 |
| `capture-library.mjs` | 1 | 2026-07-25 |
| `capture-tenant.mjs` | 5 | 2026-07-20 |
| `drive-capture.mts` | 1 | 2026-07-21 |
| `drive-navair-business-case.mts` | 5 | 2026-07-21 |
| `drive-vault-collab-surface.mts` | 2 | 2026-07-25 |
| `drive-vault-content.mts` | 2 | 2026-07-25 |
| `drive-vault-leak.mts` | 2 | 2026-07-25 |
| `immo-admin-master.mts` | 2 | 2026-08-21 |
| `immo-author.mts` | 1 | 2026-08-19 |
| `immo-card-fix.mts` | 1 | 2026-08-19 |
| `immo-cost.mts` | 1 | 2026-08-19 |
| `immo-export-all.mts` | 2 | 2026-08-19 |
| `immo-figs-cost.mts` | 1 | 2026-08-19 |
| `immo-finalize3.mts` | 1 | 2026-08-19 |
| `immo-opp-caption-fix.mts` | 2 | 2026-08-19 |
| `immo-purchase-release.mts` | 1 | 2026-08-21 |
| `immo-recost.mts` | 1 | 2026-08-19 |
| `immo-sow-cost-fix.mts` | 1 | 2026-08-19 |
| `immo-volumes.mts` | 7 | 2026-08-19 |
| `inspect-rls-pages.mjs` | 1 | 2026-07-25 |
| `j1b-new-customer.mjs` | 1 | 2026-08-20 |
| `probe-mobile-overflow.mjs` | 1 | 2026-08-20 |
| `rm-option-item.mjs` | 1 | 2026-08-21 |
| `seed-demo-atoms.mts` | 2 | 2026-07-19 |
| `seed-demo-processes.mts` | 1 | 2026-07-19 |
| `seed-demo-scouts.mts` | 2 | 2026-07-19 |
| `seed-demo-tasks.mts` | 1 | 2026-07-19 |
| `seed-house-artifacts.mts` | 1 | 2026-07-23 |
| `shot-capture-tab.mjs` | 1 | 2026-07-21 |
| `shots-deeplink.mts` | 1 | 2026-07-19 |
| `t3cp-buildout.mts` | 1 | 2026-08-21 |
| `t3cp-compliance.mts` | 1 | 2026-08-21 |
| `t3cp-curate-push.mts` | 1 | 2026-08-21 |
| `t3cp-section-draft.mts` | 1 | 2026-08-19 |
| `t3cp-upload.mts` | 1 | 2026-08-21 |
| `t3cp-volumes.mts` | 1 | 2026-08-19 |
| `verify-readiness-deadline.mts` | 1 | 2026-08-12 |
| `verify-readiness-docs.mts` | 1 | 2026-08-12 |
| `verify-readiness-format.mts` | 1 | 2026-08-12 |
| `verify-shred-audit.mts` | 1 | 2026-08-12 |

---

## ⚠ Documented but rotted — 12

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
| `drive-item-template-picker.mts` | 1 | 2026-07-19 |
| `drive-past-proposal-templify.mts` | 1 | 2026-07-19 |
| `drive-remaining-cohorts.mts` | 1 | 2026-08-14 |
| `hitl-setup.mts` | 1 | 2026-07-19 |
| `monday-journey-e2e.mts` | 1 | 2026-07-19 |
| `probe-build-or-mark.mjs` | 1 | 2026-08-20 |
| `seed-cuas-immobileyes.mts` | 1 | 2026-08-18 |

---

## Totals

| class | count |
|---|---|
| SUITE | 27 |
| LENS | 4 |
| CROSS-CHECK | 2 |
| RULER | 7 |
| LIBRARY | 5 |
| CALLED-BY-ANOTHER | 15 |
| NPM-WIRED | 1 |
| DOCUMENTED | 63 |
| UNREFERENCED | 86 |
| CANNOT-RUN | 41 |
| **total** | **251** |
