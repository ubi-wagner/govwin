#!/usr/bin/env node
/**
 * reconcile-capability.mjs — what the BACK END can do that the UI never offers.
 *
 * WHY. Every instrument in this repo asks whether what the product does, it does correctly. None
 * asks the opposite question: **what has been built and never surfaced?** That gap is invisible by
 * construction — no page renders it, so no page sweep can miss it; no route is called, so no
 * contract lens grades it; no test asserts it, because nobody wrote a test for a feature nobody can
 * reach. It only appears when you put the two inventories side by side.
 *
 * Five joins, each between something the system HAS and something the UI USES:
 *
 *   1. API route      ↔ UI fetch call      a route nothing calls
 *   2. DB table (rows) ↔ SQL in app code   data no code reads
 *   3. agent archetype ↔ an invocation path an agent nothing can start or show
 *   4. workflow template ↔ a UI reference  a workflow nothing displays
 *   5. event type emitted ↔ event rendered a signal nothing surfaces
 *
 * WHAT A ROW HERE IS AND IS NOT. It is a CANDIDATE. Several categories are legitimately UI-less by
 * design — a Stripe webhook has no caller in this codebase because Stripe is the caller; a cron
 * endpoint is poked by a scheduler; the pipeline worker calls routes over HTTP from Python, which no
 * TypeScript fetch scan can see. Those are checked and annotated rather than filtered, so the count
 * stays honest about what was measured.
 *
 * The output to act on is narrower and more interesting than "unused": **capability with a working
 * implementation, real data behind it, and no way in.**
 *
 *   cd frontend && node scripts/reconcile-capability.mjs
 *   node scripts/reconcile-capability.mjs --check    # self-test the joins against known answers
 */
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const REPO = '/home/user/govwin';
const DB = process.env.GUIDE_DB || process.env.DATABASE_URL_OWNER || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const sql = postgres(DB, { max: 2, transform: { column: { from: (c) => c } } });

const inv = JSON.parse(fs.readFileSync(path.join(REPO, 'docs/frontend-inventory.json'), 'utf8'));

/**
 * THE INVENTORY IS A GENERATED ARTIFACT, AND NOTHING FORCES IT TO BE CURRENT.
 *
 * This whole reconciliation reads its route list from `docs/frontend-inventory.json` rather than
 * from disk. That is the right design — the inventory is the manifest a sweep has to touch, and
 * re-deriving it here would be a second answer to the same question. But it makes every verdict
 * below only as fresh as the last `inventory-frontend.mjs` run, and there is no reason a person
 * adding a route would think to run it first.
 *
 * It has already happened: `/api/webhooks/postmark` was added, this reconciliation ran clean, and
 * the route simply was not in the file — a day-old inventory reported an UNSURFACED route as
 * nothing at all. A lens that cannot see a thing does not report it missing; it reports silence,
 * which reads exactly like a pass.
 *
 * So: count the route files on disk, compare, and exit 2 as a HARNESS DEFECT rather than printing a
 * verdict this run has not earned. The same rule `verify-api-contract` and `verify-surfaces` follow.
 */
{
  const walkRoutes = (dir, out = []) => {
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p2 = path.join(dir, e.name);
      if (e.isDirectory()) walkRoutes(p2, out);
      else if (e.name === 'route.ts' || e.name === 'route.tsx') out.push(p2);
    }
    return out;
  };
  const onDisk = new Set(walkRoutes(path.join(REPO, 'frontend/app')).map((f) => f.replace(REPO + '/frontend/', '')));
  const inInventory = new Set((inv.records ?? [])
    .map((r) => r.file ?? '')
    .filter((f) => /(^|\/)route\.tsx?$/.test(f)));
  const missing = [...onDisk].filter((f) => !inInventory.has(f));
  if (inInventory.size === 0) {
    console.error('HARNESS DEFECT: docs/frontend-inventory.json lists no route files at all — its');
    console.error('  shape has changed and this staleness guard is reading the wrong field. Fix the');
    console.error('  guard before trusting anything below it.');
    process.exit(2);
  }
  if (missing.length) {
    console.error(`HARNESS DEFECT: ${missing.length} API route(s) exist on disk and are ABSENT from`);
    console.error('  docs/frontend-inventory.json, which is where this reconciliation gets its route');
    console.error('  list. Every verdict below would be silent about them — which reads exactly like');
    console.error('  a pass. Regenerate first:');
    console.error('      node frontend/scripts/inventory-frontend.mjs');
    for (const f of missing.slice(0, 10)) console.error(`    · ${f}`);
    if (missing.length > 10) console.error(`    · …and ${missing.length - 10} more`);
    process.exit(2);
  }
}
const cat = JSON.parse(fs.readFileSync(path.join(REPO, 'docs/ui-catalog.json'), 'utf8'));

