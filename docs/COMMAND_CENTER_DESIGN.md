# Command Center — design spec (LOCKED 2026-08-14)

The single mobile-first, **tabbed, count-badged** review console — "what needs me → act" in one place.
**One component, reused verbatim across three roles**; the role decides which tabs appear, what each
lane sources, which action buttons show, and where "descend" goes. Counts badge each tab like unread
email, so a number ticking up = new work, knowable at a glance.

Grounded in three code reviews (role/shadow-descent, ToDo taxonomy + scoping, reuse/badge patterns).
Visual: `docs/command-center-mockup.html` (interactive role switcher). Front door already shipped:
`/admin/command` (v1, non-tabbed — this spec is the tabbed evolution).

---

## 1. Architecture

**One client component** `components/command/command-center.tsx`:
- `<CommandCenter role scope tabs />` renders `ui/tabs.tsx` (segmented control; `TabDef.label` accepts a
  React node → embeds the count badge) inside the page (mobile) / a `Modal`/`Drawer` shell (as a pop-over).
- Each tab body is **either** a `<TaskQueue apiBase taskTypes>` (todo lanes) **or** a review-list fed
  `tab.items` (opportunity/system lanes).
- A per-(role × tab) **action row** of quick-action chips sits above each list.

**Three sibling data functions** returning one common shape (the roles read *different tables*, so this
is a dispatcher, not one filtered query):
```ts
type CommandScope =
  | { kind: 'admin' }                                    // rfp_admin / master_admin — all tenants
  | { kind: 'partner'; userId: string }                  // partner_admin — owned ∪ managed stable
  | { kind: 'tenant'; tenantId: string; tenantSlug: string }; // tenant_admin — own tenant

getCommandQueue(scope): Promise<{ tabs: CommandTab[] }>
interface CommandTab { key; label; tone:'action'|'shadow'|'progress'|'info'; count; actions: QuickAction[]; body }
interface QuickAction { label; icon; href?; onClick?: 'compose'|'descendPicker'|'addCompany' }
```

**Pool discipline** (RLS-cutover safe, docs/RLS_CUTOVER.md): admin/partner cross-tenant reads →
`sqlBypass`/`enterBypass`; tenant reads → `sql` + `enterTenant(tenantId)`.

**Reuse as-is** (nothing to build): `ui/tabs.tsx`, `Modal`/`Drawer`, the `IndicatorRail` badge pill →
extract `<CountBadge n>`, `TaskQueue` (+ a ~4-line `taskTypes?` filter prop), `partnerScopeTenants` +
`tenantRollupStats` (partner scope + counts), `listOpenTasksForActor` + both task routes,
`listCandidates` + the curated/amendment count queries, `enterHref` / `/api/partner/enter`, `assign-task-form`
(compose a to-do), `add-company-flow`.

**Rank quirk (non-negotiable):** `partner_admin` = rank **50**, *below* `tenant_admin` **60**. So
`hasRoleAtLeast(partner_admin,'tenant_admin')` is **false**. Branch on `role === 'partner_admin'`, never on
a rank comparison, when selecting the partner lanes/descent.

---

## 2. The four semantic lanes

| Lane | Meaning | Tone/color |
|---|---|---|
| **Opportunities** | the discovery→release pipeline (or, for tenant/partner, their live cards & proposals) | amber (action) |
| **Admin** | platform/our-org actions only RFP admin can take | amber (action) |
| **Tenant-surfaced** | workflow to-dos assigned *inside* a tenant — act by **descending** | violet (shadow) |
| **System** | infra / automation / monitors | grey/blue (info) |

The count on each tab = **open items in that lane**. `actionable` (the header/bell number) = Σ of the
action-tone tabs.

---

## 3. Role × Tab matrix — exactly what each tab shows

### 3.1 RFP admin / master admin (rank 80 — **shadow**, all tenants)  → tabs: Opportunities · Admin · Tenant-surfaced · System

