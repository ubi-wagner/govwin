/** Backfill / refresh the semantic index (atom_embeddings, mig 170) for existing atoms.
 *  Embeds every approved, non-archived, non-reference atom via the SAME gated helper createAtom uses
 *  (upsertAtomEmbedding), so it's tenant-scoped + idempotent (skips unchanged text). No-op unless an
 *  engine is enabled — run with ATOM_EMBED=local (offline, no key) or a real VOYAGE_API_KEY.
 *
 *  Usage:
 *    cd frontend && ATOM_EMBED=local DATABASE_URL=… node --import tsx scripts/embed-atoms.mts [tenantSlug]
 *  (omit tenantSlug to embed ALL tenants — needed to prove cross-tenant isolation.)
 */
import postgres from 'postgres';
import { upsertAtomEmbedding, atomEmbedText } from '@/lib/atom-embed';
import { embeddingsEnabled, activeEmbedModel } from '@/lib/embeddings';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://govtech:changeme@localhost:5432/govtech_intel', { max: 4 });
const onlySlug = process.argv[2] || null;

async function main() {
  if (!embeddingsEnabled()) {
    console.error('✗ embeddings disabled — set ATOM_EMBED=local or VOYAGE_API_KEY. Nothing to do.');
    process.exit(2);
  }
  console.log(`engine: ${activeEmbedModel()}${onlySlug ? ` · tenant=${onlySlug}` : ' · ALL tenants'}`);
  const tenants = await sql<Array<{ id: string; slug: string }>>`
    SELECT id, slug FROM tenants ${onlySlug ? sql`WHERE slug = ${onlySlug}` : sql``} ORDER BY slug`;

  let total = 0, stored = 0, skipped = 0, failed = 0;
  for (const t of tenants) {
    const atoms = await sql<Array<{ id: string; title: string | null; summary: string | null; content: string | null }>>`
      SELECT id, title, summary, content FROM library_atoms
      WHERE tenant_id = ${t.id}::uuid AND vault_id IS NULL AND archived_at IS NULL
        AND status = 'approved' AND grain <> 'reference'`;
    let ts = 0, tk = 0, tf = 0;
    for (const a of atoms) {
      total++;
      const r = await upsertAtomEmbedding(t.id, a.id, atomEmbedText({ title: a.title, summary: a.summary, content: a.content }));
      if (r === 'stored') { stored++; ts++; }
      else if (r === 'skipped') { skipped++; tk++; }
      else if (r === 'failed') { failed++; tf++; }
    }
    if (atoms.length) console.log(`  ${t.slug.padEnd(28)} ${atoms.length} atoms → +${ts} stored, ${tk} skipped, ${tf} failed`);
  }
  console.log(`\ndone — ${total} atoms · ${stored} stored · ${skipped} unchanged · ${failed} failed`);
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); }).finally(() => sql.end({ timeout: 5 }));
