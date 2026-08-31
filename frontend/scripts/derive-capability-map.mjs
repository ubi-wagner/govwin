/**
 * derive-capability-map — what can each actor DO, derived from the tree rather than remembered.
 *
 * Two questions, answered separately because they have different answers:
 *
 *   rfp_admin      the platform side: ingest, curation, release, provisioning. PLATFORM scope —
 *                  `tenant_id IS NULL` — and NO ambient cross-tenant reach into tenant space.
 *   tenant_admin   the customer side: buckets, cards, proposals, projects, the team.
 *
 * The gate for a route is the FIRST of three, in this order, because that is the order the request
 * actually meets them: middleware's PATH_MIN_ROLE prefix, then any in-page `canX()` guard, then the
 * handler's own `requiredRole`. Reporting only the middleware prefix would say `/portal/**` is open
 * to partner_user, which is true of the prefix and false of most of the pages behind it.
 *
 * Output: docs/capability-map.json (repo root)
 * Usage:  node scripts/derive-capability-map.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

// The app tree is frontend/, the docs tree is the repo root. Keeping them apart, so this cannot
// write a second docs/ under frontend the way the first version of capture-stage-walk did.
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const REPO = path.resolve(ROOT, '..');
const RANK = { master_admin: 100, rfp_admin: 80, tenant_admin: 60, partner_admin: 50, tenant_user: 40, partner_user: 20 };

const PATH_MIN_ROLE = [
  { prefix: '/admin/system', role: 'master_admin' },
  { prefix: '/api/admin/system', role: 'master_admin' },
  { prefix: '/admin', role: 'rfp_admin' },
  { prefix: '/api/admin', role: 'rfp_admin' },
  { prefix: '/architecture', role: 'rfp_admin' },
  { prefix: '/partner', role: 'partner_admin' },
  { prefix: '/api/partner', role: 'partner_admin' },
  { prefix: '/portal', role: 'partner_user' },
  { prefix: '/api/portal', role: 'partner_user' },
  { prefix: '/dashboard', role: 'tenant_user' },
];
const prefixRole = (p) => PATH_MIN_ROLE.find(({ prefix }) => p === prefix || p.startsWith(prefix + '/'))?.role ?? null;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const routeOf = (file) =>
  '/' + path.relative(path.join(ROOT, 'app'), path.dirname(file)).split(path.sep)
    .filter((s) => !/^\(.*\)$/.test(s)).join('/');

// ── Page routes ────────────────────────────────────────────────────────────────────────────────
const pages = walk(path.join(ROOT, 'app'))
  .filter((f) => path.basename(f) === 'page.tsx')
  .map((f) => {
    const src = fs.readFileSync(f, 'utf8');
    const route = routeOf(f) === '/' ? '/' : routeOf(f);
    // The IN-PAGE guard, which is the real gate for the portal tree. A page that calls
    // canManageBuckets is tenant_admin-or-designee regardless of what the /portal prefix says.
    const guards = [];
    for (const g of ['canManageBuckets', 'canAdministerTenant', 'canManagePartnerTenants', 'verifyTenantAccess', 'isPlatformAdmin', 'requireRole']) {
      if (new RegExp(`\\b${g}\\s*\\(`).test(src)) guards.push(g);
    }
    const redirectsUnless = /if\s*\(\s*!\s*\(?await\s+can\w+\(/.test(src) || /if\s*\(\s*!can\w+\)/.test(src);
    return { route, file: path.relative(ROOT, f), prefixRole: prefixRole(route), guards, redirectsUnless };
  })
  .sort((a, b) => a.route.localeCompare(b.route));

// ── API routes and their verbs ─────────────────────────────────────────────────────────────────
const apis = walk(path.join(ROOT, 'app'))
  .filter((f) => path.basename(f) === 'route.ts')
  .map((f) => {
    const src = fs.readFileSync(f, 'utf8');
    const verbs = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].filter((v) =>
      new RegExp(`export\\s+(async\\s+)?function\\s+${v}\\b`).test(src));
    const route = routeOf(f);
    const guards = [];
    for (const g of ['canManageBuckets', 'canAdministerTenant', 'verifyTenantAccess', 'hasRoleAtLeast', 'isPlatformAdmin']) {
      if (new RegExp(`\\b${g}\\s*\\(`).test(src)) guards.push(g);
    }
    return { route, verbs, prefixRole: prefixRole(route), guards, file: path.relative(ROOT, f) };
  })
  .filter((r) => r.verbs.length)
  .sort((a, b) => a.route.localeCompare(b.route));

// ── Agent tools, which carry their own requiredRole ────────────────────────────────────────────
// PER DECLARATION, not per file. The first version read one `requiredRole:` per file and named it
// with the file's first `name:` — which silently dropped every tool after the first in any file
// declaring several (registry.ts declares two), and attributed a base-class example in base.ts as a
// real tool. A scanner that quietly drops what it cannot see reports a clean, wrong number.
const tools = [];
const toolWarnings = [];
if (fs.existsSync(path.join(ROOT, 'lib/tools'))) {
  for (const f of walk(path.join(ROOT, 'lib/tools')).filter((x) => x.endsWith('.ts'))) {
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(ROOT, f);
    // Each `requiredRole:` is one tool. Attribute it to the nearest `name:` ABOVE it, which is how
    // these objects are written; if there is none, report it rather than inventing a name.
    const roleRe = /requiredRole:\s*'([a-z_]+)'/g;
    let m;
    while ((m = roleRe.exec(src)) !== null) {
      const before = src.slice(0, m.index);
      const name = [...before.matchAll(/name:\s*'([a-z0-9_.]+)'/g)].pop()?.[1] ?? null;
      // tenantScoped is declared on the line AFTER requiredRole, not before it. Looking backwards
      // found nothing and reported "platform-scope 0" for a registry that is mostly platform-scope
      // — a clean number about the wrong direction. Look FORWARD, and bound the window so it cannot
      // reach into the next tool's declaration.
      const after = src.slice(m.index, m.index + 400);
      const scoped = /tenantScoped:\s*(true|false)/.exec(after)?.[1] ?? null;
      if (!name) { toolWarnings.push(`${rel}: a requiredRole with no name above it — UNNAMED, not skipped`); }
      if (!scoped) { toolWarnings.push(`${rel}: "${name}" declares no tenantScoped within 400 chars — UNKNOWN, not assumed`); }
      tools.push({ name: name ?? `(unnamed in ${path.basename(rel)})`, role: m[1], tenantScoped: scoped, file: rel });
    }
  }
}
// base.ts is the abstract shape every tool extends, not a tool anyone can call. Excluded WITH A
// REASON stated, because an unexplained exclusion is how a real capability leaves a checklist.
const toolExclusions = tools.filter((t) => t.file.endsWith('lib/tools/base.ts'));
const callableTools = tools.filter((t) => !t.file.endsWith('lib/tools/base.ts'));

// ── Classify each surface into the two lanes ───────────────────────────────────────────────────
const lane = (r) => {
  if (r.route.startsWith('/admin') || r.route.startsWith('/api/admin')) return 'rfp_admin';
  if (r.route.startsWith('/partner') || r.route.startsWith('/api/partner')) return 'partner_admin';
  if (r.route.startsWith('/portal') || r.route.startsWith('/api/portal')) return 'tenant';
  return 'shared';
};

const byLane = (rows) => rows.reduce((m, r) => { (m[lane(r)] ??= []).push(r); return m; }, {});
const pageLanes = byLane(pages);
const apiLanes = byLane(apis);

const count = (o, k) => (o[k] ?? []).length;
const verbCount = (rows) => (rows ?? []).reduce((n, r) => n + r.verbs.length, 0);

const summary = {
  generatedAt: new Date().toISOString(),
  pages: { total: pages.length, rfp_admin: count(pageLanes, 'rfp_admin'), tenant: count(pageLanes, 'tenant'), partner_admin: count(pageLanes, 'partner_admin'), shared: count(pageLanes, 'shared') },
  apiRoutes: { total: apis.length, rfp_admin: count(apiLanes, 'rfp_admin'), tenant: count(apiLanes, 'tenant'), partner_admin: count(apiLanes, 'partner_admin'), shared: count(apiLanes, 'shared') },
  verbs: { total: verbCount(apis), rfp_admin: verbCount(apiLanes.rfp_admin), tenant: verbCount(apiLanes.tenant), partner_admin: verbCount(apiLanes.partner_admin), shared: verbCount(apiLanes.shared) },
  tools: { total: callableTools.length, byRole: callableTools.reduce((m, t) => { m[t.role] = (m[t.role] ?? 0) + 1; return m; }, {}), platformScope: callableTools.filter((t) => t.tenantScoped === 'false').length, excludedBaseShapes: toolExclusions.length, warnings: toolWarnings },
  ranks: RANK,
};

fs.mkdirSync(path.join(REPO, 'docs'), { recursive: true });
fs.writeFileSync(path.join(REPO, 'docs/capability-map.json'),
  JSON.stringify({ summary, pages, apis, tools: callableTools }, null, 2));

console.log('\nderive-capability-map\n');
console.log(`  pages        ${summary.pages.total}   admin ${summary.pages.rfp_admin} · tenant ${summary.pages.tenant} · partner ${summary.pages.partner_admin} · shared ${summary.pages.shared}`);
console.log(`  API routes   ${summary.apiRoutes.total}   admin ${summary.apiRoutes.rfp_admin} · tenant ${summary.apiRoutes.tenant} · partner ${summary.apiRoutes.partner_admin} · shared ${summary.apiRoutes.shared}`);
console.log(`  verbs        ${summary.verbs.total}   admin ${summary.verbs.rfp_admin} · tenant ${summary.verbs.tenant} · partner ${summary.verbs.partner_admin} · shared ${summary.verbs.shared}`);
console.log(`  agent tools  ${summary.tools.total}   ${JSON.stringify(summary.tools.byRole)} · platform-scope ${summary.tools.platformScope}`);
if (toolExclusions.length) console.log(`               (${toolExclusions.length} excluded: lib/tools/base.ts is the abstract shape, not a callable tool)`);
for (const w of toolWarnings) console.log(`  ⚠️  ${w}`);
console.log('\n  admin pages:');
for (const p of pageLanes.rfp_admin ?? []) console.log(`    ${p.route}`);
console.log('\n  tenant pages:');
for (const p of pageLanes.tenant ?? []) console.log(`    ${p.route}${p.guards.length ? '   [' + p.guards.join(', ') + ']' : ''}`);
console.log('\n→ docs/capability-map.json (repo root)');
