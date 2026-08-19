/**
 * The cost workbook lands on exactly one item per cost volume, and the mold builder must skip that
 * same item.
 *
 * When these two disagreed, the mold builder stamped an empty `cost_volume`-typed skeleton onto
 * the T3CP cost item; provisioning saw a cost-typed mold, read it as a deliberate admin override
 * of the workbook, and never computed one. The buyer's cost volume arrived as a bare heading, the
 * drafter filled it from the company's library, and the "cost volume" ended up as prose lifted
 * from a different agency's proposal — priced nothing, and citing the wrong solicitation.
 */
import { describe, it, expect } from 'vitest';
import { pickCostWorkbookItems, isDataItem, volKeyOf, type CostItemLike } from '@/lib/proposal/cost-workbook-item';

const item = (n: number, name: string, type = 'document', vol = 3, volName = 'Cost Volume'): CostItemLike =>
  ({ itemNumber: n, itemName: name, itemType: type, volumeNumber: vol, volumeName: volName });

const allCost = () => true;
const costOnly = (k: string) => k.startsWith('3|');

describe('isDataItem', () => {
  it('recognises the type', () => {
    for (const t of ['spreadsheet', 'cost', 'cost_volume', 'budget', 'SPREADSHEET']) {
      expect(isDataItem({ itemType: t, itemName: 'Anything' }), t).toBe(true);
    }
  });

  it('recognises the name when the type is generic', () => {
    for (const n of ['Cost Proposal', 'Budget Workbook', 'Pricing Table', 'Phase I Base Cost Proposal']) {
      expect(isDataItem({ itemType: 'document', itemName: n }), n).toBe(true);
    }
  });

  it('does not mistake a prose companion for the workbook', () => {
    for (const n of ['Basis of Estimate', 'Cost Narrative', 'Pricing Rationale']) {
      // These are excluded as PROSE by the picker; isDataItem alone may still match on a word like
      // "Pricing", which is why the picker filters prose FIRST.
      expect(pickCostWorkbookItems([item(1, n)], allCost).size).toBe(0);
    }
  });
});

describe('pickCostWorkbookItems', () => {
  it('picks the single item in a one-item cost volume', () => {
    const chosen = pickCostWorkbookItems([item(1, 'Phase I Base Cost Proposal', 'spreadsheet')], allCost);
    expect(chosen.get(volKeyOf(3, 'Cost Volume'))).toBe(1);
  });

  it('prefers the data item over a prose sibling regardless of order', () => {
    const forward = pickCostWorkbookItems(
      [item(1, 'Basis of Estimate'), item(2, 'Cost Workbook', 'spreadsheet')], allCost);
    expect(forward.get(volKeyOf(3, 'Cost Volume'))).toBe(2);

    const reverse = pickCostWorkbookItems(
      [item(1, 'Cost Workbook', 'spreadsheet'), item(2, 'Basis of Estimate')], allCost);
    expect(reverse.get(volKeyOf(3, 'Cost Volume'))).toBe(1);
  });

  it('upgrades from a non-data first item to a real data item', () => {
    const chosen = pickCostWorkbookItems(
      [item(1, 'Cover Page', 'document'), item(2, 'Budget Detail', 'spreadsheet')], allCost);
    expect(chosen.get(volKeyOf(3, 'Cost Volume'))).toBe(2);
  });

  it('never picks two workbooks in one volume', () => {
    const chosen = pickCostWorkbookItems(
      [item(1, 'Cost Workbook', 'spreadsheet'), item(2, 'Pricing Table', 'spreadsheet')], allCost);
    expect(chosen.size).toBe(1);
  });

  it('picks one per cost volume when there are several', () => {
    const chosen = pickCostWorkbookItems([
      item(1, 'Base Cost', 'spreadsheet', 3, 'Cost Volume'),
      item(1, 'Option Cost', 'spreadsheet', 4, 'Option Cost Volume'),
    ], allCost);
    expect(chosen.get(volKeyOf(3, 'Cost Volume'))).toBe(1);
    expect(chosen.get(volKeyOf(4, 'Option Cost Volume'))).toBe(1);
  });

  it('ignores volumes that are not cost volumes', () => {
    const chosen = pickCostWorkbookItems([
      item(1, 'Technical Approach', 'document', 2, 'Technical Volume'),
      item(1, 'Base Cost', 'spreadsheet', 3, 'Cost Volume'),
    ], costOnly);
    expect(chosen.has(volKeyOf(2, 'Technical Volume'))).toBe(false);
    expect(chosen.get(volKeyOf(3, 'Cost Volume'))).toBe(1);
  });

  it('leaves a cost volume of only prose items with no workbook item', () => {
    const chosen = pickCostWorkbookItems(
      [item(1, 'Cost Narrative'), item(2, 'Basis of Estimate')], allCost);
    expect(chosen.size).toBe(0);
  });

  it('keys on number AND name, so two volumes sharing a number stay distinct', () => {
    const chosen = pickCostWorkbookItems([
      item(1, 'Base Cost', 'spreadsheet', 3, 'Cost Volume'),
      item(1, 'State Budget', 'spreadsheet', 3, 'TVSF Budget'),
    ], allCost);
    expect(chosen.size).toBe(2);
  });

  it('the T3CP shape: one spreadsheet item, chosen', () => {
    // Exactly what the master carries — and exactly the item the mold builder must skip.
    const chosen = pickCostWorkbookItems(
      [item(1, 'Phase I Base Cost Proposal', 'spreadsheet', 3, 'Cost Volume')], allCost);
    expect(chosen.get(volKeyOf(3, 'Cost Volume'))).toBe(1);
  });
});
