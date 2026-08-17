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
import { sql, sqlBypass } from '@/lib/db';
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
  /** DoD/DoW solicitation vehicle (SBIR/STTR/CSO/DP2) — a filterable taxonomy dimension. */
  vehicle?: string;
}

export interface DecomposedArtifact {
  foundationId: string;
  sectionIds: string[];
  groupIds: string[];
  atomIds: string[];
}

// Structural nodes render inside their group/section but are NOT reusable content,
// so they don't get their own primitive atom (their text is captured in titles).
// Primitives are the substantive leaf content: text_block, bulleted_list,
// numbered_list, image, table, url, caption, footnote. The structural set matches
// the canvas's own library_eligible exclusions (page_break/spacer/toc), plus heading
// (a bare heading is a label, not a standalone reusable atom).
const STRUCTURAL_NODES: ReadonlySet<string> = new Set(['heading', 'toc', 'page_break', 'spacer', 'divider']);

function nodeLabel(n: CanvasNode): { title: string; content: string } {
  const c = (n.content ?? {}) as Record<string, unknown>;
  if (n.type === 'heading') { const t = String(c.text ?? ''); return { title: t.slice(0, 120) || 'Heading', content: t }; }
  if (n.type === 'text_block') { const t = String(c.text ?? ''); return { title: t.slice(0, 60) || 'Text', content: t }; }
  if (n.type === 'table') { const s = String(c.sheet_name ?? 'Table'); return { title: s.slice(0, 60), content: JSON.stringify(c).slice(0, 4000) }; }
  return { title: n.type, content: typeof c === 'object' ? JSON.stringify(c).slice(0, 4000) : String(c) };
}

/** The taxonomy tag set for a foundation + all its grains (collection · doc=slug · kind · form · format · context). */
function foundationTags(meta: FoundationMeta): AtomTagInput[] {
  return [
    { dimension: 'collection', value: meta.collection ?? HOUSE_COLLECTION, source: 'admin', confirmed: true },
    { dimension: 'doc', value: meta.slug, source: 'admin', confirmed: true },
    { dimension: 'kind', value: meta.kind ?? 'document', source: 'admin', confirmed: true },
    { dimension: 'form', value: meta.form, source: 'admin', confirmed: true },
    { dimension: 'format', value: ARTIFACT_FORMAT[meta.form], source: 'admin', confirmed: true },
    { dimension: 'context', value: meta.context ?? 'general', source: 'admin', confirmed: true },
    ...(meta.vehicle ? [{ dimension: 'vehicle', value: meta.vehicle, source: 'admin' as const, confirmed: true }] : []),
  ];
}

const DECOMPOSE_COMMON = { source: 'manual' as const, creatorKind: 'admin' as const, visibility: 'tenant' as const, status: 'approved' as const };

/** Build the section/group/primitive child grains (bottom-up) from a doc's sections,
 *  tagging every grain with the same taxonomy. Shared by create + re-decompose. */
async function buildChildGrains(
  tenantId: string,
  doc: CanvasDocument,
  tags: () => AtomTagInput[],
  actor: { id: string; kind: 'admin' },
  common: { source: 'manual'; creatorKind: 'admin'; status: 'approved'; visibility: 'tenant' | 'vault'; vaultId?: string } = DECOMPOSE_COMMON,
): Promise<{ sectionIds: string[]; groupIds: string[]; atomIds: string[] }> {
  const atomIds: string[] = [];
  const groupIds: string[] = [];
  const sectionIds: string[] = [];
  for (const section of doc.sections ?? []) {
    const sectionGroupIds: string[] = [];
    for (const group of section.groups ?? []) {
      const groupAtomIds: string[] = [];
      for (const n of group.nodes ?? []) {
        // Skip structural nodes and anything the canvas itself marks non-eligible.
        if (STRUCTURAL_NODES.has(n.type) || n.library_eligible === false) continue;
        const { title, content } = nodeLabel(n);
        const { atomId } = await createAtom(tenantId, { grain: 'primitive', title, content, canvasNodes: [n], tags: tags(), ...common }, actor);
        groupAtomIds.push(atomId);
      }
      atomIds.push(...groupAtomIds);
      const { atomId: gid } = await createAtom(tenantId, {
        grain: 'group', title: section.title || 'Group', canvasNodes: group.nodes ?? [],
        memberAtomIds: groupAtomIds, tags: tags(), ...common,
      }, actor);
      sectionGroupIds.push(gid);
    }
    groupIds.push(...sectionGroupIds);
    const sectionNodes: CanvasNode[] = (section.groups ?? []).flatMap((g) => g.nodes ?? []);
    const { atomId: sid } = await createAtom(tenantId, {
      grain: 'section', title: section.title || 'Section', canvasNodes: sectionNodes,
      memberAtomIds: sectionGroupIds, tags: tags(), ...common,
    }, actor);
    sectionIds.push(sid);
  }
  return { sectionIds, groupIds, atomIds };
}