/**
 * One shape for both sides of the API join.
 *
 * A route is written `/api/portal/[tenantSlug]/proposals`; the fetch that calls it is written
 * `` `/api/portal/${tenantSlug}/proposals` ``. Comparing them raw finds nothing and reports the
 * whole API as uncalled — which is what the first draft of this did. Collapse every dynamic segment
 * on both sides to `:p` and they line up.
 */
const norm = (u) => String(u)
  .replace(/^[`'"]|[`'"]$/g, '')
  .split('?')[0]
  .replace(/\$\{[^}]*\}/g, ':p')
  .replace(/\[\.\.\.[^\]]+\]|\[[^\]]+\]/g, ':p')
  // A QUERY STRING BUILT INTO A VARIABLE. `` `/api/…/cards/${opp}/pin${qs}` `` carries no literal
  // `?` for the split above to find, so the collapse yields `…/pin:p` and the route `…/pin` never
  // matches — the pin/unpin buttons in `portal/pipeline-cards.tsx` are right there on the card and
  // the join called the route unreachable. A `:p` GLUED to a segment (no `/` before it) is never a
  // path parameter — Next writes those as their own segment — so it is a suffix, and drops.
  .replace(/([^/]):p$/, '$1')
  .replace(/\/+$/, '')
  .trim();

// ── 1 · API routes with no UI caller ─────────────────────────────────────────
const routes = inv.records.filter((r) => r.kind === 'api-route');
const uiCalls = new Set();
for (const r of cat.records) for (const f of r.fetches ?? []) uiCalls.add(norm(f.url));

/**
 * EVERY API PATH THE UI MENTIONS, not just the ones passed straight to `fetch()`.
 *
 * A `fetch(...)`-argument scan answers a narrower question than "does the UI use this route", and
 * the difference is not marginal. The section export builds its URL into a const and passes the
 * variable; `/api/partner/exit` is an `<a href>`; downloads are hrefs by nature because a fetch
 * cannot save a file. Each of those is a fully-wired route the fetch scan calls unreachable.
 *
 * So the reconciliation asks the honest version of the question: does any API-shaped string literal
 * anywhere in `app/` or `components/` name this path? That over-counts slightly — a path inside a
 * comment counts — and over-counting is the right direction here, because the output is a list of
 * things to go and check, and a false "unsurfaced" costs a person a hunt while a false "called"
 * only loses a candidate that a human reading the route would have dismissed anyway.
 */
const walkUi = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p2 = path.join(dir, e.name);
    if (e.isDirectory()) walkUi(p2, out);
    else if (/\.tsx?$/.test(e.name) && !/route\.tsx?$/.test(e.name) && !POLICY_TABLES.has(p2)) out.push(p2);
  }
  return out;
};

/**
 * THE TWO FILES THAT NAME A PATH IN ORDER TO *DENY* IT.
 *
 * `lib/` has to be in the scan: it is where the ToDo deep-links are built (`lib/tasks/completers.ts`
 * turns an entity into `/admin/site/content/${id}`, which is the only way a person ever reaches that
 * route), and where shared fetch helpers live (`lib/hooks/use-tool.ts` → `/api/tool`). Leaving it
 * out reported a working, linked route as unreachable.
 *
 * But two files there enumerate paths for the opposite reason. `lib/rbac.ts` lists ten prefixes to
 * ROLE-GATE them; `lib/rate-limit.ts` lists one to THROTTLE it. A path appearing in a policy table
 * is evidence the route is guarded, not evidence anything calls it — count them and every gated
 * route reads as surfaced. Named individually, with the reason, rather than pattern-guessed.
 */
const POLICY_TABLES = new Set([
  path.join(REPO, 'frontend/lib/rbac.ts'),
  path.join(REPO, 'frontend/lib/rate-limit.ts'),
]);
/**
 * A UI THAT IS NOT A COMPONENT. `frontend/public/architecture/explorer.html` is a hand-written
 * static page, served as an asset, that fetches `/api/admin/architecture/{schema,stats}` from plain
 * `<script>`. It is a real, reachable, shipped surface — and a `.tsx`-only walk cannot see one line
 * of it, so both routes came back UNSURFACED. Any file that can issue a request counts as a caller,
 * whatever extension it happens to have.
 */
const walkHtml = (dir, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p2 = path.join(dir, e.name);
    if (e.isDirectory()) walkHtml(p2, out);
    else if (/\.(html|js|mjs)$/.test(e.name)) out.push(p2);
  }
  return out;
};
const uiFiles = [
  ...walkUi(path.join(REPO, 'frontend/app')),
  ...walkUi(path.join(REPO, 'frontend/components')),
  ...walkUi(path.join(REPO, 'frontend/lib')),
  ...walkHtml(path.join(REPO, 'frontend/public')),
  ...walkHtml(path.join(REPO, 'frontend/scripts/architecture')),
];
for (const f of uiFiles) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/['"`](\/(?:api|admin)\/[^'"`\s)]*)['"`]/g)) uiCalls.add(norm(m[1]));
  // …and the same path split across a template with a leading segment, e.g. `/api/portal/${s}/x`.
  for (const m of src.matchAll(/`(\/(?:api|admin)\/[^`]*)`/g)) uiCalls.add(norm(m[1]));
}
// A fetch to a PREFIX also exercises deeper routes in the reader's mind, but not in fact; keep the
// comparison exact and let the annotations explain the legitimate misses.

