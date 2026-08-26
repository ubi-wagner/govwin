/**
 * What a buyer is asked to WRITE, versus what they must obtain, sign, file or fetch elsewhere.
 *
 * A solicitation's volumes are not all authoring work. Some are completed inside the agency's own
 * submission portal — a DSIP webform, a Company Commercialization Report the agency generates from
 * SBIR.gov, a Fraud/Waste/Abuse training certificate, a signed DD Form 2345. The company still has
 * to DO all of those; they just do them somewhere else. Provisioning has to sort the two, and this
 * is the one place that rule lives so the provision loop and the readiness bar cannot drift apart.
 *
 * THE EMPTY-VOLUME RULE. Extraction lists what the solicitation itemises. When it returns a volume
 * with no items under it, that is nearly always because the volume IS the form — there was nothing
 * to itemise. Provisioning used to read the empty list the opposite way and stand up a blank
 * authorable section named after the volume, which is the product inventing a writing task the
 * solicitation never set. So an undecided empty volume defaults to completed-elsewhere.
 *
 * THE OVERRIDE. `dsipOnly` is deliberately TRI-STATE. `undefined` is "nobody decided"; `false` is an
 * rfp_admin's explicit "this really is authored here, the extraction just missed the items". Those
 * differ exactly on the empty volume, which is the case that matters — collapse them and the
 * override becomes the default again. The paired NOTE (`expert_notes`, set through the disposition
 * routes) is what tells the buyer WHERE, so "not authored here" never reads as "not required".
 */

/**
 * The shape provisioning needs; the resolver returns a superset.
 *
 * `dsipOnly` admits null as well as undefined because that is what the two callers actually hold:
 * the resolver maps a missing jsonb key to undefined, while a UI row reading
 * `(metadata->>'dsipOnly')::boolean` gets null. Both mean "nobody decided", and the predicates
 * below test for `true` and `false` explicitly so either spelling lands in the same branch.
 *
 * The index signature lets the resolver's rich volume/item objects pass straight through; a caller
 * holding a narrower shape (the curation UI) projects onto just these fields instead. Both reach
 * the SAME predicate deliberately — a chip that disagrees with what provisioning will do is worse
 * than no chip at all.
 */
export interface ScopedItem {
  dsipOnly?: boolean | null;
  expertNotes?: string | null;
  itemName?: string;
  [k: string]: unknown;
}
export interface ScopedVolume {
  dsipOnly?: boolean | null;
  expertNotes?: string | null;
  volumeName?: string;
  items?: ScopedItem[];
  [k: string]: unknown;
}

/** Fallback text for a checklist row whose admin left no note. */
export const DEFAULT_ELSEWHERE_NOTE =
  'Completed in the agency submission portal — not authored in this workspace.';

/** An item is authored here unless it was explicitly marked completed-elsewhere. */
export function isAuthoredItem(item: ScopedItem): boolean {
  return item.dsipOnly !== true;
}

export function authoredItems(vol: ScopedVolume): ScopedItem[] {
  return (vol.items ?? []).filter(isAuthoredItem);
}

/**
 * True when this volume yields authoring work — an artifact and sections the buyer fills in.
 *
 * Three ways to be false, and the third is the one that was wrong:
 *   1. marked completed-elsewhere outright;
 *   2. every one of its items marked, so nothing is left to write;
 *   3. NO items and no decision — a portal form by default, unless overridden to `false`.
 */
export function isAuthoredVolume(vol: ScopedVolume): boolean {
  if (vol.dsipOnly === true) return false;
  const items = vol.items ?? [];
  if (items.length === 0) return vol.dsipOnly === false;
  return authoredItems(vol).length > 0;
}

/** The note that rides onto a buyer's checklist row for work completed elsewhere. */
export function elsewhereNote(...candidates: unknown[]): string {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return DEFAULT_ELSEWHERE_NOTE;
}

/**
 * Every requirement this volume contributes that the buyer completes ELSEWHERE — one checklist row
 * each, so a marked volume leaves a trace instead of vanishing from the proposal.
 *
 * An authored volume can still contribute rows: the DoW Volume 1 is a DSIP cover-sheet webform
 * sitting beside two narrative documents that genuinely are written here.
 */
export function elsewhereRequirements(vol: ScopedVolume): Array<{ text: string; note: string }> {
  const source = vol.volumeName || 'RFP';
  const volNote = vol.expertNotes;
  const items = vol.items ?? [];

  if (!isAuthoredVolume(vol)) {
    // The whole volume is done elsewhere: one row per named item if the master listed any,
    // otherwise a single row for the volume itself — that is the empty-volume portal form.
    return items.length > 0
      ? items.map((it) => ({ text: it.itemName || source, note: elsewhereNote(it.expertNotes, volNote) }))
      : [{ text: source, note: elsewhereNote(volNote) }];
  }
  return items
    .filter((it) => !isAuthoredItem(it))
    .map((it) => ({ text: it.itemName || source, note: elsewhereNote(it.expertNotes, volNote) }));
}
