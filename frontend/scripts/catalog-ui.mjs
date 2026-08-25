#!/usr/bin/env node
/**
 * catalog-ui.mjs — EVERY UI path, component, action and callback. The offline half of the atlas.
 *
 * WHY. `docs/FRONTEND_INVENTORY.md` answers "what files exist and which harness reaches them".
 * It does not answer the question a UI sweep actually needs: **what can a person DO here?** A page
 * is not one thing — it is a tree of components, each carrying handlers that fire requests. Those
 * handlers are the product's real surface area, and nothing in this repo had ever counted them:
 * 704 `onClick`, 448 `onChange`, 21 `onSubmit`, spread over 188 components, plus 127 files issuing
 * `fetch`. A sweep that drives 78 routes and calls that "the UI" is measuring the doors and
 * ignoring everything behind them.
 *
 * WHAT IT EMITS
 *   docs/UI_CATALOG.md    every route · every component · every handler · every fetch target,
 *                         with the RENDER GRAPH both ways (what a page renders; who renders a
 *                         component) so an orphan is visible as an orphan.
 *   docs/ui-catalog.json  the machine-readable twin, consumed by capture-ui-atlas.mjs.
 *
 * HOW IT PARSES. TypeScript compiler API. A regex cannot tell `onClick={handleSave}` from
 * `onClick={() => setOpen(false)}` from a prop literally NAMED onClick being passed down, and the
 * difference decides whether a component is interactive or merely forwards its parent's intent.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM. That a catalogued handler WORKS. This is the enumeration;
 * `capture-ui-atlas.mjs` is the observation. Keeping them apart is the point — the catalog is the
 * denominator the screenshots are measured against, and a denominator computed from the same run
 * that produced the numerator proves nothing.
 *
 *   node scripts/catalog-ui.mjs           # writes both files
 *   node scripts/catalog-ui.mjs --check   # self-test the extractor against known answers
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..');
const REPO = path.resolve(FRONTEND, '..');
const SKIP = new Set(['node_modules', '.next', 'e2e-artifacts', 'blocker-shots', 'ocr-data', '.git', 'public', 'scripts', 'e2e', '__tests__']);

async function walk(dir, out = []) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) await walk(full, out); }
    // `route.ts` is an API endpoint, not a UI path. Including it put all 250 of them in the
    // component population — 438 "components" instead of 188 — and then reported every one as an
    // orphan, because an API route has no render path by definition. That would have made the
    // orphan list (the whole point of §5) worthless while looking thorough.
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !/^route\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

/** app-router URL for a page file. Route groups `(marketing)` are organisational, not addressable. */
const routeOf = (rel) => {
  const p = rel.replace(/^app/, '').replace(/\/page\.tsx$/, '').replace(/\/\([^)]+\)/g, '');
  return p === '' ? '/' : p;
};

const HANDLER_RE = /^on[A-Z]/;

