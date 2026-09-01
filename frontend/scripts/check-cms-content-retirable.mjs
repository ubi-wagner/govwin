#!/usr/bin/env node
/**
 * Is `cms_content` safe to drop — HERE, on the database this points at?
 *
 * ── WHY THIS EXISTS AS A SCRIPT ──────────────────────────────────────────────────────────────
 * The consolidation left one gate: the coverage that makes the legacy content store retirable was
 * measured on the sandbox, and this repository's own rule is that "empty in the sandbox is NOT a
 * drop signal". So the gate was a paragraph asking somebody to re-run two queries against
 * production — which is the shape of instruction that never gets run, or gets run differently.
 *
 * It is a command instead. Point it at production, read the verdict.
 *
 *   DATABASE_URL=<production owner URL> node frontend/scripts/check-cms-content-retirable.mjs
 *
 * ── WHAT IT ASKS ─────────────────────────────────────────────────────────────────────────────
 *   1. Does every legacy DOCUMENT have a live successor in `content_pages`, by slug and type?
 *   2. Does every legacy PAGE-BLOCK belong to a page that is either migrated (an active
 *      content_pages row) or dead (a route that redirects and never reads content)?
 *   3. Is anything still WRITING it? — answered from the tree, not the database, because a writer
 *      that has simply not fired yet leaves no row behind.
 *
 * Exit 0 = safe to drop. Exit 1 = a real gap, named. Exit 2 = it could not reach the database or
 * could not earn a verdict, which is NOT the same as safe.
 *
 * ⚠️ READ-ONLY. It runs SELECTs and reads files. It drops nothing — that stays a human act.
 */
import postgres from 'postgres';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(HERE, '..');

/**
 * Pages whose route is a REDIRECT, so their legacy blocks can never be read.
 *
 * Derived from the tree rather than hard-coded: a list typed here would go stale the first time a
 * redirect was turned back into a real page, and would then declare a live page's content
 * droppable.
 */