/**
 * WHEN THE BASE OF THE URL IS IN A DIFFERENT FILE.
 *
 * `nook-detail.tsx` takes `apiBase` as a PROP — `/api/portal/<slug>/vaults/<id>`, assembled by the
 * page — and builds every call as `` `${apiBase}/atoms/${id}/ingest` ``. No literal beginning
 * `/api/` exists anywhere in the component, so a scan for one finds nothing and reports the vault
 * download link and the "Harvest → library" button as unreachable capability. They are both on
 * screen, next to each other, in the shipped UI.
 *
 * Nothing can resolve a prop statically without following it across files. What CAN be matched is
 * the TAIL: the part after the placeholder is written out in full, and a route that ends with it is
 * almost certainly the one being called. Two segments minimum, so a bare `/atoms` cannot sweep up
 * every route that happens to end that way.
 *
 * This is weaker evidence than a literal, so it is recorded separately and shown as such — a reader
 * checking the report can see which routes were cleared by a tail match and disagree with one.
 */
const uiTails = new Set();
for (const f of uiFiles) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/`\$\{[^}]*\}(\/[^`]*)`/g)) {
    const tail = norm(m[1]);
    if (tail.split('/').filter(Boolean).length >= 2) uiTails.add(tail);
  }
}
const tailMatch = (n) => [...uiTails].find((t) => n.endsWith(t)) ?? null;

/** Routes the UI legitimately never calls, with the reason. Annotated, never silently dropped. */
const EXTERNAL_CALLER = [
  [/^\/api\/stripe\/webhook/, 'Stripe is the caller — an inbound webhook has no UI'],
  [/^\/api\/webhooks\/postmark/, 'Postmark is the caller — delivery outcomes arrive on their own connection, with POSTMARK_WEBHOOK_SECRET as the authorization'],
  [/^\/api\/auth\//, 'NextAuth owns these; the client calls them through the library, not by URL'],
  [/^\/api\/health/, 'load balancer / Railway probe'],
  [/^\/api\/admin\/(reconcile-cards|agent-gates\/sweep)/, 'headless scheduler via CRON_SECRET (middleware CRON_EXACT_PATHS)'],
  [/^\/api\/tools\//, 'the generic tool adapter — invoked by agents and scripts, not by a page'],
  [/^\/api\/storage\/local\//, 'the local storage driver’s own serving route; signed URLs point at it'],
  [/^\/api\/uploads\//, 'public CMS image serving — referenced as an <img> src, never fetched'],
  [/^\/api\/cms\/revalidate/, 'the CRM-CMS publish bridge calls it service-to-service with REVALIDATE_SECRET'],
  [/^\/blog\/feed\.xml|^\/sitemap/, 'crawler-facing'],
  [/^\/api\/enter|^\/api\/partner\/(enter|exit)/, 'navigation endpoints — the browser follows them, it does not fetch them'],
];
const reasonFor = (route) => EXTERNAL_CALLER.find(([re]) => re.test(route))?.[1] ?? null;

/**
 * THE THIRD OUTCOME, which the first draft did not model and the self-test caught.
 *
 * "No fetch" is not "no UI path". In the App Router a server component queries the database
 * DIRECTLY — `app/portal/[tenantSlug]/proposals/page.tsx` renders the proposal list from its own
 * `sql` call and never touches `/api/portal/[tenantSlug]/proposals`. The route still exists, fully
 * implemented, with no caller anywhere in the repo.
 *
 * That is the opposite of unsurfaced capability: it is capability served TWICE, by two
 * implementations that can drift on filters, ordering, RLS scoping and response shape without
 * anything noticing. Worth reporting, but not as the same thing.
 *
 * So a route lands in one of four buckets, and only the last is what this reconciliation is for:
 *   called          a UI fetch names it
 *   external        a webhook, scheduler, crawler or the agent tool adapter calls it (annotated)
 *   duplicated      a page at the mirror path renders the same data server-side
 *   UNSURFACED      nothing calls it and no page covers it — built and unreachable
 */
const pageServesSamePath = (route) => {
  // /api/portal/[tenantSlug]/proposals  →  app/portal/[tenantSlug]/proposals/page.tsx
  const asPage = route.replace(/^\/api/, 'app') + '/page.tsx';
  const parent = path.dirname(route.replace(/^\/api/, 'app')) + '/page.tsx';
  for (const cand of [asPage, parent]) {
    try {
      const src = fs.readFileSync(path.join(REPO, 'frontend', cand), 'utf8');
      if (/\bsql[<`]|from '@\/lib\/db'/.test(src)) return cand;
    } catch { /* no such page */ }
  }
  return null;
};

