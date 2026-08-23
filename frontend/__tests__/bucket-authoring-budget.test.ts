/**
 * The spotlight-bucket authoring budget (#189).
 *
 * A bucket is the CUSTOMER's own ranking lens — a 1:n they open empty and fill. Two things follow,
 * and this file is the guard on both:
 *
 *   1. Nothing is seeded on tenant creation. The four creation paths used to call
 *      seedDefaultBuckets, and that is what entangled the cap with the number seeded.
 *   2. The cap is therefore a plain authoring budget, independent of the starter catalog.
 *
 * The history is worth keeping in front of whoever changes these numbers next. Mig 181 set the cap
 * to 6 while six buckets were seeded, so a brand-new tenant opened at 100% of cap and was refused
 * 409 BUCKET_LIMIT before authoring anything (B62). Mig 203 added headroom — which patched the
 * symptom and left the two numbers coupled, so moving either would collide again. #189 removed the
 * seeding instead.
 *
 * The last test here is the important one: it reads the SOURCE of the four creation paths and fails
 * if any of them imports the seeder again. Value assertions catch a number drifting; only a
 * structural assertion catches the architecture drifting back.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ enterTenant: () => {}, enterBypass: () => {}, sql: sqlMock }));
vi.mock('@/lib/rls', () => ({ withTenant: (_t: string, fn: (tx: unknown) => unknown) => fn(sqlMock) }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), child: () => ({ warn: vi.fn(), info: vi.fn() }) }),
}));

import { DEFAULT_MAX_BUCKETS, MIN_MAX_BUCKETS, getMaxBucketsPerTenant } from '@/lib/automation/policy';
import { DEFAULT_BUCKETS } from '@/lib/spotlight/default-buckets';

const ROOT = path.resolve(__dirname, '..');

beforeEach(() => sqlMock.mockReset());

describe('the cap is an authoring budget, not `seeded + headroom`', () => {
  it('leaves real room to author', () => {
    expect(DEFAULT_MAX_BUCKETS).toBeGreaterThanOrEqual(10);
  });

  it('is NOT derived from the starter catalog — the B62 entanglement stays broken', () => {
    // The exact failure: cap === seeded meant a new tenant opened at 100% of cap. Even with the
    // seeding gone, a cap that tracks the catalog size would re-couple two unrelated numbers.
    expect(DEFAULT_MAX_BUCKETS).not.toBe(DEFAULT_BUCKETS.length);
    expect(DEFAULT_MAX_BUCKETS).not.toBe(DEFAULT_BUCKETS.length + 4);
    expect(MIN_MAX_BUCKETS).not.toBe(DEFAULT_BUCKETS.length + 1);
  });

  it('never floors so low a tenant cannot author one lens', () => {
    expect(MIN_MAX_BUCKETS).toBeGreaterThanOrEqual(1);
  });
});

describe('getMaxBucketsPerTenant', () => {
  it('uses the rfp_admin-configured value', async () => {
    sqlMock.mockResolvedValueOnce([{ maxBucketsPerTenant: 40 }]);
    expect(await getMaxBucketsPerTenant()).toBe(40);
  });

  it('floors a configured value that would leave a tenant unable to author', async () => {
    sqlMock.mockResolvedValueOnce([{ maxBucketsPerTenant: 1 }]);
    expect(await getMaxBucketsPerTenant()).toBeGreaterThanOrEqual(MIN_MAX_BUCKETS);
  });

  it('falls back to the default rather than throwing — bucket-create must never break', async () => {
    sqlMock.mockRejectedValueOnce(new Error('framework read failed'));
    expect(await getMaxBucketsPerTenant()).toBe(DEFAULT_MAX_BUCKETS);
  });

  it('falls back when the framework row is missing entirely', async () => {
    sqlMock.mockResolvedValueOnce([]);
    expect(await getMaxBucketsPerTenant()).toBe(DEFAULT_MAX_BUCKETS);
  });
});

describe('no production path seeds buckets', () => {
  // Every path that creates a tenant. If one is added, add it here — an unlisted creation path is
  // exactly how the seeding would return unnoticed.
  const CREATION_PATHS = [
    'app/api/admin/applications/[id]/accept/route.ts',
    'lib/partner/create-partner-org.ts',
    'lib/partner/own-org.ts',
    'lib/tenants/create-tenant.ts',
  ];

  it.each(CREATION_PATHS)('%s does not seed spotlight buckets', (rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    expect(src).not.toMatch(/seedDefaultBuckets/);
    expect(src).not.toMatch(/from '@\/lib\/spotlight\/default-buckets'/);
  });

  it('the starter catalog still exists for fixtures and the demo seed', () => {
    // Removed from the product path, NOT deleted: test fixtures and the sandbox/demo seed both
    // legitimately want a realistic multi-bucket tenant.
    expect(Array.isArray(DEFAULT_BUCKETS)).toBe(true);
    expect(DEFAULT_BUCKETS.length).toBeGreaterThan(0);
    for (const b of DEFAULT_BUCKETS) {
      expect(typeof b.name).toBe('string');
      expect(b.criteria).toBeTruthy();
    }
  });
});
