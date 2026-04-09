/**
 * GET /api/admin/system
 *
 * Returns aggregated system health metrics for the /admin/system
 * page. Master-admin only — middleware gates `/api/admin/*` to
 * `rfp_admin` minimum, and this route adds a stricter `master_admin`
 * requirement via withHandler's requiredRole because system-level
 * metrics include cross-tenant data.
 *
 * See docs/API_CONVENTIONS.md for the envelope contract.
 */

import { withHandler } from '@/lib/api-helpers';
import {
  eventRates,
  queueDepth,
  recentErrors,
  recentToolStats,
  type RecentErrorRow,
  type ToolStatRow,
} from '@/lib/capacity';
import { list as listTools } from '@/lib/tools';

interface SystemSnapshot {
  capturedAt: string;
  queueDepth: number;
  eventsLastHour: number;
  errorsLastHour: number;
  toolStats24h: ToolStatRow[];
  recentErrors: RecentErrorRow[];
  registeredTools: Array<{
    name: string;
    namespace: string;
    description: string;
    tenantScoped: boolean;
    requiredRole?: string;
  }>;
}

export const dynamic = 'force-dynamic';

export const GET = withHandler({
  scope: 'api',
  inputSchema: null,
  requireAuth: true,
  requiredRole: 'master_admin',
  method: 'GET',
  async handler(_input, ctx) {
    ctx.log.info({ actor: ctx.actor?.id }, 'admin system snapshot requested');

    // Fetch everything in parallel so the response is snappy.
    const [depth, rates, toolStats, errors] = await Promise.all([
      queueDepth(),
      eventRates(),
      recentToolStats(24),
      recentErrors(20),
    ]);

    const registered = listTools().map((t) => ({
      name: t.name,
      namespace: t.namespace,
      description: t.description,
      tenantScoped: t.tenantScoped,
      requiredRole: t.requiredRole,
    }));

    const snapshot: SystemSnapshot = {
      capturedAt: new Date().toISOString(),
      queueDepth: depth,
      eventsLastHour: rates.eventsLastHour,
      errorsLastHour: rates.errorsLastHour,
      toolStats24h: toolStats,
      recentErrors: errors,
      registeredTools: registered,
    };

    return snapshot;
  },
});