| Tab | Purpose | Data source | Count = | Row → |
|---|---|---|---|---|
| **Opportunities** | the review→release pipeline | `getReviewQueue()` (scout_findings new/reviewed + curated_solicitations by state + solicitation_amendments detected) — the shipped v1 aggregator | # awaiting a decision (approve+release+amendments+scout+claim) | `/admin/rfp-curation/[solId]` (or `/admin/scouts`) |
| **Admin** | platform actions | `/api/admin/tasks` admin bucket: `admin_review`, `content_publish`, `application_triage`, `partner_registration_triage` (assignee_role IN rfp_admin/master_admin, cross-tenant via bypass) | # open admin tasks | Content Studio / Applications / entity |
| **Tenant-surfaced** | tenants' workflow to-dos | **NEW** cross-tenant query: `tasks WHERE tenant_id IS NOT NULL AND assignee_role IN ('tenant_admin','tenant_user','partner_user') AND status IN ('open','in_progress')` on the bypass pool, joined to tenant slug + entity. All tenants. | # open tenant to-dos | **Descend** → `/portal/[slug]/[entity]` (shadow) |
| **System** | monitors & automation alerts | automation-produced rows (`params.automated=true`) + (new) failed-workflow alerts; `system_events` health | # alerts | `/admin/workflows` etc. |

### 3.2 EconDev partner-manager (`partner_admin`, rank 50 — **pin-up**, owned ∪ managed stable)  → tabs: Opportunities · Companies (tenant-surfaced)

| Tab | Purpose | Data source | Count = | Row → |
|---|---|---|---|---|
| **Opportunities** | live pipeline across the stable | `tenant_opportunity_cards` (pins) + `proposals` for `partnerScopeTenants(userId)` ids, via bypass scoped to those ids | # active pins/proposals needing attention | descend into that company |
| **Companies** (tenant-surfaced) | **the core lane** — every company's open to-dos | `Σ tenantRollupStats(scopeIds).openTodos` (the exact partner-console count) | # open to-dos across the stable | **Descend** → `/api/partner/enter?slug&next=…` (pin-up, navy banner) |

*(No Admin/System tabs — rank 50 has no `/admin` reach. Optional future "Requests" tab = pending
`manager_request` handshakes + registration status.)*

### 3.3 Tenant admin (`tenant_admin`, rank 60 — own tenant)  → tabs: Opportunities · To-dos · Workflows · Activity

**Descended RFP-admins (shadow) and partner-managers (pin-up) see this SAME tenant view** — the descended
session is the tenant portal — so these tabs serve them too. **Activity is admin-only** (`tenant_admin+`),
so a `tenant_user` never sees it; rfp_admin passes by rank, a descended partner passes as the pinned
`tenant_admin`.

| Tab | Purpose | Data source | Count = | Row → |
|---|---|---|---|---|
| **Opportunities** | own spotlight + proposals | own `tenant_opportunity_cards` (pins) + active `proposals`, `sql`+`enterTenant` | # cards to act on + proposals in flight | `/portal/[slug]/cards` or `/proposals/[id]` |
| **To-dos** | own workflow to-dos | `/api/portal/[slug]/tasks` (tenant branch — the shipped TaskQueue) | # open to-dos | `/portal/[slug]/[entity]` |
| **Workflows** | live pipeline instances | `process_instances WHERE tenant_id=$t AND archived_at IS NULL AND status IN ('running','paused','pending','retrying')`, `sql`+`enterTenant`. **Reuse `<ProcessesClient>` + `classifyProcessHealth` (the shipped `/portal/[slug]/processes`).** | # active instances (mostly the **paused HITL gates** = the actionable ones — do NOT filter to `running`-only or it reads empty) | per-instance step timeline; tenant_admin **"Move to next gate"** (`forceAdvanceProcess`, `canForceAdvanceInstance`) |
| **Activity** (admin-only) | tenant system events | `system_events WHERE tenant_id=$t ORDER BY created_at DESC LIMIT 200`. **Reuse the Activity Stream (`/portal/[slug]/activity`).** Tighten visibility `tenant_user → tenant_admin+` in **3 spots** (nav `layout.tsx`, page guard `activity/page.tsx`, cockpit indicator `cockpit.tsx`). | recent-count (no unread state today) | filterable timeline — invites (`collaborator.invited`/`team_member.invited`), member-adds, lifecycle |