/**
 * THE SAME QUESTION, ASKED WITHOUT GUESSING AT PATHS.
 *
 * The mirror rule above needs the page to sit where the route's URL says and to hold raw `sql`.
 * Both assumptions break in the CMS admin: the docs editor lives at `app/admin/site/docs/[type]/
 * [slug]` while its route is `/api/admin/site/docs/[type]/[slug]` (mirror OK) but the page reads
 * through `getDocument()` rather than `sql` (signal missed); the page editor is at
 * `app/admin/site/[pageKey]` while its route is `/api/admin/site/pages/[pageKey]` (mirror missed
 * outright, the collection noun only exists on the API side). Four fully-built, fully-reachable
 * editor routes read as unreachable capability.
 *
 * The stronger rule needs no path convention at all, and states the duplication directly:
 * **a server page imports the same data function the route's handler imports.** Not "a page that
 * looks like it might" — the same named export from the same module, which is the thing that would
 * have to drift for the two to disagree.
 *
 * Auth, RBAC and event helpers are excluded: a page and a route sharing `requireAdmin` share a
 * gate, not an answer, and counting that would mark half the admin surface as duplicated.
 */
// `lib/rls` is the per-request tenant context and `lib/export/artifact-export` is the shared canvas
// renderer — every tenant route wraps in the first and every download route calls the second, so
// sharing either distinguishes nothing. Same reason as the auth helpers beside them.
const CROSS_CUTTING = /@\/(auth|lib\/(admin-auth|rbac|events|db|toast|jsonb|tenant-access|rls|export\/artifact-export|storage\/s3-client|session.*))$/;
/**
 * Authorization resolvers that happen to be async, named one at a time with the reason.
 *
 * `resolveVaultAccess()` answers "may this user touch this vault", which every vault route and the
 * vault page must ask — so sharing it is universal and says nothing. Counting it claimed the atom
 * DOWNLOAD route was duplicated by the vault page, which cannot be true: a page render does not
 * hand anybody a .docx. Same category as `requireAdmin` above; it just lives in a data module.
 */
const ACCESS_RESOLVERS = new Set(['@/lib/vaults/vaults#resolveVaultAccess']);
/**
 * AND THE SYMBOL HAS TO BE A READ, NOT A HELPER.
 *
 * First run of the rule above claimed the vault atom download and ingest routes were duplicated by
 * `documents/[documentId]/page.tsx` because both import `isValidUUID()`. They share a *validator*.
 * Sharing a validator says nothing about whether two pieces of code answer the same question, and
 * had it gone unread it would have retired two genuine candidates on a false premise.
 *
 * A function that fetches data is async; a guard like `isValidUUID` is not. So the symbol only
 * counts when its own module declares it async — resolved and read, not assumed from the name.
 */
const asyncExportCache = new Map();
const isAsyncExport = (mod, sym) => {
  const key = `${mod}#${sym}`;
  if (asyncExportCache.has(key)) return asyncExportCache.get(key);
  const base = path.join(REPO, 'frontend', mod.replace('@/', ''));
  let src = null;
  for (const c of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(c)) { src = fs.readFileSync(c, 'utf8'); break; }
  }
  const ok = src != null && new RegExp(
    `export\\s+async\\s+function\\s+${sym}\\b|export\\s+(?:const|let)\\s+${sym}\\s*(?::[^=]+)?=\\s*async\\b`,
  ).test(src);
  asyncExportCache.set(key, ok);
  return ok;
};
const importsOf = (src) => {
  const out = [];
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const mod = m[2];
    if (!mod.startsWith('@/lib/') || CROSS_CUTTING.test(mod)) continue;
    for (const raw of m[1].split(',')) {
      if (/\btype\b/.test(raw)) continue; // a shared TYPE is a shape, not an answer
      const sym = raw.split(/\s+as\s+/)[0].trim();
      if (!/^[A-Za-z_$][\w$]*$/.test(sym)) continue;
      if (ACCESS_RESOLVERS.has(`${mod}#${sym}`)) continue;
      if (isAsyncExport(mod, sym)) out.push(`${mod}#${sym}`);
    }
  }
  return out;
};
/** module#symbol → the server pages that import it. Built once over every page in the tree. */
const pagesBySymbol = new Map();
const walkPages = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p2 = path.join(dir, e.name);
    if (e.isDirectory()) { walkPages(p2); continue; }
    if (e.name !== 'page.tsx') continue;
    const src = fs.readFileSync(p2, 'utf8');
    if (/^\s*['"]use client['"]/m.test(src)) continue; // a client page cannot read the DB
    const rel = path.relative(path.join(REPO, 'frontend'), p2);
    for (const k of importsOf(src)) {
      if (!pagesBySymbol.has(k)) pagesBySymbol.set(k, []);
      pagesBySymbol.get(k).push(rel);
    }
  }
};
walkPages(path.join(REPO, 'frontend/app'));