function redirectingPages() {
  const out = new Set();
  const root = join(FRONTEND, 'app', '(marketing)');
  let entries = [];
  try { entries = readdirSync(root); } catch { return out; }
  for (const name of entries) {
    const page = join(root, name, 'page.tsx');
    try {
      if (!statSync(page).isFile()) continue;
      const src = readFileSync(page, 'utf8');
      // A redirect page calls redirect() and never asks for blocks.
      if (/\bredirect\s*\(/.test(src) && !/getPageBlocks/.test(src)) out.add(name);
    } catch { /* not a page directory */ }
  }
  return out;
}

/** Files that still name the table in CODE (comments stripped — this repo documents at the site). */
function writersInTree() {
  const hits = [];
  const testHits = [];
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
                        .replace(/^\s*#.*$/gm, '').replace(/"""[\s\S]*?"""/g, '');
  const walk = (dir) => {
    let items = [];
    try { items = readdirSync(dir); } catch { return; }
    for (const e of items) {
      if (e === 'node_modules' || e === '.next' || e.startsWith('.') || e === '__pycache__') continue;
      const p = join(dir, e);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { walk(p); continue; }
      if (!/\.(ts|tsx|py|mts|mjs)$/.test(p)) continue;
      const src = strip(readFileSync(p, 'utf8'));
      const writes = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+cms_content\b/i.test(src);
      const reads = /\bFROM\s+cms_content\b/i.test(src);
      if (!writes && !reads) continue;
      // TESTS are separated, not silently excluded. A test that asserts the table is NOT written
      // has to name it, and after this rewrite that is exactly what services/cms's integration
      // test does — its fixture even creates its own copy of the shape, so it survives a
      // production drop. But an unexplained exclusion is how a real reference leaves the
      // checklist, so they are listed, and simply do not block.
      const isTest = /(^|\/)(tests?|__tests__)\//.test(p) || /\.(test|spec)\.[a-z]+$/.test(p)
                     || /(^|\/)test_[^/]+$/.test(p);
      (isTest ? testHits : hits).push(`${p} (${writes ? 'writes' : 'reads'})`);
    }
  };
  walk(join(FRONTEND, 'app'));
  walk(join(FRONTEND, 'lib'));
  walk(join(FRONTEND, '..', 'services'));
  walk(join(FRONTEND, '..', 'pipeline', 'src'));
  return { hits, testHits };
}

const URL_ = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
if (!URL_) {
  console.error('CannotRun: set DATABASE_URL (or DATABASE_URL_OWNER) to the database to check.');
  process.exit(2);
}

const sql = postgres(URL_, { max: 2, onnotice: () => {} });
let findings = 0;
const ok = (good, label, detail = '') => {
  if (!good) findings += 1;
  console.log(`  ${good ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

try {
  const [{ exists }] = await sql`
    SELECT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='cms_content') AS exists`;
  if (!exists) {
    console.log('\ncms_content does not exist on this database — already dropped.\n');
    await sql.end();
    process.exit(0);
  }

  const [{ n: total }] = await sql`SELECT count(*)::int AS n FROM cms_content`;
  console.log(`\ncms_content on this database: ${total} row(s)\n`);
  console.log('1 · every legacy DOCUMENT has a live successor');

  const docs = await sql`
    SELECT c.content_type, c.slug
      FROM cms_content c
     WHERE c.content_type <> 'page_block'
       AND NOT EXISTS (
         SELECT 1 FROM content_pages p
          WHERE p.content_type = c.content_type AND p.page_key = c.slug)
     ORDER BY 1, 2`;
  ok(docs.length === 0, 'no legacy document is missing from content_pages',
     docs.length ? docs.map((d) => `${d.contentType}:${d.slug}`).join(', ') : 'all covered');

  console.log('\n2 · every legacy PAGE-BLOCK belongs to a migrated or dead page');
  const redirects = redirectingPages();
  console.log(`  · routes that redirect and never read blocks: ${[...redirects].join(', ') || 'none'}`);
  const pages = await sql`
    SELECT DISTINCT tags[1] AS page,
           count(*) OVER (PARTITION BY tags[1])::int AS blocks
      FROM cms_content WHERE content_type = 'page_block' AND tags[1] IS NOT NULL`;
  const stranded = [];
  for (const p of pages) {
    const [live] = await sql`
      SELECT COALESCE(max(jsonb_array_length(COALESCE(blocks,'[]'::jsonb))), 0)::int AS n
        FROM content_pages
       WHERE page_key = ${p.page} AND content_type = 'page' AND status = 'active'`;
    if (live.n === 0 && !redirects.has(p.page)) stranded.push(`${p.page} (${p.blocks} blocks, no active row, route is not a redirect)`);
  }
  ok(stranded.length === 0, 'no page-block is the only copy of a live page',
     stranded.length ? stranded.join(' · ') : `${pages.length} page key(s) accounted for`);

  console.log('\n3 · nothing in the tree still touches it');
  const { hits: refs, testHits } = writersInTree();
  const rel = (r) => r.replace(FRONTEND + '/', '').replace(FRONTEND + '/../', '');
  ok(refs.length === 0, 'no production code reads or writes cms_content',
     refs.length ? refs.map(rel).join(' · ') : 'zero references');
  if (testHits.length) {
    console.log(`  · ${testHits.length} test file(s) name it, which does not block the drop —`);
    console.log('    a test asserting the table is NOT written has to say its name:');
    for (const t of testHits) console.log(`      ${rel(t)}`);
  }

  console.log(findings === 0
    ? '\n✓ SAFE TO DROP on this database. Archive the page_block rows with the migration —\n'
      + '  they are the last copy of retired pages\' copy, and a drop is not the place to lose them.\n'
    : `\n✗ ${findings} gap(s). Do NOT drop until each is resolved.\n`);
  await sql.end();
  process.exit(findings === 0 ? 0 : 1);
} catch (err) {
  console.error('\nCannotRun:', err.message);
  console.error('A verdict was not earned. That is not the same as safe.\n');
  await sql.end().catch(() => {});
  process.exit(2);
}