*(No Admin / System-monitor tabs — those are the RFP-admin cross-tenant console. The tenant sees only its own pipeline + activity.)*

---

## 4. Action buttons — exactly what each does, per role × tab

Every button = a *create/do/jump* verb for that lane. All map to existing routes/components.

### RFP admin
| Tab | Buttons → action |
|---|---|
| Opportunities | 📤 **Upload RFP** → `/admin/rfp-curation/upload` · ➕ **New intake** → `/admin/intake` · 🔭 **Scout** → `/admin/sources` · 📋 **Triage** → `/admin/rfp-curation` |
| Admin | 👤 **Applications** → `/admin/applications` · 🤝 **Partner requests** → partner-registration triage · ✍️ **Content Studio** → `/admin/site` · 🎁 **Comp a portal** → release a build free (`/admin/purchases` / rfp-curation release) |
| Tenant-surfaced | 📨 **Send a to-do** → compose modal (`assign-task-form`, broadcast/delegated to a chosen tenant) · 🏢 **Jump to company** → tenant descend picker |
| System | 🔀 **Workflows** → `/admin/workflows` · ⚙️ **Automation** → `/admin/automation` · 📡 **Events** → `/admin/events` · ❤️ **Health** → `/admin/system` *(jump-to-monitor, not create)* |

### EconDev partner-manager
| Tab | Buttons → action |
|---|---|
| Opportunities | 🏢 **My companies** → `/partner` console · 🔍 **Spotlight** → stable-wide opportunity view |
| Companies | 📨 **Send a to-do** → compose to a company · ➕ **Add company** → `add-company-flow` (manager-request handshake / RFP-admin approval) · 🏢 **Jump to company** → `/api/partner/enter` picker |

### Tenant admin
| Tab | Buttons → action |
|---|---|
| Opportunities | 🔍 **Browse spotlight** → `/portal/[slug]/cards` · ➕ **New proposal** → buy/provision from a pinned card |
| To-dos | 📨 **Send a to-do** → compose to my team (`assign-task-form`) · 👥 **Invite teammate** → team invite |
| Workflows | 📝 **Run full draft** → `POST …/proposals/[p]/full-draft` (mode a/b/c) · 🎬 **Run Studio** → `POST …/proposals/[p]/studio` (`auto` = all 3 loops) · 📨 **Create a to-do** → `assign-task-form`. *(Real per-proposal starts only — a generic template-launcher is admin-only and NOT exposed to tenants, per the locked decision.)* |
| Activity | 🔎 **Filter** (namespace) · 📅 **Time range** — read-only feed; reuse the Activity Stream's own controls |

---

## 5. Descend-to-act mechanics (the tenant-surfaced lane)

Two mechanisms, chosen by role — the console link is **navigational only**; the act happens *inside* the
tenant (completion never happens at the console). `completeTask`'s existing dual authority
(admin-anywhere / tenant_admin-own-tenant) is reused unchanged.

- **RFP admin → SHADOW.** Row links straight to `/portal/[slug]/[entityPath]`. `verifyTenantAccess` waves
  the admin through; the amber **ShadowSpaceBanner** ("Return to platform ↑") appears automatically;
  descent/ascent audited via `/api/admin/shadow-transition` (`identity:shadow.*`). Session role unchanged.
- **Partner-manager → PIN-UP.** Row links to `/api/partner/enter?slug=X&next=…`, which pins the session to
  `tenant_admin` (scope-gated by `partnerCanEnter`), lands in the portal with the navy **"Exit to partner
  console →"** bar, and ascends via `/api/partner/exit`. Emits `finder:partner.entered/.exited`.

