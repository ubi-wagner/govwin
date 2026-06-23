# Frontend Pages Inventory
Generated: 2026-06-23 | Scope: git ls-files frontend/app/**/page.tsx frontend/app/**/layout.tsx + config files

---

## Config Files

### frontend/middleware.ts
- **Public bypass list**: `/`, `/login`, `/about`, `/apply`, `/blog`, `/features`, `/pricing`, `/engine`, `/how-it-works`, `/infosec`, `/resources`, `/security`, `/team`, `/the-expert`, `/customers`, `/get-started`, `/value`, `/legal`, `/api/health`, `/api/waitlist`, `/api/content`, `/api/analytics`, `/api/stripe/webhook`, `/invite` (prefix-based); `/api/applications` (exact match only)
- **Static bypass**: `/_next`, `/api/auth`, `/favicon`, plus extension regex for ico/png/jpg/gif/svg/webp/avif/css/js/mjs/map/woff/ttf/otf/eot/txt/xml/json/webmanifest
- **Rate limits**: `/api/applications` (5/15 min), `/api/auth/forgot-password` (5/15 min), `/api/auth/reset-password` (5/15 min), `/api/waitlist` (5/15 min), `/api/auth/*` general (20/15 min)
- **Role-by-path gating** (via `requiredRoleForPath`): `/admin/system` → master_admin; `/api/admin/system` → master_admin; `/admin` → rfp_admin; `/api/admin` → rfp_admin; `/portal` → partner_user; `/api/portal` → partner_user; `/dashboard` → tenant_user
- **Temp password enforcement**: forces /change-password for any user with `tempPassword=true`; returns 403 on API routes
- **Session strategy**: NextAuth v5 JWT/JWE, edge-safe via `auth.config.ts` split (no DB/bcrypt in edge runtime)
- **Unauthenticated handling**: HTML → redirect /login?from=<path>; API → 401 JSON

### frontend/auth.ts
- Full Node runtime; imports Credentials provider + bcrypt + lib/db
- On successful login: touches `users.last_login_at`, inserts `identity.user.logged_in` event
- On failed login: inserts `identity.user.login_failed` event
- JWT carries: id, role, tenantId, tenantSlug, tempPassword
- Session max age: 8 hours

### frontend/auth.config.ts
- Edge-safe; JWT + session callbacks only; no providers
- Exposes: id, role, tenantId, tenantSlug, tempPassword on session.user

### frontend/next.config.mjs
- output: standalone
- serverExternalPackages: postgres, bcryptjs, mammoth, pdf-parse, pdfjs-dist, @napi-rs/canvas, googleapis
- Server Actions bodySizeLimit: 50MB
- Security headers: X-Frame-Options SAMEORIGIN, X-Content-Type-Options nosniff, HSTS 1yr, CSP (`unsafe-inline`/`unsafe-eval` in script-src, api.anthropic.com + api.stripe.com in connect-src)
- Redirect: /blog → /resources (permanent)

