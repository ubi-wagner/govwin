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
  // Inherit the section's standard classification (C1/C2) so atoms are
  // retrievable by section_type — the foundation for matrix-driven canvas selection.
  const tags = [
    'harvested',
    provenanceTag,
    sectionSlug,
    ...(volumeSlug ? [volumeSlug] : []),
    ...(section.sectionType ? [`type:${section.sectionType}`] : []),
  ];
  // Classified-shred metadata (C2 — "JSON now, vector-ready"). Carried on each
  // atom so Phase-4 retrieval can filter/rank by the standard taxonomy; the
  // embedding column already exists (library_units.embedding) and stays NULL
  // until Phase-4 populates real vectors.
  const atomMeta = {
    sectionType: section.sectionType ?? null,
    standardCategory: subcategory,
    provenance: provenanceTag,
    proposalId,
    sectionId: section.id,
  };

  for (const node of canvasDoc.nodes) {
    if (!isHarvestable(node)) {
      atomsSkipped++;
      continue;
    }

    const text = getNodeText(node);
    const atomHash = computeAtomHash(text);

    try {
      // Check if this exact content already exists for this tenant
      const existing = await sql<Array<{ id: string }>>`
        SELECT id FROM library_units
        WHERE tenant_id = ${tenantId}::uuid
          AND atom_hash = ${atomHash}
        LIMIT 1
      `;

      if (existing.length > 0) {
        // Deduplicate — just increment usage count
        await sql`
          UPDATE library_units
          SET usage_count = usage_count + 1
          WHERE id = ${existing[0].id}
        `;
        atomsSkipped++;
        continue;
      }

      const sourceId = JSON.stringify({
        proposalId,
        sectionId: section.id,
        nodeId: node.id,
      });

      await sql`
        INSERT INTO library_units (
          tenant_id, content, category, subcategory, tags, meta,
          confidence, status, source_type, source_id,
          original_proposal_id, original_node_id, atom_hash,
          outcome, outcome_score
        ) VALUES (
          ${tenantId}::uuid,
          ${text},
          ${category},
          ${subcategory},
          ${tags}::text[],
          ${JSON.stringify(atomMeta)}::jsonb,
          0.9,
          'approved',
          'harvest',
          ${sourceId},
          ${proposalId}::uuid,
          ${node.id},
          ${atomHash},
          'pending',
          0.7
        )
      `;

      await sql`
        INSERT INTO library_harvest_log (tenant_id, proposal_id, harvested_at)
        VALUES (${tenantId}::uuid, ${proposalId}::uuid, now())
      `;

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

  for (const section of sections) {
    const r = await harvestSectionNodes(tenantId, proposalId, section, 'proposal_final');
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

  const result = await harvestSectionNodes(tenantId, proposalId, section, 'section_accepted');

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
