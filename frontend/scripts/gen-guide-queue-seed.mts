/**
 * Capture the queued guide drafts + their review ToDos into a durable migration.
 *
 * WHY THIS EXISTS. Mig 176 captured wave 1 by hand and the drafts survived every rebuild. Wave 2
 * (`seed-followon-guides.mts`) was written, committed, and run — and then the sandbox database was
 * rebuilt and all three guides were simply gone, because nothing but the script knew about them.
 * A seed script is not durability; the migration is. This generates the migration from whatever is
 * actually in the database right now, so the captured bodies are the ones that were reviewed
 * rather than a re-render that might differ.
 *
 * It emits ONLY page_keys passed on the command line, so a guide already published (and therefore
 * already someone's decision) is never dragged back into the queue by a rebuild.
 *
 *   cd frontend && DATABASE_URL=<owner> node --import tsx scripts/gen-guide-queue-seed.mts \
 *     db/migrations/210_x.sql slug-a slug-b …
 */
import fs from 'fs';
import path from 'path';
import postgres from 'postgres';

// The toCamel transform is NOT optional here. A bare postgres() client returns snake_case columns,
// so a `sql<{ pageKey: string }[]>` assertion compiles and then reads `undefined` at runtime — the
// #1 bug class in this codebase (CLAUDE.md, SOP: Data Layer). It bit this script on its first run:
// every page_key came back undefined and the generator reported all six guides missing. It failed
// loudly only because the guard below compares what was asked for against what came back; without
// that guard it would have written a migration full of NULLs.
const sql = postgres(process.env.DATABASE_URL || 'postgresql://govtech:changeme@localhost:5432/govtech_intel', {
  max: 3,
  transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } },
});
const [outArg, ...slugs] = process.argv.slice(2);
if (!outArg || slugs.length === 0) {
  console.error('usage: gen-guide-queue-seed.mts <out.sql> <slug> [slug…]');
  process.exit(2);
}
const out = path.resolve(process.cwd(), '..', outArg);

// Dollar-quote tag. Chosen once and asserted against every value we emit: if a body ever contained
// the tag, the generated SQL would terminate a literal early and the migration would fail in a
// confusing place. Cheaper to check here than to debug there.
const TAG = 'g168b';
const lit = (v: unknown): string => {
  if (v === null || v === undefined) return 'NULL';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s.includes(`$${TAG}$`)) throw new Error(`dollar-quote tag ${TAG} appears inside a value — pick another`);
  return `$${TAG}$${s}$${TAG}$`;
};

try {
  const pages = await sql<Array<{
    id: string; pageKey: string; contentType: string; versionNo: number; status: string;
    title: string | null; blocks: unknown; metadata: unknown; auditNote: string | null; createdBy: string | null;
  }>>`
    SELECT id, page_key, content_type, version_no, status, title, blocks, metadata, audit_note, created_by
    FROM content_pages
    WHERE content_type = 'guide' AND status = 'draft' AND page_key = ANY(${slugs})
    ORDER BY page_key`;

  const missing = slugs.filter((s) => !pages.some((p) => p.pageKey === s));
  if (missing.length) throw new Error(`no DRAFT row for: ${missing.join(', ')} — run the seed script first`);

  const tasks = await sql<Array<{
    id: string; assigneeRole: string; title: string; description: string | null; entityId: string; params: unknown;
  }>>`
    SELECT t.id, t.assignee_role, t.title, t.description, t.entity_id, t.params
    FROM tasks t
    WHERE t.task_type = 'content_publish' AND t.status = 'open'
      AND t.entity_id = ANY(${pages.map((p) => p.id)}) ORDER BY t.created_at`;

  const L: string[] = [];
  L.push(`-- ${path.basename(out)}`);
  L.push('--');
  L.push('-- #168 CONTENT-QUEUE — durable capture of the guide drafts still awaiting review, plus the');
  L.push('-- content_publish ToDo that puts each one in front of a human. Wave 2 (cost volume ·');
  L.push('-- submission rules · Phase II) and wave 3 (compliance matrix · registrations · teaming).');
  L.push('--');
  L.push('-- Captured FROM THE LIVE ROWS by scripts/gen-guide-queue-seed.mts, not re-rendered, so what');
  L.push('-- lands on a rebuilt database is byte-identical to what was reviewed. Mig 176 did the same');
  L.push("-- for wave 1; these six existed only inside a seed script until now, which is why a sandbox");
  L.push('-- rebuild silently emptied half the review queue.');
  L.push('--');
  L.push('-- They land as DRAFTS. Nothing here publishes anything.');
  L.push('-- Idempotent via ON CONFLICT (id) DO NOTHING.');
  L.push('');
  L.push('-- ── The guide drafts (content_pages) ──────────────────────────────────────');
  for (const p of pages) {
    L.push('INSERT INTO content_pages (id, page_key, content_type, version_no, status, title, blocks, metadata, audit_note, created_by, created_at)');
    L.push(`VALUES ('${p.id}', ${lit(p.pageKey)}, 'guide', ${p.versionNo}, 'draft', ${lit(p.title)}, `
      + `${lit(p.blocks)}::jsonb, ${lit(p.metadata)}::jsonb, ${lit(p.auditNote)}, ${lit(p.createdBy)}, now())`);
    L.push('ON CONFLICT (id) DO NOTHING;');
    L.push('');
  }
  L.push('-- ── The content_publish review ToDos (tasks) ──────────────────────────────');
  L.push('-- Platform scope: tenant_id IS NULL. Curation is owned by no tenant (CLAUDE.md).');
  for (const t of tasks) {
    L.push('INSERT INTO tasks (id, tenant_id, assignee_role, task_type, title, description, entity_type, entity_id, status, params, created_at)');
    L.push(`VALUES ('${t.id}', NULL, ${lit(t.assigneeRole)}, 'content_publish', ${lit(t.title)}, ${lit(t.description)}, `
      + `'content_pages', '${t.entityId}', 'open', COALESCE(${lit(t.params ?? {})}::jsonb, '{}'::jsonb), now())`);
    L.push('ON CONFLICT (id) DO NOTHING;');
    L.push('');
  }

  fs.writeFileSync(out, L.join('\n'));
  console.log(`✓ wrote ${path.relative(path.resolve(process.cwd(), '..'), out)}`);
  console.log(`  ${pages.length} draft page(s): ${pages.map((p) => p.pageKey).join(', ')}`);
  console.log(`  ${tasks.length} review ToDo(s)`);
  if (tasks.length !== pages.length) console.log(`  ⚠ ${pages.length} pages but ${tasks.length} ToDos — a draft with no ToDo is a draft nobody is asked to review`);
} catch (e) {
  console.error('GEN ERROR', e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