const pageSharesDataFn = (routeFile) => {
  // Read it directly. A `try { … } catch { return null }` here spent a run reporting every route as
  // non-duplicated because the path was missing its `frontend/` segment — a silent catch turns a
  // broken lookup into a confident negative, which is the one answer this join must never invent.
  const src = fs.readFileSync(path.join(REPO, 'frontend', routeFile), 'utf8');
  for (const k of importsOf(src)) {
    const pages = pagesBySymbol.get(k);
    if (pages?.length) return `${pages[0]} (both call ${k.split('#')[1]}())`;
  }
  return null;
};

/**
 * THE OTHER WAY A ROUTE CAN BE UNCALLED WITHOUT BEING UNREACHABLE CAPABILITY.
 *
 * `POST /api/admin/rfp-curation/[solId]/complete-buildout` has no caller. But `completeBuildOut()`
 * — the whole capability — is reached every time the provisioning cockpit hits
 * `/api/admin/provisioning/[portalId]/release`, which imports the same function. The route is a
 * SECOND FRONT DOOR to a capability that already has one.
 *
 * That is worth knowing and it is not the same finding. Unsurfaced means a person cannot get at the
 * behaviour; this means they can, by another URL, and there is a spare endpoint carrying its own
 * auth check that has to stay correct. Reporting it as unsurfaced would send someone to build a
 * button for something that already has one.
 */
const routesBySymbol = new Map();
for (const r of routes) {
  for (const k of importsOf(fs.readFileSync(path.join(REPO, 'frontend', r.file), 'utf8'))) {
    if (!routesBySymbol.has(k)) routesBySymbol.set(k, []);
    routesBySymbol.get(k).push(r.route);
  }
}
const routeSharesDomainFn = (r) => {
  for (const k of importsOf(fs.readFileSync(path.join(REPO, 'frontend', r.file), 'utf8'))) {
    const sibling = (routesBySymbol.get(k) ?? []).find((o) => o !== r.route && uiCalls.has(norm(o)));
    if (sibling) return `${sibling} (both call ${k.split('#')[1]}())`;
  }
  return null;
};

const uncalled = [];
const tailCalled = [];
for (const r of routes) {
  const n = norm(r.route);
  if (uiCalls.has(n)) continue;
  const byTail = tailMatch(n);
  if (byTail) { tailCalled.push({ route: r.route, tail: byTail }); continue; }
  const calledUnderneath = [...uiCalls].some((c) => c.startsWith(n + '/') || n.startsWith(c + '/'));
  // Duplication-by-page is a claim about a READ. A page render cannot stand in for a POST, so a
  // mutation-only route is never explained away that way — it is called, external, or unsurfaced.
  const isRead = r.methods.includes('GET');
  uncalled.push({
    route: r.route,
    file: r.file,
    methods: r.methods,
    reason: reasonFor(r.route),
    duplicatedBy: isRead ? (pageServesSamePath(r.route) ?? pageSharesDataFn(r.file)) : null,
    secondDoor: routeSharesDomainFn(r),
    nearMiss: calledUnderneath,
  });
}

// ── 5 · event types the system emits vs. what any surface renders ────────────
const emittedTypes = new Set();
for (const r of [...inv.records, ...cat.records]) {
  const src = (() => { try { return fs.readFileSync(path.join(REPO, 'frontend', r.file), 'utf8'); } catch { return ''; } })();
  for (const m of src.matchAll(/type:\s*'([a-z_]+\.[a-z_]+)'/g)) emittedTypes.add(m[1]);
}

/**
 * SCOPE THIS TO WHAT A CUSTOMER ACTUALLY SEES, or it measures the label map's design instead.
 *
 * First version compared every emitted type against `lib/event-labels.ts` and reported 194 of 243
 * as unlabelled. That number is real and means nothing: the map's own comment says it holds
 * "explicit labels for the customer-relevant taxonomy", so every admin-facing type is unlabelled BY
 * DESIGN and `describeEvent()` humanises the rest. Reporting 194 defects would have been reporting
 * a deliberate decision back to the people who made it. (It also swept up `widget.frobnicated`, a
 * fixture — a fair warning that the source scan was too wide.)
 *
 * The question worth asking is narrower: of the events that carry a real `tenant_id` — the ones
 * that reach a CUSTOMER's Activity feed rather than an operator's — which arrive with no written
 * label? Taken from the database, so it reflects what the product has actually emitted, not what a
 * regex found in a string.
 */
const [{ tenantTypes }] = await sql`
  SELECT json_agg(DISTINCT type) AS "tenantTypes" FROM system_events WHERE tenant_id IS NOT NULL`;
