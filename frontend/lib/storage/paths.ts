/**
 * Object-storage path helpers — canonical source for S3 keys.
 *
 * ALL application code that needs an S3 key MUST go through one of
 * the functions in this file. Never concatenate bucket/key strings
 * in callers. See docs/STORAGE_LAYOUT.md and docs/DECISIONS.md D002
 * for the layout rationale.
 *
 * The three top-level prefixes are:
 *   - rfp-admin/      Curation staging (admin-only)
 *   - rfp-pipeline/   Published opportunity artifacts
 *   - customers/      Per-tenant isolated storage
 */

const TENANT_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECTION_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const EXT_RE = /^[a-z0-9]{1,8}$/;
const EXTERNAL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type RfpSource = 'sam-gov' | 'sbir-gov' | 'grants-gov' | 'manual-upload';
const RFP_SOURCES: readonly RfpSource[] = ['sam-gov', 'sbir-gov', 'grants-gov', 'manual-upload'];

function assertTenantSlug(slug: string): void {
  if (!TENANT_SLUG_RE.test(slug)) {
    throw new Error(`[storage/paths] invalid tenant slug: ${JSON.stringify(slug)}`);
  }
}

function assertUuid(id: string, label: string): void {
  if (!UUID_RE.test(id)) {
    throw new Error(`[storage/paths] invalid ${label}: ${JSON.stringify(id)}`);
  }
}

function assertSectionSlug(slug: string): void {
  if (!SECTION_SLUG_RE.test(slug)) {
    throw new Error(`[storage/paths] invalid section slug: ${JSON.stringify(slug)}`);
  }
}

function assertExt(ext: string): void {
  const lower = ext.toLowerCase();
  if (!EXT_RE.test(lower)) {
    throw new Error(`[storage/paths] invalid extension: ${JSON.stringify(ext)}`);
  }
}

function assertExternalId(id: string): void {
  if (!EXTERNAL_ID_RE.test(id)) {
    throw new Error(`[storage/paths] invalid external id: ${JSON.stringify(id)}`);
  }
}

function assertSource(source: string): asserts source is RfpSource {
  if (!RFP_SOURCES.includes(source as RfpSource)) {
    throw new Error(`[storage/paths] invalid source: ${JSON.stringify(source)}`);
  }
}

function ymd(date: Date): { yyyy: string; mm: string; dd: string } {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return { yyyy, mm, dd };
}

// ----------------------------------------------------------------------------
// rfp-admin/ — curation staging
// ----------------------------------------------------------------------------

export interface RfpAdminInboxInput {
  source: RfpSource;
  externalId: string;
  ext: string;
  at?: Date;
}

export function rfpAdminInboxPath(p: RfpAdminInboxInput): string {
  assertSource(p.source);
  assertExternalId(p.externalId);
  assertExt(p.ext);
  const { yyyy, mm, dd } = ymd(p.at ?? new Date());
  return `rfp-admin/inbox/${yyyy}/${mm}/${dd}/${p.source}/${p.externalId}.${p.ext.toLowerCase()}`;
}

export interface RfpAdminDiscardedInput {
  externalId: string;
  ext: string;
  at?: Date;
}

export function rfpAdminDiscardedPath(p: RfpAdminDiscardedInput): string {
  assertExternalId(p.externalId);
  assertExt(p.ext);
  const { yyyy, mm } = ymd(p.at ?? new Date());
  return `rfp-admin/discarded/${yyyy}/${mm}/${p.externalId}.${p.ext.toLowerCase()}`;
}

// ----------------------------------------------------------------------------
// rfp-pipeline/ — published opportunity artifacts
// ----------------------------------------------------------------------------

export type RfpPipelineKind = 'source' | 'text' | 'metadata' | 'shredded' | 'attachment';

export interface RfpPipelineInput {
  opportunityId: string;
  kind: RfpPipelineKind;
  /** For kind=shredded: the section slug. For kind=attachment: the filename base. */
  name?: string;
  /** For kind=source or kind=attachment: the file extension without the dot. */
  ext?: string;
}

