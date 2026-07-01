/**
 * Atom meta-tag taxonomy — several DISCRETE, namespaced tags (not one long blob),
 * each independently displayable and audience-gated.
 *
 * An atom accumulates many tags across its journey (upload → library → proposal).
 * We keep them as separate `namespace:value` entries so the UI can show exactly the
 * ones it wants for a given viewer. Some namespaces (access, owner, role) are
 * ACCESS-CONTROL metadata and must be admin-only in the customer portal — a
 * tenant_user or partner_user should never see who owns an atom or its visibility
 * scope. Admins (tenant_admin and up) see everything.
 *
 * Shared by the library dashboard, the atomization rail, and the detail modal so the
 * gating is defined once and can't drift between surfaces.
 */

import type { Role } from '@/lib/rbac';

export interface TagNamespaceMeta {
  /** Human label shown as the chip's category. */
  label: string;
  /** Hidden from non-admin portal viewers (access-control metadata). */
  adminOnly: boolean;
  /** Tailwind chip classes. */
  tone: string;
}

/**
 * The known namespaces. Anything not listed is treated as a freeform tag (public).
 * The prefixes mirror what proposal-harvest writes (`agency:`, `org:`, `program:`,
 * `sol:`, `type:`) plus the access-control namespaces surfaced from columns/meta.
 */
export const TAG_NAMESPACES: Record<string, TagNamespaceMeta> = {
  agency: { label: 'Department', adminOnly: false, tone: 'bg-sky-50 text-sky-700 border-sky-200' },
  org: { label: 'Component', adminOnly: false, tone: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  program: { label: 'Program', adminOnly: false, tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  sol: { label: 'Solicitation', adminOnly: false, tone: 'bg-teal-50 text-teal-700 border-teal-200' },
  type: { label: 'Section', adminOnly: false, tone: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  author: { label: 'Author', adminOnly: false, tone: 'bg-violet-50 text-violet-700 border-violet-200' },
  // ── Access-control metadata — admin-only in the portal ──
  access: { label: 'Access', adminOnly: true, tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  owner: { label: 'Owner', adminOnly: true, tone: 'bg-orange-50 text-orange-700 border-orange-200' },
  role: { label: 'Role', adminOnly: true, tone: 'bg-rose-50 text-rose-700 border-rose-200' },
};

const FREEFORM: TagNamespaceMeta = { label: 'Tag', adminOnly: false, tone: 'bg-blue-50 text-blue-600 border-blue-100' };

/** System/plumbing tags that carry no display value (provenance markers). */
const HIDDEN_TAGS = new Set(['harvested', 'refined', 'proposal_final', 'section_accepted']);

export interface DisplayTag {
  /** Namespace key (e.g. 'agency'), or 'freeform'. */
  ns: string;
  /** Category label for the chip. */
  nsLabel: string;
  /** The value part (after the colon), or the whole tag for freeform. */
  value: string;
  /** The raw tag string (for keys / filter round-trips). */
  raw: string;
  adminOnly: boolean;
  tone: string;
}

/** Split a `namespace:value` tag; returns ns=null for freeform tags. */
export function parseTag(tag: string): { ns: string | null; value: string } {
  const idx = tag.indexOf(':');
  if (idx <= 0) return { ns: null, value: tag };
  return { ns: tag.slice(0, idx), value: tag.slice(idx + 1) };
}

/** Turn a raw tag into a DisplayTag (namespace metadata resolved). */
export function toDisplayTag(tag: string): DisplayTag {
  const { ns, value } = parseTag(tag);
  const meta = (ns && TAG_NAMESPACES[ns]) || FREEFORM;
  return {
    ns: ns && TAG_NAMESPACES[ns] ? ns : 'freeform',
    nsLabel: meta.label,
    value: value.replace(/_/g, ' '),
    raw: tag,
    adminOnly: meta.adminOnly,
    tone: meta.tone,
  };
}

/** Is this portal viewer allowed to see admin-only (access-control) tags? */
export function canSeeAdminTags(role: Role | null | undefined): boolean {
  return role === 'tenant_admin' || role === 'rfp_admin' || role === 'master_admin';
}

export interface AtomTagSource {
  tags?: string[] | null;
  visibility?: string | null;
  ownerName?: string | null;
}

/**
 * Build the full set of display chips for an atom — the stored tags PLUS
 * access-control chips derived from the visibility column + owner (so access/role
 * metadata is carried as its own discrete, admin-only chips rather than buried).
 * Pass the viewer's role to drop admin-only chips for non-admin portal users.
 */
export function buildDisplayTags(
  source: AtomTagSource,
  viewerRole: Role | null | undefined,
): DisplayTag[] {
  const isAdmin = canSeeAdminTags(viewerRole);
  const out: DisplayTag[] = [];

  // Access-control chips derived from structured columns (single source of truth).
  if (source.visibility && source.visibility !== 'tenant') {
    out.push(toDisplayTag(`access:${source.visibility}`));
  }
  if (source.ownerName) {
    out.push(toDisplayTag(`owner:${source.ownerName}`));
  }

  // Stored tags (skip plumbing markers).
  for (const raw of source.tags ?? []) {
    if (HIDDEN_TAGS.has(raw)) continue;
    out.push(toDisplayTag(raw));
  }

  return isAdmin ? out : out.filter((t) => !t.adminOnly);
}