function parse(fullPath, rel) {
  const text = readFileSync(fullPath, 'utf8');
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const rec = {
    file: rel,
    lines: text.split('\n').length,
    client: false,
    // A `.ts` file under components/ or app/ is a DATA or helper module, not a component. Calling
    // one an unreachable component is a category error: `card-format.ts` and `admin-nav-data.ts`
    // are imported by components, render nothing, and have no route of their own by construction.
    kind: /\.ts$/.test(rel) && !/\.tsx$/.test(rel) ? 'module'
      : /^app\/.*page\.tsx$/.test(rel) ? 'page'
      : /^app\/.*layout\.tsx$/.test(rel) ? 'layout'
        : /^app\/.*(error|not-found|loading|template)\.tsx$/.test(rel) ? 'boundary'
          : /^app\/actions\//.test(rel) ? 'server-action'
            : /^app\//.test(rel) ? 'app-component' : 'component',
    exports: [],
    renders: [],      // component names this file instantiates in JSX
    handlers: [],     // { on, element, form } — interactive bindings
    fetches: [],      // { method, url }
    forms: 0,
    inputs: 0,
    buttons: 0,
    links: 0,
    localImports: [], // resolved local component imports, for the render graph
  };
  if (rec.kind === 'page') rec.route = routeOf(rel);

  for (const s of sf.statements) {
    if (ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression)) {
      if (s.expression.text === 'use client') rec.client = true;
    } else break;
  }

  const isExported = (n) => !!n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && isExported(node)) rec.exports.push(node.name?.text ?? 'default');
    else if (ts.isVariableStatement(node) && isExported(node)) {
      for (const d of node.declarationList.declarations) if (ts.isIdentifier(d.name)) rec.exports.push(d.name.text);
    }

    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      if (spec.startsWith('@/components') || spec.startsWith('@/app') || spec.startsWith('./') || spec.startsWith('../')) {
        rec.localImports.push(spec);
      }
    }

    // JSX: element names, handler props, and the plain-HTML interaction counters.
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      if (/^[A-Z]/.test(tag)) rec.renders.push(tag);
      if (tag === 'form') rec.forms += 1;
      if (tag === 'input' || tag === 'textarea' || tag === 'select') rec.inputs += 1;
      if (tag === 'button') rec.buttons += 1;
      if (tag === 'a' || tag === 'Link') rec.links += 1;

      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr) || !attr.name) continue;
        const name = attr.name.getText(sf);
        if (!HANDLER_RE.test(name)) continue;
        // An `onClick` on a lowercase tag BINDS behaviour; on a component it PASSES a prop down.
        // Counting them together would double-count every wrapper and inflate the interaction
        // surface — the distinction is the whole reason this uses a syntax tree.
        rec.handlers.push({
          on: name,
          element: tag,
          binds: /^[a-z]/.test(tag),
          line: sf.getLineAndCharacterOfPosition(attr.getStart(sf)).line + 1,
        });
      }
    }

    // fetch('…', { method }) — what a handler actually calls.
    if (ts.isCallExpression(node) && node.expression.getText(sf) === 'fetch' && node.arguments.length) {
      const url = node.arguments[0].getText(sf).replace(/\s+/g, ' ').slice(0, 120);
      const opts = node.arguments[1]?.getText(sf) ?? '';
      const m = /method:\s*'([A-Z]+)'/.exec(opts)?.[1] ?? 'GET';
      rec.fetches.push({ method: m, url });
    }

    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);

  rec.renders = [...new Set(rec.renders)];
  return rec;
}

// ── build ────────────────────────────────────────────────────────────────────
const files = await walk(path.join(FRONTEND, 'app'));
await walk(path.join(FRONTEND, 'components'), files);
const records = files.map((f) => parse(f, path.relative(FRONTEND, f).split(path.sep).join('/')));

// Map an exported component NAME → the file that defines it, so the render graph can resolve.
const definedIn = new Map();
for (const r of records) for (const e of r.exports) if (/^[A-Z]/.test(e)) definedIn.set(e, r.file);

// Reverse graph: who renders me?
const renderedBy = new Map();
for (const r of records) {
  for (const name of r.renders) {
    const target = definedIn.get(name);
    if (!target || target === r.file) continue;
    if (!renderedBy.has(target)) renderedBy.set(target, new Set());
    renderedBy.get(target).add(r.file);
  }
}

/**
 * Which ROUTES can reach this component, walking the render graph upward.
 *
 * A LAYOUT is a terminal too, and forgetting that produced a badly wrong answer: the first version
 * walked up only to a `page`, so every component rendered by a layout — the admin nav, the portal
 * notification panel, the shadow-space banner, the marketing mobile menu — resolved to NO route and
 * was listed as a deprecation candidate. Nine of fifteen "orphans" were chrome that appears on
 * literally every page of a tree. A layout wraps everything beneath it, so its reach is every route
 * under its directory, which is the opposite of unreachable.
 */
const routesUnder = (dir) => pagesOf().filter((p) => p.file.startsWith(dir)).map((p) => p.route);
let _pages = null;
function pagesOf() { return (_pages ??= records.filter((r) => r.kind === 'page')); }

const routesFor = (file, seen = new Set()) => {
  if (seen.has(file)) return [];
  seen.add(file);
  const rec = records.find((r) => r.file === file);
  if (rec?.kind === 'page') return [rec.route];
  if (rec?.kind === 'layout') return routesUnder(file.replace(/\/layout\.tsx$/, '/'));
  const parents = renderedBy.get(file);
  if (!parents) return [];
  return [...new Set([...parents].flatMap((p) => routesFor(p, seen)))];
};