/** Decompose a CanvasDocument into foundation/section/group/atom real atoms and
 *  persist them (bottom-up so member ids exist before their container). */
export async function decomposeAndIngest(
  tenantId: string,
  doc: CanvasDocument,
  meta: FoundationMeta,
  actor: { id: string },
  opts?: { vaultId?: string },
): Promise<DecomposedArtifact> {
  const tags = () => foundationTags(meta);
  const A = { id: actor.id, kind: 'admin' as const };
  // When minting into a vault, every grain is born vault-scoped (visibility='vault' +
  // vault_id) so partner content is never briefly visible in the main library and a
  // mid-decompose failure can't strand it there — atomic by construction.
  const common = opts?.vaultId ? { ...DECOMPOSE_COMMON, visibility: 'vault' as const, vaultId: opts.vaultId } : DECOMPOSE_COMMON;
  const { sectionIds, groupIds, atomIds } = await buildChildGrains(tenantId, doc, tags, A, common);
  const { atomId: foundationId } = await createAtom(tenantId, {
    grain: 'foundation', title: meta.title, canvasNodes: flattenNodes(doc), memberAtomIds: sectionIds,
    summary: `Foundation ${meta.form} → ${ARTIFACT_FORMAT[meta.form]} · ${sectionIds.length} sections`, tags: tags(), ...common,
  }, A);
  return { foundationId, sectionIds, groupIds, atomIds };
}

/**
 * Decompose-on-save (design §2): refresh a foundation's grains to match its edited
 * canvas. Keeps the foundation id stable (external refs survive) but replaces its
 * child subtree — delete the old sections/groups/primitives (atom_members / _tags /
 * _lineage cascade), rebuild from `doc`, and re-wire the foundation's members. The
 * taxonomy is preserved (read back from the foundation's own tags). Non-transactional
 * across grains, matching decomposeAndIngest.
 */
