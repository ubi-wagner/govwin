/**
 * Atom library service (greenfield, mig 101/102) — the engine that drives the
 * upload → atomize → select → fill-the-mold loop.
 *
 * An atom is one `library_atoms` row: a primitive (one object), a group (aggregate
 * of member atoms), or a reference (the registered source doc). Every atom is unique,
 * records its creator (admin / AI / collaborator / …) and a source_anchor back to the
 * document/objects it was cut from, carries the unified taxonomy as `atom_tags` (each
 * tag auto- or admin-confirmed), and knows its SIZE in the same currency the section
 * molds use (words/chars + a physical estimate) so fit against a compliance-bound
 * skeleton is a direct comparison.
 */

import { withTenant } from '@/lib/rls';
import { atomSize, type AtomSize } from '@/lib/atom-size';
import { hasRoleAtLeast, type Role } from '@/lib/rbac';
import type { CanvasNode } from '@/lib/types/canvas-document';

// Re-export the pure size API so callers keep `import { atomSize } from '@/lib/atoms'`.
export { atomSize, type AtomSize };

// Foundation-artifact containment (docs/LIBRARY_AND_VAULTS_DESIGN.md §1):
// foundation ⊃ section ⊃ group ⊃ primitive. The three container grains aggregate
// members (via atom_members); primitive is the leaf; reference is a pointer.
export type Grain = 'foundation' | 'section' | 'group' | 'primitive' | 'reference';
const CONTAINER_GRAINS: ReadonlySet<Grain> = new Set<Grain>(['foundation', 'section', 'group']);
export type CreatorKind = 'admin' | 'ai' | 'collaborator' | 'system' | 'import';
export type AtomSource = 'upload' | 'harvest' | 'download_derivative' | 'manual';
export type Visibility = 'tenant' | 'owner_only' | 'shared_for_proposal' | 'admin_only' | 'vault';
export type AtomStatus = 'draft' | 'approved' | 'archived';

export interface AtomTagInput {
  dimension: string;
  value: string;
  isOther?: boolean;
  source?: 'auto' | 'admin';
  confirmed?: boolean;
}

export interface CreateAtomInput {
  grain: Grain;
  title?: string | null;
  content?: string | null;
  canvasNodes?: CanvasNode[] | null;
  summary?: string | null;
  source?: AtomSource;
  creatorKind?: CreatorKind;
  cocoonId?: string | null;
  sourceAnchor?: unknown;              // [{ sourceAtomId, nodeIds, region }]
  originProposalId?: string | null;
  originSectionId?: string | null;
  visibility?: Visibility;
  vaultId?: string | null;             // segregates the atom into a collaboration vault (nook)
  status?: AtomStatus;
  memberAtomIds?: string[];            // grain='group'
  parentAtomIds?: string[];            // lineage: derived_from
  tags?: AtomTagInput[];
  // When true and originSectionId is set, reuse the section's existing derivative
  // atom (UPDATE in place) instead of inserting a duplicate. Makes the section
  // return idempotent across lock → unlock → re-lock (one atom per section, refreshed).
  idempotentBySection?: boolean;
}

// ── create ──
export interface CreatedAtom { atomId: string; size: AtomSize }

