/**
 * An empty volume is a portal form, and completed-elsewhere is still required.
 *
 * Two rules, one module, both learned from a live DoW 2026 SBIR build:
 *
 *  1. A volume the extraction found no items under is usually the form itself — a DSIP webform, an
 *     SBIR.gov-generated commercialization report, a training certificate — which is why there was
 *     nothing to itemise. Provisioning read the empty list the other way and stood up a blank
 *     authorable section named after the volume, inventing a writing task the solicitation never
 *     set. The rfp_admin's note explains it; the override handles the minority case.
 *
 *  2. Marking something completed-elsewhere removed it from the buyer's proposal ENTIRELY — no
 *     section (right) and no compliance row (wrong). That build's master had seven volumes and the
 *     buyer could see two: the DD Form 2345, the SAM reps & certs, the FWA training certificate and
 *     the foreign-affiliations disclosure were all still mandatory and all silently absent. Not
 *     authored here must never read as not required.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ELSEWHERE_NOTE,
  authoredItems,
  elsewhereNote,
  elsewhereRequirements,
  isAuthoredItem,
  isAuthoredVolume,
  type ScopedVolume,
} from '@/lib/provisioning/authored-scope';

const vol = (over: Partial<ScopedVolume> = {}): ScopedVolume =>
  ({ volumeName: 'Volume 2 — Technical', items: [], ...over });
const item = (name: string, over: Record<string, unknown> = {}) => ({ itemName: name, ...over });

describe('isAuthoredVolume', () => {
  it('authors a volume with items and no marks', () => {
    expect(isAuthoredVolume(vol({ items: [item('Phase I Statement of Work')] }))).toBe(true);
  });

  it('does NOT author a volume marked completed-elsewhere', () => {
    expect(isAuthoredVolume(vol({ dsipOnly: true, items: [item('anything')] }))).toBe(false);
  });

  it('does NOT author a volume whose every item is marked', () => {
    expect(isAuthoredVolume(vol({ items: [item('a', { dsipOnly: true }), item('b', { dsipOnly: true })] }))).toBe(false);
  });

  it('DOES author a volume where only some items are marked', () => {
    expect(isAuthoredVolume(vol({ items: [item('webform', { dsipOnly: true }), item('narrative')] }))).toBe(true);
  });

  describe('the empty volume — the rule that was backwards', () => {
    it('defaults to completed-elsewhere when nobody has decided', () => {
      // "Disclosures of Foreign Affiliations" on the DoW 2026 BAA: zero items, because the volume IS
      // the portal disclosure. This used to provision a blank section, which the drafter then filled.
      expect(isAuthoredVolume(vol({ items: [] }))).toBe(false);
      expect(isAuthoredVolume(vol({ items: undefined }))).toBe(false);
    });

    it('is authored ONLY on the admin\'s explicit override', () => {
      expect(isAuthoredVolume(vol({ items: [], dsipOnly: false }))).toBe(true);
    });

    it('treats NULL exactly like undefined — the UI reads jsonb, which gives null', () => {
      // The curation workspace selects (metadata->>'dsipOnly')::boolean, so an undecided volume
      // arrives as null, not undefined. If null fell through to a different branch the chip would
      // say the opposite of what provisioning does — which is worse than showing no chip.
      expect(isAuthoredVolume(vol({ items: [], dsipOnly: null }))).toBe(false);
      expect(isAuthoredVolume(vol({ items: [item('a')], dsipOnly: null }))).toBe(true);
      expect(isAuthoredItem(item('a', { dsipOnly: null }))).toBe(true);
    });

    it('is elsewhere when every item is marked, even with no volume-level flag', () => {
      // The case the curation chip got wrong first time: the volume itself carries no decision, but
      // nothing under it is authored here, so provisioning yields no sections for it.
      const v = vol({ items: [item('webform', { dsipOnly: true }), item('cert', { dsipOnly: true })] });
      expect(isAuthoredVolume(v)).toBe(false);
      expect(elsewhereRequirements(v).map((r) => r.text)).toEqual(['webform', 'cert']);
    });

    it('keeps undefined and false distinct — collapsing them restores the old bug', () => {
      // `dsipOnly !== true` was the old test, which made undecided and overridden identical and so
      // handed every unlisted portal form back to the buyer as a blank page.
      expect(isAuthoredVolume(vol({ items: [] }))).not.toBe(isAuthoredVolume(vol({ items: [], dsipOnly: false })));
    });
  });
});

describe('isAuthoredItem', () => {
  it('authors an item unless positively marked', () => {
    expect(isAuthoredItem(item('narrative'))).toBe(true);
    expect(isAuthoredItem(item('webform', { dsipOnly: true }))).toBe(false);
    // An item carries no empty-volume ambiguity, so false and absent mean the same thing here.
    expect(isAuthoredItem(item('narrative', { dsipOnly: false }))).toBe(true);
  });

  it('authoredItems filters to what is written here', () => {
    const v = vol({ items: [item('webform', { dsipOnly: true }), item('narrative'), item('cost', { dsipOnly: true })] });
    expect(authoredItems(v).map((i) => i.itemName)).toEqual(['narrative']);
  });
});

describe('elsewhereNote', () => {
  it('takes the first non-blank candidate, so an item note beats its volume note', () => {
    expect(elsewhereNote('filed in SAM', 'in DSIP')).toBe('filed in SAM');
    expect(elsewhereNote(undefined, 'in DSIP')).toBe('in DSIP');
    expect(elsewhereNote('   ', null, 'in DSIP')).toBe('in DSIP');
  });

  it('falls back to text that still tells the buyer something', () => {
    expect(elsewhereNote()).toBe(DEFAULT_ELSEWHERE_NOTE);
    expect(elsewhereNote(null, undefined, '')).toBe(DEFAULT_ELSEWHERE_NOTE);
    expect(elsewhereNote(42)).toBe(DEFAULT_ELSEWHERE_NOTE);
  });

  it('trims, so a note typed with trailing whitespace lands clean on the row', () => {
    expect(elsewhereNote('  Completed in DSIP.  ')).toBe('Completed in DSIP.');
  });
});

describe('elsewhereRequirements — the trace a buyer must still see', () => {
  it('gives an authored volume nothing to file elsewhere', () => {
    expect(elsewhereRequirements(vol({ items: [item('Phase I Statement of Work')] }))).toEqual([]);
  });

  it('names each item of a volume marked completed-elsewhere', () => {
    const r = elsewhereRequirements(vol({
      volumeName: 'Volume 5 — Supporting Documents',
      dsipOnly: true,
      expertNotes: 'Upload signed originals in DSIP.',
      items: [item('DD Form 2345'), item('Reps & Certifications')],
    }));
    expect(r.map((x) => x.text)).toEqual(['DD Form 2345', 'Reps & Certifications']);
    expect(r.every((x) => x.note === 'Upload signed originals in DSIP.')).toBe(true);
  });

  it('lets a per-item note override the volume note', () => {
    const r = elsewhereRequirements(vol({
      dsipOnly: true,
      expertNotes: 'in DSIP',
      items: [item('Reps & Certifications', { expertNotes: 'filed in SAM.gov' }), item('DD Form 2345')],
    }));
    expect(r[0].note).toBe('filed in SAM.gov');
    expect(r[1].note).toBe('in DSIP');
  });

  it('gives an EMPTY volume one row named after the volume itself', () => {
    // The whole point: the buyer's checklist still says "Disclosures of Foreign Affiliations" even
    // though there is no section for it, so the build cannot read as complete without it.
    const r = elsewhereRequirements(vol({ volumeName: 'Disclosures of Foreign Affiliations', items: [] }));
    expect(r).toEqual([{ text: 'Disclosures of Foreign Affiliations', note: DEFAULT_ELSEWHERE_NOTE }]);
  });

  it('gives an OVERRIDDEN empty volume no row — it is authored here instead', () => {
    expect(elsewhereRequirements(vol({ items: [], dsipOnly: false }))).toEqual([]);
  });

  it('reports the marked items of a MIXED volume that is otherwise authored', () => {
    // DoW Volume 1: a DSIP cover-sheet webform beside two narratives genuinely written here.
    const r = elsewhereRequirements(vol({
      volumeName: 'Volume 1 — Proposal Cover Sheet',
      items: [item('Cover Sheet & Technical Abstract', { dsipOnly: true }), item('Technical Abstract Narrative')],
    }));
    expect(r).toEqual([{ text: 'Cover Sheet & Technical Abstract', note: DEFAULT_ELSEWHERE_NOTE }]);
  });

  it('falls back to the volume name for an item with no name of its own', () => {
    const r = elsewhereRequirements(vol({ volumeName: 'Volume 6', dsipOnly: true, items: [{}] }));
    expect(r).toEqual([{ text: 'Volume 6', note: DEFAULT_ELSEWHERE_NOTE }]);
  });

  it('never returns a row with empty text, whatever the master looks like', () => {
    for (const v of [vol({ volumeName: undefined, items: [] }), vol({ volumeName: '', dsipOnly: true, items: [{}] })]) {
      for (const r of elsewhereRequirements(v)) expect(r.text.length).toBeGreaterThan(0);
    }
  });
});
