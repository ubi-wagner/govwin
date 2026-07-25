/**
 * Seed the STARTER_SET into a tenant's library under the shared `system_starter`
 * collection (P4.3). Idempotent: every grain of a foundation carries a `doc=slug`
 * tag, so re-seeding deletes the whole prior subtree for these slugs (scoped to
 * system_starter) and re-decomposes — a re-run leaves exactly one copy of each.
 *
 * Kept out of starter-set.ts (which is pure) so the starter definitions can be
 * unit-tested without a DB connection.
 */
import { sql } from '@/lib/db';
import { STARTER_SET } from '@/lib/library/starter-set';
import { decomposeAndIngest, SYSTEM_COLLECTION } from '@/lib/library/foundation';

export interface SeedResult { seeded: number; cleared: number; foundationIds: string[] }

export async function seedStarterSet(tenantId: string, actor: { id: string }): Promise<SeedResult> {
  const slugs = STARTER_SET.map((s) => s.slug);
  // Drop any prior system_starter grains for these slugs (foundation + its subtree).
  const cleared = await sql<Array<{ id: string }>>`
    DELETE FROM library_atoms
    WHERE tenant_id = ${tenantId}::uuid
      AND id IN (
        SELECT atom_id FROM atom_tags
        WHERE dimension = 'doc' AND value = ANY(${slugs})
          AND atom_id IN (SELECT atom_id FROM atom_tags WHERE dimension = 'collection' AND value = ${SYSTEM_COLLECTION})
      )
    RETURNING id`;

  const foundationIds: string[] = [];
  for (const s of STARTER_SET) {
    const d = await decomposeAndIngest(
      tenantId, s.build(),
      { title: s.title, slug: s.slug, form: s.form, kind: s.kind, context: s.context, vehicle: s.vehicle, collection: SYSTEM_COLLECTION },
      actor,
    );
    foundationIds.push(d.foundationId);
  }
  return { seeded: foundationIds.length, cleared: cleared.length, foundationIds };
}