export async function createAtom(
  tenantId: string,
  input: CreateAtomInput,
  actor: { id: string; kind?: CreatorKind },
): Promise<CreatedAtom> {
  const size = atomSize({ content: input.content, canvasNodes: input.canvasNodes });
  const creatorKind = input.creatorKind ?? actor.kind ?? 'admin';

  return withTenant(tenantId, async (tx) => {
    // Idempotent-by-section: when asked, refresh the section's existing derivative
    // in place (matched on origin_section_id + source) rather than inserting a
    // duplicate on re-lock. Falls through to INSERT when there's no prior atom.
    const reuse = input.idempotentBySection && input.originSectionId
      ? (await tx<Array<{ id: string }>>`
          SELECT id FROM library_atoms
          WHERE tenant_id = ${tenantId}::uuid
            AND origin_section_id = ${input.originSectionId}::uuid
            AND source = ${input.source ?? 'manual'}
          ORDER BY created_at ASC
          LIMIT 1
        `)[0] ?? null
      : null;

    let atomId: string;
    if (reuse) {
      await tx`
        UPDATE library_atoms SET
          title = ${input.title ?? null},
          content = ${input.content ?? null},
          canvas_nodes = ${input.canvasNodes ? tx.json(input.canvasNodes) : null},
          summary = ${input.summary ?? null},
          word_count = ${size.words},
          char_count = ${size.chars},
          status = ${input.status ?? 'draft'},
          cocoon_id = ${input.cocoonId ?? null},
          origin_proposal_id = ${input.originProposalId ?? null}
        WHERE id = ${reuse.id}::uuid
      `;
      atomId = reuse.id;
    } else {
      const [atom] = await tx<Array<{ id: string }>>`
        INSERT INTO library_atoms
          (tenant_id, grain, title, content, canvas_nodes, summary, word_count, char_count,
           status, source, creator_kind, created_by, owner_user_id, visibility, vault_id,
           cocoon_id, source_anchor, origin_proposal_id, origin_section_id)
        VALUES
          (${tenantId}::uuid, ${input.grain}, ${input.title ?? null}, ${input.content ?? null},
           ${input.canvasNodes ? tx.json(input.canvasNodes) : null}, ${input.summary ?? null},
           ${size.words}, ${size.chars}, ${input.status ?? 'draft'}, ${input.source ?? 'manual'},
           ${creatorKind}, ${actor.id}::uuid, ${actor.id}::uuid, ${input.visibility ?? 'tenant'}, ${input.vaultId ?? null}::uuid,
           ${input.cocoonId ?? null}, ${input.sourceAnchor ? tx.json(input.sourceAnchor) : null},
           ${input.originProposalId ?? null}, ${input.originSectionId ?? null})
        RETURNING id
      `;
      atomId = atom.id;
    }

    // tags (each carries auto/admin + confirmed provenance)
    for (const t of input.tags ?? []) {
      const confirmed = t.confirmed ?? false;
      await tx`
        INSERT INTO atom_tags (atom_id, dimension, value, is_other, tag_source, confirmed, confirmed_by, confirmed_at)
        VALUES (${atomId}::uuid, ${t.dimension}, ${t.value}, ${t.isOther ?? false},
                ${t.source ?? 'admin'}, ${confirmed},
                ${confirmed ? actor.id : null}, ${confirmed ? new Date() : null})
        ON CONFLICT (atom_id, dimension, value) DO NOTHING
      `;
    }

    // members: a container grain (foundation/section/group) aggregates ordered members.
    const members = CONTAINER_GRAINS.has(input.grain) ? (input.memberAtomIds ?? []) : [];
    for (let i = 0; i < members.length; i++) {
      await tx`
        INSERT INTO atom_members (group_atom_id, member_atom_id, ordinal)
        VALUES (${atomId}::uuid, ${members[i]}::uuid, ${i})
        ON CONFLICT (group_atom_id, member_atom_id) DO NOTHING
      `;
    }
    // member_summary = count of members by kind
    if (members.length > 0) {
      const rows = await tx<Array<{ value: string; n: number }>>`
        SELECT value, count(*)::int AS n FROM atom_tags
        WHERE atom_id = ANY(${members}::uuid[]) AND dimension = 'kind' GROUP BY value
      `;
      const rollup: Record<string, number> = {};
      for (const r of rows) rollup[r.value] = r.n;
      await tx`UPDATE library_atoms SET member_summary = ${tx.json(rollup)} WHERE id = ${atomId}::uuid`;
    }

    // lineage (this atom derived_from parents; a child ← many parents). Only bump
    // the parent's usage_count when the edge is NEWLY inserted, so an idempotent
    // re-harvest of the same section doesn't inflate the source atom's usage.
    for (const p of input.parentAtomIds ?? []) {
      if (p === atomId) continue;
      const linked = await tx<Array<{ parent_atom_id: string }>>`
        INSERT INTO atom_lineage (parent_atom_id, child_atom_id, relation)
        VALUES (${p}::uuid, ${atomId}::uuid, 'derived_from')
        ON CONFLICT (parent_atom_id, child_atom_id) DO NOTHING
        RETURNING parent_atom_id
      `;
      if (linked.length > 0) {
        await tx`UPDATE library_atoms SET usage_count = usage_count + 1 WHERE id = ${p}::uuid`;
      }
    }

    return { atomId, size };
  });
}

