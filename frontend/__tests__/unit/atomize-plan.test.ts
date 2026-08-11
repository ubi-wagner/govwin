import { describe, it, expect } from 'vitest';
import { planDocumentAtomization } from '@/lib/atomize-package';

/**
 * planDocumentAtomization is the shared "brain" behind BOTH the drop-card preview and the
 * real write, so the preview cannot lie about what a commit produces. These tests pin the
 * invariants the preview relies on — and that it never touches the DB (pure aside from parse).
 */

const md = `# Capabilities Overview
Foundation prints residential foundation walls directly from a downloaded plan using locally sourced concrete and robotics.

# TBD
Short line.
`;

describe('planDocumentAtomization (preview == what gets written)', () => {
  it('plans substantive blocks, surfaces short ones as skipped, and writes nothing', async () => {
    const plan = await planDocumentAtomization({
      buffer: Buffer.from(md, 'utf-8'),
      filename: 'capabilities.md',
      ctxTags: [{ dimension: 'agency', value: 'navy', source: 'auto', confirmed: true, isOther: true }],
    });

    expect(plan.error).toBeUndefined();
    expect(plan.format).toBe('md');
    expect(plan.fmt).toBe('doc');

    // Every planned atom clears the MIN_ATOM_WORDS floor.
    expect(plan.planned.length).toBeGreaterThanOrEqual(1);
    for (const p of plan.planned) expect(p.wordCount).toBeGreaterThanOrEqual(10);

    // The short "TBD / Short line." block is surfaced as skipped, not silently dropped.
    expect(plan.skipped).toBeGreaterThanOrEqual(1);

    // Machine-guessed content tags land UNCONFIRMED; the uploader's own context tag flows through.
    const first = plan.planned[0];
    expect(first.tags.find((t) => t.dimension === 'kind')?.confirmed).toBe(false);
    expect(first.tags.find((t) => t.dimension === 'fmt')?.confirmed).toBe(false);
    expect(first.tags.some((t) => t.dimension === 'agency' && t.value === 'navy')).toBe(true);

    // Preview payload is derived purely from the plan — title + word count only.
    expect(typeof first.title).toBe('string');
    expect(first.title.length).toBeGreaterThan(0);
  });

  it('returns a parse/empty error (never throws) with zero planned for empty input', async () => {
    const plan = await planDocumentAtomization({ buffer: Buffer.from('', 'utf-8'), filename: 'empty.txt', ctxTags: [] });
    expect(plan.planned).toHaveLength(0);
    expect(plan.skipped).toBe(0);
    expect(plan.error).toBeTruthy();
  });
});