export function rfpPipelinePath(p: RfpPipelineInput): string {
  assertUuid(p.opportunityId, 'opportunity id');
  const base = `rfp-pipeline/${p.opportunityId}`;
  switch (p.kind) {
    case 'source': {
      if (!p.ext) throw new Error('[storage/paths] rfp-pipeline source requires ext');
      assertExt(p.ext);
      return `${base}/source.${p.ext.toLowerCase()}`;
    }
    case 'text':
      return `${base}/text.md`;
    case 'metadata':
      return `${base}/metadata.json`;
    case 'shredded': {
      if (!p.name) throw new Error('[storage/paths] rfp-pipeline shredded requires name');
      assertSectionSlug(p.name);
      return `${base}/shredded/${p.name}.md`;
    }
    case 'attachment': {
      if (!p.name || !p.ext) {
        throw new Error('[storage/paths] rfp-pipeline attachment requires name and ext');
      }
      assertSectionSlug(p.name);
      assertExt(p.ext);
      return `${base}/attachments/${p.name}.${p.ext.toLowerCase()}`;
    }
  }
}

// ----------------------------------------------------------------------------
// customers/ — per-tenant isolated storage
// ----------------------------------------------------------------------------

export type CustomerKind =
  | 'upload'
  | 'proposal-section'
  | 'proposal-attachment'
  | 'proposal-export'
  | 'library-unit'
  | 'library-asset';

export interface CustomerPathInput {
  tenantSlug: string;
  kind: CustomerKind;
  proposalId?: string;
  sectionSlug?: string;
  unitId?: string;
  assetId?: string;
  name?: string;
  ext?: string;
  at?: Date;
}

export function customerPath(p: CustomerPathInput): string {
  assertTenantSlug(p.tenantSlug);
  const base = `customers/${p.tenantSlug}`;

  switch (p.kind) {
    case 'upload': {
      if (!p.name || !p.ext) {
        throw new Error('[storage/paths] customer upload requires name and ext');
      }
      assertUuid(p.name, 'upload uuid');
      assertExt(p.ext);
      const { yyyy, mm } = ymd(p.at ?? new Date());
      return `${base}/uploads/${yyyy}/${mm}/${p.name}.${p.ext.toLowerCase()}`;
    }
    case 'proposal-section': {
      if (!p.proposalId || !p.sectionSlug) {
        throw new Error('[storage/paths] proposal-section requires proposalId and sectionSlug');
      }
      assertUuid(p.proposalId, 'proposal id');
      assertSectionSlug(p.sectionSlug);
      return `${base}/proposals/${p.proposalId}/sections/${p.sectionSlug}.md`;
    }
    case 'proposal-attachment': {
      if (!p.proposalId || !p.name || !p.ext) {
        throw new Error('[storage/paths] proposal-attachment requires proposalId, name, ext');
      }
      assertUuid(p.proposalId, 'proposal id');
      assertUuid(p.name, 'attachment uuid');
      assertExt(p.ext);
      return `${base}/proposals/${p.proposalId}/attachments/${p.name}.${p.ext.toLowerCase()}`;
    }
    case 'proposal-export': {
      if (!p.proposalId || !p.name || !p.ext) {
        throw new Error('[storage/paths] proposal-export requires proposalId, name, ext');
      }
      assertUuid(p.proposalId, 'proposal id');
      assertSectionSlug(p.name);
      assertExt(p.ext);
      return `${base}/proposals/${p.proposalId}/exports/${p.name}.${p.ext.toLowerCase()}`;
    }
    case 'library-unit': {
      if (!p.unitId) throw new Error('[storage/paths] library-unit requires unitId');
      assertUuid(p.unitId, 'library unit id');
      return `${base}/library/units/${p.unitId}.md`;
    }
    case 'library-asset': {
      if (!p.assetId || !p.ext) {
        throw new Error('[storage/paths] library-asset requires assetId and ext');
      }
      assertUuid(p.assetId, 'library asset id');
      assertExt(p.ext);
      return `${base}/library/assets/${p.assetId}.${p.ext.toLowerCase()}`;
    }
  }
}

/**
 * Guard helper — throws if a key does not belong to the given tenant.
 * Use at the boundary of any operation that takes a user-supplied
 * object key and must enforce tenant isolation.
 */
export function assertKeyBelongsToTenant(key: string, tenantSlug: string): void {
  assertTenantSlug(tenantSlug);
  const prefix = `customers/${tenantSlug}/`;
  if (!key.startsWith(prefix)) {
    throw new Error(`[storage/paths] key ${JSON.stringify(key)} does not belong to tenant ${tenantSlug}`);
  }
}