// ── tag confirmation ──
export async function confirmTags(
  tenantId: string,
  atomId: string,
  tags: AtomTagInput[],
  actorId: string,
): Promise<{ updated: number }> {
  return withTenant(tenantId, async (tx) => {
    // Vault fence: confirmTags is a main-library curation op (only ever called from the
    // main-library atom route). Guard that the target is a non-vault atom in this tenant
    // before writing any tags, so a main-library call can never touch a vault atom's tags
    // — mirrors the AND vault_id IS NULL on every library_atoms read in this file.
    const [own] = await tx<Array<{ id: string }>>`
      SELECT id FROM library_atoms
      WHERE tenant_id = ${tenantId}::uuid AND id = ${atomId}::uuid AND vault_id IS NULL`;
    if (!own) return { updated: 0 };
    let updated = 0;
    for (const t of tags) {
      const rows = await tx<Array<{ atom_id: string }>>`
        INSERT INTO atom_tags (atom_id, dimension, value, is_other, tag_source, confirmed, confirmed_by, confirmed_at)
        VALUES (${atomId}::uuid, ${t.dimension}, ${t.value}, ${t.isOther ?? false},
                ${t.source ?? 'admin'}, ${t.confirmed ?? true}, ${actorId}::uuid, now())
        ON CONFLICT (atom_id, dimension, value) DO UPDATE SET
          confirmed = EXCLUDED.confirmed, confirmed_by = EXCLUDED.confirmed_by, confirmed_at = now()
        RETURNING atom_id
      `;
      updated += rows.length;
    }
    return { updated };
  });
}

// ── soft-archive lifecycle at the FOUNDATION level (mig 148: library_atoms.archived_at) ──
// Archive is a reversible, sort/visibility-only state ORTHOGONAL to the curation `status` column:
// it HIDES atoms from active library lists + counts + draft selection (every such read carries
// `archived_at IS NULL`) while keeping the rows indexed in Postgres — NOT a delete, NOT a status
// change. Per the Archivable contract, atoms archive at the FOUNDATION level: archiving a foundation
// (grain='foundation') cascades to its whole member subtree (foundation → sections → groups →
// primitives, via atom_members). Main-library-only (vault_id IS NULL), the standard library fence.
export async function archiveFoundation(tenantId: string, foundationId: string): Promise<{ archived: number }> {
  return withTenant(tenantId, async (tx) => {
    const f = await tx<Array<{ id: string }>>`
      SELECT id FROM library_atoms
      WHERE id = ${foundationId}::uuid AND tenant_id = ${tenantId}::uuid AND grain = 'foundation' AND vault_id IS NULL LIMIT 1`;
    if (f.length === 0) return { archived: 0 }; // only a foundation is archivable at this level
    const rows = await tx<Array<{ id: string }>>`
      WITH RECURSIVE subtree(id) AS (
        SELECT ${foundationId}::uuid
        UNION
        SELECT m.member_atom_id FROM atom_members m JOIN subtree s ON m.group_atom_id = s.id
      )
      UPDATE library_atoms SET archived_at = now()
      WHERE id IN (SELECT id FROM subtree) AND tenant_id = ${tenantId}::uuid
        AND vault_id IS NULL AND archived_at IS NULL
      RETURNING id`;
    return { archived: rows.length };
  });
}

export async function restoreFoundation(tenantId: string, foundationId: string): Promise<{ restored: number }> {
  return withTenant(tenantId, async (tx) => {
    const f = await tx<Array<{ id: string }>>`
      SELECT id FROM library_atoms
      WHERE id = ${foundationId}::uuid AND tenant_id = ${tenantId}::uuid AND grain = 'foundation' AND vault_id IS NULL LIMIT 1`;
    if (f.length === 0) return { restored: 0 };
    const rows = await tx<Array<{ id: string }>>`
      WITH RECURSIVE subtree(id) AS (
        SELECT ${foundationId}::uuid
        UNION
        SELECT m.member_atom_id FROM atom_members m JOIN subtree s ON m.group_atom_id = s.id
      )
      UPDATE library_atoms SET archived_at = NULL
      WHERE id IN (SELECT id FROM subtree) AND tenant_id = ${tenantId}::uuid
        AND vault_id IS NULL AND archived_at IS NOT NULL
      RETURNING id`;
    return { restored: rows.length };
  });
}

// A viewer for library visibility. Admins (tenant_admin / rfp_admin / master_admin)
// get the whole tenant library (management view); everyone else sees tenant-shared
// atoms plus the ones they own. owner_only / shared_for_proposal / admin_only are
// hidden from other non-admins (per-proposal sharing is a later increment).
export interface Viewer { userId: string; isAdmin: boolean }

