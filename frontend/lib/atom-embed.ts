/**
 * atom-embed — store an atom's semantic vector (mig 170 atom_embeddings), gated + best-effort.
 *
 * The single write path for the semantic index. Called post-commit from createAtom (so a provider
 * network call never holds a business tx open) and in bulk from scripts/embed-atoms.mts. Everything
 * here is a no-op when embeddings are disabled, and NEVER throws into the caller — a failed embed
 * just leaves the atom without a vector and selectForSection degrades to tag-ranking.
 */
import { withTenant } from '@/lib/rls';
import {
  activeEmbedModel, embedOne, embedContentHash, toVectorLiteral, EMBED_DIM,
} from '@/lib/embeddings';

export type EmbedOutcome = 'stored' | 'skipped' | 'disabled' | 'empty' | 'failed';

/** The text we embed for an atom: title + summary + content, whitespace-collapsed and capped. */
export function atomEmbedText(parts: { title?: string | null; summary?: string | null; content?: string | null }): string {
  return [parts.title, parts.summary, parts.content].filter(Boolean).join('\n').replace(/\s+/g, ' ').trim().slice(0, 8000);
}

/**
 * Embed `text` and upsert the atom's vector (tenant-scoped, one row per atom, current model).
 * Idempotent: skips the embed when the same (model, text) is already stored (content_hash match).
 * Runs its own short withTenant tx — RLS scopes the write to `tenantId`, and the explicit tenant_id
 * column makes a cross-tenant write impossible even before the cutover.
 */
export async function upsertAtomEmbedding(tenantId: string, atomId: string, text: string): Promise<EmbedOutcome> {
  const model = activeEmbedModel();
  if (!model) return 'disabled';
  const t = (text || '').trim();
  if (!t) return 'empty';
  try {
    const hash = embedContentHash(model, t);
    const existing = await withTenant<Array<{ contentHash: string }>>(tenantId, async (tx) =>
      tx`SELECT content_hash AS "contentHash" FROM atom_embeddings WHERE atom_id = ${atomId}::uuid AND model = ${model}`);
    if (existing[0]?.contentHash === hash) return 'skipped';

    const vec = await embedOne(t, 'document');
    if (!vec || vec.length !== EMBED_DIM) return 'failed';
    const lit = toVectorLiteral(vec);
    await withTenant(tenantId, async (tx) =>
      tx`INSERT INTO atom_embeddings (atom_id, tenant_id, model, dim, content_hash, embedding, updated_at)
         VALUES (${atomId}::uuid, ${tenantId}::uuid, ${model}, ${EMBED_DIM}, ${hash}, ${lit}::vector, now())
         ON CONFLICT (atom_id) DO UPDATE SET
           model = EXCLUDED.model, dim = EXCLUDED.dim, content_hash = EXCLUDED.content_hash,
           embedding = EXCLUDED.embedding, updated_at = now()`);
    return 'stored';
  } catch (e) {
    console.error('[atom-embed] upsert failed (non-fatal)', e instanceof Error ? e.message : e);
    return 'failed';
  }
}
