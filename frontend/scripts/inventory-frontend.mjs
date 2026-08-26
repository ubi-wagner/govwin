#!/usr/bin/env node
/**
 * inventory-frontend.mjs — the SWEEP MANIFEST for the frontend.
 *
 * WHY THIS EXISTS. docs/SCRIPT_INVENTORY.md answers "which of the 271 harness scripts still runs".
 * Nothing answered the larger question the four lenses assume: **what is the full set of things a
 * sweep has to touch, and what is inside each one?** Every sweep here has enumerated its own scope
 * — verify-surfaces walks `page.tsx`, verify-api-contract walks `route.ts` — so the surfaces that
 * belong to NEITHER walk (components, lib modules, server actions, middleware) have never appeared
 * in a coverage number at all. A surface a lens has no expectation for is *uncovered, not passing*
 * (CLAUDE.md), and you cannot say which those are without first writing down the whole set.
 *
 * WHAT IT EMITS. `docs/FRONTEND_INVENTORY.md` — every file in the sweep scope with its COMPONENTS
 * (the meaningful units inside it), plus a coverage join against the four lenses and the unit
 * suite. Machine-readable twin at `docs/frontend-inventory.json` for other harnesses to consume.
 *
 * HOW IT PARSES. The TypeScript compiler API, not regex. This is deliberate: the regex version of
 * this script reported 61 API routes with "no auth gate" because the gate is often reached through
 * a helper (`requireAdmin`, `verifyTenantAccess`) rather than a literal `await auth()`, and a
 * further 12 because the export was `export const GET = withX(...)` rather than a function
 * declaration. Both classes are invisible to a line-oriented match and obvious to a syntax tree.
 * The rule from B74 applies directly — a tool that silently cannot see a construct reports the
 * files containing it as clean.
 *
 * WHAT IT DOES NOT DO. It does not decide whether a finding is real. Everything under "signals"
 * is a CANDIDATE for a human/agent to verify against the source; several signals have known,
 * legitimate exceptions (an admin console reading `sqlBypass` on purpose, a public marketing page
 * with no auth gate by design), and those are annotated rather than filtered so the count stays
 * honest about what it measured.
 *
 *   node scripts/inventory-frontend.mjs            # writes docs/FRONTEND_INVENTORY.md + .json
 *   node scripts/inventory-frontend.mjs --check    # self-test the parser against known answers
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..');
const REPO = path.resolve(FRONTEND, '..');

// ── file walk ────────────────────────────────────────────────────────────────
const SKIP_DIRS = new Set(['node_modules', '.next', 'e2e-artifacts', 'blocker-shots', 'ocr-data', '.git', 'public']);

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      await walk(full, out);
    } else if (/\.(ts|tsx|mts)$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

// ── classification ───────────────────────────────────────────────────────────
function classify(rel) {
  if (rel === 'middleware.ts') return 'middleware';
  if (rel === 'auth.ts' || rel === 'auth.config.ts') return 'auth';
  if (/^app\/.*\/route\.tsx?$/.test(rel)) return 'api-route';
  if (/^app\/.*page\.tsx$/.test(rel)) return 'page';
  if (/^app\/.*layout\.tsx$/.test(rel)) return 'layout';
  if (/^app\/.*(error|not-found|loading|template)\.tsx$/.test(rel)) return 'app-boundary';
  if (/^app\/actions\//.test(rel)) return 'server-action';
  if (/^app\//.test(rel)) return 'app-component';
  if (/^components\//.test(rel)) return 'component';
  if (/^lib\/.*\/__tests__\//.test(rel) || /\.test\.tsx?$/.test(rel)) return 'test';
  if (/^__tests__\//.test(rel)) return 'test';
  if (/^lib\//.test(rel)) return 'lib';
  if (/^e2e\//.test(rel)) return 'e2e';
  if (/^scripts\//.test(rel)) return 'script';
  return 'other';
}

/** app-router path for a page/route file: app/portal/[tenantSlug]/page.tsx → /portal/[tenantSlug] */
function routePath(rel) {
  let p = rel.replace(/^app/, '').replace(/\/(page|route)\.tsx?$/, '');
  // strip route groups: /(marketing)/about → /about
  p = p.replace(/\/\([^)]+\)/g, '');
  return p === '' ? '/' : p;
}

// ── the parse ────────────────────────────────────────────────────────────────
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/**
 * Collect the exported names of a source file, plus the shape facts a sweep cares about.
 * Handles the four export forms that appear in this tree — `export function f`,
 * `export const f =`, `export default`, and `export { a, b }` — because a matcher that knows
 * only the first two silently under-reports (see the header).
 */
