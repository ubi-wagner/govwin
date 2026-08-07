/**
 * Add-company precheck classifier (docs/PARTNER_MANAGER_DESIGN.md §4).
 * Pure decision logic — the ordering of the hard gates (email → exact → similar → new) is the
 * safety-critical part; the DB reads are covered by the drive/E2E.
 */
import { describe, expect, it, vi } from 'vitest';

// classifyPrecheck is pure, but the module graph pulls in @/lib/db (via runPrecheck's imports),
// which throws at load without DATABASE_URL — mock it so the pure test can import cleanly.
vi.mock('@/lib/db', () => ({ sqlBypass: vi.fn() }));

import { classifyPrecheck } from '@/lib/partner/precheck';

const match = (id: string) => ({ id, slug: id, name: id, similarity: 0.9, ownerId: null });

describe('classifyPrecheck', () => {
  it('clear-to-create when nothing matches', () => {
    expect(classifyPrecheck({ exactExistingTenant: null, similar: [], emailInUseAsAdmin: false })).toBe('ok_new');
  });
  it('soft review when a similar name exists', () => {
    expect(classifyPrecheck({ exactExistingTenant: null, similar: [match('a')], emailInUseAsAdmin: false })).toBe('review_similar');
  });
  it('routes to manager-request on an exact tenant match', () => {
    expect(classifyPrecheck({ exactExistingTenant: match('a'), similar: [], emailInUseAsAdmin: false })).toBe('must_request_manager');
  });
  it('email-taken is the highest-priority hard gate', () => {
    // even with an exact match AND similars, an in-use admin email blocks first
    expect(classifyPrecheck({ exactExistingTenant: match('a'), similar: [match('b')], emailInUseAsAdmin: true })).toBe('email_taken');
  });
  it('exact match outranks a similar-only review', () => {
    expect(classifyPrecheck({ exactExistingTenant: match('a'), similar: [match('b')], emailInUseAsAdmin: false })).toBe('must_request_manager');
  });
});
