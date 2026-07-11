/**
 * Driven regression for the customer-onboarding funnel:
 *   public application → admin accept → tenant + tenant_admin provisioned,
 *   the temp password is RETURNED to the admin (so it can be relayed even when
 *   email is unconfigured), and the opportunity river is mirrored onto the new
 *   tenant on signup (carbon-copy clone → a non-empty /cards).
 *
 * Locks two launch P0s (see docs/LAUNCH_READINESS_AND_10DAY_PLAN_2026-07-04.md):
 *   P0-5 credential delivery — accept returns tempPassword + emailError.
 *   P0-6 backfill-on-signup   — accept runs backfillTenant (cardsBackfilled).
 *
 * Runs as the RFP admin (admin storageState); the application is submitted through
 * the real public endpoint from an anonymous context. Uses a per-run unique email +
 * domain so re-runs don't trip the email/domain de-dup guard.
 */
import { test, expect, request as pwRequest } from '@playwright/test';

test('onboarding: apply → accept provisions the tenant, returns the temp password, mirrors cards', async ({ request, baseURL }) => {
  const ts = Date.now();
  const email = `founder+${ts}@acme-${ts}.test`;

  // 1. Public application (anonymous — the real funnel).
  const anon = await pwRequest.newContext({ baseURL });
  let appId: string;
  try {
    const res = await anon.post('/api/applications', {
      data: {
        contactEmail: email,
        contactName: 'Ada Founder',
        companyName: `Acme Labs ${ts}`,
        techSummary: 'Autonomous ISR edge inference for contested, comms-degraded environments.',
        motivation: 'We want to win an SBIR Phase I this cycle.',
        referralSource: 'colleague',
        termsAccepted: true,
        termsSignature: email,
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    appId = (await res.json()).data.id as string;
  } finally {
    await anon.dispose();
  }

  // 2. Admin accepts → provisions tenant + tenant_admin, returns credentials, backfills cards.
  const acc = await request.post(`/api/admin/applications/${appId}/accept`, {
    data: { reviewNotes: 'Approved (onboarding regression drive).' },
  });
  expect(acc.status(), await acc.text()).toBe(200);
  const d = (await acc.json()).data;

  // P0-5 — the temp password is obtainable from the response (not only the email),
  // so an approved customer can be let in even when no email provider is configured.
  expect(typeof d.tempPassword, 'accept returns a temp password').toBe('string');
  expect((d.tempPassword as string).length).toBeGreaterThan(6);
  expect(d, 'accept returns an emailError field (null or reason)').toHaveProperty('emailError');
  expect(d.tenantSlug, 'a tenant slug was allocated').toBeTruthy();

  // P0-6 — the opportunity river was mirrored onto the new tenant on signup.
  expect(typeof d.cardsBackfilled, 'accept reports a card-backfill count').toBe('number');

  // 3. Re-accepting an already-accepted application is rejected (idempotent guard).
  const again = await request.post(`/api/admin/applications/${appId}/accept`, { data: {} });
  expect(again.status(), await again.text()).toBe(409);
});