/** Build a library Viewer from a session user + role. Admin tiers see the whole
 *  tenant library; tenant_user / partner_user see tenant-shared + their own. */
export function viewerFromRole(userId: string, role: Role): Viewer {
  return { userId, isAdmin: hasRoleAtLeast(role, 'tenant_admin') || role === 'rfp_admin' || role === 'master_admin' };
}

// ── the scored selector (pre-vector): scope → context boost → quality ──
export interface SectionQuery {
  vol?: string | null;
  kinds?: string[];
  context?: string[];     // the opp card's values: agency/program/phase/tech/dept slugs
  limit?: number;
}
export interface RankedAtom {
  id: string; title: string | null; summary: string | null; content: string | null; grain: Grain;
  wordCount: number; charCount: number; outcomeScore: number; usageCount: number;
  ctxMatches: number; score: number;
}

export async function selectForSection(tenantId: string, q: SectionQuery, viewer: Viewer): Promise<RankedAtom[]> {
  const vol = q.vol ?? null;
  const kinds = q.kinds ?? [];
  const context = q.context ?? [];
  const limit = Math.min(50, q.limit ?? 8);

  // `requireTag=true` scopes to the section's vol/kind atoms; `false` drops that
  // filter → ALL of the tenant's approved atoms (still context-ranked). We run the
  // scoped pass first, then fall back to the broad pass when the section has no
  // matching atoms — Eric's "no atoms selected → the agent uses all other proposal
  // atoms in place to try to generate" (the blank-mold-with-a-prompt path). Raw
  // ${boolean} — never `${cond?'t':'f'}::bool`, which binds text and evaluates false.
  const runQuery = (requireTag: boolean) =>
    withTenant<Array<{ id: string; title: string | null; summary: string | null; content: string | null; grain: Grain; wordCount: number; charCount: number; outcomeScore: number; usageCount: number; ctxMatches: number }>>(tenantId, async (tx) =>
      tx`
        SELECT a.id, a.title, a.summary, a.grain,
               a.word_count AS "wordCount", a.char_count AS "charCount",
               a.outcome_score AS "outcomeScore", a.usage_count AS "usageCount",
               -- a group carries no content of its own; assemble it from its ordered members
               coalesce(a.content, (
                 SELECT string_agg(m.content, E'\n\n' ORDER BY am.ordinal)
                 FROM atom_members am JOIN library_atoms m ON m.id = am.member_atom_id
                 WHERE am.group_atom_id = a.id
               )) AS content,
               (SELECT count(*)::int FROM atom_tags t
                  WHERE t.atom_id = a.id
                    AND t.dimension IN ('agency','program','phase','tech','dept')
                    AND t.value = ANY(${context}::text[])) AS "ctxMatches"
        FROM library_atoms a
        WHERE a.tenant_id = ${tenantId}::uuid
          AND a.vault_id IS NULL
          AND a.archived_at IS NULL
          AND a.status = 'approved'
          AND a.grain <> 'reference'
          AND (${viewer.isAdmin} OR a.visibility = 'tenant' OR a.owner_user_id = ${viewer.userId}::uuid)
          AND (${!requireTag} OR EXISTS (
            SELECT 1 FROM atom_tags t WHERE t.atom_id = a.id AND (
              (${vol}::text IS NOT NULL AND t.dimension = 'vol' AND t.value = ${vol})
              OR (t.dimension = 'kind' AND t.value = ANY(${kinds}::text[]))
            )
          ))
        ORDER BY "ctxMatches" DESC, a.outcome_score DESC, a.usage_count DESC, a.created_at DESC
        LIMIT ${limit}
      `,
    );

  let rows = await runQuery(true);
  if (rows.length === 0) rows = await runQuery(false); // fallback: all proposal atoms
  // final blended score (context is authoritative; quality/usage break ties)
  return rows.map((r) => ({
    ...r,
    score: Math.round((r.ctxMatches * 2 + r.outcomeScore + Math.log1p(r.usageCount) * 0.1) * 1000) / 1000,
  }));
}

