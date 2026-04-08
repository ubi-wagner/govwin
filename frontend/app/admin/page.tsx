import { redirect } from 'next/navigation';

/**
 * /admin — the admin area has no index page of its own; every
 * actual admin screen lives under a nested route. Navigating to
 * /admin directly should land on the admin dashboard, not 404.
 *
 * Access control is handled by middleware.ts via the PATH_MIN_ROLE
 * entry `{ prefix: '/admin', role: 'rfp_admin' }`, so this page is
 * only reachable by master_admin and rfp_admin users — the redirect
 * below runs after middleware has already confirmed the role.
 */
export default function AdminIndex() {
  redirect('/admin/dashboard');
}
