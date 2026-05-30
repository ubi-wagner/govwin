# Process Flow Gaps — Remaining TODO

**Date:** 2026-05-29
**Source:** End-to-end code trace of all 10 process flows

## Fixed This Session

| # | Bug | Fix |
|---|-----|-----|
| 1 | Proposal advance workflows dead (phase mismatch) | Changed trigger to phase="end" |
| 2 | Duplicate welcome email on accept | Removed workflow email step |
| 3 | Content draft saves invisible | Added content.drafts_saved event |

## Remaining Gaps by Flow

### Flow 1: Ingestion
- [ ] **Triage row creation** — `_create_triage_row()` in `base.py` emits no event when curated_solicitations rows are created. Admin queue population is invisible.
- [ ] **Per-item failures** — Individual opportunity insert failures are logged but not emitted as events.

### Flow 4: Curation → Push
- [ ] **Intermediate curation states** — No events between claim and push (annotate, compliance check, outline edit). These happen via tool calls which emit tool events, but the curation-specific context is lost.

### Flow 6: Proposal Lifecycle  
- [ ] **No archive event** — `outcome/route.ts` sets stage='archived' but emits `outcome.recorded`, not `proposal.archived`. The lifecycle has no closing bookend.
- [ ] **Duplicate admin notification** — `proposals/create/route.ts` sends admin alert email inline AND fires OnProposalCreated which also notifies. Remove one.

### Flow 7: Content Pipeline
- [ ] **Discard action emits no event** — `page-blocks/route.ts` discard path has no event.
- [ ] **AI generation needs start/end** — Currently uses single events. Long operations (60s) should bracket.

### Flow 8: Email Pipeline
- [ ] **No event for email_send creation** — When an email is queued (status='pending_approval' or 'queued'), no event fires.
- [ ] **No event for permanent send failure** — After max retries, failure is only logged.
- [ ] **CMS-local events invisible** — CMS workers emit to a local event system, not shared system_events.

### Flow 9: Drip Campaign
- [ ] **No shared event for enrollment** — `_action_enroll_drip` creates enrollment rows but emits no shared event.
- [ ] **No shared event for completion** — Enrollment completion is CMS-local only.

### Flow 10: Collaborator Lifecycle
- [ ] **No acceptance event** — When an invited user accepts and first logs in, no event links back to the invitation.
- [ ] **No stage access change event** — Grant/revoke of stage permissions is silent.
- [ ] **No section assignment event** — Changes to assigned_sections are silent.
- [ ] **No collaborator removal event** — DELETE handler exists but removal has no event in some paths.

## Priority Order

1. Archive event (proposal lifecycle end bookend)
2. Duplicate admin notification dedup
3. Content discard event
4. Triage row creation event
5. Email creation event
6. Drip enrollment shared event
7. Collaborator acceptance event
8. Everything else