// ── list / facet ──
// `archived`: opt-in switch for the soft-archive (mig 148) view. Default/false shows
// only ACTIVE atoms (archived_at IS NULL); true shows ONLY archived atoms so the UI
// can offer an "Archived" section with restore. Never mixes the two.
export interface AtomListFilter { dimension?: string; value?: string; grain?: Grain; status?: AtomStatus; q?: string; limit?: number; mine?: boolean; archived?: boolean }
export async function listAtoms(tenantId: string, f: AtomListFilter, viewer: Viewer): Promise<Array<Record<string, unknown>>> {
  const limit = Math.min(500, f.limit ?? 200);
  return withTenant(tenantId, async (tx) =>
    tx`
      SELECT a.id, a.grain, a.title, a.summary, a.word_count, a.char_count, a.status,
             a.creator_kind, a.source, a.outcome_score, a.usage_count, a.created_at,
             a.owner_user_id, a.created_by, a.visibility,
             u.name AS owner_name, u.email AS owner_email,
             (a.owner_user_id = ${viewer.userId}::uuid) AS is_mine,
             (SELECT count(*)::int FROM atom_members m WHERE m.group_atom_id = a.id) AS member_count,
             (SELECT count(*)::int FROM atom_lineage l WHERE l.parent_atom_id = a.id) AS child_count,
             coalesce((SELECT array_agg(t.dimension || ':' || t.value ORDER BY t.dimension) FROM atom_tags t WHERE t.atom_id = a.id), '{}') AS tags
      FROM library_atoms a
      LEFT JOIN users u ON u.id = a.owner_user_id
      WHERE a.tenant_id = ${tenantId}::uuid
        AND a.vault_id IS NULL
        ${f.archived ? tx`AND a.archived_at IS NOT NULL` : tx`AND a.archived_at IS NULL`}
        AND (${viewer.isAdmin} OR a.visibility = 'tenant' OR a.owner_user_id = ${viewer.userId}::uuid)
        ${f.mine ? tx`AND a.owner_user_id = ${viewer.userId}::uuid` : tx``}
        ${f.grain ? tx`AND a.grain = ${f.grain}` : tx``}
        ${f.status ? tx`AND a.status = ${f.status}` : tx``}
        ${f.q ? tx`AND (a.title ILIKE ${'%' + f.q.replace(/[%_\\]/g, '\\$&') + '%'} OR a.summary ILIKE ${'%' + f.q.replace(/[%_\\]/g, '\\$&') + '%'})` : tx``}
        ${f.dimension && f.value ? tx`AND EXISTS (SELECT 1 FROM atom_tags t WHERE t.atom_id = a.id AND t.dimension = ${f.dimension} AND t.value = ${f.value})` : tx``}
      ORDER BY a.created_at DESC
      LIMIT ${limit}
    `,
  );
}

// ── faceted library list (P3.1): intersect taxonomy dimensions + facet counts ──
export interface FacetFilter {
  kind?: string; form?: string; context?: string; collection?: string; vehicle?: string;
  grain?: Grain; q?: string; page?: number; pageSize?: number;
  // Soft-archive (mig 148) opt-in: default/false = active only (archived_at IS NULL);
  // true = only archived. Applied to the list, the total, AND the facet counts.
  archived?: boolean;
}
export interface FacetResult {
  atoms: Array<Record<string, unknown>>;
  total: number;
  /** dimension → { value → count } over the visible library (for the filter chips). */
  facets: Record<string, Record<string, number>>;
}

/**
 * List the library with an ANDed taxonomy filter (kind × form × context × collection ×
 * vehicle), grain filter, escaped search + pagination, plus facet counts for the chips.
 * Visibility is the same viewer predicate as listAtoms. Every taxonomy filter is an
 * EXISTS on atom_tags, so they intersect. Facet counts respect grain+q but NOT the
 * taxonomy filters, so a chip always shows every available option with its total.
 */
