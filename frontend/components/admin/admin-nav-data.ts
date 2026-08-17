// THE single source of truth for the admin nav — consumed by BOTH the sidebar
// (app/admin/layout.tsx renders directly from ADMIN_NAV) AND the nav-trail
// breadcrumb (adminPageLabel). Previously the layout hardcoded its own, larger
// list and this file was a stale subset that only fed the breadcrumb — so any
// route missing here (e.g. /admin/provisioning) fell back to a title-cased slug
// ("Provisioning"). Keeping one list fixes that drift for good: every admin route
// lives here with its canonical label, and redundant surfaces are grouped as
// `children` (a primary link with indented secondaries) instead of a flat wall.

export type AdminNavItem = {
  href: string;
  label: string;
  /** Leading glyph for the primary/overview entries. */
  icon?: string;
  /** Indented secondary links grouped under this one (rendered smaller). */
  children?: AdminNavItem[];
};
export type AdminNavSection = { title: string; items: AdminNavItem[] };

export const ADMIN_NAV: AdminNavSection[] = [
  {
    title: 'Overview',
    items: [
      {
        href: '/admin/command', label: 'Command Center', icon: '🎯',
        children: [{ href: '/admin/dashboard', label: 'Dashboard' }],
      },
      { href: '/portal/rfp-pipeline/dashboard', label: 'Our Workspace' },
    ],
  },
  {
    title: 'Opportunities',
    items: [
      { href: '/admin/intake', label: 'Intake' },
      { href: '/admin/rfp-curation', label: 'RFP Curation' },
      { href: '/admin/cards', label: 'Opportunity Cards' },
      { href: '/admin/opportunities', label: 'Opportunity Rollup' },
      { href: '/admin/sources', label: 'Sources' },
      { href: '/admin/scouts', label: 'Scout Monitor' },
      { href: '/admin/pipeline', label: 'Pipeline Monitor' },
      { href: '/admin/templates', label: 'Templates' },
      { href: '/admin/template-stable', label: 'Template Stable' },
      { href: '/admin/guardrail-defaults', label: 'Guardrail Defaults' },
    ],
  },
  {
    title: 'Customers',
    items: [
      { href: '/admin/applications', label: 'Applications' },
      { href: '/admin/tenants', label: 'Tenants' },
      { href: '/admin/billing', label: 'Billing' },
      { href: '/admin/waitlist', label: 'Waitlist' },
      { href: '/admin/purchases', label: 'Purchases' },
      { href: '/admin/proposals', label: 'Proposals' },
      { href: '/admin/provisioning', label: 'Releases & SLA' },
      { href: '/admin/expert-time', label: 'Expert Time' },
    ],
  },
  {
    title: 'Content',
    items: [
      { href: '/admin/site', label: 'Site Content' },
      { href: '/admin/documents', label: 'Document Builder' },
      { href: '/admin/storage', label: 'S3 Storage' },
    ],
  },
  {
    title: 'System',
    items: [
      // Three process/workflow lenses on process_instances → grouped under the richest one.
      {
        href: '/admin/workflows', label: 'Workflows',
        children: [
          { href: '/admin/process', label: 'Process Monitor' },
          { href: '/admin/processes', label: 'Process Ledger' },
        ],
      },
      // Tenant rules (this) vs the platform ceilings that resolve down to them (child).
      {
        href: '/admin/automation', label: 'Automation',
        children: [{ href: '/admin/automation-framework', label: 'Automation Framework' }],
      },
      // Two health rollups → grouped; the architecture explorer stays separate (it's reference, not health).
      {
        href: '/admin/system-state', label: 'System State',
        children: [{ href: '/admin/system', label: 'System Health' }],
      },
      { href: '/admin/events', label: 'Event Stream' },
      { href: '/admin/agents', label: 'Agents' },
      { href: '/admin/analytics', label: 'Analytics' },
      { href: '/admin/architecture', label: 'Architecture' },
    ],
  },
  { title: 'CRM', items: [{ href: '/admin/crm', label: 'CRM Console' }] },
];

/** Every nav item, parents AND children, flattened — for label lookup + tests. */
const FLAT: AdminNavItem[] = ADMIN_NAV.flatMap((s) =>
  s.items.flatMap((i) => [i, ...(i.children ?? [])]),
);

/** Human-readable label for an admin pathname, including detail routes. */
export function adminPageLabel(pathname: string): string {
  const exact = FLAT.find((i) => i.href === pathname);
  if (exact) return exact.label;

  // Longest matching parent (e.g. /admin/tenants/<id> → "Tenants").
  const parent = FLAT.filter((i) => pathname.startsWith(i.href + '/')).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
  if (parent) {
    const rest = pathname.slice(parent.href.length + 1).split('/')[0] ?? '';
    const short = rest.length > 12 ? `${rest.slice(0, 8)}…` : rest;
    return short ? `${parent.label} / ${short}` : parent.label;
  }

  const seg = pathname.split('/').filter(Boolean).pop() ?? 'Admin';
  return seg.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
