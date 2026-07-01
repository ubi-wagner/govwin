/**
 * Proposal Harvest — extracts accepted content from a locked proposal
 * and saves it to the tenant's library as reusable atoms.
 *
 * This is the feedback-loop write-side: when a proposal is locked at
 * the "final" stage, all substantive canvas nodes (text blocks, lists,
 * tables, headings with real content) are hashed and inserted into
 * library_units if they don't already exist. Atoms from previously
 * locked proposals that share the same hash are deduplicated — only
 * usage_count is incremented.
 *
 * Quality markers:
 *   - confidence: 0.9 (submitted content is high-confidence)
 *   - outcome_score: 0.7 (above default 0.5 — submitted > draft)
 *   - status: 'approved' (not draft — this was accepted content)
 *   - outcome: 'pending' (updated when admin records win/loss)
 *
 * Called from the lock API route on first lock (lock_count = 1).
 */

import { sql } from '@/lib/db';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { emitEventSingle, systemActor } from '@/lib/events';
import type { CanvasDocument, CanvasNode } from '@/lib/types/canvas-document';
import { getNodeText } from '@/lib/types/canvas-document';

// ─── Section title → library category mapping ────────────────────────
// Same mapping used in draft-all-sections.tsx for consistency.

const SECTION_CATEGORY_MAP: Record<string, string> = {
  'technical proposal': 'technical_approach',
  'technical approach': 'technical_approach',
  'technical volume': 'technical_approach',
  'key personnel': 'key_personnel',
  'personnel': 'key_personnel',
  'staffing plan': 'key_personnel',
  'past performance': 'past_performance',
  'relevant experience': 'past_performance',
  'corporate experience': 'past_performance',
  'commercialization': 'commercialization',
  'commercialization plan': 'commercialization',
  'commercialization strategy': 'commercialization',
  'facilities': 'facilities',
  'facilities and equipment': 'facilities',
  'equipment': 'facilities',
  'management approach': 'management_approach',
  'management plan': 'management_approach',
  'cost proposal': 'cost_proposal',
  'cost volume': 'cost_proposal',
  'budget': 'cost_proposal',
};

function sectionToCategory(title: string): string {
  const normalized = title.toLowerCase().trim();
  return SECTION_CATEGORY_MAP[normalized] ?? normalized.replace(/\s+/g, '_');
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80);
}

/** Compute a stable hash of content text for deduplication. */
function computeAtomHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Node types eligible for harvest. */
const HARVESTABLE_TYPES = new Set([
  'heading',
  'text_block',
  'bulleted_list',
  'numbered_list',
  'table',
]);

/** Node types that should always be skipped. */
const SKIP_TYPES = new Set([
  'page_break',
  'spacer',
  'toc',
]);

/**
 * Determines whether a node should be harvested.
 *
 * Skips:
 * - page_break, spacer, toc
 * - Nodes with provenance.source='template' that were never edited
 * - Nodes with no meaningful text content
 */
function isHarvestable(node: CanvasNode): boolean {
  if (SKIP_TYPES.has(node.type)) return false;
  if (!HARVESTABLE_TYPES.has(node.type)) return false;

  // Skip unedited template nodes — they're just placeholders
  if (node.provenance.source === 'template') {
    const wasEdited = node.history.some((h) => h.action === 'edited' || h.action === 'replaced');
    if (!wasEdited) return false;
  }

  // Must have actual content
  const text = getNodeText(node);
  if (!text || text.trim().length < 20) return false;

  return true;
}

export interface HarvestResult {
  atomsHarvested: number;
  atomsSkipped: number;
}

/**
 * Dept:Agency:Sol:Topic context that contextually binds a harvested atom to the
 * effort it was refined in (and makes it retrievable by that hierarchy later).
 */
interface HarvestContext {
  opportunityId?: string | null;
  agency?: string | null;
  office?: string | null;
  programType?: string | null;
  namespace?: string | null;
}

/** The person a harvested atom is attributed to (queryable "original author"). */
interface HarvestAuthor {
  id: string | null;
  name: string | null;
}

/** Resolve harvestedBy (a user id) → {id, name} once, for atom authorship in meta. */
async function resolveAuthor(userId: string): Promise<HarvestAuthor> {
  if (!userId) return { id: null, name: null };
  try {
    const [u] = await sql<Array<{ id: string; name: string | null }>>`
      SELECT id, name FROM users WHERE id = ${userId}::uuid LIMIT 1
    `;
    return u ? { id: u.id, name: u.name } : { id: userId, name: null };
  } catch {
    // harvestedBy wasn't a resolvable uuid — keep the raw id, no name.
    return { id: userId, name: null };
  }
}