**One required code change:** widen `/api/partner/enter`'s `next` whitelist (today `{todos,dashboard,
proposals,cards,manage}`) so a partner can descend to a **specific entity** (not just the to-do list) —
add a whitelisted `entity`/`entityId` param the route composes into the landing path. Admins already get
entity depth from plain portal links.

---

## 6. Counts & badges

- **v1 = open-count.** Each tab count computed server-side (`safeCount`-style / `tenantRollupStats`),
  `::int` cast (postgres.js int8→string). Badge chip = extracted `<CountBadge n>` (renders only when
  `n>0`, caps `99+`).
- **Badge/body agreement:** drive the badge from the same source the body renders (an `onCount` callback
  from `TaskQueue`) so the number never lies.
- **Live feel:** a thin `GET …/command/counts` per scope, polled 30–60s (mirrors TaskQueue's self-poll).
- **Future (optional) "new since you looked":** true unread requires a per-user, per-tab **last-seen
  watermark** — `notification_read_state` is per-(user,tenant) only, no platform/partner variant today,
  so this is a small separate add (a `command_seen_state` table). v1 ships without it.

---

## 7. Build phases (each shippable, green, committed)

1. **RFP-admin tabbed Command Center** — evolve `/admin/command` into the 4 tabs + count badges + action
   rows + the **new tenant-surfaced/descend** query & tab. Highest daily value. (`getReviewQueue` stays for
   the Opportunities tab; add the admin-tasks, tenant-surfaced, and system tab sources.)
2. **Extract `<CommandCenter>`** + mount for **tenant admin** — tabs Opportunities · To-dos · **Workflows**
   (reuse `<ProcessesClient>` / the shipped `/portal/[slug]/processes`; Start = Run full draft + Run Studio;
   Create a to-do) · **Activity** (reuse the Activity Stream + tighten its visibility `tenant_user →
   tenant_admin+`). Descended rfp-admins/partner-managers inherit this view. The Activity gate-tighten is a
   small standalone security fix (a `tenant_user` should not see the full activity firehose) worth shipping
   regardless of the Command Center.
3. **Partner-manager mount** over the managed stable (`partnerScopeTenants` + `tenantRollupStats`); widen
   `/api/partner/enter` `next` for entity descent.
4. *(optional)* the unread watermark + failed-workflow→to-do hook feeding the System lane.

---

## 8. Invariants / gotchas (carry into the build)

1. **partner_admin(50) < tenant_admin(60)** — branch on `role`, never rank.
2. **Pool discipline** — admin/partner cross-tenant → `sqlBypass`/`enterBypass`; tenant → `sql`+`enterTenant`.
3. **camelCase result trap** — any new `sql<typeof rows>` declares fields camelCase (runtime transform).
4. **Counts `::int`** — postgres.js returns int8 as string.
5. **Badge/body agreement** — count from the same source as the rendered body (`onCount`).
6. **Completion-in-tenant-only** — the console descends & lands; it never completes cross-tenant.
7. **No platform read-state** today — open-count for v1; unread watermark is a later add.
8. **`taskType` vs `agent_task_queue`** — the Command Center reads the `tasks` ledger ONLY; exclude the
   `agent_task_queue` types (review_section/package_review/seed_*/etc. — those are agent jobs, not ToDos).

---

## 9. Task-type → tab bucketing (the `tasks` ledger)

- **Opportunities**: `triage_new_opportunities`, `source_review`, `proposal_setup`, `curation_release`.
- **Admin**: `admin_review`, `content_publish`, `application_triage`, `partner_registration_triage`.
- **Tenant-surfaced (shadow)**: `review_section`, `proposal_build`, `review`, the 4 full-draft reviews
  (`proposal_draft_stage_review`/`proposal_style_lock_review`/`proposal_full_draft_review`/
  `advisory_overlay_review`), `proposal_review`, `contract_kickoff`, `vault_artifact_review`,
  `starter_set_offer`, `final_due`, `complete_sections`/`upload_documents`/`acknowledge`, `delegated_task`,
  tenant `broadcast`/`thread`.
- **System**: automation `broadcast`/`admin_review` where `params.automated=true`; failed-workflow alerts (new).
- **Flags:** `proposal_setup` + create-route `admin_review` are tenant-scoped but admin-acted (no descent);
  `broadcast` is polymorphic (tenant chat → tenant-surfaced; admin notify → System); `manager_request`
  completes on the Team page (special completer) — surface it in the partner "Requests" lane, link out.
