# Deprecation + Bloat Cleanup (2026-07-22)

Second parallel hunt (after the UI-UX sweep) targeting the rot the migrations left behind:
retired-table reads, dead code, dead config, dead tables, unused deps, misleading docs.
Method: 4 read-only auditors (DB rot / frontend dead code / pipeline+CMS dead code /
markers+deps), then conservative triage — **drop only superseded-with-a-successor + zero
code refs; never "empty in the sandbox"** (most empty tables are live-but-unused).

Verified: `tsc` 0 · `vitest` 729 · migration applied through the real `migrate.mjs` runner.

## Live bugs fixed (retired-table reads that silently returned zero)
- **`services/cms/src/templates.py`** — the `matched_opportunities` email/CRM template
  variable counted the retired `tenant_pipeline_items` (via the CMS→main-DB bridge pool),
  so it was always `0`. Repointed to `tenant_opportunity_cards`.
- **`v_opportunity_rollup`** (admin Opportunity Rollup, `app/admin/opportunities`) counted
  `ranked_tenants`/`pinned_tenants` off `tenant_pipeline_items` → the whole rollup showed
  zeros. Migration 125 rebuilds the view on `tenant_opportunity_cards`. Verified live:
  `ranked_tenants` now populates (6 tenants on seeded opps).

## Schema — migration 125 (drop 12 dead tables + rebuild the view)
Superseded, zero live refs, dropped (+ their orphaned indexes, via CASCADE):
`tenant_pipeline_items`, `opportunity_events`, `customer_events`, `content_events`,
`pipeline_runs`, `proposal_reviews`, `solicitation_templates`, `tenant_uploads`,
`tenant_actions`, `legal_document_versions`, `system_config`, `collaborator_library_prefs`.
(Already handled earlier: the `library_units` family in mig 121; `solicitation_topics` in
030a/035.) Idempotent (`DROP … IF EXISTS … CASCADE`).

**Deliberately KEPT** (inert but risky/forward-looking — dropping to save zero bytes is a
bad trade): `verification_tokens` + `invitations` (NextAuth/invite surface),
`agent_archetypes` (the agent workforce — the automation phase is next),
`rate_limit_state` (code names it as a *future* target), `system_health_snapshots`
(monitoring). Empty ≠ dead.

## Dead code / config removed
- deleted the empty `pipeline/src/scoring/` package (vestige of the retired Python scorer)
- removed the dead `DEFAULT_CATEGORIES` constant + fixed the misleading module docstring on
  the retired `create_library_defaults` no-op (kept the no-op — it's a wired safe-skip)
- stripped the dead `STORAGE_ROOT` env from `docker-compose.yml` (pipeline + frontend),
  `Makefile`, `.env.example` (no code reads it; `CMS_STORAGE_ROOT` is a different, live var)

## Dependency bloat removed (frontend, all verified zero imports + zero config refs)
The entire **tiptap** stack (`@tiptap/{react,starter-kit,pm,extension-collaboration,
extension-highlight,extension-placeholder}`), **dnd-kit** (`@dnd-kit/{core,sortable,
utilities}`), `@tanstack/react-query`, `lucide-react`, `recharts`, `clsx`, `date-fns`,
`dom-serializer`, `domutils` — 16 packages. (The canvas editor + icons are custom.)

## Misleading docs fixed (engineers are pointed here)
- `docs/DB_SCHEMAS.md` — self-labeled "Authoritative" but frozen at mig 108 and listing
  dropped tables → added a strong ⚠ stale-snapshot banner (source of truth is `db/migrations/`).
- `docs/DEVELOPMENT_STANDARDS.md` — repointed the "authoritative architecture" ref from
  ARCHITECTURE_V9 to V10.

## Deferred (cataloged, low-value or needs a product decision — NOT rot that bites now)
- ~8 stale `// V1 TODO (P2-xx): Implement …` comment headers on routes that are already
  live (cosmetic).
- CMS python deps `google-auth-oauthlib` + `python-dotenv` (0 usage in CMS) — left because
  CMS runtime isn't verifiable here; low bloat.
- 3 orphaned pipeline modules reachable only by their tests — `content_crawler.py`
  (producer for dormant agents), `portal_provisioner.py` (superseded by the frontend
  release path), `shredder/sync_extract.py` (backs a frontend tool whose `/internal/shred/
  sync` HTTP endpoint isn't in-repo yet). **Pending-wiring for the automation phase** — a
  product decision, not a blind delete.
- Remaining doc nits: `docs/API_REFERENCE.md` endpoint table, `STORAGE_LAYOUT.md`,
  `CLAUDE_CLIFFNOTES.md §731` (tenant_pipeline_items.total_score) — minor, self-correcting.

The spines (opportunity_bridge → tenant_opportunity_cards, library_atoms, system_events
audit river) are now clean of retired-table reads end-to-end — which is exactly what makes
the automation layer a straightforward wiring job on top.