function parseFile(fullPath, rel, kind) {
  const text = readFileSync(fullPath, 'utf8');
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, /*setParentNodes*/ true, /\.tsx$/.test(rel) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

  const exports = [];
  const imports = [];
  const calls = new Set();
  const jsxComponents = new Set();
  let hasUseClient = false;
  let defaultExportName = null;
  let tryCount = 0;
  const sqlTags = []; // { tag, line }
  const snakeRowTypes = []; // { field, line } — snake_case fields in a sql<T> row assertion
  let ownClientSql = 0;     // sql<T> tags on a client this file built itself (no toCamel) — unmeasured, not clean
  const jsonResponses = []; // NextResponse.json(...) argument text, for envelope checks

  // Does THIS file's `sql` / `sqlBypass` come from lib/db (and therefore carry postgres.toCamel)?
  // Decided from the import list before any tag is inspected — see the note at the row-type check.
  const fromLibDb = /import\s*\{[^}]*\b(sql|sqlBypass)\b[^}]*\}\s*from\s*['"](@\/lib\/db|\.{1,2}(\/[^'"]*)?\/lib\/db|\.{1,2}\/db)['"]/.test(text);

  // 'use client' / 'use server' prologue
  for (const stmt of sf.statements) {
    if (ts.isExpressionStatement(stmt) && ts.isStringLiteral(stmt.expression)) {
      if (stmt.expression.text === 'use client') hasUseClient = true;
    } else break;
  }

  const isExported = (node) =>
    !!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const isDefault = (node) =>
    !!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);

  function visit(node) {
    // ── exports ──
    if (ts.isFunctionDeclaration(node) && isExported(node)) {
      const name = node.name?.text ?? 'default';
      exports.push({ name, form: 'function', async: !!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) });
      if (isDefault(node)) defaultExportName = name;
    } else if (ts.isVariableStatement(node) && isExported(node)) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) {
          const init = d.initializer;
          const form =
            init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? 'function'
              : init && ts.isCallExpression(init) ? 'wrapped'
                : 'const';
          exports.push({ name: d.name.text, form, async: !!(init && init.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) });
        }
      }
    } else if (ts.isClassDeclaration(node) && isExported(node)) {
      exports.push({ name: node.name?.text ?? 'default', form: 'class' });
    } else if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const el of node.exportClause.elements) exports.push({ name: el.name.text, form: 're-export' });
    } else if (ts.isExportAssignment(node)) {
      exports.push({ name: 'default', form: 'default' });
      if (ts.isIdentifier(node.expression)) defaultExportName = node.expression.text;
    } else if ((ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) && isExported(node)) {
      exports.push({ name: node.name.text, form: 'type' });
    }

    // ── imports ──
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      const names = [];
      const c = node.importClause;
      if (c?.name) names.push(c.name.text);
      if (c?.namedBindings) {
        if (ts.isNamedImports(c.namedBindings)) for (const el of c.namedBindings.elements) names.push(el.name.text);
        else if (ts.isNamespaceImport(c.namedBindings)) names.push('* as ' + c.namedBindings.name.text);
      }
      imports.push({ spec, names });
    }

    // ── call expressions (the gate/helper vocabulary) ──
    if (ts.isCallExpression(node)) {
      const e = node.expression;
      let name = null;
      if (ts.isIdentifier(e)) name = e.text;
      else if (ts.isPropertyAccessExpression(e)) name = `${e.expression.getText(sf)}.${e.name.text}`;
      if (name) {
        calls.add(name);
        if (name === 'NextResponse.json' && node.arguments.length) {
          jsonResponses.push({
            arg: node.arguments[0].getText(sf).slice(0, 400),
            opts: node.arguments[1]?.getText(sf) ?? '',
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          });
        }
      }
    }

    // ── tagged template SQL (sql`…`, sqlBypass`…`, sql<T>`…`) ──
    if (ts.isTaggedTemplateExpression(node)) {
      const tagText = node.tag.getText(sf);
      // sql<Array<{…}>>` — the form B74's regex could not see. Take the identifier head.
      const head = tagText.split('<')[0].trim();
      if (/(^|\.)sql(Bypass)?$/.test(head) || head === 'sql' || head === 'sqlBypass') {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        sqlTags.push({ tag: head, line });

        // THE #1 RUNTIME-CRASH CLASS (CLAUDE.md · SOP Data Layer). lib/db.ts applies
        // postgres.toCamel to both pools, so EVERY column comes back camelCased. A manual row-type
        // assertion whose fields are declared snake_case COMPILES — tsc trusts the assertion — and
        // every read is `undefined` at runtime. It shipped twice: `new Date(undefined)` → a 500,
        // and a silently-dropped volume grouping in an assembled document. tsc cannot catch it by
        // construction, and a unit test only catches it if it happens to read that field. The
        // syntax tree can see it directly: look for snake_case property names in the type argument.
        //
        // BUT ONLY WHERE toCamel ACTUALLY APPLIES. The transform is a property of the CLIENT, not
        // of the tag name. `scripts/drive-collaborator-boundary.mts` builds its own
        // `postgres(url, {max:2})` with no transform, so its columns come back snake_case and its
        // snake_case row type is CORRECT. The first version of this check flagged it as a bug —
        // three confident, wrong findings, and exactly the failure CLAUDE.md names: a new harness's
        // first output describes the harness. So gate on the IMPORT: only a `sql`/`sqlBypass` bound
        // from lib/db carries toCamel. Files using a local client are recorded as `ownClient`
        // rather than dropped, so the count stays honest about what it did and did not measure.
        if (!fromLibDb) { ownClientSql++; }
        for (const ta of (fromLibDb ? node.typeArguments ?? [] : [])) {
          const walkType = (t) => {
            if (ts.isPropertySignature(t) && t.name && ts.isIdentifier(t.name) && /[a-z]_[a-z]/.test(t.name.text)) {
              snakeRowTypes.push({ field: t.name.text, line: sf.getLineAndCharacterOfPosition(t.getStart(sf)).line + 1 });
            }
            ts.forEachChild(t, walkType);
          };
          walkType(ta);
        }
      }
    }

    if (ts.isTryStatement(node)) tryCount++;

    // ── JSX element names (the components a page actually renders) ──
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const n = node.tagName.getText(sf);
      if (/^[A-Z]/.test(n)) jsxComponents.add(n);
    }

    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sf, visit);

  const out = {
    file: rel,
    kind,
    lines: text.split('\n').length,
    bytes: text.length,
    client: hasUseClient,
    exports,
    imports,
    tryCount,
    sqlTags,
    calls: [...calls],
    jsx: [...jsxComponents],
    snakeRowTypes,
    ownClientSql,
  };

  // The envelope is a property of ANY file that answers an HTTP request, not only files named
  // `route.ts`. Scoping this to `kind === 'api-route'` is what hid the finding this sweep opened
  // with: middleware.ts fronts all 250 routes and answered `{error:'unauthenticated'}` with no
  // `code`, and the check could not see it because middleware is not an api-route. Same shape as
  // B113 — a tenant_id-shaped instrument cannot see a lineage-shaped table. Collect everywhere.
  out.jsonResponses = jsonResponses;

  if (kind === 'api-route') {
    out.route = routePath(rel);
    out.methods = exports.filter((e) => HTTP_METHODS.has(e.name)).map((e) => e.name).sort();
    out.runtime = exports.find((e) => e.name === 'runtime') ? 'declared' : null;
    out.dynamic = /export const dynamic\s*=/.test(text);
  }
  if (kind === 'page' || kind === 'layout') {
    out.route = routePath(rel);
    out.dynamic = /export const dynamic\s*=/.test(text);
    out.params = (out.route.match(/\[[^\]]+\]/g) ?? []);
  }
  return out;
}

