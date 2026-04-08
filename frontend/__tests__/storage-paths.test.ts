import { describe, expect, it } from 'vitest';
import {
  assertKeyBelongsToTenant,
  customerPath,
  rfpAdminDiscardedPath,
  rfpAdminInboxPath,
  rfpPipelinePath,
} from '@/lib/storage/paths';

const FIXED_DATE = new Date('2026-04-08T12:00:00Z');
const OPP_UUID = '11111111-2222-3333-4444-555555555555';
const PROP_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ATTACH_UUID = '99999999-8888-7777-6666-555555555555';
const UNIT_UUID = 'deadbeef-1234-5678-90ab-cdef12345678';
const ASSET_UUID = 'cafef00d-1234-5678-90ab-cdef12345678';

describe('rfpAdminInboxPath', () => {
  it('builds inbox path with UTC date parts', () => {
    expect(
      rfpAdminInboxPath({
        source: 'sam-gov',
        externalId: 'NOTICE-ABC-123',
        ext: 'PDF',
        at: FIXED_DATE,
      }),
    ).toBe('rfp-admin/inbox/2026/04/08/sam-gov/NOTICE-ABC-123.pdf');
  });

  it('lowercases the extension', () => {
    const p = rfpAdminInboxPath({
      source: 'sbir-gov',
      externalId: 'id1',
      ext: 'DOCX',
      at: FIXED_DATE,
    });
    expect(p.endsWith('.docx')).toBe(true);
  });

  it('rejects unknown source', () => {
    expect(() =>
      rfpAdminInboxPath({
        // @ts-expect-error deliberately invalid
        source: 'unknown',
        externalId: 'id1',
        ext: 'pdf',
      }),
    ).toThrow(/invalid source/);
  });

  it('rejects external id with path separator', () => {
    expect(() =>
      rfpAdminInboxPath({
        source: 'sam-gov',
        externalId: '../escape',
        ext: 'pdf',
      }),
    ).toThrow(/invalid external id/);
  });

  it('rejects extension with dot', () => {
    expect(() =>
      rfpAdminInboxPath({
        source: 'sam-gov',
        externalId: 'id1',
        ext: '.pdf',
      }),
    ).toThrow(/invalid extension/);
  });
});

describe('rfpAdminDiscardedPath', () => {
  it('builds path with yyyy/mm only', () => {
    expect(
      rfpAdminDiscardedPath({
        externalId: 'id-1',
        ext: 'pdf',
        at: FIXED_DATE,
      }),
    ).toBe('rfp-admin/discarded/2026/04/id-1.pdf');
  });
});

describe('rfpPipelinePath', () => {
  it('source kind needs ext', () => {
    expect(rfpPipelinePath({ opportunityId: OPP_UUID, kind: 'source', ext: 'pdf' })).toBe(
      `rfp-pipeline/${OPP_UUID}/source.pdf`,
    );
    expect(() => rfpPipelinePath({ opportunityId: OPP_UUID, kind: 'source' })).toThrow(
      /source requires ext/,
    );
  });

  it('text and metadata have fixed names', () => {
    expect(rfpPipelinePath({ opportunityId: OPP_UUID, kind: 'text' })).toBe(
      `rfp-pipeline/${OPP_UUID}/text.md`,
    );
    expect(rfpPipelinePath({ opportunityId: OPP_UUID, kind: 'metadata' })).toBe(
      `rfp-pipeline/${OPP_UUID}/metadata.json`,
    );
  });

  it('shredded kind writes under /shredded/', () => {
    expect(
      rfpPipelinePath({
        opportunityId: OPP_UUID,
        kind: 'shredded',
        name: 'requirements',
      }),
    ).toBe(`rfp-pipeline/${OPP_UUID}/shredded/requirements.md`);
  });

  it('rejects non-uuid opportunity id', () => {
    expect(() =>
      rfpPipelinePath({ opportunityId: 'not-a-uuid', kind: 'text' }),
    ).toThrow(/invalid opportunity id/);
  });
});

describe('customerPath', () => {
  it('upload path uses yyyy/mm', () => {
    expect(
      customerPath({
        tenantSlug: 'acme-corp',
        kind: 'upload',
        name: ATTACH_UUID,
        ext: 'pdf',
        at: FIXED_DATE,
      }),
    ).toBe(`customers/acme-corp/uploads/2026/04/${ATTACH_UUID}.pdf`);
  });

  it('proposal-section path uses section slug', () => {
    expect(
      customerPath({
        tenantSlug: 'acme-corp',
        kind: 'proposal-section',
        proposalId: PROP_UUID,
        sectionSlug: 'executive-summary',
      }),
    ).toBe(`customers/acme-corp/proposals/${PROP_UUID}/sections/executive-summary.md`);
  });

  it('library-unit path under library/units/', () => {
    expect(
      customerPath({
        tenantSlug: 'acme-corp',
        kind: 'library-unit',
        unitId: UNIT_UUID,
      }),
    ).toBe(`customers/acme-corp/library/units/${UNIT_UUID}.md`);
  });

  it('library-asset path under library/assets/', () => {
    expect(
      customerPath({
        tenantSlug: 'acme-corp',
        kind: 'library-asset',
        assetId: ASSET_UUID,
        ext: 'png',
      }),
    ).toBe(`customers/acme-corp/library/assets/${ASSET_UUID}.png`);
  });

  it('rejects tenant slug with uppercase', () => {
    expect(() =>
      customerPath({
        tenantSlug: 'AcmeCorp',
        kind: 'upload',
        name: ATTACH_UUID,
        ext: 'pdf',
      }),
    ).toThrow(/invalid tenant slug/);
  });

  it('rejects tenant slug with slash (path traversal guard)', () => {
    expect(() =>
      customerPath({
        tenantSlug: 'acme/../evil',
        kind: 'upload',
        name: ATTACH_UUID,
        ext: 'pdf',
      }),
    ).toThrow(/invalid tenant slug/);
  });

  it('rejects too-short tenant slug', () => {
    expect(() =>
      customerPath({
        tenantSlug: 'a',
        kind: 'library-unit',
        unitId: UNIT_UUID,
      }),
    ).toThrow(/invalid tenant slug/);
  });
});

describe('assertKeyBelongsToTenant', () => {
  it('passes for a matching key', () => {
    expect(() =>
      assertKeyBelongsToTenant('customers/acme-corp/uploads/2026/04/xyz.pdf', 'acme-corp'),
    ).not.toThrow();
  });

  it('throws for a different tenant', () => {
    expect(() =>
      assertKeyBelongsToTenant('customers/evil-corp/uploads/xyz.pdf', 'acme-corp'),
    ).toThrow(/does not belong to tenant/);
  });

  it('throws for an admin key', () => {
    expect(() =>
      assertKeyBelongsToTenant('rfp-admin/inbox/2026/04/08/sam-gov/id.pdf', 'acme-corp'),
    ).toThrow(/does not belong to tenant/);
  });
});
