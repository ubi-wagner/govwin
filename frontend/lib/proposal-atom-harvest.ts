/**
 * Greenfield atom return — the closing leg of the atom loop:
 *   atomize → library → mold → draft → **back into the library**.
 *
 * When a section is accepted (locked), its finalized content returns to the
 * unified library (`library_atoms`) as a DERIVATIVE atom:
 *   - bound into the proposal's `document_cocoon` (the "document universe"),
 *   - source = 'download_derivative', creator_kind = 'ai' (drafted output),
 *   - origin_proposal_id / origin_section_id link it back to where it was built,
 *   - lineage (`derived_from`) to the source atoms it was drafted from
 *     (recorded on the section as meta.sourceAtomIds by the drafter),
 *   - tagged by vol so it's immediately findable/selectable for the NEXT mold —
 *     a child that can become a parent later (the USAF-team pattern).
 *
 * The legacy `harvestSectionToLibrary` (→ `library_units`) is a separate, older
 * path; this is the greenfield counterpart. Best-effort at the call site — a
 * harvest failure must never fail the lock.
 */
import { withTenant } from '@/lib/rls';
import { createAtom, type AtomTagInput } from '@/lib/atoms';
import { textOfNodes } from '@/lib/atom-size';
import type { CanvasNode } from '@/lib/types/canvas-document';

/** One document cocoon per proposal — created on the first section return. */
export async function getOrCreateProposalCocoon(tenantId: string, proposalId: string, name: string): Promise<string> {
  return withTenant(tenantId, async (tx) => {
    const [existing] = await tx<Array<{ id: string }>>`
      SELECT id FROM document_cocoons
      WHERE tenant_id = ${tenantId}::uuid AND origin_proposal_id = ${proposalId}::uuid AND scope = 'document'
      LIMIT 1
    `;
    if (existing) return existing.id;
    const [row] = await tx<Array<{ id: string }>>`
      INSERT INTO document_cocoons (tenant_id, name, scope, origin_proposal_id, source)
      VALUES (${tenantId}::uuid, ${name}, 'document', ${proposalId}::uuid, 'download')
      RETURNING id
    `;
    return row.id;
  });
}

interface HarvestSection {
  title: string | null;
  content: string | null;
  sectionType: string | null;
  volumeName: string | null;
  meta: Record<string, unknown> | null;
}

/**
 * Return one accepted section to the greenfield atom library. Returns the new
 * atom id, or null when there's nothing to harvest (no drafted content).
 */
export async function harvestSectionToAtomLibrary(
  tenantId: string,
  proposalId: string,
  sectionId: string,
  actorId: string,
): Promise<string | null> {
  const [section] = await withTenant<HarvestSection[]>(tenantId, async (tx) =>
    tx`
      SELECT title, content, section_type, volume_name, meta
      FROM proposal_sections
      WHERE proposal_id = ${proposalId}::uuid AND id = ${sectionId}::uuid
      LIMIT 1
    `,
  );
  if (!section) return null;

  // Content is a stored CanvasDocument JSON string; extract nodes + text.
  let nodes: CanvasNode[] = [];
  try {
    const parsed = JSON.parse(section.content ?? '{}') as { nodes?: CanvasNode[] } | CanvasNode[];
    nodes = Array.isArray(parsed) ? parsed : Array.isArray(parsed.nodes) ? parsed.nodes : [];
  } catch { /* not valid canvas JSON → treat as empty */ }
  const text = textOfNodes(nodes);
  if (!text.trim()) return null; // nothing drafted yet — don't return an empty atom

  const cocoonId = await getOrCreateProposalCocoon(tenantId, proposalId, `Proposal ${proposalId}`);

  // Lineage: the source atoms this section was drafted from (recorded by the
  // drafter as meta.sourceAtomIds). Absent → the cocoon + origin links are the binding.
  const meta = section.meta && typeof section.meta === 'object' ? section.meta : {};
  const rawParents = (meta as { sourceAtomIds?: unknown }).sourceAtomIds;
  const parentAtomIds = Array.isArray(rawParents) ? rawParents.filter((x): x is string => typeof x === 'string') : [];

  // Tag by vol (from section_type / volume) so the returned atom is findable for
  // the next mold; kind=narrative marks it as drafted prose.
  const tags: AtomTagInput[] = [{ dimension: 'kind', value: 'narrative', source: 'auto', confirmed: true }];
  if (section.sectionType) tags.push({ dimension: 'vol', value: section.sectionType, source: 'auto', confirmed: true });

  const { atomId } = await createAtom(
    tenantId,
    {
      grain: 'reference',
      title: section.title ?? 'Drafted section',
      content: text,
      canvasNodes: nodes.length ? nodes : null,
      summary: `Returned from proposal draft${section.volumeName ? ` · ${section.volumeName}` : ''}`,
      source: 'download_derivative',
      creatorKind: 'ai',
      status: 'approved',
      cocoonId,
      originProposalId: proposalId,
      originSectionId: sectionId,
      parentAtomIds,
      tags,
      // One derivative atom per section, refreshed on re-lock (not duplicated).
      idempotentBySection: true,
    },
    { id: actorId, kind: 'ai' },
  );
  return atomId;
}
