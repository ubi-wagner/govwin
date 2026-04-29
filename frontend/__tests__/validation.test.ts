import { describe, expect, it } from 'vitest';
import {
  zDottedName,
  zEmail,
  zPaginationRequest,
  zPassword,
  zRole,
  zSortOrder,
  zTenantSlug,
  zUuid,
} from '@/lib/validation';

describe('zUuid', () => {
  it('accepts a valid v4 UUID', () => {
    expect(zUuid.safeParse('550e8400-e29b-41d4-a716-446655440000').success).toBe(true);
  });

  it('accepts uppercase UUID (case-insensitive)', () => {
    expect(zUuid.safeParse('550E8400-E29B-41D4-A716-446655440000').success).toBe(true);
  });

  it('rejects invalid formats', () => {
    expect(zUuid.safeParse('not-a-uuid').success).toBe(false);
    expect(zUuid.safeParse('550e8400e29b41d4a716446655440000').success).toBe(false);
    expect(zUuid.safeParse('').success).toBe(false);
  });
});

describe('zEmail', () => {
  it('lowercases and trims on parse', () => {
    const parsed = zEmail.safeParse('  Eric@RfpPipeline.COM  ');
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toBe('eric@rfppipeline.com');
  });

  it('rejects malformed addresses', () => {
    expect(zEmail.safeParse('not-an-email').success).toBe(false);
    expect(zEmail.safeParse('@nowhere.com').success).toBe(false);
  });
});

describe('zTenantSlug', () => {
  it('accepts valid kebab-case slugs', () => {
    expect(zTenantSlug.safeParse('acme').success).toBe(true);
    expect(zTenantSlug.safeParse('acme-corp').success).toBe(true);
    expect(zTenantSlug.safeParse('a1-b2-c3').success).toBe(true);
  });

  it('rejects uppercase, underscores, leading/trailing dashes', () => {
    expect(zTenantSlug.safeParse('Acme').success).toBe(false);
    expect(zTenantSlug.safeParse('acme_corp').success).toBe(false);
    expect(zTenantSlug.safeParse('-acme').success).toBe(false);
    expect(zTenantSlug.safeParse('acme-').success).toBe(false);
  });

  it('rejects too-short slugs', () => {
    expect(zTenantSlug.safeParse('ab').success).toBe(false);
  });
});

describe('zDottedName', () => {
  it('accepts valid dotted identifiers', () => {
    expect(zDottedName.safeParse('memory.search').success).toBe(true);
    expect(zDottedName.safeParse('finder.solicitation.pushed').success).toBe(true);
    expect(zDottedName.safeParse('tool.invoke.start').success).toBe(true);
  });

  it('rejects single-segment or non-dotted', () => {
    expect(zDottedName.safeParse('memory').success).toBe(false);
    expect(zDottedName.safeParse('Memory.Search').success).toBe(false);
    expect(zDottedName.safeParse('memory/search').success).toBe(false);
  });
});

describe('zPassword', () => {
  it('accepts passwords of 12+ characters', () => {
    expect(zPassword.safeParse('a'.repeat(12)).success).toBe(true);
    expect(zPassword.safeParse('a'.repeat(200)).success).toBe(true);
  });

  it('rejects passwords shorter than 12 characters', () => {
    expect(zPassword.safeParse('short').success).toBe(false);
    expect(zPassword.safeParse('a'.repeat(11)).success).toBe(false);
  });

  it('rejects passwords longer than 256 characters', () => {
    expect(zPassword.safeParse('a'.repeat(257)).success).toBe(false);
  });
});

describe('zRole', () => {
  it('accepts all five canonical roles', () => {
    for (const r of ['master_admin', 'rfp_admin', 'tenant_admin', 'tenant_user', 'partner_user']) {
      expect(zRole.safeParse(r).success).toBe(true);
    }
  });

  it('rejects unknown roles', () => {
    expect(zRole.safeParse('admin').success).toBe(false);
    expect(zRole.safeParse('super_admin').success).toBe(false);
  });
});

describe('zPaginationRequest', () => {
  it('uses default limit when not provided', () => {
    const parsed = zPaginationRequest.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.limit).toBe(50);
  });

  it('accepts cursor + limit', () => {
    const parsed = zPaginationRequest.safeParse({ cursor: 'abc', limit: 25 });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.cursor).toBe('abc');
      expect(parsed.data.limit).toBe(25);
    }
  });

  it('rejects limit > 200', () => {
    expect(zPaginationRequest.safeParse({ limit: 500 }).success).toBe(false);
  });

  it('rejects non-integer limit', () => {
    expect(zPaginationRequest.safeParse({ limit: 3.14 }).success).toBe(false);
  });
});

describe('zSortOrder', () => {
  it('defaults to desc', () => {
    const parsed = zSortOrder.safeParse(undefined);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toBe('desc');
  });

  it('accepts asc and desc', () => {
    expect(zSortOrder.safeParse('asc').success).toBe(true);
    expect(zSortOrder.safeParse('desc').success).toBe(true);
  });

  it('rejects other values', () => {
    expect(zSortOrder.safeParse('random').success).toBe(false);
  });
});