/**
 * Where a refined atom sits in the parent→child→grandchild tree. Atoms are
 * immutable, so each harvest crystallizes the NEXT generation and carries its
 * root + depth in meta.lineage (a denormalized convenience; the authoritative
 * chain is always parent_unit_id, walkable via the recursive lineage query).
 */
interface AtomLineage {
  parentUnitId: string | null;
  rootUnitId?: string;
  generation: number;
}

/** Derive a child's lineage (root + generation) from its parent's carried lineage. */
async function loadParentLineage(parentUnitId: string, tenantId: string): Promise<{ rootUnitId: string; generation: number }> {
  try {
    const [p] = await sql<Array<{ id: string; parentUnitId: string | null; lineage: { rootUnitId?: string; generation?: number } | null }>>`
      SELECT id, parent_unit_id AS "parentUnitId", meta->'lineage' AS lineage
      FROM library_units
      WHERE id = ${parentUnitId}::uuid AND tenant_id = ${tenantId}::uuid
      LIMIT 1
    `;
    if (!p) return { rootUnitId: parentUnitId, generation: 1 };
    const parentGen = typeof p.lineage?.generation === 'number' ? p.lineage.generation : (p.parentUnitId ? 1 : 0);
    const parentRoot = p.lineage?.rootUnitId ?? p.parentUnitId ?? p.id;
    return { rootUnitId: parentRoot, generation: parentGen + 1 };
  } catch (err) {
    console.error('[harvest] parent lineage load failed:', err);
    return { rootUnitId: parentUnitId, generation: 1 };
  }
}

/** Load the proposal's opportunity/solicitation context once, for atom binding. */
async function loadHarvestContext(proposalId: string): Promise<HarvestContext> {
  try {
    const [row] = await sql<Array<{ opportunityId: string | null; agency: string | null; office: string | null; programType: string | null; namespace: string | null }>>`
      SELECT o.id AS "opportunityId", o.agency, o.office,
             o.program_type AS "programType", cs.namespace
      FROM proposals p
      LEFT JOIN opportunities o ON o.id = p.opportunity_id
      LEFT JOIN curated_solicitations cs ON cs.id = o.solicitation_id
      WHERE p.id = ${proposalId}::uuid
      LIMIT 1
    `;
    return row ?? {};
  } catch (err) {
    console.error('[harvest] context load failed:', err);
    return {};
  }
}

/**
 * Harvest the canvas nodes of a single section into the tenant's library.
 * Shared by the whole-proposal harvest (final lock) and the per-section
 * harvest (on accept+lock). `provenanceTag` distinguishes the source
 * ('proposal_final' vs 'section_accepted') in the atom's tags; the parent
 * document/volume name is added as a tag for document-grouped retrieval.
 */