export async function redecomposeFoundation(
  tenantId: string,
  foundationId: string,
  doc: CanvasDocument,
  actor: { id: string },
): Promise<DecomposedArtifact> {
  const [f] = await sql<Array<{ title: string | null }>>`
    SELECT title FROM library_atoms
    WHERE id = ${foundationId}::uuid AND tenant_id = ${tenantId}::uuid AND grain = 'foundation'
      AND vault_id IS NULL LIMIT 1`;
  if (!f) throw new Error('foundation not found');

  // Reconstruct the taxonomy meta from the foundation's own tags (fixed at creation).
  const tagRows = await sql<Array<{ dimension: string; value: string }>>`
    SELECT dimension, value FROM atom_tags WHERE atom_id = ${foundationId}::uuid`;
  const dim = (d: string) => tagRows.find((t) => t.dimension === d)?.value;
  const form = (dim('form') ?? 'doc') as ArtifactForm;
  const meta: FoundationMeta = {
    title: doc.metadata?.title || f.title || 'Canvas',
    slug: dim('doc') ?? 'canvas', form,
    kind: (dim('kind') as 'template' | 'document') ?? 'document',
    context: dim('context') ?? 'general',
    collection: dim('collection') ?? HOUSE_COLLECTION,
    vehicle: dim('vehicle'),
  };
  const tags = () => foundationTags(meta);
  const A = { id: actor.id, kind: 'admin' as const };

  // Gather + delete the old child subtree (sections → groups → primitives).
  const memberIds = async (parents: string[]): Promise<string[]> =>
    parents.length
      ? (await sql<Array<{ id: string }>>`SELECT member_atom_id AS id FROM atom_members WHERE group_atom_id = ANY(${parents}::uuid[])`).map((r) => r.id)
      : [];
  const secIds = await memberIds([foundationId]);
  const grpIds = await memberIds(secIds);
  const primIds = await memberIds(grpIds);
  const subtree = [...secIds, ...grpIds, ...primIds];
  if (subtree.length) await sql`DELETE FROM library_atoms WHERE id = ANY(${subtree}::uuid[]) AND tenant_id = ${tenantId}::uuid`;

  // Rebuild the children + refresh the foundation (canvas_nodes/title/summary) + re-wire members.
  const { sectionIds, groupIds, atomIds } = await buildChildGrains(tenantId, doc, tags, A);
  await sql`
    UPDATE library_atoms SET
      title = ${meta.title},
      canvas_nodes = ${sql.json(flattenNodes(doc) as unknown as Parameters<typeof sql.json>[0])},
      summary = ${`Foundation ${meta.form} → ${ARTIFACT_FORMAT[meta.form]} · ${sectionIds.length} sections`}
    WHERE id = ${foundationId}::uuid AND tenant_id = ${tenantId}::uuid`;
  await sql`DELETE FROM atom_members WHERE group_atom_id = ${foundationId}::uuid`;
  for (let i = 0; i < sectionIds.length; i++) {
    await sql`INSERT INTO atom_members (group_atom_id, member_atom_id, ordinal)
      VALUES (${foundationId}::uuid, ${sectionIds[i]}::uuid, ${i}) ON CONFLICT (group_atom_id, member_atom_id) DO NOTHING`;
  }
  return { foundationId, sectionIds, groupIds, atomIds };
}

// ── shared system scaffold: the starter foundations every tenant can see + copy ──

/** Collection tag marking a foundation as part of the shared system starter set. */
export const SYSTEM_COLLECTION = 'system_starter';

export interface SystemFoundation { id: string; title: string | null; form: string | null; format: string | null; context: string | null }

/** List the shared system-scaffold foundations (readable by any tenant — the "add to
 *  my library" catalog). Cross-tenant read of the house scaffold, so no tenant filter. */
export async function listSystemFoundations(): Promise<SystemFoundation[]> {
  // sqlBypass: the shared system-starter scaffold lives under a HOST tenant. Under prod RLS
  // (govtech_app) a context-scoped `sql` read returns 0 rows — this cross-tenant read of the
  // house catalog is legitimately a bypass read. (Writes still go through the tenant-scoped path.)
  return sqlBypass<SystemFoundation[]>`
    SELECT la.id, la.title,
      (SELECT value FROM atom_tags WHERE atom_id = la.id AND dimension = 'form')    AS form,
      (SELECT value FROM atom_tags WHERE atom_id = la.id AND dimension = 'format')  AS format,
      (SELECT value FROM atom_tags WHERE atom_id = la.id AND dimension = 'context') AS context
    FROM library_atoms la
    WHERE la.grain = 'foundation'
      AND la.id IN (SELECT atom_id FROM atom_tags WHERE dimension = 'collection' AND value = ${SYSTEM_COLLECTION})
    ORDER BY la.title`;
}

/** True iff the foundation is part of the shared system scaffold (guards copy-to-library). */
export async function isSystemFoundation(foundationId: string): Promise<boolean> {
  const [row] = await sqlBypass<Array<{ one: number }>>`
    SELECT 1 AS one FROM library_atoms la
    WHERE la.id = ${foundationId}::uuid AND la.grain = 'foundation'
      AND la.id IN (SELECT atom_id FROM atom_tags WHERE dimension = 'collection' AND value = ${SYSTEM_COLLECTION})
    LIMIT 1`;
  return !!row;
}

