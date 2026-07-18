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
import { docNodes, type CanvasNode, type CanvasDocument } from '@/lib/types/canvas-document';

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

  // Content is a stored CanvasDocument JSON string; extract nodes + text. A v2
  // section-layer doc keeps content under `sections`, so flatten via docNodes.
  let nodes: CanvasNode[] = [];
  try {
    const parsed = JSON.parse(section.content ?? '{}') as CanvasDocument | CanvasNode[];
    nodes = Array.isArray(parsed)
      ? parsed
      : (Array.isArray(parsed.sections) && parsed.sections.length) || Array.isArray(parsed.nodes)
        ? docNodes(parsed as CanvasDocument)
        : [];
  } catch { /* not valid canvas JSON → treat as empty */ }
  const text = textOfNodes(nodes);
  if (!text.trim()) return null; // nothing drafted yet — don't return an empty atom

  const cocoonId = await getOrCreateProposalCocoon(tenantId, proposalId, `Proposal ${proposalId}`);

  // Lineage: the source atoms this section was drafted from (recorded by the
  // drafter as meta.sourceAtomIds). Absent → the cocoon + origin links are the binding.
  const meta = section.meta && typeof section.meta === 'object' ? section.meta : {};
  const rawParents = (meta as { sourceAtomIds?: unknown }).sourceAtomIds;
  const parentAtomIds = Array.isArray(rawParents) ? rawParents.filter((x): x is string => typeof x === 'string') : [];

  // Content-class tags: kind=narrative marks drafted prose; vol from section_type
  // makes the atom findable for the next mold of the same section family.
  const tags: AtomTagInput[] = [{ dimension: 'kind', value: 'narrative', source: 'auto', confirmed: true }];
  if (section.sectionType) tags.push({ dimension: 'vol', value: section.sectionType, source: 'auto', confirmed: true });

  // Source-document CONTEXT tags — the "FROM" pedigree (agency/program/phase/sol/
  // topic) pulled from the proposal's opportunity, so the atom pivots on context
  // (the AFWERX→Navy reuse loop), not just content class. Off-vocabulary values
  // (agency/sol/topic) are flagged isOther; program/phase map to the seeded vocab.
  const [opp] = await withTenant<Array<{ agency: string | null; programType: string | null; solicitationNumber: string | null; topicNumber: string | null }>>(
    tenantId,
    async (tx) => tx`
      SELECT o.agency, o.program_type AS "programType",
             o.solicitation_number AS "solicitationNumber", o.topic_number AS "topicNumber"
      FROM proposals p JOIN opportunities o ON o.id = p.opportunity_id
      WHERE p.id = ${proposalId}::uuid LIMIT 1`,
  );
  if (opp) {
    const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (opp.agency) tags.push({ dimension: 'agency', value: slug(opp.agency), source: 'auto', confirmed: true, isOther: true });
    const pt = (opp.programType ?? '').toLowerCase();
    const prog = pt.match(/sbir|sttr|baa|ota|cso|rif/)?.[0];
    if (prog) tags.push({ dimension: 'program', value: prog, source: 'auto', confirmed: true });
    const phase = pt.match(/phase[_ -]?([123])/)?.[1];
    if (phase) tags.push({ dimension: 'phase', value: `phase_${phase}`, source: 'auto', confirmed: true });
    if (opp.solicitationNumber) tags.push({ dimension: 'sol', value: slug(opp.solicitationNumber), source: 'auto', confirmed: true, isOther: true });
    if (opp.topicNumber) tags.push({ dimension: 'topic', value: slug(opp.topicNumber), source: 'auto', confirmed: true, isOther: true });
  }

  const { atomId } = await createAtom(
    tenantId,
    {
      // A section returns as a selectable PRIMITIVE seminal atom; the whole locked
      // document universe is the cocoon (the foundational "reference"). Previously
      // 'reference', which excluded harvested atoms from selectForSection —
      // contradicting the reuse intent above and this file's own header.
      grain: 'primitive',
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
