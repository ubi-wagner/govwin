/**
 * Foundation-artifact decomposition (docs/LIBRARY_AND_VAULTS_DESIGN.md §1).
 *
 * A created canvas is a FOUNDATION ARTIFACT — a container. This decomposes a
 * CanvasDocument into the real atoms, bottom-up, wiring the containment via
 * atom_members:
 *
 *     foundation ⊃ section ⊃ group ⊃ primitive
 *     ↕           ↕         ↕        ↕
 *     CanvasDocument  CanvasSection  group  CanvasNode
 *
 * Every grain carries the same taxonomy tags (collection · doc=slug · kind · form ·
 * context) so a section/atom is filterable exactly like its foundation. createAtom
 * records members for the three container grains (foundation/section/group).
 */
import { sql } from '@/lib/db';
import { createAtom, type AtomTagInput } from '@/lib/atoms';
import type { CanvasDocument, CanvasNode } from '@/lib/types/canvas-document';
import { ARTIFACT_FORMAT, flattenNodes, type ArtifactForm } from '@/lib/library/artifact-canvas';
import { HOUSE_COLLECTION } from '@/lib/library/house-docs';

// Taxonomy (docs/LIBRARY_AND_VAULTS_DESIGN.md §3): kind × form × context.
//   kind    template | document
//   form    doc | ppt | pdf | sheet   (→ format docx | pptx | pdf | xlsx)
//   context proposal | marketing | commercialization | email | …
export interface FoundationMeta {
  title: string;
  slug: string;
  form: ArtifactForm;
  kind?: 'template' | 'document';
  context?: string;
  collection?: string;
}

export interface DecomposedArtifact {
  foundationId: string;
  sectionIds: string[];
  groupIds: string[];
  atomIds: string[];
}

// Structural nodes render inside their group/section but are NOT reusable content,
// so they don't get their own primitive atom (their text is captured in titles).
// Keeps the library to MEANINGFUL atoms (text/table/figure/image), not bare headings.
const STRUCTURAL_NODES: ReadonlySet<string> = new Set(['heading', 'spacer', 'page_break', 'divider']);

function nodeLabel(n: CanvasNode): { title: string; content: string } {
  const c = (n.content ?? {}) as Record<string, unknown>;
  if (n.type === 'heading') { const t = String(c.text ?? ''); return { title: t.slice(0, 120) || 'Heading', content: t }; }
  if (n.type === 'text_block') { const t = String(c.text ?? ''); return { title: t.slice(0, 60) || 'Text', content: t }; }
  if (n.type === 'table') { const s = String(c.sheet_name ?? 'Table'); return { title: s.slice(0, 60), content: JSON.stringify(c).slice(0, 4000) }; }
  return { title: n.type, content: typeof c === 'object' ? JSON.stringify(c).slice(0, 4000) : String(c) };
}

/** Decompose a CanvasDocument into foundation/section/group/atom real atoms and
 *  persist them (bottom-up so member ids exist before their container). */
export async function decomposeAndIngest(
  tenantId: string,
  doc: CanvasDocument,
  meta: FoundationMeta,
  actor: { id: string },
): Promise<DecomposedArtifact> {
  const format = ARTIFACT_FORMAT[meta.form];
  const tags = (): AtomTagInput[] => [
    { dimension: 'collection', value: meta.collection ?? HOUSE_COLLECTION, source: 'admin', confirmed: true },
    { dimension: 'doc', value: meta.slug, source: 'admin', confirmed: true },
    { dimension: 'kind', value: meta.kind ?? 'document', source: 'admin', confirmed: true },
    { dimension: 'form', value: meta.form, source: 'admin', confirmed: true },
    { dimension: 'format', value: format, source: 'admin', confirmed: true },
    { dimension: 'context', value: meta.context ?? 'general', source: 'admin', confirmed: true },
  ];
  const common = { source: 'manual' as const, creatorKind: 'admin' as const, visibility: 'tenant' as const, status: 'approved' as const };
  const A = { id: actor.id, kind: 'admin' as const };

  const atomIds: string[] = [];
  const groupIds: string[] = [];
  const sectionIds: string[] = [];

  for (const section of doc.sections ?? []) {
    const sectionGroupIds: string[] = [];
    for (const group of section.groups ?? []) {
      const groupAtomIds: string[] = [];
      for (const n of group.nodes ?? []) {
        if (STRUCTURAL_NODES.has(n.type)) continue;   // renders in the group, but not its own atom
        const { title, content } = nodeLabel(n);
        const { atomId } = await createAtom(tenantId, {
          grain: 'primitive', title, content, canvasNodes: [n], tags: tags(), ...common,
        }, A);
        groupAtomIds.push(atomId);
      }
      atomIds.push(...groupAtomIds);
      const { atomId: gid } = await createAtom(tenantId, {
        grain: 'group', title: section.title || 'Group', canvasNodes: group.nodes ?? [],
        memberAtomIds: groupAtomIds, tags: tags(), ...common,
      }, A);
      sectionGroupIds.push(gid);
    }
    groupIds.push(...sectionGroupIds);
    const sectionNodes: CanvasNode[] = (section.groups ?? []).flatMap((g) => g.nodes ?? []);
    const { atomId: sid } = await createAtom(tenantId, {
      grain: 'section', title: section.title || 'Section', canvasNodes: sectionNodes,
      memberAtomIds: sectionGroupIds, tags: tags(), ...common,
    }, A);
    sectionIds.push(sid);
  }

  const { atomId: foundationId } = await createAtom(tenantId, {
    grain: 'foundation', title: meta.title, canvasNodes: flattenNodes(doc), memberAtomIds: sectionIds,
    summary: `Foundation ${meta.form} → ${format} · ${sectionIds.length} sections`, tags: tags(), ...common,
  }, A);

  return { foundationId, sectionIds, groupIds, atomIds };
}

