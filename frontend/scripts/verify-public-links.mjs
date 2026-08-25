#!/usr/bin/env node
/**
 * Every internal link on a page a stranger can reach — does it go anywhere?
 *
 * A dead link is not a broken build and not a failing test. `href="/pricing"` typechecks whether or
 * not `/pricing` exists, renders as a perfectly ordinary link, and 404s only when somebody clicks
 * it. The surface sweep cannot catch it either: it drives routes enumerated from the FILE TREE, so
 * it visits pages that exist and never asks whether the links pointing at them do.
 *
 * WHY PUBLIC PAGES SPECIFICALLY. `verify-surfaces` drives `app/admin` and `app/portal/[tenantSlug]`
 * — 82 authenticated pages. The 35 routes outside those two roots, including all 22 marketing pages
 * a stranger sees first, have never been driven by any lens. This is the cheapest instrument that
 * covers part of that gap without a database.
 *
 * WHAT IT PROVES AND WHAT IT DOES NOT. It resolves link TARGETS against the route tree: a reported
 * link definitely points at no page. It says nothing about whether the page renders, whether a
 * button does what it says, or whether the copy is real — those need the running app. Reported as
 * "cannot resolve", never as "the page is broken".
 *
 *   node scripts/verify-public-links.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const APP = path.join(process.cwd(), 'app');

/** Every addressable route in the app, as a matcher. Route groups `(x)` are not URL segments. */
function routeTable() {
  const routes = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, `${rel}/${e.name}`);
      else if (e.name === 'page.tsx' || e.name === 'route.ts') {
        routes.push((rel.replace(/\/\([^)]*\)/g, '') || '/'));
      }
    }
  };
  walk(APP, '');
  return [...new Set(routes)];
}

/** Does `href` match a route, allowing [param] and [...catchall] segments? */
function resolves(href, routes) {
  const want = href.split('#')[0].split('?')[0].replace(/\/$/, '') || '/';
  return routes.some((r) => {
    const rs = r.split('/').filter(Boolean);
    const hs = want.split('/').filter(Boolean);
    if (rs.some((s) => s.startsWith('[...'))) {
      const head = rs.findIndex((s) => s.startsWith('[...'));
      return hs.length >= head && rs.slice(0, head).every((s, i) => s.startsWith('[') || s === hs[i]);
    }
    if (rs.length !== hs.length) return false;
    return rs.every((s, i) => (s.startsWith('[') ? true : s === hs[i]));
  });
}

/**
 * Internal link targets on a line, and whether the line holds any the scanner cannot read.
 *
 * TWO CORRECTIONS, and the first version was green because of both. It matched only bare string
 * literals, so `href={cta?.metadata?.cta?.href ?? '/apply'}` — the shape most CTAs on this site use
 * — contributed nothing, and it found 23 links across a surface carrying 48 `href=` occurrences in
 * the marketing tree alone. And it SKIPPED dynamic hrefs in silence, which is the failure this
 * codebase keeps re-learning: a target it cannot address is UNCOVERED, and reporting a sweep as
 * clean when a third of it was never looked at is how a check ends up narrower than its own
 * sentence.
 *
 * So: pull every `/…` string literal out of the whole attribute, expression or not, and separately
 * count the attributes that resolve to a runtime value with no literal to check.
 */
function linksIn(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const found = [];
  const dynamic = [];
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/href=(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/g)) {
      const raw = m[1] ?? m[2] ?? m[3] ?? '';
      const attr = m[0];
      // Literals anywhere in the attribute — including a `?? '/apply'` fallback.
      const lits = [...raw.matchAll(/["'`](\/[^"'`\s${}]*)["'`]/g)].map((x) => x[1]);
      if (m[1] !== undefined || m[2] !== undefined) {
        if (raw.startsWith('/')) { found.push({ href: raw, line: i + 1 }); continue; }
        continue;                                      // external / mailto / anchor
      }
      for (const l of lits) found.push({ href: l, line: i + 1 });
      // An expression with no internal literal at all is a target this instrument cannot read.
      if (!lits.length && !/^\s*["'`](https?:|mailto:|tel:|#)/.test(raw)) {
        dynamic.push({ line: i + 1, attr: attr.slice(0, 72) });
      }
    }
  });
  return { found, dynamic };
}

function filesUnder(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

const routes = routeTable();
// The public surface: what a stranger reaches, plus the shared chrome those pages mount.
const roots = ['(marketing)', '(auth)'].map((r) => path.join(APP, r)).filter(fs.existsSync);
roots.push(path.join(process.cwd(), 'components', 'marketing'));

let checked = 0;
const dead = [];
const unreadable = [];
for (const root of roots.filter(fs.existsSync)) {
  for (const f of filesUnder(root)) {
    const rel = path.relative(process.cwd(), f);
    const { found, dynamic } = linksIn(f);
    for (const { href, line } of found) {
      checked++;
      if (!resolves(href, routes)) dead.push({ file: rel, line, href });
    }
    for (const d of dynamic) unreadable.push({ file: rel, ...d });
  }
}

console.log(`${routes.length} addressable routes · ${checked} internal links checked on public surfaces`);
if (unreadable.length) {
  // UNCOVERED, not passing. These resolve at runtime (usually from CMS content), so only the
  // running app can say where they go.
  console.log(`\n⚠ ${unreadable.length} link target(s) are computed at runtime — NOT checked here:`);
  for (const u of unreadable.slice(0, 12)) console.log(`  ${u.file}:${u.line}  ${u.attr}`);
  if (unreadable.length > 12) console.log(`  … and ${unreadable.length - 12} more`);
}
if (!dead.length) {
  console.log(`\n✓ all ${checked} statically-readable internal links resolve to a route that exists`);
  process.exit(0);
}
console.log(`✗ ${dead.length} link(s) point at no route:\n`);
for (const d of dead) console.log(`  ${d.file}:${d.line}  →  ${d.href}`);
process.exit(1);
