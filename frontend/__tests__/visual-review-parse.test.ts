/**
 * The visual reviewer's reply parser, against recorded model replies (VIS-PROOF).
 *
 * WHAT THIS CAN AND CANNOT PROVE — stated up front, because the gap matters.
 *
 * The visual review has two halves. The PAGE-COUNT half is not gated on a model at all: it renders
 * the volume through the product's own PDF exporter, counts what Chromium laid out, and reports a
 * blocker if that exceeds the agency's cap. That half is live everywhere and proven by the drive.
 *
 * The VISION half needs a real `ANTHROPIC_API_KEY`. The sandbox's emulated model cannot see images
 * and returns `[]` — on purpose: a harness that invented plausible defects would make this review
 * look proven when nothing had looked at a page. So in the sandbox the wire is exercised end to
 * end and the eyesight is not.
 *
 * That leaves exactly one part of the vision path a test can pin without a key: what the product
 * does with the model's answer. Recorded replies, therefore — including the malformed ones a model
 * actually produces (prose wrapped around the JSON, a page number past the end, a severity nobody
 * defined). The rule throughout is the same: never invent a finding, and never surface one a
 * reader cannot navigate to.
 */
import { describe, expect, it } from 'vitest';
import { parseFindings } from '@/lib/review/visual-review';

/** A realistic reply: models routinely wrap the array in a sentence. */
const WRAPPED = `Here is what I found across the pages:
[
  {"page": 3, "severity": "defect", "finding": "The flow-diagram labels are truncated mid-word — 'production un…' and 'optics + firm…' — so two of the five stages cannot be read."},
  {"page": 1, "severity": "blocker", "finding": "The running footer prints the literal string 'Page {page}' instead of a page number."},
  {"page": 3, "severity": "polish", "finding": "Figure 2's caption sits above the figure while Figure 1's sits below."}
]
Let me know if you'd like more detail.`;

describe('a well-formed reply', () => {
  const out = parseFindings(WRAPPED, 4);

  it('finds every finding even when the array is wrapped in prose', () => {
    expect(out).toHaveLength(3);
  });

  it('puts blockers first, then orders by page — a reader should not have to sort a review', () => {
    expect(out.map((f) => [f.severity, f.page])).toEqual([
      ['blocker', 1], ['defect', 3], ['polish', 3],
    ]);
  });

  it('keeps the finding text intact', () => {
    expect(out[0].finding).toContain("Page {page}");
  });
});

describe('never invent, never strand', () => {
  it('returns nothing at all when there is no array to read', () => {
    expect(parseFindings('I was unable to review these pages.', 4)).toEqual([]);
  });

  it('returns nothing when the array is malformed rather than guessing at it', () => {
    expect(parseFindings('[{"page": 1, "finding": ', 4)).toEqual([]);
  });

  it('is empty for a clean document — the right answer, not a failure', () => {
    expect(parseFindings('[]', 4)).toEqual([]);
  });

  it('drops a finding on a page the document does not have', () => {
    // A model that hallucinates page 9 of a 4-page volume gives the reader nowhere to go.
    const out = parseFindings('[{"page":9,"severity":"blocker","finding":"x"},{"page":2,"severity":"defect","finding":"real"}]', 4);
    expect(out.map((f) => f.page)).toEqual([2]);
  });

  it.each([0, -1, 1.5])('drops a nonsense page number (%s)', (page) => {
    expect(parseFindings(`[{"page":${page},"severity":"defect","finding":"x"}]`, 4)).toEqual([]);
  });

  it('drops a finding with no text', () => {
    expect(parseFindings('[{"page":1,"severity":"defect","finding":"   "}]', 4)).toEqual([]);
  });

  it('falls back to "defect" for a severity nobody defined, rather than dropping the finding', () => {
    // The observation is still worth showing; only the label was wrong.
    const [f] = parseFindings('[{"page":1,"severity":"catastrophic","finding":"the masthead overlaps the title"}]', 4);
    expect(f.severity).toBe('defect');
    expect(f.finding).toBe('the masthead overlaps the title');
  });

  it('ignores non-objects mixed into the array', () => {
    expect(parseFindings('[null, "oops", 7, {"page":1,"severity":"polish","finding":"ok"}]', 4)).toHaveLength(1);
  });
});

describe('bounded output', () => {
  it('caps at 60 findings so one confused reply cannot bury a section thread', () => {
    const many = JSON.stringify(
      Array.from({ length: 200 }, (_, i) => ({ page: 1, severity: 'polish', finding: `n${i}` })),
    );
    expect(parseFindings(many, 4)).toHaveLength(60);
  });

  it('truncates a single runaway finding rather than letting it fill the comment', () => {
    const [f] = parseFindings(JSON.stringify([{ page: 1, severity: 'defect', finding: 'x'.repeat(1000) }]), 4);
    expect(f.finding).toHaveLength(400);
  });
});
