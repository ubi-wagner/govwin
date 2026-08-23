/**
 * Starter spotlight buckets — a FIXTURE catalog, no longer a production path (#104, then #189).
 *
 * ⚠️ `seedDefaultBuckets` is NOT called on tenant creation any more. It was, from all four
 * creation paths, and that is what entangled the bucket cap with the number seeded: mig 181 set
 * the cap to exactly the six that were seeded, so a brand-new tenant opened at 100% of cap and
 * was refused 409 BUCKET_LIMIT before authoring anything (B62). Mig 203 papered over it with
 * headroom; #189 removed the seeding instead, which is the root.
 *
 * A spotlight bucket is the CUSTOMER's own ranking lens — a 1:n they open empty and fill. The
 * product imposes none. Until a tenant authors one, /cards falls back to `is_pinned` then
 * `updated_at DESC`: recency-ordered, not blank.
 *
 * What this module is FOR now:
 *   · test fixtures — a realistic multi-bucket tenant without hand-writing criteria
 *   · the sandbox/demo seed — so the demo box and the guide screenshots show a RANKED pipeline
 * Both are deliberate callers that want buckets. Production tenant creation is not one of them.
 * If you are adding a third caller, check you are not re-introducing the entanglement above.
 *
 * Criteria match `scoreCard` (lib/bucket-ranking.ts): keyword hits over the card's
 * title + spotlight summary + description + office, exact program-type match, and
 * the always-on close-date timeline signal.
 */
import { withTenant } from '@/lib/rls';

export interface DefaultBucket { name: string; description: string; criteria: Record<string, unknown> }

/** Broad DoD-SBIR/STTR starter buckets — keyword themes + a Phase I program bucket. */
export const DEFAULT_BUCKETS: DefaultBucket[] = [
  {
    name: 'AI, Autonomy & ML',
    description: 'Artificial intelligence, machine learning, and autonomous systems.',
    criteria: { keywords: ['artificial intelligence', 'machine learning', 'ai/ml', 'autonomy', 'autonomous', 'neural', 'llm', 'ai', 'ml'] },
  },
  {
    name: 'Counter-UAS & Air Defense',
    description: 'Counter-unmanned systems, drone defense, and air-domain awareness.',
    criteria: { keywords: ['counter-uas', 'c-uas', 'counter-uxs', 'counter-drone', 'anti-drone', 'drone', 'uas', 'air defense', 'swarm'] },
  },
  {
    name: 'Sensing, RF & Microelectronics',
    description: 'Sensors, RF, radar, photonics, quantum sensing, and microelectronics.',
    criteria: { keywords: ['sensor', 'sensing', 'rf', 'radar', 'signature', 'detection', 'photonic', 'quantum', 'microelectronic', 'memory'] },
  },
  {
    name: 'Power, Energy & Propulsion',
    description: 'Power, energy storage, batteries, thermal, and propulsion.',
    criteria: { keywords: ['power', 'energy', 'battery', 'batteries', 'propulsion', 'thermal', 'air-independent'] },
  },
  {
    name: 'Human Performance & Biotech',
    description: 'Human performance, medical, biotechnology, and biosurveillance.',
    criteria: { keywords: ['human performance', 'cognitive', 'sleep', 'medical', 'biotech', 'biological', 'pathogen', 'biomanufactur', 'health'] },
  },
  {
    name: 'SBIR/STTR Phase I',
    description: 'Any SBIR or STTR Phase I opportunity (broad accessibility bucket).',
    criteria: { programTypes: ['sbir_phase_1', 'sttr_phase_1'] },
  },
];

/**
 * Seed the default buckets for a tenant. Idempotent — a no-op if the tenant
 * already has any bucket. Runs inside `withTenant` so the RLS-protected
 * `tenant_spotlight_buckets` insert is allowed. Returns the number created.
 */
export async function seedDefaultBuckets(tenantId: string, createdBy: string | null = null): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const [{ n }] = await tx<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM tenant_spotlight_buckets WHERE tenant_id = ${tenantId}::uuid`;
    if (n > 0) return 0;
    let created = 0;
    for (const b of DEFAULT_BUCKETS) {
      await tx`
        INSERT INTO tenant_spotlight_buckets (tenant_id, name, description, criteria, created_by)
        VALUES (${tenantId}::uuid, ${b.name}, ${b.description}, ${tx.json(b.criteria)}, ${createdBy})`;
      created++;
    }
    return created;
  });
}