// ── gate vocabulary ─────────────────────────────────────────────────────────
// Reached through helpers as often as through `await auth()` directly, so match the SET, not one
// spelling. Missing this is what made the regex draft report 61 phantom "ungated" routes, and
// `withHandler` — the wrapper form `export const GET = withHandler({ requireAuth: true, … })` —
// was the last one missing: four routes including the master_admin-only /api/admin/system read as
// ungated until it was added. Each addition here was a phantom finding first.
const AUTH_CALLS = ['auth', 'requireAdmin', 'requireRole', 'requireUser', 'getSession', 'resolveVaultAccess', 'verifyTenantAccess', 'requireApiAuth', 'resolveActor', 'withHandler'];

/**
 * THREE DIFFERENT THINGS, and lumping them together is how a real gap would hide.
 *
 *   AUTHORISE  does THIS actor belong to THAT tenant / proposal / vault?
 *   SCOPE      pin the RLS context so the database enforces it too
 *   RESOLVE    turn a slug into an id — no authority claim whatsoever
 *
 * The first draft counted `getTenantBySlug` as tenant scoping, which made every portal route look
 * gated: 117 of 117. But resolving `/portal/<slug>/…` to a tenant id says nothing about whether the
 * caller may read it, and middleware cannot help — it authorises by ROLE prefix, so any
 * `partner_user` passes `/portal/ANY-SLUG/…`. A route that resolves and never authorises is a
 * cross-tenant read, and the merged vocabulary could not have reported one.
 *
 * Separated, the check becomes the SOP's own sentence: "Always verify tenant access before
 * returning tenant-specific data." Scoping alone is not enough either — RLS refuses foreign ROWS,
 * but a 200 with an empty list where a 403 belongs is still the wrong answer.
 */
const TENANT_AUTHORISE = ['verifyTenantAccess', 'verifyProposalAccess', 'resolveVaultAccess', 'resolveUserAccess', 'verifyPortalAccess', 'requireTenantMember'];
const TENANT_SCOPE = ['withTenant', 'enterTenant', 'runInTenant'];
const TENANT_RESOLVE = ['getTenantBySlug'];
const TENANT_CALLS = [...TENANT_AUTHORISE, ...TENANT_SCOPE, ...TENANT_RESOLVE];

