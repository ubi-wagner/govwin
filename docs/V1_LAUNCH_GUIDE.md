# V1 Launch Guide — features, by actor (screenshot-mapped)

The as-built V1 surface, verified end-to-end on build `EIHMKFP62qwSslLPKG8B3` (tsc 0 · vitest 855 ·
next build ✓ · migrations 148). Screenshots referenced live in the session scratchpad (arch_*.png,
act_*.png); regenerate with `_drive_archive.mjs` / `_drive_actors.mjs`.

## Tenant admin (customer — e.g. Kate @ Foundation)
- **Cockpit / dashboard** — live indicator rail (ToDos, opportunities, library, activity). `act_tadmin_dashboard`
- **Opportunity pipeline** (`/cards`) — ranked cards (pinned → score → recency), origin/compliance/**Fit** (bucket + score, M2). No card archive (not an archive target). `act_tadmin_cards`
- **Proposals list** — active + a collapsible **Archived (N)** section (Restore / Export; never Delete). `arch_2_archived_list`
- **Proposal workspace** (`act_tadmin_proposal`):
  - **Proposal Studio** — the recommended front door: 3 gated loops (Draft → Refine → Compliance), comment+regenerate or approve→next, or "Run all 3 automatically" (H5).
  - **Archive portal** — archives the whole build; its workflow instances cascade with it; reversible. (Admin only.)
  - **AI Actions** (admin panel → AI tab) — Draft with AI · **AI Review** (real color-team, posts `ai_review` comments, H3) · Run full draft Mode A/B/C.
  - **Compliance tab** — AI Compliance Check + **Submission Package** card (readiness + AI packaging review, M1).
  - **Amendment banner** — self-hiding; shows a confirmed amendment's compliance delta + Acknowledge (M3).
- **Atom library** (`/atoms`) — browse/curate; per-atom **Archive** = excluded from library + draft selection until restored (atoms are copied-forward, so archiving breaks nothing). `act_tadmin_atoms`

## RFP admin / master admin (platform)
- **Workflow Monitor** (`/admin/workflows`, `act_admin_workflows`) — instance tracking; **Generate Content** launcher (content_generator vertical, live) + **Launch Review Gate** (HITL ProjectCollaboration). Cascade-archived workflow instances drop out (no standalone archive — they follow their pipeline/tenant).
- **RFP Curation** (`act_admin_curation`) — **Ingest Assist** + **🩺 Assess readiness** (rfp_ingest_manager deterministic stage readout, H4) + **Amendments** panel (log → confirm → fan-out to tenants, M3).
- **Agent Workforce** (`/admin/agents`, `act_admin_agents`) — 36 archetypes with live/wired/dormant + per-tenant usage; content_generator now **live**.
- **Opportunity Rollup** (`/admin/opportunities`) — per-opp pipeline: building / final / submitted / archived / **contract** counts.
- **Tenants** — archive a tenant (license slumber) → revokes access + cascades its workflow instances; restore renews.
- **Proposal Auto-Drive doorbell** (`/admin/agents`) — drive a tenant's full draft or Studio phases from up top.

## Tenant user (scoped)
- Sees the portal but **no admin controls** — no Proposal Studio, no Archive portal, no AI-actions panel (verified boundary). `act_tuser_proposal`

## Partner user (stage-scoped)
- Access only to the proposal sections they were granted; excluded from the notification bell + admin surfaces.

## The archive model (V1)
Archive = **soft, reversible, sort/visibility only. Nothing is ever deleted** (future: S3 cold-storage
by watermark). Archive actions exist on **three entities only**: portals (→cascade workflows),
library atoms/foundational docs (per-item, excluded from selection), tenants (→cascade workflows).
Workflows are instantiated templates — they archive by cascade, never on their own. See
docs/ARCHIVABLE_CONTRACT.md.