### frontend/tailwind.config.ts
- Custom colors: brand (coral/red), navy (dark ink), award (green), citrus (gold), cream (warm light)
- Fonts: display (Inter), prose (Georgia)
- Content paths: app/**, components/**, lib/**

### frontend/tsconfig.json
- strict: true, noEmit: true, moduleResolution: bundler, incremental: true
- Paths alias: @/* → ./*
- Excludes: node_modules, __tests__, e2e, *.test.ts, *.spec.ts

### frontend/package.json
- Next 15.5.14, React 19.2.4, NextAuth 5.0.0-beta.25, postgres 3.4.3
- Key deps: @anthropic-ai/sdk 0.91.1, @aws-sdk/client-s3 3.1026.0, stripe 17.0.0, @tiptap/react 3.22.4, recharts 2.15.4, zod 4.3.6, googleapis 171.4.0
- Scripts: dev/build/start/lint/type-check, test (vitest), test:integration, test:e2e (playwright)

---

## Layouts

### /admin/* (file: frontend/app/admin/layout.tsx)
- Use: Admin shell — navy sidebar with nav sections for Overview, Opportunities, Customers, Content, System, CRM
- Render: server (no 'use client')
- Guard: middleware-only (rfp_admin via PATH_MIN_ROLE); no auth() call in layout itself
- Data: none (sidebar is static nav links)
- Renders: AdminNavLink components; links to /admin/dashboard, /admin/rfp-curation, /admin/sources, /admin/pipeline, /admin/templates, /admin/applications, /admin/tenants, /admin/billing, /admin/waitlist, /admin/purchases, /admin/proposals, /admin/site, /admin/documents, /admin/storage, /admin/system-state, /admin/events, /admin/agents, /admin/automation, /admin/process, /admin/workflows, /admin/processes, /admin/system, /admin/analytics, /admin/crm
- Status: ✅active

### /portal/[tenantSlug]/* (file: frontend/app/portal/[tenantSlug]/layout.tsx)
- Use: Portal shell — verifies tenant membership; renders navy sidebar with tenant-scoped nav
- Render: server
- Guard: auth() → role check → getTenantBySlug → verifyTenantAccess → redirects /portal on failure; partner_user sees only Proposals + Settings
- Data: tenants (via getTenantBySlug), users (verifyTenantAccess)
- Renders: PortalNavLink, SignOutButton, NotificationBell; conditional nav (partner_user hides Dashboard/Spotlight/Pipeline/Library/Processes/Activity/Team/Documents/Billing)
- Status: ✅active

### /[marketing]/* (file: frontend/app/(marketing)/layout.tsx)
- Use: Marketing shell — nav header + footer + analytics tracker
- Render: server
- Guard: none (public)
- Data: site_content (page_content table via getSiteChrome — reads 'site-chrome' key for CMS-editable banner + nav)
- Renders: Wordmark, MobileMenu, Tracker, full nav with dropdown groups
- Status: ✅active

### /legal/* (file: frontend/app/(marketing)/legal/layout.tsx)
- Use: Legal sub-layout — centered container with nav links for Terms/Privacy/AUP/AI-Disclosure
- Render: server
- Guard: none (public)
- Data: none
- Renders: static nav + children
- Status: ✅active

---

## Auth Pages

### /login (file: frontend/app/(auth)/login/page.tsx)
- Use: Credentials login form with server action; redirects authenticated users to their landing path
- Render: server (login form uses server action `handleLogin`)
- Guard: if already authenticated → redirect to role landing; allows `error=session` to render form
- Data: none server-side (auth() session read only)
- Renders: inline login form (server action → `signIn('credentials', ...)` → redirects /portal or `from` param), error messages, links to /forgot-password
- Status: ✅active

### /change-password (file: frontend/app/(auth)/change-password/page.tsx)
- Use: Force password reset for tempPassword users; also available for voluntary change
- Render: server
- Guard: auth() → redirect /login if unauthenticated
- Data: none (reads tempPassword from session)
- Renders: ChangePasswordForm (client component)
- Status: ✅active

### /forgot-password (file: frontend/app/(auth)/forgot-password/page.tsx)
- Use: Email entry form for password reset link
- Render: client (`'use client'`)
- Guard: none (public)
- Data: POST /api/auth/forgot-password
- Renders: email input, loading/success/error states
- Status: ✅active

### /reset-password (file: frontend/app/(auth)/reset-password/page.tsx)
- Use: Password reset form (token + email from query params)
- Render: client (`'use client'`); uses Suspense wrapper for useSearchParams
- Guard: none (public, validated server-side via /api/auth/reset-password)
- Data: POST /api/auth/reset-password with token + email + password
- Renders: password/confirm inputs, invalid/success states
- Status: ✅active

---

## Marketing Pages

### / (file: frontend/app/(marketing)/page.tsx)
- Use: Landing page — hero, stats, value prop, pricing tiers, CTA
- Render: server (revalidate: 60s)
- Guard: none (public)
- Data: page_content table (key: 'homepage'), content_pages table (blog_post type, 3 records) via lib/cms
- Renders: RichText, CustomSections, inline JSX sections; falls back to hardcoded defaults if CMS empty
- Status: ✅active

### /about (file: frontend/app/(marketing)/about/page.tsx)
- Use: About page — company pillars, founder bio
- Render: server (revalidate: 60s)
- Guard: none (public)
- Data: page_content (key: 'about') via lib/cms
- Renders: RichText, CmsCard, CustomSections
- Status: ✅active

### /apply (file: frontend/app/(marketing)/apply/page.tsx)
- Use: Founding cohort application form
- Render: server (revalidate: 60s)
- Guard: none (public)
- Data: page_content (key: 'apply') via lib/cms
- Renders: ApplicationForm (client component), CustomSections
- Status: ✅active

### /blog/[slug] (file: frontend/app/(marketing)/blog/[slug]/page.tsx)
- Use: Permanent redirect → /resources/[slug]
- Render: server
- Guard: none (public)
- Data: none
- Renders: nothing (permanentRedirect only)
- Status: 🗑️deprecated-candidate (pure redirect shim; kept for backward compatibility after V8 blog→resources consolidation; no user-visible content — could be removed once all inbound links updated, but SEO value of 308 redirect argues for keeping)

### /customers (file: frontend/app/(marketing)/customers/page.tsx)
- Use: Track record / outcomes page
- Render: server (revalidate: 60s)
- Guard: none (public)
- Data: page_content (key: 'customers'), content_pages (type: team_member or outcome) via lib/cms
- Renders: RichText, CustomSections
- Status: ✅active

### /engine (file: frontend/app/(marketing)/engine/page.tsx)
- Use: Permanent redirect → /value
- Render: server
- Guard: none (public)
- Data: none
- Renders: nothing (redirect only)
- Status: 🗑️deprecated-candidate (redirect shim only; /engine fully absorbed into /value per V8 review; no content served; could remove route file and update any referencing links, but 302 vs 308 is a mild concern — uses `redirect()` not `permanentRedirect()`)

### /features (file: frontend/app/(marketing)/features/page.tsx)
- Use: Platform features overview
- Render: server (revalidate: 60s)
- Guard: none (public)
- Data: page_content (key: 'features') via lib/cms
- Renders: CmsCard, RichText, CustomSections; fallback to hardcoded feature list
- Status: ✅active

### /federal-rd-101 (file: frontend/app/(marketing)/federal-rd-101/page.tsx)
- Use: Education/explainer page for non-dilutive federal R&D funding
- Render: server (revalidate: 60s)
- Guard: none (public)
- Data: page_content (key: 'federal-rd-101') via lib/cms
- Renders: RichText, CustomSections, WaitlistForm, MarketingIcon
- Status: ✅active

### /get-started (file: frontend/app/(marketing)/get-started/page.tsx)
- Use: Redirect → /pricing
- Render: server
- Guard: none (public)
- Data: none
- Renders: nothing (redirect only)
- Status: 🗑️deprecated-candidate (redirect shim; uses `redirect()` not `permanentRedirect()`; if /get-started is linked in nav or external, a permanent redirect would be better; low risk to keep but could be cleaned)

### /how-it-works (file: frontend/app/(marketing)/how-it-works/page.tsx)
- Use: 6-stage workflow walkthrough
- Render: server (revalidate: 60s)
- Guard: none (public)
- Data: page_content (key: 'how-it-works') via lib/cms
- Renders: Hero, Section, SectionHeader, ProcessStep, FeatureGrid, CtaSection, RichText, CustomSections
- Status: ✅active

### /infosec (file: frontend/app/(marketing)/infosec/page.tsx)
- Use: Security and data isolation information page
- Render: server (revalidate: 60s)
- Guard: none (public)
- Data: page_content (key: 'infosec') via lib/cms
- Renders: RichText, CustomSections, MarketingIcon; HTML sanitizer applied to CMS content (strips scripts, on* handlers, javascript: URIs)
- Status: ✅active

### /legal/acceptable-use (file: frontend/app/(marketing)/legal/acceptable-use/page.tsx)
- Use: Static acceptable use policy (May 2026)
- Render: server
- Guard: none (public)
- Data: none (fully hardcoded)
- Renders: static HTML content
- Status: ✅active

### /legal/ai-disclosure (file: frontend/app/(marketing)/legal/ai-disclosure/page.tsx)
- Use: Static AI usage disclosure (May 2026)
- Render: server
- Guard: none (public)
- Data: none (fully hardcoded)
- Renders: static HTML content
- Status: ✅active

### /legal/privacy (file: frontend/app/(marketing)/legal/privacy/page.tsx)
- Use: Static privacy policy (May 2026)
- Render: server
- Guard: none (public)
- Data: none (fully hardcoded)
- Renders: static HTML content
- Status: ✅active

### /legal/terms (file: frontend/app/(marketing)/legal/terms/page.tsx)
- Use: Terms of service rendered from lib/terms.ts constant
- Render: server
- Guard: none (public)
- Data: TERMS_TEXT + TERMS_VERSION from lib/terms (in-code constant, not DB)
- Renders: paragraph-split terms text
- Status: ✅active

### /pricing (file: frontend/app/(marketing)/pricing/page.tsx)
- Use: Pricing tiers ($299/mo Spotlight, $999 Phase I, $1999 Phase II)
- Render: server (revalidate: 60s)
- Guard: none (public)
- Data: page_content (key: 'pricing') via lib/cms; ValueComparison block
- Renders: Hero, SectionHeader, PricingTier, CtaSection, ValueComparison, RichText, CustomSections
- Status: ✅active

### /resources (file: frontend/app/(marketing)/resources/page.tsx)
- Use: Blog/guides/resources hub (consolidated from /blog in V8)
- Render: server (revalidate: 60s)
- Guard: none (public)
- Data: content_pages (types: resource, guide, blog_post) via lib/cms; page_content (key: 'resources')
- Renders: ResourcesFilter (client component), RichText, CustomSections, MarketingIcon
- Status: ✅active

### /resources/[slug] (file: frontend/app/(marketing)/resources/[slug]/page.tsx)
- Use: Individual resource/blog post page; also receives /blog/[slug] redirects
- Render: server (revalidate: 60s)
- Guard: none (public); notFound() if slug not in content_pages
- Data: content_pages (by slug) via lib/cms; renderMarkdown for body
- Renders: sanitized HTML (strips scripts/on*/javascript:), OG metadata generation
- Status: ✅active