// The SECOND gate layer, and the reason a page can carry none of the above and still be safe.
// middleware.ts enforces `requiredRoleForPath` over PATH_MIN_ROLE prefixes for every request its
// matcher sees (i.e. everything but static assets). A page under /admin with no `auth()` call is
// gated to rfp_admin whether or not it says so. Reporting those as "no gate" is true of the FILE
// and false of the SURFACE, which is the kind of accurate-but-misleading number that sends the
// next reader hunting. Mirrored from lib/rbac.ts — longest prefix first, first match wins.
const PATH_MIN_ROLE = [
  ['/admin/system', 'master_admin'],
  ['/api/admin/system', 'master_admin'],
  ['/admin', 'rfp_admin'],
  ['/api/admin', 'rfp_admin'],
  ['/architecture', 'rfp_admin'],
  ['/partner', 'partner_admin'],
  ['/api/partner', 'partner_admin'],
  ['/portal', 'partner_user'],
  ['/api/portal', 'partner_user'],
  ['/dashboard', 'tenant_user'],
];
function middlewareRoleFor(route) {
  if (!route) return null;
  for (const [prefix, role] of PATH_MIN_ROLE) {
    if (route === prefix || route.startsWith(prefix + '/')) return role;
  }
  return null;
}
/** A page whose whole body is `redirect(...)` reads no data, so it needs no tenant gate. */
function isPureRedirect(rec) {
  return rec.calls.includes('redirect') && rec.sqlTags.length === 0
    && !rec.calls.some((c) => TENANT_CALLS.includes(c));
}

function gateOf(rec) {
  const c = new Set(rec.calls);
  const imported = new Set(rec.imports.flatMap((i) => i.names));
  const found = AUTH_CALLS.filter((n) => c.has(n) || imported.has(n));
  return found;
}
function tenantScopeOf(rec) {
  const c = new Set(rec.calls);
  const imported = new Set(rec.imports.flatMap((i) => i.names));
  return TENANT_CALLS.filter((n) => c.has(n) || imported.has(n));
}
/** Only the calls that actually decide whether THIS actor may see THAT tenant's data. */
function tenantAuthOf(rec) {
  const c = new Set(rec.calls);
  return TENANT_AUTHORISE.filter((n) => c.has(n));
}

// ── SELF-TEST — the instrument before the finding ────────────────────────────
// Every claim this script makes about a file is a claim the parser can get wrong. These are hand-
// verified answers for files chosen because each exercises a construct an earlier draft got wrong.
const SELF_TEST = [
  {
    file: 'app/api/portal/[tenantSlug]/proposals/route.ts',
    expect: (r) => r.methods.includes('GET') && r.route === '/api/portal/[tenantSlug]/proposals'
      && gateOf(r).includes('auth') && tenantScopeOf(r).includes('verifyTenantAccess'),
    why: 'function-declaration exports + helper-reached tenant gate',
  },
  {
    file: 'app/admin/tenants/page.tsx',
    expect: (r) => r.kind === 'page' && r.route === '/admin/tenants'
      && r.sqlTags.some((t) => t.tag === 'sql') && gateOf(r).includes('auth'),
    why: 'a page whose `sql` identifier is an ALIAS of sqlBypass — the tag text is what is written',
  },
  {
    file: 'middleware.ts',
    expect: (r) => r.kind === 'middleware' && r.exports.some((e) => e.name === 'middleware' || e.name === 'config'),
    why: 'root middleware is in scope and is neither a page nor a route',
  },
  {
    file: 'middleware.ts',
    expect: (r) => (r.jsonResponses ?? []).some((j) => /status:\s*401/.test(j.opts)),
    why: 'the envelope check REACHES middleware — the scoping bug this sweep opened with',
  },
  {
    file: 'app/api/admin/system/route.ts',
    expect: (r) => gateOf(r).includes('withHandler'),
    why: '`export const GET = withHandler({requireAuth:true})` counts as a gate',
  },
  {
    file: 'app/portal/[tenantSlug]/pipeline/page.tsx',
    expect: (r) => isPureRedirect(r),
    why: 'a redirect-only page reads nothing, so it needs no tenant gate',
  },
  {
    file: 'app/portal/[tenantSlug]/atoms/page.tsx',
    expect: (r) => !isPureRedirect(r) && tenantScopeOf(r).length > 0,
    why: 'a portal page that READS must verify tenant membership — the control case for the redirect exemption',
  },
];