// ── copy-on-use: materialize a per-tenant copy of a (shared/system) foundation ──

interface SrcAtom { grain: string; title: string | null; content: string | null; canvasNodes: CanvasNode[] | null; tags: AtomTagInput[] }

async function readAtom(id: string): Promise<SrcAtom> {
  // sqlBypass: reading the shared house scaffold cross-tenant (see listSystemFoundations).
  const [a] = await sqlBypass<Array<{ grain: string; title: string | null; content: string | null; canvasNodes: CanvasNode[] | null }>>`
    SELECT grain, title, content, canvas_nodes AS "canvasNodes" FROM library_atoms WHERE id = ${id}::uuid`;
  if (!a) throw new Error(`readAtom: source atom ${id} not found (or not readable)`);
  const rawTags = await sqlBypass<Array<{ dimension: string; value: string }>>`
    SELECT dimension, value FROM atom_tags WHERE atom_id = ${id}::uuid`;
  const tags: AtomTagInput[] = rawTags.map((t) => ({ dimension: t.dimension, value: t.value, source: 'admin', confirmed: true }));
  return { grain: a.grain, title: a.title, content: a.content, canvasNodes: a.canvasNodes, tags };
}
async function orderedMembers(containerId: string): Promise<string[]> {
  const rows = await sqlBypass<Array<{ id: string }>>`
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

export interface StarterSetResult { added: number; skipped: number; foundationIds: string[] }

/**
 * Bulk copy-on-use (P5.2): materialize the WHOLE system-starter catalog into a
 * tenant's library — each foundation copied with `derived_from` lineage and retagged
 * `collection=my_library`. This is the one-click "add the starter set" behind the
 * empty-library offer (P5.1) and the onboarding hook (P5.3).
 *
 * Idempotent: skips any starter whose `doc` slug already has a foundation in the
 * tenant, so re-running (or a double-click) never duplicates. Returns added/skipped.
 */
export async function copyStarterSetToTenant(
  targetTenantId: string,
  actor: { id: string },
  opts?: { collection?: string },
): Promise<StarterSetResult> {
  const collection = opts?.collection ?? 'my_library';
  // sqlBypass: the catalog is the shared house scaffold (cross-tenant); the dedup read carries an
  // explicit `la.tenant_id = targetTenantId` filter (a legitimate specific-tenant bypass read). The
  // WRITES below go through copyFoundationToTenant → createAtom → withTenant(target), so isolation holds.
  const catalog = await sqlBypass<Array<{ id: string; slug: string | null }>>`
    SELECT la.id, (SELECT value FROM atom_tags WHERE atom_id = la.id AND dimension = 'doc') AS slug
    FROM library_atoms la
    WHERE la.grain = 'foundation'
      AND la.id IN (SELECT atom_id FROM atom_tags WHERE dimension = 'collection' AND value = ${SYSTEM_COLLECTION})
    ORDER BY la.title`;

  // Which starter slugs does the tenant already hold a foundation for? (dedup key)
  const slugs = catalog.map((c) => c.slug).filter((s): s is string => !!s);
  const present = new Set<string>(
    slugs.length
      ? (await sqlBypass<Array<{ slug: string }>>`
          SELECT DISTINCT t.value AS slug
          FROM atom_tags t
          JOIN library_atoms la ON la.id = t.atom_id AND la.grain = 'foundation' AND la.tenant_id = ${targetTenantId}::uuid AND la.vault_id IS NULL
          WHERE t.dimension = 'doc' AND t.value = ANY(${slugs})`).map((r) => r.slug)
      : [],
  );

  const foundationIds: string[] = [];
  let skipped = 0;
  for (const c of catalog) {
    if (c.slug && present.has(c.slug)) { skipped++; continue; }
    const d = await copyFoundationToTenant(c.id, targetTenantId, actor, { collection });
    foundationIds.push(d.foundationId);
  }
  return { added: foundationIds.length, skipped, foundationIds };
}