### /security (file: frontend/app/(marketing)/security/page.tsx)
- Use: Redirect → /infosec
- Render: server
- Guard: none (public)
- Data: none
- Renders: nothing (redirect only; uses `redirect()` not `permanentRedirect()`)
- Status: 🗑️deprecated-candidate (redirect shim; route was superseded by /infosec; no content served; same concern as /get-started about 302 vs 308)

### /team (file: frontend/app/(marketing)/team/page.tsx)
- Use: Team member profiles
- Render: server (revalidate: 60s)
- Guard: none (public)
- Data: content_pages (type: team_member) via lib/cms; page_content (key: 'team')
- Renders: RichText, CustomSections
- Status: ✅active

### /the-expert (file: frontend/app/(marketing)/the-expert/page.tsx)
- Use: Eric Wagner founder profile/credentials page
- Render: server (revalidate: 60s)
- Guard: none (public)
- Data: page_content (key: 'the-expert') via lib/cms
- Renders: Hero, Section, SectionHeader, FeatureGrid, CtaSection, CustomSections
- Status: ✅active

### /value (file: frontend/app/(marketing)/value/page.tsx)
- Use: "Why RFP Pipeline" value proposition page (absorbs /engine)
- Render: server (revalidate: 60s)
- Guard: none (public)
- Data: page_content (key: 'value') via lib/cms
- Renders: RichText, ValueComparison, ModelDiagram, FlywheelRing, CustomSections, MarketingIcon
- Status: ✅active

---

## Auth/Misc Pages (non-marketing, non-admin, non-portal)

### /dashboard (file: frontend/app/dashboard/page.tsx)
- Use: Legacy post-login redirect dispatcher (pre-/portal pattern); shows "workspace setting up" for no-tenant users
- Render: server
- Guard: auth() → redirect /login if unauthenticated; role-based redirect via getLandingPath
- Data: none
- Renders: SignOutButton, setup message (fallback only)
- Status: ⚠️stale (duplicates /portal dispatcher; /portal/page.tsx is the canonical post-login dispatcher; /dashboard is in PATH_MIN_ROLE requiring tenant_user+ but has no explicit role guard in component; appears to be kept as a fallback route)