// The role join is a claim about the product's OTHER gate layer, so assert it against known paths
// rather than trusting the transcription. A stale copy of PATH_MIN_ROLE is worse than none: it
// would silence real findings under a gate that no longer exists.
const ROLE_TEST = [
  ['/admin/system/health', 'master_admin'],
  ['/admin/tenants', 'rfp_admin'],
  ['/api/admin/system', 'master_admin'],
  ['/portal/foundation/cards', 'partner_user'],
  ['/api/portal/foundation/proposals', 'partner_user'],
  ['/about', null],
  ['/api/waitlist', null],
];

function selfTest(records) {
  const byFile = new Map(records.map((r) => [r.file, r]));
  let bad = 0;
  console.log('── parser self-test (validate the instrument before believing its output) ──');
  for (const t of SELF_TEST) {
    const r = byFile.get(t.file);
    if (!r) { console.log(`  ✗ ${t.file} — NOT FOUND in the walk (${t.why})`); bad++; continue; }
    let ok = false;
    try { ok = !!t.expect(r); } catch (e) { ok = false; }
    console.log(`  ${ok ? '✓' : '✗'} ${t.file} — ${t.why}`);
    if (!ok) { bad++; console.log(`      got: ${JSON.stringify({ kind: r.kind, route: r.route, methods: r.methods, gate: gateOf(r), tenant: tenantScopeOf(r), sql: r.sqlTags.map((s) => s.tag) })}`); }
  }
  for (const [route, want] of ROLE_TEST) {
    const got = middlewareRoleFor(route);
    const ok = got === want;
    if (!ok) { bad++; console.log(`  ✗ PATH_MIN_ROLE ${route} → ${got} (expected ${want})`); }
  }
  console.log(`  ${bad ? '✗' : '✓'} PATH_MIN_ROLE mirror agrees with lib/rbac.ts on ${ROLE_TEST.length} known paths`);

  if (bad) console.log(`  ${bad} self-test failure(s) — the manifest below is NOT trustworthy until these pass.`);
  else console.log('  all self-tests pass — parser sees the constructs it claims to.');
  return bad === 0;
}

// ── main ─────────────────────────────────────────────────────────────────────
const files = await walk(FRONTEND);
const records = [];
for (const full of files) {
  const rel = path.relative(FRONTEND, full).split(path.sep).join('/');
  const kind = classify(rel);
  try {
    records.push(parseFile(full, rel, kind));
  } catch (e) {
    records.push({ file: rel, kind, parseError: String(e.message ?? e), exports: [], imports: [], calls: [], sqlTags: [], jsx: [] });
  }
}

const clean = selfTest(records);
if (process.argv.includes('--check')) process.exit(clean ? 0 : 1);

const byKind = (k) => records.filter((r) => r.kind === k);
const pages = byKind('page');
const apis = byKind('api-route');

// ── coverage join: which sweep instrument has an expectation for each surface ──
function readIfExists(p) { try { return readFileSync(p, 'utf8'); } catch { return ''; } }
const lensSources = {
  'verify-surfaces': readIfExists(path.join(FRONTEND, 'scripts/verify-surfaces.mjs')),
  'verify-api-contract': readIfExists(path.join(FRONTEND, 'scripts/verify-api-contract.mjs')),
  'verify-db-crud': readIfExists(path.join(FRONTEND, 'scripts/verify-db-crud.mjs')),
  'verify-ui-vs-db': readIfExists(path.join(FRONTEND, 'scripts/verify-ui-vs-db.mjs')),
};
const unitTestText = records.filter((r) => r.kind === 'test').map((r) => readIfExists(path.join(FRONTEND, r.file))).join('\n');

// verify-surfaces enumerates from the tree, so every page under app/admin + app/portal/[tenantSlug]
// is IN ITS WALK by construction; other pages are not.
function surfaceCovered(r) {
  return /^app\/admin\//.test(r.file) || /^app\/portal\/\[tenantSlug\]\//.test(r.file);
}
/**
 * Is this module imported by any unit test? Matched on the `@/lib/…` alias OR a relative import
 * ending in the module's basename — the two forms the suite actually uses. Deliberately generous:
 * this measures "some test loads this file", not "this file's behaviour is asserted", and calling
 * it coverage would overstate it. It is the floor, and the floor is what tells you which modules
 * NOTHING loads.
 */
function unitCovered(r) {
  const noExt = r.file.replace(/\.(ts|tsx)$/, '');
  const base = path.basename(noExt).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return unitTestText.includes(`@/${noExt}`) || new RegExp(`from '[^']*/${base}'`).test(unitTestText);
}

/**
 * `lib/templates/*` are MOLD DEFINITIONS — data, not logic. They have no unit test by design and
 * are measured instead by `scripts/sweep-mold-quality.mts`, which runs all 39 through the page
 * ruler. Counting them as "uncovered" would inflate the gap by a third and point the next reader at
 * the wrong files, so they are attributed to the harness that does cover them rather than hidden.
 */
