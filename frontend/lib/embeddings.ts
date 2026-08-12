/**
 * Embeddings — the drop-in "retrieve by MEANING" engine for the atom library.
 *
 * The tag/context selector (lib/atoms.selectForSection) finds atoms whose taxonomy literally
 * matches a section. This adds a semantic axis: an atom about "additive manufacturing throughput"
 * can surface for a section on "print speed" even with zero shared tags. One vector per atom lives
 * in atom_embeddings (mig 171, tenant-scoped + forced RLS); selectForSection blends cosine similarity
 * into the score.
 *
 * TWO engines, gated exactly like vision/OCR — inert by default:
 *   · PROVIDER (prod): Voyage AI (Anthropic's recommended embeddings partner). Enabled when
 *     VOYAGE_API_KEY is set; called via fetch (no SDK/install). Real neural semantics.
 *   · LOCAL (ATOM_EMBED=local): a deterministic, dependency-free hashed-n-gram embedder. LEXICAL,
 *     not neural — it clusters by shared vocabulary/character-grams, not deep meaning. It exists so
 *     the whole vector pipeline (embed → store → tenant-scoped ANN → blend) is real + provable with
 *     NO key and NO data ever leaving the box. Off in prod unless deliberately chosen.
 *   · DISABLED (default / sandbox): no engine → selectForSection is exactly the pre-vector selector.
 *
 * Every vector is stored with its `model`; selectForSection only ever compares within one model, so
 * a local-hash vector is never cosine-compared against a Voyage one. BEST-EFFORT everywhere: a failed
 * embed yields null and the caller degrades to tag-ranking — it never throws into a request path.
 */
import { createHash } from 'crypto';

/** Fixed stored dimension. The column is vector(1024); both engines emit exactly this. */
export const EMBED_DIM = 1024;

export type EmbedInputType = 'document' | 'query';

const VOYAGE_KEY = process.env.VOYAGE_API_KEY;
const VOYAGE_ON = !!VOYAGE_KEY && VOYAGE_KEY !== 'noop';
const LOCAL_ON = !VOYAGE_ON && process.env.ATOM_EMBED === 'local';
const VOYAGE_MODEL = process.env.EMBED_MODEL || 'voyage-3.5';

/** The engine id stamped onto every row, or null when embeddings are disabled. */
export function activeEmbedModel(): string | null {
  if (VOYAGE_ON) return VOYAGE_MODEL;
  if (LOCAL_ON) return 'local-hash-v1';
  return null;
}
export function embeddingsEnabled(): boolean {
  return activeEmbedModel() !== null;
}

/** sha256(model || '\0' || text) — the re-embed skip key (unchanged text+model → no work). */
export function embedContentHash(model: string, text: string): string {
  return createHash('sha256').update(model).update('\0').update(text).digest('hex');
}

/** postgres literal for a pgvector column: '[0.1,0.2,…]'. Non-finite → 0 (defensive). */
export function toVectorLiteral(v: number[]): string {
  return '[' + v.map((x) => (Number.isFinite(x) ? x : 0)).join(',') + ']';
}

/**
 * Usable for cosine ranking ONLY if right-length, all-finite, and NON-zero. A zero-magnitude vector
 * (e.g. hashEmbed of text with no [a-z0-9] tokens — a non-Latin or symbol-only atom) makes pgvector's
 * `<=>` return NaN, which coalesce(…,0) does NOT catch and Postgres sorts ABOVE every finite score —
 * so a poisoned atom would rank #1 for the whole tenant. Reject such vectors on write AND as a query.
 */
export function isUsableVector(v: number[] | null | undefined): v is number[] {
  return Array.isArray(v) && v.length === EMBED_DIM && v.some((x) => x !== 0) && v.every((x) => Number.isFinite(x));
}

// ── local deterministic embedder (lexical; no deps, no network) ───────────────────────────
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
/** Signed-hash a feature into the accumulator (reduces collision bias). */
function addFeature(vec: Float64Array, feat: string, weight: number) {
  const h = fnv1a(feat);
  const idx = h % EMBED_DIM;
  const sign = (h >>> 31) & 1 ? 1 : -1; // top bit → sign
  vec[idx] += sign * weight;
}
/** Deterministic 1024-d L2-normalized vector from word uni/bi-grams + intra-word char 3-grams. */
export function hashEmbed(text: string): number[] {
  const vec = new Float64Array(EMBED_DIM);
  const words = (text.toLowerCase().match(/[a-z0-9]+/g) || []).slice(0, 2000);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    addFeature(vec, 'w:' + w, 1);
    if (i + 1 < words.length) addFeature(vec, 'b:' + w + '_' + words[i + 1], 0.5); // bigram
    if (w.length > 3) {
      const p = '#' + w + '#';
      for (let j = 0; j + 3 <= p.length; j++) addFeature(vec, 'c:' + p.slice(j, j + 3), 0.3); // char-3gram
    }
  }
  let norm = 0;
  for (let i = 0; i < EMBED_DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  const out = new Array<number>(EMBED_DIM);
  if (norm === 0) { for (let i = 0; i < EMBED_DIM; i++) out[i] = 0; return out; }
  for (let i = 0; i < EMBED_DIM; i++) out[i] = vec[i] / norm;
  return out;
}

// ── Voyage provider (prod; neural) ────────────────────────────────────────────────────────
async function voyageEmbed(texts: string[], inputType: EmbedInputType): Promise<number[][] | null> {
  try {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${VOYAGE_KEY}` },
      body: JSON.stringify({ input: texts, model: VOYAGE_MODEL, input_type: inputType, output_dimension: EMBED_DIM }),
    });
    if (!res.ok) { console.error('[embeddings] voyage HTTP', res.status); return null; }
    const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    const rows = json.data ?? [];
    if (rows.length !== texts.length) { console.error('[embeddings] voyage count mismatch'); return null; }
    const out = rows.map((r) => r.embedding ?? []);
    if (out.some((e) => e.length !== EMBED_DIM)) { console.error('[embeddings] voyage dim mismatch'); return null; }
    return out;
  } catch (e) {
    console.error('[embeddings] voyage failed', e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Embed a batch. Returns one vector per input (order-preserving), or null when the engine is
 * disabled or the provider failed — callers must treat null as "no semantic axis, degrade to tags".
 * `inputType` lets an asymmetric provider (Voyage) distinguish the stored document from the query.
 */
export async function embedTexts(texts: string[], inputType: EmbedInputType = 'document'): Promise<number[][] | null> {
  if (!VOYAGE_ON && !LOCAL_ON) return null; // disabled — honor "null when off" even for an empty batch
  const clean = texts.map((t) => (t || '').slice(0, 8000));
  if (clean.length === 0) return [];
  if (VOYAGE_ON) return voyageEmbed(clean, inputType);
  return clean.map(hashEmbed); // LOCAL_ON
}

/** Single-text convenience. null when disabled/failed. */
export async function embedOne(text: string, inputType: EmbedInputType = 'document'): Promise<number[] | null> {
  const r = await embedTexts([text], inputType);
  return r && r[0] ? r[0] : null;
}