### /invite/[token] (file: frontend/app/invite/[token]/page.tsx)
- Use: Proposal collaborator invite acceptance — sets password and activates partner_user account
- Render: client (`'use client'`)
- Guard: none (public route in middleware PUBLIC_PATHS `/invite` prefix)
- Data: GET /api/invite?token=... (invite info); POST /api/invite (accept)
- Renders: invite details (inviter name, proposal title, company), password/confirm inputs, success redirect to /portal
- Status: ✅active

### /portal (file: frontend/app/portal/page.tsx)
- Use: Post-login traffic cop; role-based redirect to appropriate workspace; "no workspace assigned" fallback
- Render: server
- Guard: auth() → redirect /login if unauthenticated; validates role; attempts DB recovery if JWT role invalid; validates tenant still exists
- Data: users, tenants (stale JWT recovery + tenant validation)
- Renders: SignOutButton, "no workspace assigned" message (only when tenant=null)
- Status: ✅active (canonical post-login dispatcher)

---

## Admin Pages

### /admin (file: frontend/app/admin/page.tsx)
- Use: Index redirect → /admin/dashboard
- Render: server
- Guard: middleware only (rfp_admin); no auth() in component (relies on middleware comment states this is intentional)
- Data: none
- Renders: nothing (redirect)
- Status: ✅active

### /admin/dashboard (file: frontend/app/admin/dashboard/page.tsx)
- Use: Admin overview — stat cards (tenants, proposals, events, library), recent event stream, TaskQueue
- Render: server
- Guard: auth() → redirect /login; role check rfp_admin|master_admin → redirect /
- Data: tenants, proposals, library_units, system_events, agent_task_queue (counts + recent events)
- Renders: stat cards, event list with namespace color badges, TaskQueue client component
- Status: ✅active

### /admin/agents (file: frontend/app/admin/agents/page.tsx)
- Use: Agent + tool registry overview; agent usage stats
- Render: server
- Guard: auth() → redirect /login; role check rfp_admin|master_admin → redirect /admin
- Data: lib/tools (in-code registry), agent_usage_log (via AgentUsageSummary), system_events
- Renders: tool catalog grouped by namespace, AgentUsageSummary client component
- Status: ✅active

### /admin/analytics (file: frontend/app/admin/analytics/page.tsx)
- Use: Platform analytics — page view counts, user metrics, revenue totals, session list
- Render: server
- Guard: auth() → redirect /login; role check rfp_admin|master_admin → redirect /admin
- Data: page_analytics, users, tenants, purchases (counts/sums), recent_sessions via lib/analytics-admin
- Renders: stat cards, RecentSessions client component
- Status: ✅active

### /admin/applications (file: frontend/app/admin/applications/page.tsx)
- Use: All applications list with status filters
- Render: server
- Guard: auth() → redirect /login; role check rfp_admin|master_admin (inferred from pattern)
- Data: applications table
- Renders: tabular application list with status badges, links
- Status: ✅active

### /admin/automation (file: frontend/app/admin/automation/page.tsx)
- Use: Automation rules CRUD + execution history
- Render: server (data) + AutomationClient (client component for CRUD)
- Guard: auth() → redirect /login; role check rfp_admin|master_admin → redirect /
- Data: automation_rules, system_events (execution stats)
- Renders: AutomationClient with initial data
- Status: ✅active

### /admin/billing (file: frontend/app/admin/billing/page.tsx)
- Use: Platform billing overview — subscription counts, MRR, purchase totals, Stripe summary
- Render: server
- Guard: auth() → redirect /login; role check rfp_admin|master_admin → redirect /admin
- Data: tenants (subscription_status counts), purchases (sum amount_cents, product_type breakdown)
- Renders: stat cards, purchase type breakdown
- Status: ✅active

### /admin/crm (file: frontend/app/admin/crm/page.tsx)
- Use: CRM placeholder — links out to CMS_PUBLIC_URL env var if set, else "coming soon"
- Render: server
- Guard: middleware only (rfp_admin via /admin prefix); NO auth() call in component
- Data: process.env.CMS_PUBLIC_URL
- Renders: static "coming soon" or link to CMS_PUBLIC_URL
- Status: ⚠️stale (CMS described as "dormant V1 placeholder" in CLAUDE.md; CRM noted as "future" in code comments; no local auth guard — relies entirely on middleware; SECURITY: if middleware bug occurs, no page-level fallback)

### /admin/documents (file: frontend/app/admin/documents/page.tsx)
- Use: Document builder — list of canvas documents
- Render: server (auth check) + DocumentListClient (client)
- Guard: auth() → redirect /login; role check rfp_admin|master_admin → redirect /
- Data: (delegated to client via API calls)
- Renders: DocumentListClient
- Status: ✅active

### /admin/documents/[documentId] (file: frontend/app/admin/documents/[documentId]/page.tsx)
- Use: Canvas document editor
- Render: client (`'use client'`)
- Guard: none at page level (client component; no auth() call; relies on API route guard)
- Data: GET /api/admin/documents/[documentId]; PUT to save; GET /api/admin/documents/[documentId]/history
- Renders: CanvasEditor, history sidebar
- Status: ⚠️stale (SECURITY: no page-level auth; client component loaded before auth check; relies entirely on API responding with 401; browser can still render the editor shell)

