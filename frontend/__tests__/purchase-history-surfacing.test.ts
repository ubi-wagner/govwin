/**
 * WHAT A PURCHASE WAS FOR.
 *
 * `/api/portal/[tenantSlug]/purchases` has always LEFT JOINed `proposals` and `opportunities` to
 * return `proposal_title` and `opportunity_title` alongside each row. Nothing had ever called it:
 * the Billing page and the Manage console each ran their own bare `SELECT` and rendered Product /
 * Amount / Status / Date. A customer with three portal purchases therefore saw three rows reading
 * "Proposal Portal (Phase I) · $0.00 · Completed", two of them on the same date, with nothing to
 * distinguish them — while the answer sat computed in a route with no caller.
 *
 * Found by the capability reconciliation (`scripts/reconcile-capability.mjs`) and confirmed against
 * the captured screenshot `docs/ui-atlas/tenant__portal-tenantSlug-billing.jpg`, which shows the
 * three identical rows.
 *
 * Two halves, and both have to hold or the fix is cosmetic:
 *   1. the panel RENDERS a title when one is present, and stays quiet when one is not
 *      (consulting hours buy no proposal, so both joins are null and a blank line would be worse)
 *   2. both pages actually SELECT the titles — the panel can only render what it is handed, and
 *      the reason this was invisible for so long is that nothing failed when they were absent
 */
import { describe, it, expect } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import path from 'node:path';
import BillingPanel from '@/components/portal/billing-panel';

const base = {
  id: 'p1', productType: 'proposal_portal', amountCents: 0,
  status: 'completed', createdAt: '2026-08-10T00:00:00Z', opportunityId: null,
};
const render = (purchases: unknown[]) => renderToStaticMarkup(
  h(BillingPanel as never, {
    tenantSlug: 't', subscriptionStatus: 'none', hasStripeCustomer: false,
    canManageBilling: true, purchases,
  } as never),
);

describe('purchase history names what was bought', () => {
  it('shows the proposal title under the product', () => {
    const html = render([{ ...base, proposalTitle: 'Additive Manufacturing Phase I', opportunityTitle: null }]);
    expect(html).toContain('Additive Manufacturing Phase I');
  });

  it('falls back to the opportunity title when the purchase predates the proposal', () => {
    // A comp-code purchase creates the `purchases` row before the portal is provisioned, so
    // `proposal_id` is null and the opportunity is the only thing that can name it.
    const html = render([{ ...base, proposalTitle: null, opportunityTitle: 'AF X25.6 — Sustainment' }]);
    expect(html).toContain('AF X25.6 — Sustainment');
  });

  it('renders nothing extra when a purchase names no work', () => {
    const withNames = render([{ ...base, proposalTitle: 'A', opportunityTitle: 'B' }]);
    const without = render([{ ...base, proposalTitle: null, opportunityTitle: null }]);
    // The bare row must not grow an empty element — same markup as before the titles existed.
    expect(without).not.toContain('mt-0.5');
    expect(withNames).toContain('mt-0.5');
  });

  it('distinguishes two same-day purchases, which is the whole point', () => {
    const html = render([
      { ...base, id: 'a', proposalTitle: 'Portal A', opportunityTitle: null },
      { ...base, id: 'b', proposalTitle: 'Portal B', opportunityTitle: null },
    ]);
    expect(html).toContain('Portal A');
    expect(html).toContain('Portal B');
  });
});

describe('both purchase-history pages select the titles', () => {
  // The panel is handed data by two separate server components running two separate queries. A
  // test of the panel alone passes while a page silently supplies null for every row.
  const pages = [
    'app/portal/[tenantSlug]/billing/page.tsx',
    'app/portal/[tenantSlug]/manage/page.tsx',
  ];
  for (const rel of pages) {
    it(`${rel} joins proposals and opportunities`, () => {
      const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
      // Window the whole statement, not just what follows FROM — the titles are in the SELECT
      // ABOVE it, and slicing forward passed the JOIN assertions while missing the columns.
      const at = src.indexOf('FROM purchases');
      const q = src.slice(Math.max(0, at - 500), at + 500);
      expect(q).toMatch(/LEFT JOIN proposals/);
      expect(q).toMatch(/LEFT JOIN opportunities/);
      expect(q).toMatch(/proposal_title/);
      expect(q).toMatch(/opportunity_title/);
    });
  }
});
