# UX Touch Report — launch-readiness (2026-08-13)

An end-to-end UX drive of the live app in the sandbox: every primary surface walked as four
real actors (`tenant_admin` Kate/Foundation · `rfp_admin` Eric · `tenant_user` Connor · `partner`
Paul) at desktop (1440) and mobile (390) widths. Each surface captured a screenshot + HTTP status
+ console/page errors + load time; findings were read on-screen and **traced to the component**.
Visual report (screenshots inline): the published "govwin UX Touch Report" artifact.

**Method note.** Dev server, app in owner mode (matches current prod). Dev on-demand compile latency
is excluded from perf claims; the Next.js dev indicator and seed/sandbox data (no S3 imagery, AI inert
without a key) are excluded from findings. Harness: `frontend/scripts/ux-capture{,‑supp}.mjs`.

**Verdict.** Functional and feature-complete — 36/36 surfaces rendered, 0 crashes, data everywhere,
role-gating genuinely well built. Friction concentrates in information architecture (nav breadth +
duplication), polish (empty states, low-contrast gated buttons, one universal `<title>`), and two real
plumbing defects. Nothing blocks a demo; several things blur "frictionless."

## P1 — fix before launch

1. **Proposal cockpit stacks two independent tab-rows.** The authoring surface renders *All Sections /
   My Sections / Document / Timeline* directly above *Artifacts / Team & Access / Compliance / AI &
   Library / Library Seed* — 9 tabs, two axes, no hierarchy. `proposal-workspace.tsx:214` +
   `proposal-admin-panel.tsx:522`. → merge or visually subordinate the admin-panel tabs.
2. **Library page contradicts itself.** "Your library is empty" (`starter-catalog.tsx:61`) + "Browse
   library (0)" (`library-browser.tsx:70`) render above a working list of 23 atoms — two competing
   library browsers; the empty-state keys off *foundation templates*, not atoms. Several atomized
   titles are junk ("Slide 2 https://corporate.ford.com/…", "‹#› [Speaker Notes]"). → gate empty-state
   on total library count; collapse to one browser; sanitize atomized titles.
3. **Three overlapping tenant navigation systems.** 17 flat left-nav items
   (`app/portal/[tenantSlug]/layout.tsx:113`) + a Manage hub + a floating right-rail quick-card set,
   all pointing at overlapping destinations (Buckets reachable 3 ways). The admin nav is cleanly
   sectioned; the tenant side never got that. → section the tenant nav; make Manage the single setup
   entry; retire/re-scope the right-rail.
4. **RBAC contract mismatch — tenant_user proposal view 403s on `/gates`.** `StageControl` fetches
   `/gates` on mount for every role (`stage-control.tsx:55`); the route's non-admin branch requires a
   `proposal_collaborators` row (`gates/route.ts:106‑117`), which a tenant-wide member (Connor) lacks —
   contradicting the intent comment at `proposal-access.ts:84`. Swallowed (no visible break) but
   console/monitor noise on every open + the gate chip never loads for staff. **Verified live.** →
   honor `isTenantWideMember` in the route, or gate the client fetch.
5. **Admin "Launch Review Gate" demands hand-typed raw UUIDs.** Opportunity ID / Entity ref / Tenant ID
   as raw UUID inputs (`00000000‑…` placeholder), no picker — effectively uncompletable unaided. The
   29-workflow Map is also buried under "▼ show" beneath two creation forms on a page titled "Monitor".
   `app/admin/workflows/`. → entity pickers; move creation forms below the monitor.

## P2 — polish (works → frictionless)

6. **Gated primary buttons read as broken** — Buckets "Create", Intake "Stage into review queue" use a
   near-invisible disabled fill. Systemic; one shared disabled-button treatment.
7. **Every tab titled "RFP Pipeline"** — `app/layout.tsx:6`, no per-route override. → `title.template`
   + per-page `generateMetadata`.
8. **Dashboard duplicates the nav + wastes the lower ⅔** — right-rail restates left-nav items; empty
   below the build cards. → drop nav duplication; fill with deadlines/readiness/activity.
9. **Opportunity cards — ambiguous action funnel + jargon** — Pin/Purchase/Build same weight; "Pin
   (copy docs)" is insider vocabulary. → one primary action per state; rename to a user verb.
10. **Admin Agents page** — ~7,000px wall at tiny type; three panels stuck on "loading…" (usage-by-
    tenant, usage-summary, AI controls). → tab/collapse; real empty/skeleton states.
11. **Admin Dashboard** — "Your To-Dos" widget stuck loading (renders fine elsewhere → mount-fetch
    issue); "Recent Events" ~90% `identity.user.logged_in`. → harden fetch; filter event feed.
12. **Admin RFP Curation** — Agency column truncates to "Department of…"; four CMS content-review
    to-dos crowd out the triage queue. → widen/wrap agency; route content to-dos elsewhere.
13. **Company switching forces re-auth** — `/select-company` tells multi-company partners to sign out
    and back in. → in-session company switcher.
14. **"Welcome back, Foundation"** greets with the company, not the person. → greet by first name.
15. **A few components don't collapse on mobile** — shell + main card grid are responsive
    (`pipeline-cards.tsx:162` `grid-cols-1 md:2 xl:3`), but the dashboard right-rail quick-cards and
    the Studio 3 loop-cards stay cramped at 390px. → add responsive col classes / stack below `sm`.

## P3 — minor

- Profile subscription pill renders literal "none".
- Admin nav source split: hardcoded sidebar vs stale `admin-nav-data.ts` (feeds only the breadcrumb,
  omits 8 pages → mislabels e.g. Scouts vs "Scout Monitor").
- Admin breadcrumb dead `‹ ›` chrome on single-entry trails.
- Tenants page: two different-colored primary CTAs.

## Strengths (held up under scrutiny)

Role-gating (tenant_user view correctly reduced — Studio/AI/Archive/Advance/Lock hidden, verified in
code) · Opportunity cards (urgency coloring + bucket scores + responsive grid) · sectioned + consistent
admin nav · clean partner console · the Manage-hub lifecycle strip · admin Sources/Site with real empty
states · 36/36 rendered, no crashes.

## Investigated and dismissed (keeps the list trustworthy)

- The "N" bottom-left overlapping "Sign out" = **Next.js dev indicator** (dev-only; root layout mounts
  nothing there, no `devIndicators` in `next.config`). Not a bug.
- The notification **bell is a dropdown panel, not a dead link** (an earlier "dead link" read failed
  verification).
- Four 404s (`/notifications`, `/tasks`, `/purchases`, `/admin/tasks`) were **mis-targeted capture
  URLs** — real routes are the bell dropdown, `/todos`, `/billing`, the curation triage inbox.
- Slow first loads = dev compile. Empty profile fields / "by Claude" authorship / zero counters /
  missing imagery = seed/sandbox data.