### /admin/events (file: frontend/app/admin/events/page.tsx)
- Use: System event stream viewer with namespace/type filters
- Render: server
- Guard: auth() → redirect /login; role check rfp_admin|master_admin → redirect /
- Data: system_events
- Renders: event stream table with filters
- Status: ✅active

### /admin/pipeline (file: frontend/app/admin/pipeline/page.tsx)
- Use: Pipeline job monitor
- Render: server
- Guard: auth() → redirect /login; role check rfp_admin|master_admin → redirect /
- Data: (pipeline job tables — exact tables from page content)
- Renders: pipeline status cards/tables
- Status: ✅active

### /admin/process (file: frontend/app/admin/process/page.tsx)
- Use: Process monitor — active process_instances with heartbeat/stall indicators
- Render: server
- Guard: auth() → redirect /login; role check rfp_admin|master_admin → redirect /
- Data: process_instances
- Renders: process cards
- Status: ⚠️stale (overlaps with /admin/processes — both display process_instances; the nav has both "Process Monitor" → /admin/process and "Process Ledger" → /admin/processes; distinct framing but conceptual overlap raises question of dedup)

### /admin/processes (file: frontend/app/admin/processes/page.tsx)
- Use: Process ledger — tabular view of process_instances with history
- Render: server
- Guard: auth() → redirect /login; role check rfp_admin|master_admin (hasRoleAtLeast) → redirect /
- Data: process_instances
- Renders: process table
- Status: ⚠️stale (see /admin/process above — two routes for same underlying table; nav labels distinguish "Monitor" vs "Ledger" but no clear functional boundary documented)

### /admin/proposals (file: frontend/app/admin/proposals/page.tsx)
- Use: Admin view of all proposals across all tenants
- Render: server
- Guard: auth() → redirect /login; role check rfp_admin|master_admin → redirect /
- Data: proposals, tenants, opportunities
- Renders: proposals list with tenant/stage/opportunity context
- Status: ✅active

