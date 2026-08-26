/**
 * The second defect the picture caught and the assertions did not.
 *
 * `verify-ui-vs-db` compares the VALUE the page states to the value the table holds, and
 * `1100000.00` matched `1100000.00` perfectly. The page was still wrong: on a federal contract
 * workspace the funded amount is the first number a reader scans for, and a wall of digits with no
 * separator and no currency is a number they have to count on their fingers before they trust it.
 *
 * ── SO THE FIXTURES ARE STRINGS, NOT NUMBERS ─────────────────────────────────────────────────
 * postgres.js returns `numeric` as a STRING. A test that only fed numbers would pass against code
 * that assumed numbers and broke on what the driver actually hands back — the same lesson as
 * `delivery-dates.test.ts`, one column type over.
 */
import { describe, it, expect } from 'vitest';
import { usd, spentOf } from '@/lib/delivery/money';

describe('usd', () => {
  it('formats the string postgres.js returns for numeric', () => {
    expect(usd('1100000.00')).toBe('$1,100,000');
    expect(usd('805000')).toBe('$805,000');
    // The bug, stated as an assertion.
    expect(usd('1100000.00')).not.toBe('1100000.00');
  });

  it('drops cents — noise on a million-dollar CLIN, and the ledger still holds them', () => {
    expect(usd('1234.56')).toBe('$1,235');
    expect(usd('0.49')).toBe('$0');
  });

  it('takes a number too', () => {
    expect(usd(1100000)).toBe('$1,100,000');
    expect(usd(0)).toBe('$0');
  });

  it('puts the sign OUTSIDE the currency, not inside', () => {
    // "$-4,000" reads as a price; "-$4,000" reads as a deobligation.
    expect(usd('-4000')).toBe('-$4,000');
  });

  it('returns null — never "$NaN" — for anything unparseable', () => {
    for (const bad of [null, undefined, '', 'n/a', {}, [], Number.NaN, Infinity]) {
      expect(usd(bad), `usd(${JSON.stringify(bad)})`).toBeNull();
    }
  });
});

describe('spentOf', () => {
  it('formats both halves', () => {
    expect(spentOf('805000', '1750000')).toBe('$805,000 of $1,750,000 spent');
  });

  it('formats BOTH or NEITHER — a half-formatted sentence looks deliberate and is worse', () => {
    expect(spentOf('805000', null)).toBeNull();
    expect(spentOf(null, '1750000')).toBeNull();
  });
});
