/**
 * The compliance read-out's margin line.
 *
 * Found by looking at a screenshot rather than at code: the deck capture for the customer guide
 * showed `Margins  0.5555555555555556" all` in the sidebar. Margins are stored in POINTS, the
 * read-out divided by 72, and nothing rounded — so any margin that is not a whole number of inches
 * printed a raw IEEE double at a customer. The `all` was a second, quieter defect: it read only
 * `margins.left` and asserted the other three matched it.
 *
 * Both assertions below FAIL against the previous expression (`{m.left / 72}" all`): the first on
 * the float, the second on the claim.
 */
import { describe, it, expect } from 'vitest';
import { marginLabel } from '@/components/canvas/canvas-sidebar';

describe('marginLabel', () => {
  it('rounds points→inches to a precision a person can read', () => {
    // slide_cso / slide_deck: 40pt all round. 40/72 = 0.5555555555555556.
    expect(marginLabel({ top: 40, right: 40, bottom: 40, left: 40 })).toBe('0.56" all');
  });

  it('keeps whole inches whole — no gratuitous 1.00"', () => {
    expect(marginLabel({ top: 72, right: 72, bottom: 72, left: 72 })).toBe('1" all');
    expect(marginLabel({ top: 54, right: 54, bottom: 54, left: 54 })).toBe('0.75" all');
  });

  it('does not claim "all" when the four sides differ', () => {
    // letter_onepager is 54/54/48/54 — the previous version reported `0.75" all`, which is false
    // for the bottom margin and is exactly the sort of quiet wrong number a compliance panel
    // must not produce.
    const label = marginLabel({ top: 54, right: 54, bottom: 48, left: 54 });
    expect(label).not.toContain('all');
    expect(label).toBe('0.75 · 0.75 · 0.67 · 0.75"');
  });
});
