/**
 * The automation dial can never lie (#190 integrity guard).
 *
 * The tenant Automation editor renders TRIGGER_CATALOG and lets a customer tune recipients / nudge
 * cadence / channel per trigger. Those settings only DELIVER anything when some `resolveGatePolicy`
 * consumer fires that trigger. Three catalog triggers had no consumer — a tenant could configure them,
 * hit Save, and nothing would ever send. This test pins each catalog trigger's `deliveryStatus` to the
 * ground truth (does a consumer fire it?) so an 'active' dial always delivers and a 'preview' dial is
 * honestly labelled not-yet-delivering in the UI.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TRIGGER_CATALOG, isDeliveryActive } from '@/lib/automation/catalog';

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '..');

// The ONLY files that call resolveGatePolicy — the exhaustive set of places a trigger's configured
// recipients/timing/channel can actually drive a notification. (Grep: `resolveGatePolicy(` call-sites.)
const CONSUMER_SRC = [
  'lib/automation/prestage-todos.ts',                                        // section_review / final_review
  'lib/proposal-advance.ts',                                                 // proposal:proposal.advanced
  'app/api/portal/[tenantSlug]/proposals/create/route.ts',                   // admin_review (internal)
  'app/api/portal/[tenantSlug]/proposals/[proposalId]/outcome/route.ts',     // contract_kickoff (internal)
  'app/api/portal/[tenantSlug]/purchase/route.ts',                           // proposal_setup (internal)
  'app/api/stripe/webhook/route.ts',                                         // curation SLA (internal)
].map((p) => readFileSync(join(FRONTEND, p), 'utf8')).join('\n');

const firesTrigger = (key: string) => CONSUMER_SRC.includes(`triggerKey: '${key}'`);

describe('automation trigger catalog — the dial can never lie', () => {
  it('marks exactly the consumer-backed triggers as active (locks the current truth)', () => {
    const active = TRIGGER_CATALOG.filter((t) => t.deliveryStatus === 'active')
      .map((t) => `${t.scope}:${t.triggerKey}`).sort();
    expect(active).toEqual([
      'build:final_review',
      'build:proposal:proposal.advanced',
      'build:section_review',
    ]);
  });

  it('every ACTIVE trigger is fired by a real resolveGatePolicy consumer (no active-but-dead dial)', () => {
    for (const t of TRIGGER_CATALOG.filter((t) => t.deliveryStatus === 'active')) {
      expect(
        firesTrigger(t.triggerKey),
        `active trigger '${t.triggerKey}' must be fired by a resolveGatePolicy consumer — wire it or mark it 'preview'`,
      ).toBe(true);
    }
  });

  it('every PREVIEW trigger has NO consumer (else it should be marked active)', () => {
    for (const t of TRIGGER_CATALOG.filter((t) => t.deliveryStatus === 'preview')) {
      expect(
        firesTrigger(t.triggerKey),
        `preview trigger '${t.triggerKey}' appears as a resolveGatePolicy key — it delivers, so mark it 'active'`,
      ).toBe(false);
    }
  });

  it('every catalog trigger declares a deliveryStatus, and the helper agrees', () => {
    for (const t of TRIGGER_CATALOG) {
      expect(t.deliveryStatus === 'active' || t.deliveryStatus === 'preview').toBe(true);
      expect(isDeliveryActive(t.scope, t.triggerKey)).toBe(t.deliveryStatus === 'active');
    }
    // Spot-checks of the two headline cases.
    expect(isDeliveryActive('build', 'proposal:proposal.advanced')).toBe(true);
    expect(isDeliveryActive('build', 'proposal:document.locked')).toBe(false);
  });
});
