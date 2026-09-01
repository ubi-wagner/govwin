// THE single source of truth for the admin nav — consumed by BOTH the sidebar
// (app/admin/layout.tsx renders directly from ADMIN_NAV) AND the nav-trail
// breadcrumb (adminPageLabel). Previously the layout hardcoded its own, larger
// list and this file was a stale subset that only fed the breadcrumb — so any
// route missing here (e.g. /admin/provisioning) fell back to a title-cased slug
// ("Provisioning"). Keeping one list fixes that drift for good: every admin route
// lives here with its canonical label, and redundant surfaces are grouped as
// `children` (a primary link with indented secondaries) instead of a flat wall.

import { hasRoleAtLeast, requiredRoleForPath, type Role } from '@/lib/rbac';

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
  // ── ONE BANNER OVER THE FUNNEL ──────────────────────────────────────────────────────────────
  // Content, audience and outbound were three separate sections — 'Content' (the marketing site),
  // 'Customers' (waitlist and applications, filed beside billing), and 'CRM' (a placeholder). They
  // are not three capabilities. They are one: what attracts somebody, who arrives, how we reach
  // them, and whether any of it worked.
  //
  // Splitting them is what let the funnel stay severed in the middle — the site captures a visitor
  // session with its referrer and UTM, the application captures a contact, and nothing joins the
  // two, so "which campaign produced this customer" has never been answerable. Nobody looks for a
  // missing join between two things filed under different headings.
  //
  // Ordered as the funnel runs, not alphabetically: reach → arrive → convert → measure.
  {
    title: 'Marketing & Sales',
    items: [
      { href: '/admin/site', label: 'Site Content' },
      { href: '/admin/crm', label: 'Outbound Mail' },
      { href: '/admin/waitlist', label: 'Waitlist' },
      { href: '/admin/applications', label: 'Applications' },
      // The two halves of "did any of it work": Funnel is the join, Contacts the people it joins,
      // Analytics the raw visits underneath. Analytics sat under System until migrations 242/243
      // gave it something to join to — visitor counts are a marketing measurement, not a health
      // metric, and filing it under System is the same mistake that kept the funnel severed.
      {
        href: '/admin/funnel', label: 'Funnel',
        children: [
          { href: '/admin/contacts', label: 'Contacts' },
          { href: '/admin/analytics', label: 'Analytics' },
        ],
      },
    ],
  },
  // What happens AFTER somebody buys. The dividing line is the purchase: above it we are trying to
  // be chosen, below it we are delivering.
  {
    title: 'Customers',
    items: [
      { href: '/admin/tenants', label: 'Tenants' },
      { href: '/admin/billing', label: 'Billing' },
      { href: '/admin/purchases', label: 'Purchases' },
      { href: '/admin/proposals', label: 'Proposals' },
      // Post-award. It sits next to Proposals, because that is the shape of the customer's life: a
      // build becomes a contract becomes a project, and an admin who can see the first two and not
      // the third loses the customer exactly when the money starts.
      { href: '/admin/projects', label: 'Projects' },
      { href: '/admin/provisioning', label: 'Releases & SLA' },
      { href: '/admin/expert-time', label: 'Expert Time' },
    ],
  },
  // Internal authoring and object storage — tooling, not marketing. They were under 'Content' only
  // because the word fits both, which is the same naming collision that hid the CMS migration.
  {
    title: 'Workspace tools',
    items: [
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
      // Observe sits ABOVE the raw stream: the stream is everything that happened, this is
      // what happened in the last few minutes and what does not add up. During a live drive
      // it is the surface you keep open beside the one you are driving.
      { href: '/admin/observe', label: 'Observe',
        children: [{ href: '/admin/events', label: 'Event Stream' },
                   // The shared board sits with Observe: one says what happened, the other
                   // says what to watch for. During a drive you keep both open.
                   { href: '/admin/notes', label: 'Notes' }] },
      { href: '/admin/agents', label: 'Agents' },
      // Analytics moved to Marketing & Sales — see the note there.
      { href: '/admin/architecture', label: 'Architecture' },
    ],
  },

];

/** Every nav item, parents AND children, flattened — for label lookup + tests. */
const FLAT: AdminNavItem[] = ADMIN_NAV.flatMap((s) =>
  s.items.flatMap((i) => [i, ...(i.children ?? [])]),
);

/**
 * ADMIN_NAV filtered to what `role` may actually REACH.
 *
 * The rail used to render whole to every admin, so an `rfp_admin` was shown "System Health"
 * (`/admin/system` is master_admin-only in BOTH lib/rbac.ts and the page's own guard). Clicking it
 * hit middleware's deny → `redirect('/')` — ejected out of the admin console onto the public
 * marketing site, silently. A nav entry that throws you off the product is worse than no entry.
 *
 * The gate is DERIVED from `requiredRoleForPath`, the same table middleware enforces, so this can
 * never drift from the real answer the way a second hand-maintained `minRole` field would. Adding
 * a new master_admin-only admin route needs no change here.
 *
 * A parent whose children are all hidden still renders (it is reachable itself); a section whose
 * items are ALL hidden is dropped so no empty heading appears.
 */
export function visibleAdminNav(role: Role | null): AdminNavSection[] {
  const may = (href: string) => {
    const need = requiredRoleForPath(href);
    return need == null || (role != null && hasRoleAtLeast(role, need));
  };
  return ADMIN_NAV.map((s) => ({
    ...s,
    items: s.items
      .filter((i) => may(i.href))
      .map((i) => (i.children ? { ...i, children: i.children.filter((c) => may(c.href)) } : i)),
  })).filter((s) => s.items.length > 0);
}

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
