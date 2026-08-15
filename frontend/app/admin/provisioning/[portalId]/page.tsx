/**
 * Provisioning cockpit — /admin/provisioning/[portalId] (docs/PROVISIONING_WORKSPACE_DESIGN.md, PV-3).
 *
 * Where an rfp_admin lands from the `proposal_setup` ToDo when a customer PURCHASES a portal (72h SLA):
 * the orchestration surface for COMPLETING the master OPP's build-out and RELEASING it. It shows the
 * buyer + SLA countdown + the master build-out readiness bar, deep-links to the authoring workspace
 * (/admin/rfp-curation/[solId], where compliance/volumes/templates are actually edited), and hosts the
 * two-outcome "Complete & Release" (broadcast the completed master to ALL tenants + provision THIS
 * buyer's portal + kick off their workflow). Cross-tenant admin reads → sqlBypass.
 */
import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import { sqlBypass as sql } from '@/lib/db';
import { getBuildReadiness } from '@/lib/provisioning/readiness';
import { ReleasePanel, SlaCountdown } from './release-panel';

export const dynamic = 'force-dynamic';

interface Props { params: Promise<{ portalId: string }> }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProvisioningCockpitPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const role = (session.user as { role?: string }).role;
  if (role !== 'master_admin' && role !== 'rfp_admin') redirect('/admin');

  const { portalId } = await params;
  if (!UUID_RE.test(portalId)) notFound();

  interface PortalRow {
    tenantId: string; tenantName: string; tenantSlug: string;
    opportunityId: string; proposalId: string | null; label: string; status: string;
    curationDueAt: Date | null; createdAt: Date;
    oppTitle: string; agency: string | null; programType: string | null;
    topicNumber: string | null; closeDate: Date | null;
  }
  let portal: PortalRow | undefined;
  try {
    [portal] = await sql<PortalRow[]>`
      SELECT pp.tenant_id AS "tenantId", t.name AS "tenantName", t.slug AS "tenantSlug",
             pp.opportunity_id AS "opportunityId", pp.proposal_id AS "proposalId", pp.label, pp.status,
             pp.curation_due_at AS "curationDueAt", pp.created_at AS "createdAt",
             o.title AS "oppTitle", o.agency, o.program_type AS "programType",
             o.topic_number AS "topicNumber", o.close_date AS "closeDate"
      FROM proposal_portals pp
      JOIN tenants t ON t.id = pp.tenant_id
      JOIN opportunities o ON o.id = pp.opportunity_id
      WHERE pp.id = ${portalId}::uuid
      LIMIT 1`;
  } catch (e) {
    if (e && typeof e === 'object' && 'digest' in e) throw e;
    console.error('[admin/provisioning] portal load failed', e);
  }
  if (!portal) notFound();
  const p = portal;

  // Resolve the master solicitation (topic → cs via solicitation_id; umbrella → cs.opportunity_id).
  let solId: string | null = null;
  try {
    const [row] = await sql<Array<{ solId: string }>>`
      SELECT cs.id AS "solId"
      FROM curated_solicitations cs
      JOIN opportunities o ON (o.solicitation_id = cs.id OR cs.opportunity_id = o.id)
      WHERE o.id = ${p.opportunityId}::uuid
      LIMIT 1`;
    solId = row?.solId ?? null;
  } catch (e) {
    console.error('[admin/provisioning] sol resolve failed', e);
  }

  const readiness = solId ? await getBuildReadiness(solId) : null;

  // Overlay choices: global templates (tenant_id NULL) ∪ the buyer tenant's own.
  interface OverlayRow { id: string; name: string; description: string | null; isDefault: boolean; scope: string }
  let overlays: OverlayRow[] = [];
  try {
    overlays = await sql<OverlayRow[]>`
      SELECT id, name, description, is_default AS "isDefault",
             CASE WHEN tenant_id IS NULL THEN 'global' ELSE 'tenant' END AS scope
      FROM guardrail_templates
      WHERE tenant_id IS NULL OR tenant_id = ${p.tenantId}::uuid
      ORDER BY (tenant_id IS NULL) DESC, is_default DESC, name`;
  } catch (e) {
    console.error('[admin/provisioning] overlays load failed', e);
  }

  const isReleased = p.status !== 'curation_pending' && p.status !== 'guardrails_pending';
  const oppLabel = p.topicNumber ? `${p.topicNumber}: ${p.oppTitle}` : p.oppTitle;

  return (
    <div className="max-w-5xl">
      <div className="mb-2 text-sm text-gray-500">
        <a href="/admin/rfp-curation" className="hover:text-gray-700">RFP Curation</a>
        <span className="mx-2">/</span>
        <span>Provisioning</span>
      </div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold truncate">{oppLabel}</h1>
          <p className="text-sm text-gray-500 mt-1">
            Purchased by <span className="font-medium text-gray-700">{p.tenantName}</span>
            {p.label && p.label !== 'primary' ? <> &middot; portal “{p.label}”</> : null}
            {p.agency ? <> &middot; {p.agency}</> : null}
            {p.programType ? <> &middot; {p.programType}</> : null}
          </p>
        </div>
        <StatusBadge status={p.status} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Readiness + authoring */}
        <div className="lg:col-span-2 space-y-6">
          <section className="bg-white border border-gray-200 rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Master build-out readiness</h2>
              {solId ? (
                <a href={`/admin/rfp-curation/${solId}`}
                   className="text-sm px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium">
                  Author the build-out →
                </a>
              ) : null}
            </div>
            {readiness ? (
              <ReadinessBars r={readiness} />
            ) : (
              <p className="text-sm text-gray-500">
                No master solicitation is linked to this opportunity — the build will provision from a
                default volume. Nothing to broadcast to other tenants.
              </p>
            )}
          </section>

          <section className="bg-white border border-gray-200 rounded-lg p-5">
            <h2 className="font-semibold mb-1">What “Complete &amp; Release” does</h2>
            <ol className="text-sm text-gray-600 list-decimal ml-5 space-y-1 mt-2">
              <li><span className="font-medium text-gray-800">Broadcasts</span> the completed master OPP as an update to <em>every</em> tenant’s mirror card (the shared master — segregation).</li>
              <li><span className="font-medium text-gray-800">Provisions</span> {p.tenantName}’s private portal, unlocks it, and kicks off their build workflow (the private portal — continuity).</li>
            </ol>
          </section>
        </div>

        {/* SLA + action */}
        <div className="space-y-6">
          <section className="bg-white border border-gray-200 rounded-lg p-5">
            <h2 className="font-semibold mb-2 text-sm uppercase tracking-wide text-gray-500">72h SLA</h2>
            <SlaBlock dueAt={p.curationDueAt ? p.curationDueAt.toISOString() : null}
                      createdAt={p.createdAt.toISOString()} />
          </section>

          {isReleased ? (
            <section className="bg-green-50 border border-green-200 rounded-lg p-5">
              <p className="text-sm text-green-800 font-medium">This workspace has been released.</p>
              {p.proposalId ? (
                <a href={`/portal/${p.tenantSlug}/proposals/${p.proposalId}`}
                   className="inline-block mt-2 text-sm text-green-700 underline">
                  Open the provisioned build →
                </a>
              ) : null}
            </section>
          ) : (
            <ReleasePanel
              portalId={portalId}
              tenantName={p.tenantName}
              hasMaster={!!solId}
              ready={readiness?.ready ?? true}
              overlays={overlays}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    curation_pending: 'bg-amber-100 text-amber-800',
    guardrails_pending: 'bg-gray-100 text-gray-600',
    launched: 'bg-green-100 text-green-700',
    executing: 'bg-blue-100 text-blue-700',
    closeout: 'bg-indigo-100 text-indigo-700',
    archived: 'bg-gray-100 text-gray-500',
    abandoned: 'bg-red-100 text-red-600',
  };
  const label: Record<string, string> = {
    curation_pending: 'Awaiting curation',
    guardrails_pending: 'Guardrails pending',
    launched: 'Launched',
    executing: 'Executing',
    closeout: 'Close-out',
    archived: 'Archived',
    abandoned: 'Abandoned',
  };
  return (
    <span className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium ${styles[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {label[status] ?? status}
    </span>
  );
}

function ReadinessBars({ r }: { r: import('@/lib/provisioning/readiness').BuildReadiness }) {
  const Row = ({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) => (
    <li className="flex items-center gap-2 text-sm">
      <span className={ok ? 'text-green-600' : 'text-gray-400'}>{ok ? '✓' : '○'}</span>
      <span className={ok ? 'text-gray-800' : 'text-gray-500'}>{label}</span>
      {detail ? <span className="text-gray-400">— {detail}</span> : null}
    </li>
  );
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${r.ready ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'}`}>
          {r.ready ? 'Meets the bar' : 'Below the bar'}
        </span>
        {r.buildComplete ? (
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">Marked complete</span>
        ) : null}
      </div>
      <ul className="space-y-1.5">
        <Row ok={r.hasCompliance} label="Compliance authored" detail={r.hasCompliance ? undefined : 'set a submission format'} />
        <Row ok={r.volumeCount > 0} label={`${r.volumeCount} volume${r.volumeCount === 1 ? '' : 's'}`} />
        <Row ok={r.requiredItemCount > 0} label={`${r.requiredItemCount} required item${r.requiredItemCount === 1 ? '' : 's'}`} />
        <Row ok={r.itemsWithTemplate > 0}
             label={`${r.itemsWithTemplate}/${r.requiredItemCount} items have a template mold`}
             detail={r.itemsWithTemplate < r.requiredItemCount ? 'the rest fall back to the registry (advisory)' : undefined} />
      </ul>
    </div>
  );
}

function SlaBlock({ dueAt, createdAt }: { dueAt: string | null; createdAt: string }) {
  if (!dueAt) {
    return <p className="text-sm text-gray-500">No SLA deadline recorded (purchased {new Date(createdAt).toLocaleDateString()}).</p>;
  }
  // Server-rendered baseline; the client countdown refines it live.
  return <SlaCountdown dueAt={dueAt} />;
}
