/**
 * "Eat our own cooking" — ingest the documents WE produce (ops runbooks, design
 * notes) into our own tenant library as canvas-backed atoms, via the REAL createAtom
 * write path. One primitive atom per section + a group atom for the whole document,
 * every atom carrying canvas_nodes (so it's a genuine CanvasDocument, not loose text).
 *
 * Tagged (collection=house_library, doc=<slug>) so a re-seed is idempotent
 * (clearHouseDocs removes the prior set first).
 */
import { sql } from '@/lib/db';
import { createAtom } from '@/lib/atoms';
import type { CanvasNode } from '@/lib/types/canvas-document';
import { splitMarkdownSections, type DocSection } from '@/lib/library/markdown-sections';

export { splitMarkdownSections, type DocSection };

export const HOUSE_COLLECTION = 'house_library';

const mkNode = (type: CanvasNode['type'], content: unknown): CanvasNode => ({
  id: crypto.randomUUID(),
  type,
  content: content as CanvasNode['content'],
  style: {} as CanvasNode['style'],
  provenance: { source: 'template' },
  history: [],
  library_eligible: false,
});

export interface IngestedDoc { groupId: string; sectionAtomIds: string[]; sectionCount: number; }

/** Ingest one produced markdown document into a tenant's library as canvas atoms. */
export async function ingestHouseDoc(
  tenantId: string,
  doc: { title: string; slug: string; markdown: string; kind?: string },
  actor: { id: string },
): Promise<IngestedDoc> {
  const sections = splitMarkdownSections(doc.markdown, doc.title);
  const baseTags = [
    { dimension: 'collection', value: HOUSE_COLLECTION, source: 'admin' as const, confirmed: true },
    { dimension: 'doc', value: doc.slug, source: 'admin' as const, confirmed: true },
  ];

  const sectionAtomIds: string[] = [];
  for (const s of sections) {
    const nodes: CanvasNode[] = [mkNode('heading', { level: 2, text: s.title })];
    if (s.body) nodes.push(mkNode('text_block', { text: s.body }));
    const { atomId } = await createAtom(tenantId, {
      grain: 'primitive',
      title: s.title,
      content: s.body || s.title,
      canvasNodes: nodes,
      source: 'manual',
      creatorKind: 'admin',
      visibility: 'tenant',
      status: 'approved',
      tags: [...baseTags, { dimension: 'kind', value: doc.kind ?? 'runbook', source: 'admin', confirmed: true }],
    }, { id: actor.id, kind: 'admin' });
    sectionAtomIds.push(atomId);
  }

  // The whole document as ONE canvas (all section nodes assembled), aggregating the
  // per-section atoms as its members.
  const docNodes: CanvasNode[] = [];
  for (const s of sections) {
    docNodes.push(mkNode('heading', { level: 2, text: s.title }));
    if (s.body) docNodes.push(mkNode('text_block', { text: s.body }));
  }
  const { atomId: groupId } = await createAtom(tenantId, {
    grain: 'group',
    title: doc.title,
    content: doc.markdown,
    canvasNodes: docNodes,
    summary: `House document — ${sections.length} sections`,
    source: 'manual',
    creatorKind: 'admin',
    visibility: 'tenant',
    status: 'approved',
    memberAtomIds: sectionAtomIds,
    tags: [...baseTags, { dimension: 'kind', value: 'document', source: 'admin', confirmed: true }],
  }, { id: actor.id, kind: 'admin' });

  return { groupId, sectionAtomIds, sectionCount: sections.length };
}

/** Remove a tenant's previously-seeded house-library atoms (idempotent re-seed). */
export async function clearHouseDocs(tenantId: string): Promise<number> {
  const rows = await sql<Array<{ id: string }>>`
    DELETE FROM library_atoms
    WHERE tenant_id = ${tenantId}::uuid
      AND id IN (
        SELECT atom_id FROM atom_tags
        WHERE dimension = 'collection' AND value = ${HOUSE_COLLECTION}
      )
    RETURNING id`;
  return rows.length;
}
