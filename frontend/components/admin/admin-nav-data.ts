// Single source of truth for the admin page list — consumed by the sidebar
// (admin layout) and by the nav-trail breadcrumb for human-readable labels.

export type AdminNavItem = { href: string; label: string };
export type AdminNavSection = { title: string; items: AdminNavItem[] };

const ADMIN_NAV: AdminNavSection[] = [
  { title: 'Overview', items: [{ href: '/admin/dashboard', label: 'Dashboard' }] },
  {
    title: 'Opportunities',
    items: [
      { href: '/admin/rfp-curation', label: 'RFP Curation' },
      { href: '/admin/sources', label: 'Sources' },
      { href: '/admin/pipeline', label: 'Pipeline Jobs' },
      { href: '/admin/templates', label: 'Templates' },
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
      { href: '/admin/system-state', label: 'System State' },
      { href: '/admin/events', label: 'Event Stream' },
      { href: '/admin/agents', label: 'Agents' },
      { href: '/admin/automation', label: 'Automation' },
      { href: '/admin/process', label: 'Process Monitor' },
      { href: '/admin/workflows', label: 'Workflows' },
      { href: '/admin/processes', label: 'Process Ledger' },
      { href: '/admin/system', label: 'System Health' },
      { href: '/admin/analytics', label: 'Analytics' },
    ],
  },
  { title: 'CRM', items: [{ href: '/admin/crm', label: 'CRM Console' }] },
];

const FLAT: AdminNavItem[] = ADMIN_NAV.flatMap((s) => s.items);

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