for (const r of records) {
  r.renderedBy = [...(renderedBy.get(r.file) ?? [])];
  r.reachableFrom = r.kind === 'page' ? [r.route] : routesFor(r.file);
  r.bindingHandlers = r.handlers.filter((h) => h.binds).length;
  r.passedHandlers = r.handlers.length - r.bindingHandlers;
}

// ── self-test — the extractor before the finding ─────────────────────────────
const T = [
  // Written expecting a client component with handlers; it is a SERVER page whose form posts to a
  // server action (`signIn`), so it has inputs and ZERO `on*` handlers. The extractor was right and
  // the expectation was wrong — kept as the case that proves handler count is not a proxy for
  // interactivity. A form-action page is fully interactive with no handlers at all.
  ['app/(auth)/login/page.tsx', (r) => !r.client && r.inputs >= 2 && r.handlers.length === 0, 'login is a SERVER page: a form + server action, no on* handlers'],
  ['app/admin/tenants/page.tsx', (r) => r.kind === 'page' && r.route === '/admin/tenants' && !r.client, 'a server page resolves its route and is not marked client'],
  ['app/portal/[tenantSlug]/pipeline/page.tsx', (r) => r.handlers.length === 0 && r.renders.length === 0, 'a redirect-only page has no interaction surface at all'],
];
let bad = 0;
console.log('── extractor self-test ──');
for (const [file, fn, why] of T) {
  const r = records.find((x) => x.file === file);
  let ok = false; try { ok = !!(r && fn(r)); } catch { ok = false; }
  console.log(`  ${ok ? '✓' : '✗'} ${file} — ${why}`);
  if (!ok) { bad++; if (r) console.log(`      got ${JSON.stringify({ client: r.client, route: r.route, inputs: r.inputs, handlers: r.handlers.length, renders: r.renders.length })}`); }
}
// The render graph is a CLAIM about reachability; check it against a component with a known home.
const navCheck = records.find((r) => /components\/portal\//.test(r.file) && r.reachableFrom.length);
console.log(`  ${navCheck ? '✓' : '✗'} render graph resolves at least one portal component to a route${navCheck ? ` (${navCheck.file} → ${navCheck.reachableFrom.slice(0, 2).join(', ')})` : ''}`);
if (!navCheck) bad++;
console.log(bad ? `  ${bad} failure(s) — do not trust the catalog below` : '  extractor sees what it claims to.');
if (process.argv.includes('--check')) process.exit(bad ? 1 : 0);

// ── emit ─────────────────────────────────────────────────────────────────────
const pages = records.filter((r) => r.kind === 'page').sort((a, b) => a.route.localeCompare(b.route));
const comps = records.filter((r) => r.kind === 'component' || r.kind === 'app-component').sort((a, b) => a.file.localeCompare(b.file));
const totals = {
  routes: pages.length,
  components: comps.length,
  handlers: records.reduce((a, r) => a + r.handlers.length, 0),
  binding: records.reduce((a, r) => a + r.bindingHandlers, 0),
  fetches: records.reduce((a, r) => a + r.fetches.length, 0),
  forms: records.reduce((a, r) => a + r.forms, 0),
  inputs: records.reduce((a, r) => a + r.inputs, 0),
  buttons: records.reduce((a, r) => a + r.buttons, 0),
  orphans: comps.filter((r) => !r.reachableFrom.length).length,
};

writeFileSync(path.join(REPO, 'docs/ui-catalog.json'), JSON.stringify({ totals, records }, null, 1));

const L = [];
L.push('# UI CATALOG — every path, component, action and callback');
L.push('');
L.push('> Generated by `frontend/scripts/catalog-ui.mjs`. **Do not hand-edit** — regenerate.');
L.push('> The offline half of the UI atlas; `docs/UI_ATLAS.md` is the observed half (screenshots).');
L.push('');
L.push('A page is not one thing. It is a tree of components, each carrying handlers that fire');
L.push('requests — and those handlers are the product\'s real surface area. Driving routes and calling');
L.push('it "the UI" measures the doors and ignores what is behind them. This counts both.');
L.push('');
L.push('| | count |');
L.push('|---|---:|');
L.push(`| addressable routes | ${totals.routes} |`);
L.push(`| components | ${totals.components} |`);
L.push(`| event handlers (total) | ${totals.handlers} |`);
L.push(`| …of which BIND behaviour (on a DOM element) | ${totals.binding} |`);
L.push(`| …of which PASS a prop to a child component | ${totals.handlers - totals.binding} |`);
L.push(`| \`fetch\` call sites | ${totals.fetches} |`);
L.push(`| \`<form>\` · \`<input>\` · \`<button>\` | ${totals.forms} · ${totals.inputs} · ${totals.buttons} |`);
L.push(`| components NO route can reach (orphans) | **${totals.orphans}** |`);
L.push('');
L.push('## 1. Routes — the addressable surface');
L.push('');
L.push('`interactive` counts handlers bound in the page file itself; a page that renders a component');
L.push('tree carries far more, listed per component in §2.');
L.push('');
L.push('| route | file | client | handlers | fetches | form/input/button | renders |');
L.push('|---|---|---|---:|---:|---|---|');
for (const r of pages) {
  L.push(`| \`${r.route}\` | ${r.file} | ${r.client ? 'client' : 'server'} | ${r.handlers.length} | ${r.fetches.length} | ${r.forms}/${r.inputs}/${r.buttons} | ${r.renders.slice(0, 6).join(', ') || '—'}${r.renders.length > 6 ? ` +${r.renders.length - 6}` : ''} |`);
}
L.push('');
L.push('## 2. Components — the interaction surface, and which routes reach it');
L.push('');
L.push('| component | client | handlers (bind/pass) | fetches | reachable from |');
L.push('|---|---|---|---:|---|');
for (const r of comps) {
  const reach = r.reachableFrom.length
    ? r.reachableFrom.slice(0, 3).join(', ') + (r.reachableFrom.length > 3 ? ` +${r.reachableFrom.length - 3}` : '')
    : '**no route**';
  L.push(`| ${r.file} | ${r.client ? 'client' : 'server'} | ${r.bindingHandlers}/${r.passedHandlers} | ${r.fetches.length} | ${reach} |`);
}
L.push('');
L.push('## 3. Handler census — what kind of interaction, and how much of it');
L.push('');
const byType = {};
for (const r of records) for (const h of r.handlers) (byType[h.on] ??= []).push(r.file);
L.push('| handler | count | distinct files |');
L.push('|---|---:|---:|');
for (const [k, v] of Object.entries(byType).sort((a, b) => b[1].length - a[1].length)) {
  L.push(`| \`${k}\` | ${v.length} | ${new Set(v).size} |`);
}
L.push('');
L.push('## 4. Fetch targets — what the UI actually calls');
L.push('');
const byTarget = {};
for (const r of records) for (const f of r.fetches) {
  const key = `${f.method} ${f.url.replace(/`/g, '').replace(/\$\{[^}]+\}/g, ':p')}`;
  (byTarget[key] ??= new Set()).add(r.file);
}
L.push('| call | from files |');
L.push('|---|---:|');
for (const [k, v] of Object.entries(byTarget).sort((a, b) => b[1].size - a[1].size)) {
  L.push(`| \`${k}\` | ${v.size} |`);
}
L.push('');
L.push('## 5. Components no route can reach');
L.push('');
L.push('Candidates for "deprecated", NOT a verdict — a component may be reached through a dynamic');
L.push('import, a barrel re-export, or a parent this graph could not resolve. Each needs a look.');
L.push('');
const orphans = comps.filter((r) => !r.reachableFrom.length);
if (!orphans.length) L.push('_None — every component resolves to at least one route._');
for (const r of orphans) L.push(`- \`${r.file}\` — ${r.lines} lines · ${r.bindingHandlers} bound handler(s) · rendered by: ${r.renderedBy.join(', ') || '**nothing**'}`);
L.push('');

writeFileSync(path.join(REPO, 'docs/UI_CATALOG.md'), L.join('\n'));

console.log('');
console.log('── UI catalog ──');
for (const [k, v] of Object.entries(totals)) console.log(`  ${String(v).padStart(6)}  ${k}`);
console.log('');
console.log('  wrote docs/UI_CATALOG.md + docs/ui-catalog.json');