async function harvestSectionNodes(
  tenantId: string,
  proposalId: string,
  section: { id: string; title: string; content: string | null; volumeName?: string | null; sectionType?: string | null; standardCategory?: string | null },
  provenanceTag: string,
  ctx: HarvestContext = {},
  author: HarvestAuthor = { id: null, name: null },
): Promise<HarvestResult> {
  let atomsHarvested = 0;
  let atomsSkipped = 0;

  if (!section.content) return { atomsHarvested, atomsSkipped };

  let canvasDoc: CanvasDocument;
  try {
    canvasDoc = JSON.parse(section.content) as CanvasDocument;
  } catch {
    // Not valid canvas JSON — skip
    return { atomsHarvested, atomsSkipped };
  }
  if (!canvasDoc.nodes || !Array.isArray(canvasDoc.nodes)) {
    return { atomsHarvested, atomsSkipped };
  }

  const category = sectionToCategory(section.title);
  // The C1 standard bucket (technical / team / commercialization / readiness …),
  // resolved from the section's section_type. Stored structured in subcategory so
  // atoms are bucket-retrievable, not just title-bucketed.
  const subcategory = section.standardCategory ?? null;
  const sectionSlug = slugify(section.title);
  const volumeSlug = section.volumeName ? slugify(section.volumeName) : null;
  // Dept:Agency:Sol:Topic context tags — contextually bind the harvested atom to
  // where it was refined, and make it retrievable by hierarchy (matrix-driven reuse).
  const ctxTags = [
    ...(ctx.agency ? [`agency:${slugify(ctx.agency)}`] : []),
    ...(ctx.office ? [`org:${slugify(ctx.office)}`] : []),
    ...(ctx.programType ? [`program:${slugify(ctx.programType)}`] : []),
    ...(ctx.namespace ? [`sol:${slugify(ctx.namespace)}`] : []),
  ];

  for (const node of canvasDoc.nodes) {
    if (!isHarvestable(node)) {
      atomsSkipped++;
      continue;
    }

    const text = getNodeText(node);
    const atomHash = computeAtomHash(text);
    // LINEAGE: the library atom this node was inserted from, if any. Atoms are
    // NEVER mutated — each use crystallizes a NEW context-bound child whose
    // parent_unit_id points back at the atom it was refined from. Over time this
    // builds the user's content tree (X → refined-in-proposal-A → Y → … ).
    const parentUnitId = node.provenance?.library_unit_id ?? null;

    // Generational lineage: a refined node is the NEXT generation of its parent —
    // carry the root + depth so progeny (child → grandchild → …) re-added at the end
    // of the proposal cycle record their place in the tree.
    const lineage: AtomLineage = parentUnitId
      ? { parentUnitId, ...(await loadParentLineage(parentUnitId, tenantId)) }
      : { parentUnitId: null, generation: 0 };

    // Per-node so the lineage + context bind correctly.
    const tags = [
      'harvested',
      provenanceTag,
      sectionSlug,
      ...(volumeSlug ? [volumeSlug] : []),
      ...(section.sectionType ? [`type:${section.sectionType}`] : []),
      ...ctxTags,
      ...(parentUnitId ? ['refined'] : []),
    ];
    // Classified-shred + contextual-binding metadata (vector-ready). Carries the
    // refined-from link and the Dept:Agency:Sol:Topic context the atom was used in.
    const atomMeta = {
      sectionType: section.sectionType ?? null,
      standardCategory: subcategory,
      provenance: provenanceTag,
      proposalId,
      sectionId: section.id,
      refinedFromUnitId: parentUnitId,
      // Original author — makes atoms searchable by who authored them.
      authorUserId: author.id,
      authorName: author.name,
      // Parent→child→grandchild position (root + generation depth).
      lineage,
      context: {
        opportunityId: ctx.opportunityId ?? null,
        agency: ctx.agency ?? null,
        office: ctx.office ?? null,
        programType: ctx.programType ?? null,
        namespace: ctx.namespace ?? null,
      },
    };

    try {
      // Context-bound dedup: re-harvesting the same content from the SAME proposal
      // is a re-lock (bump usage). The same content in a DIFFERENT proposal is a
      // NEW context-bound child (different context = a new atom in the tree).
      const existing = await sql<Array<{ id: string }>>`
        SELECT id FROM library_units
        WHERE tenant_id = ${tenantId}::uuid
          AND atom_hash = ${atomHash}
          AND original_proposal_id = ${proposalId}::uuid
        LIMIT 1
      `;

      if (existing.length > 0) {
        await sql`UPDATE library_units SET usage_count = usage_count + 1 WHERE id = ${existing[0].id}`;
        atomsSkipped++;
        continue;
      }

      const sourceId = JSON.stringify({
        proposalId,
        sectionId: section.id,
        nodeId: node.id,
      });

      const [created] = await sql<Array<{ id: string }>>`
        INSERT INTO library_units (
          tenant_id, content, category, subcategory, tags, meta,
          confidence, status, source_type, source_id,
          parent_unit_id, original_proposal_id, original_node_id, atom_hash,
          outcome, outcome_score
        ) VALUES (
          ${tenantId}::uuid,
          ${text},
          ${category},
          ${subcategory},
          ${tags}::text[],
          ${sql.json(atomMeta as unknown as Parameters<typeof sql.json>[0])},
          0.9,
          'approved',
          'harvest',
          ${sourceId},
          ${parentUnitId}::uuid,
          ${proposalId}::uuid,
          ${node.id},
          ${atomHash},
          'pending',
          0.7
        ) RETURNING id
      `;

      await sql`
        INSERT INTO library_harvest_log (tenant_id, proposal_id, harvested_at)
        VALUES (${tenantId}::uuid, ${proposalId}::uuid, now())
      `;

      // LINEAGE: the source atom was used again — bump its lifetime usage and emit
      // the usage-chain event (the audit trail of how an atom propagates across the
      // user's work, parent → child).
      if (parentUnitId) {
        await sql`
          UPDATE library_units SET usage_count = usage_count + 1
          WHERE id = ${parentUnitId}::uuid AND tenant_id = ${tenantId}::uuid
        `;
        try {
          await emitEventSingle({
            namespace: 'library',
            type: 'atom.refined',
            actor: systemActor('harvest'),
            tenantId,
            payload: {
              correlationId: randomUUID(),
              parentUnitId,
              newUnitId: created?.id ?? null,
              proposalId,
              sectionId: section.id,
              nodeId: node.id,
            },
          });
        } catch {
          // best-effort
        }
      }

      atomsHarvested++;
    } catch (err) {
      // Individual node failures are non-fatal — log and continue
      console.error(`[harvest] Failed to harvest node ${node.id}`, err);
      atomsSkipped++;
    }
  }

  return { atomsHarvested, atomsSkipped };
}