export async function listAtomsFaceted(tenantId: string, f: FacetFilter, viewer: Viewer): Promise<FacetResult> {
  const pageSize = Math.min(100, Math.max(1, f.pageSize ?? 30));
  const page = Math.max(1, f.page ?? 1);
  const offset = (page - 1) * pageSize;
  const esc = (s: string) => '%' + s.replace(/[%_\\]/g, '\\$&') + '%';
  return withTenant(tenantId, async (tx) => {
    const vis = tx`(${viewer.isAdmin} OR a.visibility = 'tenant' OR a.owner_user_id = ${viewer.userId}::uuid)`;
    // Soft-archive scope — active-only by default, archived-only on opt-in. Reused by
    // the list/total `where` and the facet-count query so both agree on the scope.
    const arch = f.archived ? tx`AND a.archived_at IS NOT NULL` : tx`AND a.archived_at IS NULL`;
    const tagF = (dim: string, val?: string) =>
      val ? tx`AND EXISTS (SELECT 1 FROM atom_tags t WHERE t.atom_id = a.id AND t.dimension = ${dim} AND t.value = ${val})` : tx``;
    const where = tx`
      a.tenant_id = ${tenantId}::uuid
      AND a.grain <> 'reference'
      AND a.vault_id IS NULL
      ${arch}
      AND ${vis}
      ${f.grain ? tx`AND a.grain = ${f.grain}` : tx``}
      ${f.q ? tx`AND (a.title ILIKE ${esc(f.q)} OR a.summary ILIKE ${esc(f.q)})` : tx``}
      ${tagF('kind', f.kind)} ${tagF('form', f.form)} ${tagF('context', f.context)} ${tagF('collection', f.collection)} ${tagF('vehicle', f.vehicle)}`;

    const atoms = await tx<Array<Record<string, unknown>>>`
      SELECT a.id, a.grain, a.title, a.summary, a.word_count, a.status, a.usage_count, a.created_at,
             (a.owner_user_id = ${viewer.userId}::uuid) AS is_mine,
             (SELECT count(*)::int FROM atom_members m WHERE m.group_atom_id = a.id) AS member_count,
             coalesce((SELECT array_agg(t.dimension || ':' || t.value ORDER BY t.dimension) FROM atom_tags t WHERE t.atom_id = a.id), '{}') AS tags
      FROM library_atoms a
      WHERE ${where}
      ORDER BY a.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}`;
    const [{ total }] = await tx<Array<{ total: number }>>`SELECT count(*)::int AS total FROM library_atoms a WHERE ${where}`;

    // Facet counts reflect the coarse SCOPE (grain + q + collection) but not the
    // chip dimensions themselves, so each chip always shows every option available
    // within the current library section.
    const facetRows = await tx<Array<{ dimension: string; value: string; n: number }>>`
      SELECT t.dimension, t.value, count(*)::int AS n
      FROM library_atoms a JOIN atom_tags t ON t.atom_id = a.id
      WHERE a.tenant_id = ${tenantId}::uuid AND a.grain <> 'reference' AND a.vault_id IS NULL ${arch} AND ${vis}
        AND t.dimension IN ('kind','form','context','collection','vehicle')
        ${f.grain ? tx`AND a.grain = ${f.grain}` : tx``}
        ${f.q ? tx`AND (a.title ILIKE ${esc(f.q)} OR a.summary ILIKE ${esc(f.q)})` : tx``}
        ${f.collection ? tx`AND EXISTS (SELECT 1 FROM atom_tags c WHERE c.atom_id = a.id AND c.dimension = 'collection' AND c.value = ${f.collection})` : tx``}
      GROUP BY t.dimension, t.value`;
    const facets: Record<string, Record<string, number>> = {};
    for (const r of facetRows) { (facets[r.dimension] ??= {})[r.value] = Number(r.n); }

    return { atoms, total: Number(total), facets };
  });
}

// ── full atom (tags + members + lineage) ──
export async function getAtom(tenantId: string, atomId: string, viewer: Viewer): Promise<Record<string, unknown> | null> {
  return withTenant(tenantId, async (tx) => {
    const [atom] = await tx<Array<Record<string, unknown>>>`
      SELECT * FROM library_atoms
      WHERE tenant_id = ${tenantId}::uuid AND id = ${atomId}::uuid
        AND vault_id IS NULL
        AND (${viewer.isAdmin} OR visibility = 'tenant' OR owner_user_id = ${viewer.userId}::uuid)
      LIMIT 1
    `;
    if (!atom) return null;
    const tags = await tx`SELECT dimension, value, is_other, tag_source, confirmed FROM atom_tags WHERE atom_id = ${atomId}::uuid ORDER BY dimension`;
    const members = await tx`SELECT m.member_atom_id, m.ordinal, a.title, a.grain FROM atom_members m JOIN library_atoms a ON a.id = m.member_atom_id WHERE m.group_atom_id = ${atomId}::uuid ORDER BY m.ordinal`;
    const parents = await tx`SELECT l.parent_atom_id, a.title FROM atom_lineage l JOIN library_atoms a ON a.id = l.parent_atom_id WHERE l.child_atom_id = ${atomId}::uuid`;
    const children = await tx`SELECT l.child_atom_id, a.title FROM atom_lineage l JOIN library_atoms a ON a.id = l.child_atom_id WHERE l.parent_atom_id = ${atomId}::uuid`;
    return { ...atom, tags, members, parents, children };
  });
}