### /admin/proposals/[proposalId]/section/[sectionId] (file: frontend/app/admin/proposals/[proposalId]/section/[sectionId]/page.tsx)
- Use: Admin canvas section editor for any proposal (admin maintenance/curation tool)
- Render: server (auth + data load) → CanvasEditorPage (client)
- Guard: auth() → redirect /login (no explicit role check beyond auth — NOTE: middleware guards /admin at rfp_admin but component does not double-check)
- Data: proposal_sections (by id AND proposal_id UUID), proposals (not verified against tenant)
- Renders: CanvasEditorPage client component
- Status: ⚠️stale (SECURITY: no page-level role check beyond auth(); middleware covers rfp_admin minimum but no defense-in-depth role assertion in component itself; no tenant scoping — admin can access any tenant's section by knowing the IDs)

### /admin/purchases (file: frontend/app/admin/purchases/page.tsx)
- Use: Purchase history across all tenants
- Render: server
- Guard: auth() → redirect /login; role check rfp_admin|master_admin → redirect /admin
- Data: purchases JOIN tenants
- Renders: purchase table with product type, amount, status
- Status: ✅active

### /admin/rfp-curation (file: frontend/app/admin/rfp-curation/page.tsx)
- Use: Main triage queue for curated_solicitations
- Render: server
- Guard: auth() → redirect /login; no explicit role check in component (middleware covers rfp_admin)
- Data: curated_solicitations JOIN opportunities (100 records, DESC)
- Renders: TriageQueue, TriageTodos client components; passes currentUserRole
- Status: ✅active (SECURITY NOTE: lacks page-level role check; relies on middleware only — acceptable by design but less defense-in-depth than most admin pages)

### /admin/rfp-curation/upload (file: frontend/app/admin/rfp-curation/upload/page.tsx)
- Use: Upload RFP documents for a new solicitation
- Render: server
- Guard: auth() → redirect /login; role check rfp_admin|master_admin → redirect /admin/dashboard
- Data: none (delegated to UploadForm)
- Renders: UploadForm client component
- Status: ✅active

### /admin/rfp-curation/[solId] (file: frontend/app/admin/rfp-curation/[solId]/page.tsx)
- Use: Full curation workspace for a single solicitation — metadata, documents, topics, volumes, compliance, full-text
- Render: server
- Guard: auth() → redirect /login; no explicit role check (middleware covers rfp_admin)
- Data: curated_solicitations JOIN opportunities, compliance_requirements, solicitation_topics, solicitation_documents, solicitation_volumes + items
- Renders: CurationWorkspace client component with rich pre-loaded data
- Status: ✅active (same middleware-only guard note as /admin/rfp-curation)

### /admin/rfp-curation/[solId]/topic/[topicId] (file: frontend/app/admin/rfp-curation/[solId]/topic/[topicId]/page.tsx)
- Use: Individual topic detail and curation within a solicitation
- Render: server
- Guard: auth() → redirect /login; role check rfp_admin|master_admin → redirect /admin/dashboard
- Data: opportunities JOIN curated_solicitations (filtered by both topicId AND solId UUIDs)
- Renders: TopicDetail client component
- Status: ✅active

### /admin/site (file: frontend/app/admin/site/page.tsx)
- Use: CMS console — list all editable pages + documents with view counts and edit timestamps
- Render: server
- Guard: middleware only (rfp_admin); NO auth() call in component
- Data: page_content (all pages via listPages), content_pages (via listDocuments), page_analytics (30d view counts via getPageViewCounts)
- Renders: page list with edit links, doc list
- Status: ✅active (SECURITY: no page-level auth guard; middleware-only — same pattern as /admin/crm)

### /admin/site/[pageKey] (file: frontend/app/admin/site/[pageKey]/page.tsx)
- Use: CMS page editor for a specific page key
- Render: server (data load) + EditorClient (client)
- Guard: bounces unknown pageKeys to /admin/site; NO auth() call; middleware-only
- Data: page_content (via ensurePageSeeded + getPage), fetches active + draft versions
- Renders: EditorClient client component
- Status: ✅active (SECURITY: no page-level auth guard)

### /admin/site/docs/[type]/[slug] (file: frontend/app/admin/site/docs/[type]/[slug]/page.tsx)
- Use: CMS doc editor (blog posts, resources, guides, team members); `slug=new` for creation
- Render: server (data load) + DocEditorClient (client)
- Guard: NO auth() call; middleware-only
- Data: content_pages (via getDocument by slug + type)
- Renders: DocEditorClient client component
- Status: ✅active (SECURITY: no page-level auth guard)

### /admin/sources (file: frontend/app/admin/sources/page.tsx)
- Use: Source profile hub — list all ingestion source profiles with visit history and diffs
- Render: server
- Guard: auth() → redirect /login (no explicit role check seen in first 60 lines; middleware covers rfp_admin)
- Data: source_profiles, source_visits JOIN source_profiles, source_diffs JOIN source_profiles
- Renders: SourcesHub client component (SourceCardActions)
- Status: ✅active

### /admin/sources/[profileId] (file: frontend/app/admin/sources/[profileId]/page.tsx)
- Use: Individual source profile detail — regions, diffs, visit history
- Render: server
- Guard: auth() → redirect /login; UUID validation on profileId; notFound() if not found
- Data: source_profiles, source_regions, source_diffs (all by profileId)
- Renders: SourceDetailClient client component
- Status: ✅active

### /admin/storage (file: frontend/app/admin/storage/page.tsx)
- Use: S3 storage manager (operational files in rfp-admin prefix)
- Render: server
- Guard: auth() → redirect /login; role check rfp_admin|master_admin → redirect /admin
- Data: none server-side (delegated to AdminFileManager via API)
- Renders: AdminFileManager client component
- Status: ✅active (NOTE: S3 storage IS live — contradicts prior claim that S3 is not used)

### /admin/system-state (file: frontend/app/admin/system-state/page.tsx)
- Use: Comprehensive system state dashboard — active workflows, pipeline state, event tree, error list, health summary
- Render: server (data load) + SystemStateClient (client with polling)
- Guard: auth() → redirect /login; role check rfp_admin|master_admin → redirect /
- Data: workflow_instances, pipeline jobs (via pipeline queries), system_events (errors + tree), process_instances health metrics
- Renders: SystemStateClient with initial data snapshot
- Status: ✅active

### /admin/system (file: frontend/app/admin/system/page.tsx)
- Use: Master_admin-only system health — queue depth, event rates, tool stats, error events, tool catalog
- Render: server
- Guard: auth() → redirect /login; hasRoleAtLeast master_admin → redirect / (strongest guard in admin)
- Data: agent_task_queue (queueDepth), system_events (eventRates, recentErrors), tool_invocations (recentToolStats), lib/tools registry
- Renders: inline stat sections, tool catalog table
- Status: ✅active

### /admin/templates (file: frontend/app/admin/templates/page.tsx)
- Use: Document template browser (in-code registry + optional DB), with canvas previewer
- Render: client (`'use client'`)
- Guard: none at page level (client component; no auth(); relies on middleware rfp_admin gate)
- Data: in-code template registry (hardcoded entries for DoD SBIR, CSO, etc.); GET /api/admin/templates? (optional DB fetch)
- Renders: TemplatePreviewer client component, filter/search UI
- Status: ⚠️stale (SECURITY: client component with no page-level auth; same concern as /admin/documents/[documentId]; browser renders template shell before any API guard fires)

### /admin/tenants (file: frontend/app/admin/tenants/page.tsx)
- Use: All tenants list with user/library/proposal counts
- Render: server
- Guard: auth() → redirect /login; role check rfp_admin|master_admin → redirect /admin
- Data: tenants with subquery counts for users, library_units (approved), proposals
- Renders: tenant table with status badges, links to detail
- Status: ✅active

### /admin/tenants/[tenantId] (file: frontend/app/admin/tenants/[tenantId]/page.tsx)
- Use: Tenant detail — subscription info, users, proposals, purchases, library counts
- Render: server
- Guard: auth() → redirect /login; role check rfp_admin|master_admin → redirect /admin
- Data: tenants, users, proposals, purchases (all filtered by tenantId)
- Renders: inline detail sections; shows "Tenant Not Found" if not found
- Status: ✅active

### /admin/waitlist (file: frontend/app/admin/waitlist/page.tsx)
- Use: Pending applications triage (status='pending' filter)
- Render: server
- Guard: auth() → redirect /login; role check rfp_admin|master_admin → redirect /admin
- Data: applications (WHERE status='pending', LIMIT 50)
- Renders: waitlist table, link to /admin/applications for full list
- Status: ✅active

### /admin/workflows (file: frontend/app/admin/workflows/page.tsx)
- Use: Workflow instance monitor + launch panel; handles content ingestion workflow triggers
- Render: server (data) + WorkflowMonitorClient + LaunchContentClient (client)
- Guard: auth() → redirect /login; role check rfp_admin|master_admin → redirect /
- Data: workflow_instances (active + recent), workflow stats
- Renders: WorkflowMonitorClient, LaunchContentClient
- Status: ✅active

---

## Portal Pages

### /portal/[tenantSlug]/dashboard (file: frontend/app/portal/[tenantSlug]/dashboard/page.tsx)
- Use: Customer dashboard — stats (library units, active proposals, pinned pipeline items), recent events, trial banner, onboarding checklist
- Render: server
- Guard: auth() → getTenantBySlug → verifyTenantAccess → redirect /portal if no access; hasRoleAtLeast tenant_user else redirect to /proposals
- Data: tenants (trial_ends_at), library_units (count), proposals (count), tenant_pipeline_items (pinned count), system_events (recent for tenant), agent_task_queue
- Renders: stat cards, event list, AgentUsagePanel, TaskQueue
- Status: ✅active

### /portal/[tenantSlug]/activity (file: frontend/app/portal/[tenantSlug]/activity/page.tsx)
- Use: Tenant event activity stream with namespace/type/time filters
- Render: server
- Guard: auth() → getTenantBySlug → verifyTenantAccess → redirect /portal; hasRoleAtLeast tenant_user
- Data: system_events (WHERE tenant_id=tenantId, filtered by ns/type/hours)
- Renders: ActivityStreamClient client component
- Status: ✅active

### /portal/[tenantSlug]/billing (file: frontend/app/portal/[tenantSlug]/billing/page.tsx)
- Use: Tenant billing — subscription status, purchase history
- Render: server
- Guard: auth() → getTenantBySlug → verifyTenantAccess; hasRoleAtLeast tenant_admin (higher bar than other portal pages)
- Data: tenants (subscription_status, stripe_customer_id), purchases (for tenant)
- Renders: BillingPanel client component
- Status: ✅active

### /portal/[tenantSlug]/documents (file: frontend/app/portal/[tenantSlug]/documents/page.tsx)
- Use: Documents hub — proposal sections + supporting files uploaded by tenant
- Render: server
- Guard: auth() → getTenantBySlug → verifyTenantAccess → redirect /portal; hasRoleAtLeast tenant_user
- Data: proposal_sections JOIN proposals (for tenant), supporting_documents (for tenant)
- Renders: section list with status badges, SupportingDocActions client component
- Status: ✅active

### /portal/[tenantSlug]/library (file: frontend/app/portal/[tenantSlug]/library/page.tsx)
- Use: Content library — card catalog with provenance, outcome badges, category counts
- Render: server
- Guard: auth() → getTenantBySlug → verifyTenantAccess → redirect /portal; hasRoleAtLeast tenant_user
- Data: library_units (200 records ordered by outcome_score DESC), proposals (JOIN for title), category counts (GROUP BY)
- Renders: LibraryDashboard client component with full data
- Status: ✅active

### /portal/[tenantSlug]/library/review (file: frontend/app/portal/[tenantSlug]/library/review/page.tsx)
- Use: Draft atom review queue after document upload and atomization
- Render: server
- Guard: auth() → getTenantBySlug → verifyTenantAccess → redirect /portal; hasRoleAtLeast tenant_user
- Data: library_units (WHERE status='draft' AND tenant_id); tries document_metadata column first, falls back if column missing (schema migration guard)
- Renders: AtomReviewWrapper client component
- Status: ✅active (NOTE: defensive fallback for missing document_metadata column suggests schema may be in flux)

### /portal/[tenantSlug]/library/upload (file: frontend/app/portal/[tenantSlug]/library/upload/page.tsx)
- Use: Library document upload form
- Render: server
- Guard: auth() → getTenantBySlug → verifyTenantAccess → redirect /portal; hasRoleAtLeast tenant_user
- Data: none server-side
- Renders: LibraryUploadForm client component
- Status: ✅active

### /portal/[tenantSlug]/pipeline (file: frontend/app/portal/[tenantSlug]/pipeline/page.tsx)
- Use: Tenant pipeline — pinned opportunities with proposal status and deadline countdown
- Render: server
- Guard: auth() → getTenantBySlug → verifyTenantAccess → redirect /portal; hasRoleAtLeast tenant_user
- Data: tenant_pipeline_items JOIN opportunities, LEFT JOIN proposals (WHERE is_pinned=true, tenant scoped)
- Renders: inline pipeline cards with countdown badges
- Status: ✅active

### /portal/[tenantSlug]/processes (file: frontend/app/portal/[tenantSlug]/processes/page.tsx)
- Use: Tenant automation process ledger; tenant_admin can override HITL gates
- Render: server
- Guard: auth() → getTenantBySlug → verifyTenantAccess → redirect /portal; role checked for canAdvance (tenant_admin) but no minimum role redirect
- Data: process_instances (WHERE tenant_id, LIMIT 100)
- Renders: ProcessesClient client component; null rows distinguished from empty for error state
- Status: ✅active

### /portal/[tenantSlug]/profile (file: frontend/app/portal/[tenantSlug]/profile/page.tsx)
- Use: Tenant settings + user profile — NAICS codes, keywords, agency priorities, tech focus
- Render: server
- Guard: auth() → getTenantBySlug → verifyTenantAccess → redirect /portal
- Data: tenants (full info), tenant_profiles (NAICS, keywords, agency_priorities, etc.), users (current user info)
- Renders: ProfileEditor client component
- Status: ✅active

### /portal/[tenantSlug]/proposals (file: frontend/app/portal/[tenantSlug]/proposals/page.tsx)
- Use: Proposals list — all tenant proposals or (for partner_user) only proposals where user is collaborator
- Render: server
- Guard: auth() → getTenantBySlug → verifyTenantAccess → redirect /portal; no minimum role restriction (all roles including partner_user)
- Data: proposals JOIN opportunities (for partner_user: INNER JOIN proposal_collaborators); tenant scoped
- Renders: inline proposal cards with stage badges and deadline
- Status: ✅active

### /portal/[tenantSlug]/proposals/[proposalId] (file: frontend/app/portal/[tenantSlug]/proposals/[proposalId]/page.tsx)
- Use: Proposal workspace — section list with status, AI draft triggers, compliance, collaborators, export
- Render: server
- Guard: auth() → getTenantBySlug → verifyTenantAccess → redirect /portal; proposal verified: WHERE p.id=proposalId AND p.tenant_id=tenantId
- Data: proposals JOIN opportunities LEFT JOIN curated_solicitations, proposal_sections, compliance_requirements, proposal_collaborators, lib/proposal-access (resolveUserAccess)
- Renders: ProposalWorkspace client component with access model
- Status: ✅active (critical path)

### /portal/[tenantSlug]/proposals/[proposalId]/review (file: frontend/app/portal/[tenantSlug]/proposals/[proposalId]/review/page.tsx)
- Use: Proposal review — section completion overview and compliance matrix
- Render: server
- Guard: auth() → getTenantBySlug → verifyTenantAccess → redirect /portal; proposal WHERE id=proposalId AND tenant_id=tenantId; redirects to /proposals if not found
- Data: proposals, proposal_sections (with content length stats), proposal_compliance_matrix
- Renders: inline section table, compliance matrix table
- Status: ✅active

### /portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId] (file: frontend/app/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/page.tsx)
- Use: Canvas section editor for a proposal section
- Render: server (data + auth) → CanvasEditorPage (client)
- Guard: auth() → getTenantBySlug → verifyTenantAccess → redirect /portal; proposal WHERE id=proposalId AND tenant_id=tenantId; section WHERE id=sectionId AND proposal_id=proposalId; notFound() if either missing
- Data: proposals, proposal_sections; creates empty canvas if no content yet
- Renders: CanvasEditorPage (readOnly if proposal.isLocked)
- Status: ✅active (critical path)

### /portal/[tenantSlug]/spotlights (file: frontend/app/portal/[tenantSlug]/spotlights/page.tsx)
- Use: Spotlight feed — ranked open topics scored against tenant profile; mix of pipeline-scored and estimated items
- Render: server
- Guard: auth() → getTenantBySlug → verifyTenantAccess → redirect /portal; hasRoleAtLeast tenant_user
- Data: tenant_profiles (min_surface_score), applications (profile for scoring estimation), opportunities (active topics), tenant_pipeline_items (pre-computed scores), library_units (category match bonus)
- Renders: SpotlightFeed client component
- Status: ✅active

### /portal/[tenantSlug]/spotlights/[spotlightId] (file: frontend/app/portal/[tenantSlug]/spotlights/[spotlightId]/page.tsx)
- Use: Spotlight/opportunity detail — full opportunity info, compliance variables, documents, pin/purchase actions
- Render: server
- Guard: auth() → getTenantBySlug → verifyTenantAccess → redirect /portal; (NOTE: opportunity itself queried WITHOUT tenant_id filter — any authenticated tenant can view any opportunity by knowing its UUID if they can guess the spotlightId)
- Data: opportunities LEFT JOIN curated_solicitations (NO tenant filter), tenant_pipeline_items (tenant-filtered for pin status), compliance_variables (solicitation-scoped), solicitation_documents (solicitation-scoped)
- Renders: SpotlightDetailActions, OpportunityDocuments client components
- Status: ✅active (SECURITY NOTE: opportunity data is global/non-tenant, which may be intentional — opportunities are a shared catalog — but the page exposes full solicitation metadata to any authenticated user of any tenant who knows the opportunity UUID)

### /portal/[tenantSlug]/team (file: frontend/app/portal/[tenantSlug]/team/page.tsx)
- Use: Team management — member list, collaborator list, invite form (admin only)
- Render: server
- Guard: auth() → getTenantBySlug → verifyTenantAccess → redirect /portal; hasRoleAtLeast tenant_user
- Data: users (WHERE tenant_id), proposal_collaborators JOIN proposals (WHERE p.tenant_id=tenantId, non-archived)
- Renders: member table, collaborator table, TeamInviteForm (shown only if isAdmin)
- Status: ✅active

---

## Summary Tables

### Page Count by Surface
| Surface | Count | Notes |
|---------|-------|-------|
| Admin | 33 | 1 index redirect + 32 functional pages (incl. 3 client-only, 3 dynamic multi-segment) |
| Portal | 17 | layout + 16 pages (incl. 4 nested proposal pages, 3 library pages) |
| Marketing | 20 | layout + 2 legal layouts + 16 content pages + 2 redirect-only shims |
| Auth/Misc | 6 | login, change-password, forgot-password, reset-password, dashboard, invite |
| **Total** | **86** | 84 git-tracked + /portal (dispatcher) + /dashboard (legacy) |