const labelSrc = fs.readFileSync(path.join(REPO, 'frontend/lib/event-labels.ts'), 'utf8');
const labelled = new Set([...labelSrc.matchAll(/^\s*'([a-z_]+\.[a-z_.]+)':/gm)].map((m) => m[1]));
for (const m of labelSrc.matchAll(/case '([a-z_]+\.[a-z_.]+)'/g)) labelled.add(m[1]);
// `describeEvent` answers some namespaces BEFORE consulting the map — every `tool` event renders as
// "AI tool started/completed" regardless of type. `memory.stored` (50 rows in tenant feeds) was
// reported unlabelled and is in fact handled; a type is only unlabelled if no branch claims it.
const BRANCH_NAMESPACES = new Set(
  [...labelSrc.matchAll(/namespace === '([a-z_]+)'/g)].map((m) => m[1]),
);
const [{ nsOfType }] = await sql`
  SELECT json_object_agg(type, namespace) AS "nsOfType" FROM (
    SELECT DISTINCT ON (type) type, namespace FROM system_events
    WHERE tenant_id IS NOT NULL ORDER BY type, namespace) s`;
const unlabelled = (tenantTypes ?? [])
  .filter((t) => t && !labelled.has(t) && !BRANCH_NAMESPACES.has((nsOfType ?? {})[t]))
  .sort();

const out = { uncalled, emittedTypes: [...emittedTypes], unlabelled };

// ── DB-side joins need the live database ─────────────────────────────────────
const [{ tables }] = await sql`
  SELECT json_agg(t) AS tables FROM (
    SELECT c.relname AS name, c.reltuples::bigint AS est
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname) t`;