function coveredBy(r) {
  if (/^lib\/templates\//.test(r.file)) return 'sweep-mold-quality';
  if (unitCovered(r)) return 'vitest';
  return null;
}

// ── signals: static CANDIDATES, never verdicts ───────────────────────────────
const signals = [];
const MARKETING = (f) => /^app\/\(marketing\)\//.test(f) || /^app\/\(auth\)\//.test(f);

// ── the envelope, checked on EVERY file that answers an HTTP request ──
// Not just `route.ts`. See the note at `out.jsonResponses` above for why this scoping was the bug.
for (const r of records) {
  for (const jr of r.jsonResponses ?? []) {
    const status = /status:\s*(\d{3})/.exec(jr.opts)?.[1];
    if (!status || Number(status) < 400) continue;
    const hasError = /\berror\s*:/.test(jr.arg);
    const hasCode = /\bcode\s*:/.test(jr.arg);
    if (!hasError || !hasCode) {
      const missing = [!hasError && 'error', !hasCode && 'code'].filter(Boolean).join(' + ');
      signals.push({ sig: 'envelope-missing-field', file: r.file, route: r.route ?? r.kind, line: jr.line, note: `HTTP ${status} response missing ${missing}` });
    }
  }
  // The SOP vocabulary is SCREAMING_SNAKE. A lowercase code is not a missing code, but a caller
  // switching on `code === 'UNAUTHENTICATED'` misses it just as completely.
  for (const jr of r.jsonResponses ?? []) {
    const m = /\bcode\s*:\s*'([a-z][a-z_]*)'/.exec(jr.arg);
    if (m) signals.push({ sig: 'envelope-code-not-uppercase', file: r.file, route: r.route ?? r.kind, line: jr.line, note: `code: '${m[1]}' — the rest of the tree uses SCREAMING_SNAKE` });
  }
  if (r.parseError) signals.push({ sig: 'parse-error', file: r.file, note: r.parseError });
  for (const s of r.snakeRowTypes ?? []) {
    signals.push({ sig: 'sql-row-type-snake-case', file: r.file, route: r.route ?? r.kind, line: s.line, note: `\`${s.field}\` in a sql<T> row type — postgres.toCamel returns \`${s.field.replace(/_([a-z])/g, (_, c) => c.toUpperCase())}\`; this read is undefined at runtime` });
  }
}

for (const r of apis) {
  const gate = gateOf(r);
  const mwRole = middlewareRoleFor(r.route);
  if (!gate.length && !mwRole && !/\/api\/(auth|health|cron|webhooks|storage\/local)/.test(r.route)) {
    signals.push({ sig: 'api-no-gate-at-either-layer', file: r.file, route: r.route, note: 'no in-file gate AND no middleware PATH_MIN_ROLE prefix — verify (a deliberately public route is legitimate)' });
  }
  if (r.tryCount === 0 && r.sqlTags.length > 0) {
    signals.push({ sig: 'api-sql-without-try', file: r.file, route: r.route, note: `${r.sqlTags.length} sql tag(s), 0 try blocks — SOP requires every await sql inside try/catch` });
  }
  if (/^\/api\/portal\/\[tenantSlug\]/.test(r.route) && !tenantAuthOf(r).length) {
    signals.push({ sig: 'portal-route-no-tenant-AUTHORISATION', file: r.file, route: r.route, note: `resolves/scopes (${tenantScopeOf(r).join(', ') || 'nothing'}) but calls no authorisation helper — middleware gates ROLE, never membership` });
  }
}

for (const r of pages) {
  const gate = gateOf(r);
  const mwRole = middlewareRoleFor(r.route);
  if (!gate.length && !mwRole && !MARKETING(r.file) && r.route !== '/' && !/^\/(go|select-company|invite)/.test(r.route)) {
    signals.push({ sig: 'page-no-gate-at-either-layer', file: r.file, route: r.route, note: 'no in-file gate AND no middleware prefix' });
  }
  // The gate middleware CANNOT supply: it authorises by role prefix, never by tenant membership.
  // So /portal/<other-tenant>/x passes middleware for any partner_user and is refused only by the
  // page's own verifyTenantAccess. A portal page that READS and does not verify is a cross-tenant
  // read. Pure redirects read nothing and are excluded — with the reason stated, not silently.
  if (/^app\/portal\/\[tenantSlug\]\//.test(r.file) && !tenantAuthOf(r).length && !isPureRedirect(r)) {
    signals.push({ sig: 'portal-page-no-tenant-AUTHORISATION', file: r.file, route: r.route, note: `resolves/scopes (${tenantScopeOf(r).join(', ') || 'nothing'}) but calls no authorisation helper — middleware gates ROLE, never membership` });
  }
}

// ── emit ─────────────────────────────────────────────────────────────────────
const kinds = [...new Set(records.map((r) => r.kind))].sort();
const summary = kinds.map((k) => ({ kind: k, files: byKind(k).length, lines: byKind(k).reduce((a, r) => a + (r.lines ?? 0), 0) }));

const json = {
  generatedFrom: 'frontend/scripts/inventory-frontend.mjs',
  selfTestPassed: clean,
  summary,
  records,
  signals,
};
writeFileSync(path.join(REPO, 'docs/frontend-inventory.json'), JSON.stringify(json, null, 1));

const L = [];
L.push('# FRONTEND INVENTORY — the sweep manifest');
L.push('');
L.push('> Generated by `frontend/scripts/inventory-frontend.mjs`. **Do not hand-edit** — regenerate.');
L.push('>');
L.push('> This is the answer to *"what does a full sweep have to touch, and what is inside each thing"*.');
L.push('> Each lens enumerates its own scope, so anything belonging to no walk has never appeared in a');
L.push('> coverage number. A surface a lens has no expectation for is **uncovered, not passing** — §8');
L.push('> is the join that makes that visible, stated per layer because one number would be a lie.');
L.push('>');
L.push(`> Parser self-test: **${clean ? 'PASS' : 'FAIL — the numbers below are not trustworthy'}**.`);
L.push('');
L.push('## 1. Scope at a glance');
L.push('');
L.push('| kind | files | lines |');
L.push('|---|---:|---:|');
for (const s of summary) L.push(`| ${s.kind} | ${s.files} | ${s.lines.toLocaleString()} |`);
L.push(`| **total** | **${records.length}** | **${records.reduce((a, r) => a + (r.lines ?? 0), 0).toLocaleString()}** |`);
L.push('');

L.push('## 2. Pages — every addressable customer/admin surface');
L.push('');
L.push('Two gate layers, and they answer different questions. **middleware** enforces a minimum ROLE by');
L.push('path prefix for every request; **in-file** is the page\'s own `auth()`/`verifyTenantAccess`.');
L.push('Middleware can never supply the second: it authorises `partner_user` to open `/portal/ANY-SLUG/…`,');
L.push('and only `verifyTenantAccess` decides whether this actor belongs to *that* tenant.');
L.push('');
L.push('| route | file | client | params | middleware gate | in-file gate | tenant scope | renders (components) | in verify-surfaces walk |');
L.push('|---|---|---|---|---|---|---|---|---|');
for (const r of pages.sort((a, b) => a.route.localeCompare(b.route))) {
  const mw = middlewareRoleFor(r.route);
  L.push(`| \`${r.route}\` | ${r.file} | ${r.client ? 'client' : 'server'} | ${r.params.length ? r.params.join(' ') : '—'} | ${mw ?? '— (public)'} | ${gateOf(r).join(', ') || (isPureRedirect(r) ? '— (redirect only)' : '—')} | ${tenantScopeOf(r).join(', ') || '—'} | ${r.jsx.slice(0, 8).join(', ') || '—'}${r.jsx.length > 8 ? ` +${r.jsx.length - 8}` : ''} | ${surfaceCovered(r) ? 'yes' : 'NO'} |`);
}
L.push('');

L.push('## 3. API routes — every addressable endpoint and its methods');
L.push('');
L.push('| route | methods | file | middleware gate | in-file gate | tenant scope | sql tags | try blocks |');
L.push('|---|---|---|---|---|---|---:|---:|');
for (const r of apis.sort((a, b) => a.route.localeCompare(b.route))) {
  const tags = r.sqlTags.length ? `${r.sqlTags.filter((t) => t.tag === 'sql').length}×sql${r.sqlTags.some((t) => t.tag === 'sqlBypass') ? ` ${r.sqlTags.filter((t) => t.tag === 'sqlBypass').length}×bypass` : ''}` : '—';
  L.push(`| \`${r.route}\` | ${r.methods.join(' ') || '—'} | ${r.file} | ${middlewareRoleFor(r.route) ?? '— (public)'} | ${gateOf(r).join(', ') || '—'} | ${tenantScopeOf(r).join(', ') || '—'} | ${tags} | ${r.tryCount} |`);
}
L.push('');

for (const [title, kind] of [['4. Components', 'component'], ['5. Colocated app components', 'app-component'], ['6. Library modules', 'lib']]) {
  const rs = byKind(kind).sort((a, b) => a.file.localeCompare(b.file));
  L.push(`## ${title} — ${rs.length} files`);
  L.push('');
  L.push('| file | client | exports | sql | unit-tested |');
  L.push('|---|---|---|---:|---|');
  for (const r of rs) {
    const names = r.exports.filter((e) => e.form !== 'type').map((e) => e.name);
    L.push(`| ${r.file} | ${r.client ? 'client' : 'server'} | ${names.slice(0, 6).join(', ') || '—'}${names.length > 6 ? ` +${names.length - 6}` : ''} | ${r.sqlTags.length || '—'} | ${kind === 'lib' ? (coveredBy(r) ?? '**none**') : 'n/a'} |`);
  }
  L.push('');
}

const others = records.filter((r) => ['middleware', 'auth', 'layout', 'app-boundary', 'server-action'].includes(r.kind));
L.push('## 7. Framework surfaces (middleware · auth · layouts · boundaries · server actions)');
L.push('');
L.push('| file | kind | exports |');
L.push('|---|---|---|');
for (const r of others.sort((a, b) => a.file.localeCompare(b.file))) {
  L.push(`| ${r.file} | ${r.kind} | ${r.exports.map((e) => e.name).slice(0, 8).join(', ') || '—'} |`);
}
L.push('');

const libs = byKind('lib');
const byHarness = {};
for (const r of libs) (byHarness[coveredBy(r) ?? 'none'] ??= []).push(r);
L.push('## 8. Coverage — what a sweep actually reaches');
L.push('');
L.push('The four lenses drive **surfaces** (pages, API routes). `vitest` drives **modules**. Nothing');
L.push('drives a component directly — a component is exercised only insofar as some page renders it,');
L.push('which `verify-surfaces` does for the admin + portal trees and for nothing else. So the honest');
L.push('statement is per-layer, not one number.');
L.push('');
L.push('| layer | population | reached by | not reached |');
L.push('|---|---:|---|---:|');
L.push(`| pages | ${pages.length} | verify-surfaces (admin + portal trees) | ${pages.filter((r) => !surfaceCovered(r)).length} |`);
L.push(`| API routes (GET) | ${apis.filter((r) => (r.methods ?? []).includes('GET')).length} | verify-api-contract | see that lens's own accounting |`);
L.push(`| API routes (write verbs) | ${apis.filter((r) => (r.methods ?? []).some((m) => m !== 'GET')).length} | verify-db-crud (a chosen subset, not a walk) | not enumerated |`);
L.push(`| lib modules | ${libs.length} | vitest ${byHarness['vitest']?.length ?? 0} · sweep-mold-quality ${byHarness['sweep-mold-quality']?.length ?? 0} | ${byHarness['none']?.length ?? 0} |`);
L.push(`| components | ${byKind('component').length + byKind('app-component').length} | only transitively, via a page that renders them | not measured |`);
L.push('');
L.push('**The write verbs are the real gap.** ' + apis.filter((r) => (r.methods ?? []).some((m) => m !== 'GET')).length + ' routes expose a POST/PATCH/PUT/DELETE and no lens');
L.push('walks them: `verify-api-contract` is GET-only by construction (calling every write verb would');
L.push('mutate the box it is measuring), and `verify-db-crud` proves a hand-picked set of invariants');
L.push('rather than enumerating routes. That is a defensible design and an unstated scope — written');
L.push('down here so the next reader does not mistake three green lenses for a walked API.');
L.push('');
L.push('### lib modules no harness loads');
L.push('');
for (const r of (byHarness['none'] ?? []).sort((a, b) => b.lines - a.lines)) L.push(`- \`${r.file}\` — ${r.lines} lines`);
L.push('');
L.push('## 9. Static signals — CANDIDATES, not findings');
L.push('');
L.push('Each row is something the parser noticed. **None is a verdict.** CLAUDE.md is explicit that a');
L.push("new harness's first output describes the harness; verify every row against the source before");
L.push('acting on it. Legitimate exceptions exist in every category (a public marketing page has no');
L.push('gate by design; an admin cross-tenant console reads `sqlBypass` on purpose).');
L.push('');
const bySig = {};
for (const s of signals) (bySig[s.sig] ??= []).push(s);
for (const [sig, rows] of Object.entries(bySig).sort((a, b) => b[1].length - a[1].length)) {
  L.push(`### \`${sig}\` — ${rows.length}`);
  L.push('');
  L.push('| file | where | note |');
  L.push('|---|---|---|');
  for (const s of rows) L.push(`| ${s.file} | ${s.route ?? ''}${s.line ? `:${s.line}` : ''} | ${s.note} |`);
  L.push('');
}
if (!signals.length) L.push('_No signals._');
L.push('');

writeFileSync(path.join(REPO, 'docs/FRONTEND_INVENTORY.md'), L.join('\n'));

console.log('');
console.log(`── manifest ──`);
for (const s of summary) console.log(`  ${String(s.files).padStart(5)}  ${s.kind}`);
console.log(`  ${String(records.length).padStart(5)}  TOTAL files (${records.reduce((a, r) => a + (r.lines ?? 0), 0).toLocaleString()} lines)`);
console.log('');
console.log(`── static signals (candidates, not findings) ──`);
for (const [sig, rows] of Object.entries(bySig).sort((a, b) => b[1].length - a[1].length)) console.log(`  ${String(rows.length).padStart(5)}  ${sig}`);
if (!signals.length) console.log('  none');
console.log('');
console.log('  wrote docs/FRONTEND_INVENTORY.md + docs/frontend-inventory.json');
