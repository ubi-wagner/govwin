/**
 * Which required item in a COST volume receives the computed budget workbook.
 *
 * One rule, one place. Provisioning uses it to decide where `buildCostVolume`'s output lands, and
 * the mold builder uses it to decide what NOT to mold — and those two have to agree exactly. When
 * they did not, the mold builder stamped an empty `cost_volume`-typed skeleton onto the T3CP cost
 * item; provisioning saw a cost-typed mold, accepted it as a deliberate admin override, and the
 * computed workbook was never built. The section arrived as a bare heading, the drafter filled it
 * from the company's library, and the "cost volume" ended up as prose lifted from a different
 * agency's proposal — priced nothing, and citing the wrong solicitation.
 *
 * The selection prefers a DATA-bearing item over a prose sibling, so the workbook never lands on
 * "Basis of Estimate" while the real spreadsheet item is left empty.
 */

/** A prose companion to the workbook — never the workbook itself. */
const PROSE_ITEM = /narrative|justification|explanation|rationale|basis of estimate|\bboe\b|assumption/i;
const DATA_ITEM_TYPES = new Set(['spreadsheet', 'cost', 'cost_volume', 'budget']);
const DATA_ITEM_NAME = /spreadsheet|workbook|\btable\b|budget|pricing|cost\s*(?:volume|proposal|sheet)/i;

export interface CostItemLike {
  itemNumber: number;
  itemName: string;
  itemType: string;
  volumeNumber: number | null;
  volumeName: string | null;
}

/** The map key for a volume — number and name together, since either alone can repeat. */
export const volKeyOf = (num: number | null, name: string | null) => `${num ?? ''}|${name ?? ''}`;

/** Does this item look like it carries the numbers (rather than the words about them)? */
export const isDataItem = (it: { itemType?: string | null; itemName?: string | null }) =>
  DATA_ITEM_TYPES.has((it.itemType ?? '').toLowerCase()) || DATA_ITEM_NAME.test(it.itemName ?? '');

/**
 * volKey → the itemNumber that gets the computed workbook, for every COST volume.
 *
 * `isCostVolume` is passed in because the two callers know it differently: provisioning has
 * already resolved each volume's artifact type, while the mold builder reads it off the volume.
 */
export function pickCostWorkbookItems(
  items: readonly CostItemLike[],
  isCostVolume: (volKey: string) => boolean,
): Map<string, number> {
  const chosen = new Map<string, number>();
  for (const it of items) {
    const vkey = volKeyOf(it.volumeNumber, it.volumeName);
    if (!isCostVolume(vkey) || PROSE_ITEM.test(it.itemName ?? '')) continue;
    const cur = chosen.get(vkey);
    if (cur == null) { chosen.set(vkey, it.itemNumber); continue; }
    // First one wins, but a data-bearing item upgrades over a non-data one.
    const curItem = items.find((r) => r.itemNumber === cur && volKeyOf(r.volumeNumber, r.volumeName) === vkey);
    if (isDataItem(it) && !(curItem && isDataItem(curItem))) chosen.set(vkey, it.itemNumber);
  }
  return chosen;
}
