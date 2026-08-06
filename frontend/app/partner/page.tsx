/**
 * /partner — the EconDev partner's owner-scoped home ("My Companies").
 * Lists ONLY the tenants this partner owns (tenants.owner_id = me) and lets them create a new
 * one (auto-provisioned, no Stripe). Middleware gates /partner at partner_admin; this page
 * re-checks canManagePartnerTenants defensively. See docs/ECONDEV_PARTNER_ADMIN.md.
 */
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { isRole, canManagePartnerTenants } from '@/lib/rbac';
import { sqlBypass as sql, enterBypass } from '@/lib/db';
import CreateCompanyForm from './create-company-form';
import PartnerGuide from './partner-guide';

export const dynamic = 'force-dynamic';

export default async function PartnerHome() {
  const session = await auth();
  const u = session?.user as { id?: string; role?: unknown; name?: string } | undefined;
  const role = isRole(u?.role) ? u!.role : null;
  if (!u?.id || !role || !canManagePartnerTenants(role)) redirect('/login');

  enterBypass();
  let tenants: { id: string; slug: string; name: string; status: string; proposalCount: number }[] = [];
  try {
    tenants = await sql<{ id: string; slug: string; name: string; status: string; proposalCount: number }[]>`
      SELECT t.id, t.slug, t.name, t.status,
             (SELECT count(*)::int FROM proposals WHERE tenant_id = t.id) AS "proposalCount"
      FROM tenants t
      WHERE t.owner_id = ${u.id}::uuid
      ORDER BY t.created_at DESC`;
  } catch {
    tenants = [];
  }

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '2rem 1.25rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>My Companies</h1>
        <span style={{ fontSize: 13, color: '#666' }}>{u.name ?? 'Partner'} · EconDev partner</span>
      </div>
      <p style={{ color: '#555', fontSize: 14, marginTop: 4 }}>
        Every company you create is yours — it lands with spotlight buckets, the live opportunity
        pipeline, and a starter library already provisioned (no checkout). Open one to staff it and
        build proposals.
      </p>

      <PartnerGuide />

      <CreateCompanyForm />

      <div style={{ marginTop: 24 }}>
        {tenants.length === 0 ? (
          <p style={{ color: '#888', fontSize: 14 }}>No companies yet — create your first above.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e5e5' }}>
                <th style={{ padding: '8px 6px' }}>Company</th>
                <th style={{ padding: '8px 6px' }}>Status</th>
                <th style={{ padding: '8px 6px' }}>Proposals</th>
                <th style={{ padding: '8px 6px' }}></th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '8px 6px', fontWeight: 600 }}>{t.name}</td>
                  <td style={{ padding: '8px 6px', color: '#555' }}>{t.status}</td>
                  <td style={{ padding: '8px 6px', color: '#555' }}>{t.proposalCount}</td>
                  <td style={{ padding: '8px 6px' }}>
                    <Link href={`/portal/${t.slug}/dashboard`} style={{ color: '#1a4a8a', fontWeight: 600 }}>Open workspace →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
