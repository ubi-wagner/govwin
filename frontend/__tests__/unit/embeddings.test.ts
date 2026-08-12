import { describe, it, expect } from 'vitest';
import {
  EMBED_DIM, hashEmbed, toVectorLiteral, embedContentHash, embeddingsEnabled, embedTexts, activeEmbedModel, isUsableVector,
} from '@/lib/embeddings';

/** The embedding engine is gated (Voyage key / ATOM_EMBED=local). With neither (sandbox/CI default) it
 *  is disabled and embedTexts returns null so selectForSection degrades to pure tag-ranking. The LOCAL
 *  hash embedder is a pure deterministic function and is tested directly regardless of the gate. */
const engineOn = embeddingsEnabled();

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0); // vectors are L2-normalized → dot = cosine

describe('embeddings gate', () => {
  it.skipIf(engineOn)('is disabled by default → embedTexts returns null, no model', async () => {
    expect(activeEmbedModel()).toBeNull();
    expect(await embedTexts(['anything'])).toBeNull();
  });
  it('reports EMBED_DIM = 1024 (matches the vector(1024) column)', () => {
    expect(EMBED_DIM).toBe(1024);
  });
});

describe('local hash embedder (deterministic, dependency-free)', () => {
  it('emits an L2-normalized vector of exactly EMBED_DIM', () => {
    const v = hashEmbed('additive manufacturing concrete printing throughput');
    expect(v).toHaveLength(EMBED_DIM);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });
  it('is deterministic — same text yields the same vector', () => {
    expect(hashEmbed('the quick brown fox')).toEqual(hashEmbed('the quick brown fox'));
  });
  it('ranks related text above unrelated text (lexical similarity is real)', () => {
    const q = hashEmbed('additive manufacturing concrete 3d printing');
    const near = hashEmbed('concrete 3d printing additive process for construction');
    const far = hashEmbed('quarterly financial audit tax compliance report');
    expect(dot(q, near)).toBeGreaterThan(dot(q, far));
  });
  it('an empty string yields a zero vector (no NaN)', () => {
    const v = hashEmbed('');
    expect(v).toHaveLength(EMBED_DIM);
    expect(v.every((x) => x === 0)).toBe(true);
  });
});

describe('embedding helpers', () => {
  it('toVectorLiteral formats a pgvector literal and zeroes non-finite', () => {
    expect(toVectorLiteral([1, 2, 3])).toBe('[1,2,3]');
    expect(toVectorLiteral([1, NaN, Infinity])).toBe('[1,0,0]');
  });
  it('embedContentHash is stable for the same (model,text) and changes with either', () => {
    const a = embedContentHash('voyage-3.5', 'hello world');
    expect(embedContentHash('voyage-3.5', 'hello world')).toBe(a);
    expect(embedContentHash('voyage-3.5', 'hello worlds')).not.toBe(a);
    expect(embedContentHash('local-hash-v1', 'hello world')).not.toBe(a);
  });
});

describe('degenerate-vector guard (NaN-poisoning defense)', () => {
  it('isUsableVector rejects zero-magnitude, non-finite, and wrong-length vectors', () => {
    expect(isUsableVector(hashEmbed('additive manufacturing'))).toBe(true);
    expect(isUsableVector(new Array(EMBED_DIM).fill(0))).toBe(false);        // zero-magnitude → NaN cosine
    const withNaN = hashEmbed('additive'); withNaN[0] = NaN;
    expect(isUsableVector(withNaN)).toBe(false);                              // non-finite
    expect(isUsableVector(new Array(512).fill(0.1))).toBe(false);            // wrong dim
    expect(isUsableVector(null)).toBe(false);
  });
  it('text with no [a-z0-9] tokens embeds to a zero vector that isUsableVector rejects', () => {
    // the exact poisoning input from the adversarial review: a non-Latin / symbol-only atom
    for (const t of ['日本語のテキスト', 'Кириллица', '!!! ??? ---', '   ']) {
      const v = hashEmbed(t);
      expect(v.every((x) => x === 0)).toBe(true);
      expect(isUsableVector(v)).toBe(false); // → never stored, never used as a query
    }
  });
  it('embedTexts([]) returns null when disabled (contract honored even for an empty batch)', async () => {
    if (!engineOn) expect(await embedTexts([])).toBeNull();
  });
});