// Real counts — reltuples is an estimate and reads 0 on a freshly restored table.
const withRows = [];
for (const t of tables ?? []) {
  try {
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM ${sql(t.name)}`;
    if (n > 0) withRows.push({ name: t.name, rows: n });
  } catch { /* unreadable to this role */ }
}

/** Every table name mentioned in any SQL the app or the pipeline writes. */
function tablesReferencedIn(dir, exts) {
  const seen = new Set();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '.next') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (exts.some((x) => e.name.endsWith(x))) {
        const src = fs.readFileSync(p, 'utf8');
        for (const m of src.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+"?([a-z_][a-z0-9_]*)"?/gi)) seen.add(m[1].toLowerCase());
        for (const m of src.matchAll(/sql\(\s*['"]([a-z_][a-z0-9_]*)['"]\s*\)/g)) seen.add(m[1].toLowerCase());
      }
    }
  };
  walk(dir);
  return seen;
}
const referenced = new Set([
  ...tablesReferencedIn(path.join(REPO, 'frontend/app'), ['.ts', '.tsx']),
  ...tablesReferencedIn(path.join(REPO, 'frontend/lib'), ['.ts', '.tsx']),
  ...tablesReferencedIn(path.join(REPO, 'pipeline/src'), ['.py']),
]);
const unreadTables = withRows.filter((t) => !referenced.has(t.name));

// ── 3 · agents ───────────────────────────────────────────────────────────────
const archetypeDir = path.join(REPO, 'pipeline/src/agents/archetypes');
const archetypes = fs.readdirSync(archetypeDir)
  .filter((f) => f.endsWith('.py') && !['base.py', '__init__.py'].includes(f))
  .map((f) => f.replace(/\.py$/, ''));

const wfDir = path.join(REPO, 'pipeline/src/workflows');
const wfSrc = fs.readdirSync(wfDir).filter((f) => f.endsWith('.py'))
  .map((f) => fs.readFileSync(path.join(wfDir, f), 'utf8')).join('\n');
const uiSrcAll = [...inv.records, ...cat.records]
  .map((r) => { try { return fs.readFileSync(path.join(REPO, 'frontend', r.file), 'utf8'); } catch { return ''; } }).join('\n');

const [{ invoked }] = await sql`
  SELECT json_agg(DISTINCT archetype) AS invoked FROM (
    SELECT payload->>'archetype' AS archetype FROM system_events
    WHERE payload ? 'archetype') s`;
const everInvoked = new Set((invoked ?? []).filter(Boolean));

const ENUMERATORS = {
  workflow: '/api/admin/workflows/templates',
  agent: '/api/admin/agents',
};
const enumeratorCalled = (k) => uiCalls.has(norm(ENUMERATORS[k]));

const agentRows = archetypes.map((a) => ({
  archetype: a,
  inWorkflow: wfSrc.includes(a),
  namedInUi: enumeratorCalled('agent') || uiSrcAll.includes(a),
  everRan: everInvoked.has(a),
}));

// ── 4 · workflow templates ───────────────────────────────────────────────────
const templates = fs.readdirSync(wfDir)
  .filter((f) => /^on_.*\.py$/.test(f)).map((f) => f.replace(/\.py$/, ''));
const [{ ran }] = await sql`SELECT json_agg(DISTINCT workflow_name) AS ran FROM process_instances`;
const everRan = new Set((ran ?? []).filter(Boolean));
const camel = (s) => s.split('_').map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('');

/**
 * "IS THE NAME IN THE SOURCE" IS THE WRONG QUESTION FOR A LIST THE UI FETCHES.
 *
 * The first version of this join reported 13 of 22 workflow templates as never displayed anywhere,
 * seven of which had demonstrably run. The templates are displayed: `/admin/workflows` renders the
 * whole roster as DAGs from `fetch('/api/admin/workflows/templates')`. A dynamically-enumerated
 * list contains no template names in source BY CONSTRUCTION, so a source-literal scan is
 * guaranteed to report every entry as invisible — a finding manufactured entirely by the
 * instrument. The same holds for the `/admin/agents` archetype roster.
 *
 * So ask whether an ENUMERATOR exists and the UI calls it. If one does, the roster is surfaced and
 * name-matching is not evidence of anything; the per-name scan is kept only as the fallback for
 * when no enumerator is found.
 */

const wfRows = templates.map((t) => ({
  template: t,
  namedInUi: enumeratorCalled('workflow') || uiSrcAll.includes(t) || uiSrcAll.includes(camel(t)),
  viaEnumerator: enumeratorCalled('workflow'),
  everRan: [...everRan].some((r) => r.toLowerCase().replace(/[^a-z]/g, '') === t.toLowerCase().replace(/[^a-z]/g, '')),
}));

await sql.end();

// ── self-test ────────────────────────────────────────────────────────────────
// The join is a claim; check it against answers known by hand before printing 250 rows of verdict.
const T = [
  ['norm collapses both notations to one', norm('/api/portal/[tenantSlug]/proposals') === norm('`/api/portal/${tenantSlug}/proposals`')],
  // Written expecting the UI to fetch this. It does NOT — the page renders the list from its own
  // server-side `sql`. The expectation was wrong, not the join, and that wrong expectation is what
  // surfaced the whole "duplicated" category. Kept as the case that proves it.
  ['a route with no fetch but a server-rendered page is classed DUPLICATED, not unsurfaced',
    uncalled.find((u) => u.route === '/api/portal/[tenantSlug]/proposals')?.duplicatedBy != null],
  ['a route the UI really does fetch is NOT reported',
    !uncalled.some((u) => u.route === '/api/portal/[tenantSlug]/proposals/[proposalId]/full-draft')],
  ['a webhook IS reported, but annotated', !!uncalled.find((u) => u.route === '/api/stripe/webhook')?.reason],
  // Both learned by finding them wrong. Each fails on the code as it stood before the fix above it.
  ['a route called with a built query suffix (`…/pin${qs}`) is NOT reported',
    !uncalled.some((u) => u.route === '/api/portal/[tenantSlug]/cards/[opportunityId]/pin')],
  ['a route called only from a static .html asset is NOT reported',
    !uncalled.some((u) => u.route.startsWith('/api/admin/architecture/'))],
  // Verified by hand: app/admin/site/[pageKey]/page.tsx and the route both import getPage().
  ['a route whose editor page shares its data function is DUPLICATED, not unsurfaced',
    uncalled.find((u) => u.route === '/api/admin/site/pages/[pageKey]')?.duplicatedBy != null],
  // …and the rule must not swallow a route no page shares an implementation with.
  ['the shared-data-fn rule does not over-match',
    uncalled.find((u) => u.route === '/api/admin/site/pages/[pageKey]/versions')?.duplicatedBy == null],
  // Caught by reading the output: a shared VALIDATOR is not a shared answer.
  ['sharing a sync helper (isValidUUID) does not count as duplication',
    uncalled.find((u) => u.route === '/api/portal/[tenantSlug]/vaults/[vaultId]/atoms/[atomId]/download')?.duplicatedBy == null],
  // Verified by hand: the cockpit reaches completeBuildOut() via …/provisioning/[portalId]/release.
  // Both are on screen in nook-detail.tsx; both are built off an `apiBase` PROP.
  ['a route called via a prop-based URL base is cleared by its tail, not reported',
    !uncalled.some((u) => /vaults\/\[vaultId\]\/atoms\/\[atomId\]\/(ingest|download)$/.test(u.route))],
  ['a spare endpoint onto an already-reachable capability is SECOND DOOR, not unsurfaced',
    uncalled.find((u) => u.route === '/api/admin/rfp-curation/[solId]/complete-buildout')?.secondDoor != null],
  ['a route reached only by a ToDo deep-link built in lib/ is NOT reported',
    !uncalled.some((u) => u.route === '/admin/site/content/[id]')],
  ['a path named only by the rbac POLICY TABLE still counts as unsurfaced',
    uncalled.some((u) => u.route === '/api/admin/system')],
  ['tables actually read are not called unread', !unreadTables.some((t) => t.name === 'proposals' || t.name === 'tenants')],
  ['the archetype list is the real one', archetypes.includes('section_drafter') && archetypes.length > 30],
  // The Workflow Map fetches its roster; a name-in-source scan reported all 22 as invisible.
  ['a dynamically-enumerated roster is not reported as invisible', wfRows.every((w) => w.namedInUi)],
];
let bad = 0;
console.log('── join self-test ──');
for (const [why, ok] of T) { console.log(`  ${ok ? '✓' : '✗'} ${why}`); if (!ok) bad++; }
if (bad) console.log(`  ${bad} failure(s) — the reconciliation below is not trustworthy.`);
if (process.argv.includes('--check')) process.exit(bad ? 1 : 0);

// ── report ───────────────────────────────────────────────────────────────────
const external = uncalled.filter((u) => u.reason);
const duplicated = uncalled.filter((u) => !u.reason && u.duplicatedBy);
const secondDoor = uncalled.filter((u) => !u.reason && !u.duplicatedBy && u.secondDoor);
const real = uncalled.filter((u) => !u.reason && !u.duplicatedBy && !u.secondDoor);
console.log(`\n══ 1 · API routes, by how they are reached ══`);
console.log(`   ${routes.length} routes · ${routes.length - uncalled.length} called by a UI fetch`);
console.log(`   …of which ${tailCalled.length} matched only on the URL TAIL (the base is a prop — weaker evidence):`);
for (const t of tailCalled) console.log(`   · ${t.route.padEnd(70)} ← …${t.tail}`);
console.log(`   ${external.length} have a stated external caller (webhook · scheduler · crawler · agent adapter)`);
console.log(`   ${duplicated.length} DUPLICATED — a page renders the same data server-side, so the route has no caller:`);
for (const u of duplicated) console.log(`   · ${u.methods.join('/').padEnd(16)} ${u.route.padEnd(58)} ← ${u.duplicatedBy}`);
console.log(`\n   ${secondDoor.length} SECOND DOOR — uncalled, but the capability is reachable through another route:`);
for (const u of secondDoor) console.log(`   · ${u.methods.join('/').padEnd(16)} ${u.route.padEnd(58)} ← ${u.secondDoor}`);
console.log(`\n   ${real.length} UNSURFACED — nothing calls them and no page covers them:`);
for (const u of real) console.log(`   · ${u.methods.join('/').padEnd(16)} ${u.route}${u.nearMiss ? '   (a neighbouring path IS called)' : ''}`);

console.log(`\n══ 2 · tables holding rows that NO code reads ══`);
console.log(`   ${withRows.length} tables with rows · ${unreadTables.length} unreferenced by app or pipeline SQL`);
for (const t of unreadTables) console.log(`   · ${t.name.padEnd(38)} ${t.rows} row(s)`);

console.log(`\n══ 3 · agent archetypes ══`);
const noPath = agentRows.filter((a) => !a.inWorkflow);
const neverRan = agentRows.filter((a) => a.inWorkflow && !a.everRan);
console.log(`   ${agentRows.length} archetypes · ${agentRows.filter((a) => a.everRan).length} have actually run on this box`);
console.log(`   ${noPath.length} appear in NO workflow template (no way to start them):`);
for (const a of noPath) console.log(`   · ${a.archetype}${a.namedInUi ? '   (named in UI source)' : ''}`);
console.log(`   ${neverRan.length} are wired to a workflow but have never run here:`);
console.log(`     ${neverRan.map((a) => a.archetype).join(', ') || '—'}`);

console.log(`\n══ 4 · workflow templates ══`);
const wfSilent = wfRows.filter((w) => !w.namedInUi);
console.log(`   ${wfRows.length} templates · ${wfRows.filter((w) => w.everRan).length} have run here`);
console.log(wfRows[0]?.viaEnumerator
  ? `   the roster is rendered dynamically from ${ENUMERATORS.workflow}, so every template IS displayed`
  : `   ${wfSilent.length} never named anywhere in the UI:`);
for (const w of wfSilent) console.log(`   · ${w.template}${w.everRan ? '   (HAS run — so it works and nothing shows it)' : ''}`);

console.log(`\n══ 5 · events emitted with no human label ══`);
console.log(`   ${(tenantTypes ?? []).length} types have reached a customer's feed · ${labelled.size} labels are written`);
console.log(`   ${unlabelled.length} of those arrive as a de-punctuated identifier:`);
for (const t of unlabelled) console.log(`   · ${t.padEnd(46)} → "${t.replace(/[._]/g, ' ')}"`);

fs.writeFileSync(path.join(REPO, 'docs/capability-reconciliation.json'),
  JSON.stringify({ uncalled, tailCalled, unreadTables, agents: agentRows, workflows: wfRows, unlabelled }, null, 1));
console.log(`\nwrote docs/capability-reconciliation.json`);
