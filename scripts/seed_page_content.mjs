#!/usr/bin/env node
/**
 * Push the code-owned marketing page content (PAGE_SEEDS, snapshotted to
 * lib/page-content/page-seeds.generated.json at build time) into content_pages,
 * so the public site always reflects the .ts seeds after a deploy.
 *
 * This makes CODE the source of truth for the marketing PAGES listed in
 * PAGE_SEEDS. It only touches content_type='page' rows for those exact page_keys
 * — genuinely dynamic content (blog posts, resource articles, testimonials with
 * their own page_keys / content_types) is never touched.
 *
 * OPT-IN via SEED_PAGE_CONTENT=true (set it permanently once you've backed off
 * CMS editing for marketing pages). Idempotent + deterministic: each run replaces
 * each page's versions with a single fresh active v1 from the snapshot. Non-fatal.
 *
 * Usage (entrypoint runs it): SEED_PAGE_CONTENT=true node scripts/seed_page_content.mjs
 */
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('[seed_page_content] DATABASE_URL required'); process.exit(1); }

// The snapshot ships next to this script in the image; fall back to the frontend path in dev.
const here = dirname(fileURLToPath(import.meta.url));
const candidates = [
  join(here, 'page-seeds.generated.json'),
  join(here, '..', 'frontend', 'lib', 'page-content', 'page-seeds.generated.json'),
];
let snapshot = null;
for (const p of candidates) {
  try { snapshot = JSON.parse(readFileSync(p, 'utf8')); break; } catch { /* try next */ }
}
if (!snapshot?.pages) { console.error('[seed_page_content] page-seeds snapshot not found; skipping'); process.exit(0); }

const sql = postgres(DATABASE_URL, { max: 1, idle_timeout: 5 });
let seeded = 0, failed = 0;
try {
  for (const key of Object.keys(snapshot.pages)) {
    const s = snapshot.pages[key];
    if (!s?.pageKey || !Array.isArray(s.blocks)) continue;
    try {
      await sql.begin(async (tx) => {
        // Code is source of truth for this page → wipe its versions, insert a fresh active v1.
        await tx`DELETE FROM content_pages WHERE page_key = ${s.pageKey} AND content_type = 'page'`;
        await tx`
          INSERT INTO content_pages
            (page_key, content_type, version_no, status, title, blocks, audit_note, created_by, published_at, created_at)
          VALUES (
            ${s.pageKey}, 'page', 1, 'active', ${s.title ?? s.pageKey},
            ${sql.json(s.blocks)},
            'Re-seeded from code on deploy (seed_page_content)', 'system', now(), now()
          )
        `;
      });
      seeded++;
    } catch (err) {
      failed++;
      console.error(`[seed_page_content] ${s.pageKey} failed:`, err.message);
    }
  }
  console.log(`[seed_page_content] done — ${seeded} pages re-seeded from code, ${failed} failed`);
} finally {
  await sql.end();
}
