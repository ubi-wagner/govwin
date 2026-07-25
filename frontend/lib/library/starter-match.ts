/**
 * Mold → starter-template link (P6.1).
 *
 * A compliance-matrix required item (a "mold") is scaffolded by a starter section.
 * This resolves, for a required-item / section title (+ optional vehicle), the matching
 * starter FOUNDATION and the specific SECTION grain inside it, from the tenant's own
 * library_atoms (the copy-on-use starter set). It's the TS counterpart to the pipeline
 * section_drafter's grounding match (P6.2) — so curation can surface "this required item
 * maps to the SBIR Phase I 'Phase I Technical Objectives' starter section", and the same
 * link can seed the draft scaffold.
 */
import { sql } from '@/lib/db';

export interface StarterMatch {
  foundationId: string;
  foundationTitle: string | null;
  sectionAtomId: string;
  sectionTitle: string | null;
  vehicle: string | null;
}

/**
 * Resolve the best starter foundation+section for a section title in a tenant's library.
 * When `vehicle` is given, only a foundation carrying that vehicle tag matches (so a
 * SBIR-Phase-I item links to the SBIR-Phase-I starter, not STTR); otherwise any vehicle.
 * Returns null when nothing matches. Tenant-scoped; escapes the ILIKE pattern.
 */
export async function matchStarterFoundation(
  tenantId: string,
  opts: { title: string; vehicle?: string | null },
): Promise<StarterMatch | null> {
  const title = (opts.title ?? '').trim();
  if (!title) return null;
  const pattern = `%${title.slice(0, 120).replace(/[%_\\]/g, '\\$&')}%`;
  const vehicle = opts.vehicle?.trim() || null;

  const [row] = await sql<Array<StarterMatch>>`
    SELECT
      f.id            AS "foundationId",
      f.title         AS "foundationTitle",
      s.id            AS "sectionAtomId",
      s.title         AS "sectionTitle",
      (SELECT value FROM atom_tags WHERE atom_id = f.id AND dimension = 'vehicle' LIMIT 1) AS vehicle
    FROM library_atoms s
    JOIN atom_members fs ON fs.member_atom_id = s.id
    JOIN library_atoms f ON f.id = fs.group_atom_id AND f.grain = 'foundation' AND f.tenant_id = s.tenant_id
    WHERE s.tenant_id = ${tenantId}::uuid
      AND s.vault_id IS NULL
      AND s.grain = 'section'
      AND s.status <> 'archived'
      AND s.title ILIKE ${pattern}
      AND (
        ${vehicle}::text IS NULL
        OR EXISTS (SELECT 1 FROM atom_tags v WHERE v.atom_id = f.id AND v.dimension = 'vehicle' AND v.value = ${vehicle})
      )
    ORDER BY s.updated_at DESC
    LIMIT 1`;

  return row ?? null;
}