/**
 * Harvest all canvas nodes from a locked proposal into the tenant's
 * library. Called on first lock (lock_count transitions to 1).
 */
export async function harvestProposalToLibrary(
  tenantId: string,
  proposalId: string,
  harvestedBy: string,
): Promise<HarvestResult> {
  let atomsHarvested = 0;
  let atomsSkipped = 0;

  // Load all sections for this proposal
  let sections: Array<{ id: string; title: string; content: string | null; volumeName: string | null }>;
  try {
    sections = await sql<Array<{
      id: string;
      title: string;
      content: string | null;
      volumeName: string | null;
      sectionType: string | null;
      standardCategory: string | null;
    }>>`
      SELECT id, title, content, volume_name, section_type,
             (SELECT ss.category FROM section_standards ss WHERE ss.key = section_type) AS standard_category
      FROM proposal_sections
      WHERE proposal_id = ${proposalId}
      ORDER BY section_number
    `;
  } catch (err) {
    console.error('[harvest] Failed to load proposal sections:', err);
    return { atomsHarvested: 0, atomsSkipped: 0 };
  }

  const ctx = await loadHarvestContext(proposalId);
  const author = await resolveAuthor(harvestedBy);
  for (const section of sections) {
    const r = await harvestSectionNodes(tenantId, proposalId, section, 'proposal_final', ctx, author);
    atomsHarvested += r.atomsHarvested;
    atomsSkipped += r.atomsSkipped;
  }

  // Emit harvest completion event
  try {
    await emitEventSingle({
      namespace: 'library',
      type: 'harvest.completed',
      actor: systemActor('harvest'),
      tenantId,
      payload: {
        correlationId: randomUUID(),
        proposalId,
        harvestedBy,
        atomsHarvested,
        atomsSkipped,
      },
    });
  } catch {
    // Event emission is best-effort
  }

  return { atomsHarvested, atomsSkipped };
}

/**
 * Harvest a single accepted+locked section into the tenant's library
 * (Option 1 — capture approved atomized content at accept time, not only at
 * final lock). Called from the section lock route. Best-effort + deduped, so
 * re-locking the same content just bumps usage_count.
 */
export async function harvestSectionToLibrary(
  tenantId: string,
  proposalId: string,
  sectionId: string,
  harvestedBy: string,
): Promise<HarvestResult> {
  let section: { id: string; title: string; content: string | null; volumeName: string | null } | undefined;
  try {
    [section] = await sql<Array<{ id: string; title: string; content: string | null; volumeName: string | null; sectionType: string | null; standardCategory: string | null }>>`
      SELECT id, title, content, volume_name, section_type,
             (SELECT ss.category FROM section_standards ss WHERE ss.key = section_type) AS standard_category
      FROM proposal_sections
      WHERE id = ${sectionId} AND proposal_id = ${proposalId}
      LIMIT 1
    `;
  } catch (err) {
    console.error('[harvest] Failed to load section for harvest:', err);
    return { atomsHarvested: 0, atomsSkipped: 0 };
  }
  if (!section) return { atomsHarvested: 0, atomsSkipped: 0 };

  const ctx = await loadHarvestContext(proposalId);
  const author = await resolveAuthor(harvestedBy);
  const result = await harvestSectionNodes(tenantId, proposalId, section, 'section_accepted', ctx, author);

  try {
    await emitEventSingle({
      namespace: 'library',
      type: 'section.harvested',
      actor: systemActor('harvest'),
      tenantId,
      payload: {
        correlationId: randomUUID(),
        proposalId,
        sectionId,
        harvestedBy,
        atomsHarvested: result.atomsHarvested,
        atomsSkipped: result.atomsSkipped,
      },
    });
  } catch {
    // best-effort
  }

  return result;
}