// ── copy-on-use: materialize a per-tenant copy of a (shared/system) foundation ──

interface SrcAtom { grain: string; title: string | null; content: string | null; canvasNodes: CanvasNode[] | null; tags: AtomTagInput[] }

async function readAtom(id: string): Promise<SrcAtom> {
  const [a] = await sql<Array<{ grain: string; title: string | null; content: string | null; canvasNodes: CanvasNode[] | null }>>`
    SELECT grain, title, content, canvas_nodes AS "canvasNodes" FROM library_atoms WHERE id = ${id}::uuid`;
  const rawTags = await sql<Array<{ dimension: string; value: string }>>`
    SELECT dimension, value FROM atom_tags WHERE atom_id = ${id}::uuid`;
  const tags: AtomTagInput[] = rawTags.map((t) => ({ dimension: t.dimension, value: t.value, source: 'admin', confirmed: true }));
  return { grain: a.grain, title: a.title, content: a.content, canvasNodes: a.canvasNodes, tags };
}
async function orderedMembers(containerId: string): Promise<string[]> {
  const rows = await sql<Array<{ id: string }>>`
    SELECT member_atom_id AS id FROM atom_members WHERE group_atom_id = ${containerId}::uuid ORDER BY ordinal`;
  return rows.map((r) => r.id);
}

/**
 * Copy a foundation's whole grain tree into targetTenant as the tenant's OWN atoms,
 * each linked back to its source via derived_from lineage (createAtom parentAtomIds).
 * This is the "copy-on-use" that materializes a per-tenant copy from the shared/system
 * scaffold — so onboarding doesn't deep-copy every template into every tenant.
 */
export async function copyFoundationToTenant(
  sourceFoundationId: string,
  targetTenantId: string,
  actor: { id: string },
  opts?: { collection?: string; visibility?: 'tenant' | 'owner_only' },
): Promise<DecomposedArtifact> {
  const common = { source: 'download_derivative' as const, creatorKind: 'admin' as const, visibility: opts?.visibility ?? 'tenant' as const, status: 'approved' as const };
  const A = { id: actor.id, kind: 'admin' as const };
  const retag = (src: AtomTagInput[]): AtomTagInput[] =>
    src.map((t) => (t.dimension === 'collection' && opts?.collection ? { ...t, value: opts.collection } : t));

  const copyAtom = async (srcId: string, memberNewIds: string[]): Promise<string> => {
    const s = await readAtom(srcId);
    const { atomId } = await createAtom(targetTenantId, {
      grain: s.grain as 'foundation' | 'section' | 'group' | 'primitive',
      title: s.title, content: s.content, canvasNodes: s.canvasNodes,
      memberAtomIds: memberNewIds, parentAtomIds: [srcId], tags: retag(s.tags), ...common,
    }, A);
    return atomId;
  };

  const sectionIds: string[] = [], groupIds: string[] = [], atomIds: string[] = [];
  const newSectionIds: string[] = [];
  for (const secSrc of await orderedMembers(sourceFoundationId)) {
    const newGroupIds: string[] = [];
    for (const grpSrc of await orderedMembers(secSrc)) {
      const newPrimIds: string[] = [];
      for (const primSrc of await orderedMembers(grpSrc)) newPrimIds.push(await copyAtom(primSrc, []));
      atomIds.push(...newPrimIds);
      newGroupIds.push(await copyAtom(grpSrc, newPrimIds));
    }
    groupIds.push(...newGroupIds);
    newSectionIds.push(await copyAtom(secSrc, newGroupIds));
  }
  sectionIds.push(...newSectionIds);
  const foundationId = await copyAtom(sourceFoundationId, newSectionIds);
  return { foundationId, sectionIds, groupIds, atomIds };
}
