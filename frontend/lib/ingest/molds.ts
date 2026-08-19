/**
 * Ingest Studio — the MOLDS gate: propose a master response skeleton, then build the molds.
 *
 * WHAT WAS BROKEN. The molds phase ran `skeleton_architect`, which by design is advisory: it
 * reads the landed matrix and proposes a skeleton (volumes → sections → template type + page
 * budget) as JSON. Correct so far — an AI_INVOKE never writes a business table. But its output
 * went NOWHERE. `solicitation_outlines`, the table built to hold exactly this, was never written
 * by any code path (0 rows, ever), and nothing turned a proposal into molds. So the phase did its
 * advisory work, the advance action parked a human at the gate "with something staged to look
 * at", and there was nothing staged and no button. The gate was a dead end: an admin approved
 * into Molds and the workspace had nothing to show them. Meanwhile every buyer provisioned off
 * that solicitation got blank sections instead of the solicitation's own mandated structure.
 *
 * WHAT THIS IS. The missing half — the read-on-review landing, the same shape the full-draft
 * cohort already uses (docs/FULL_DRAFT_LANDING_DESIGN.md): the pipeline proposes, a human
 * reviews, the FRONTEND lands. Two steps, both explicit:
 *
 *   proposeOutline  →  stage a skeleton into solicitation_outlines (advisory, reviewable)
 *   buildMolds      →  turn the reviewed skeleton into real per-item molds a buyer receives
 *
 * PROVENANCE. A proposal carries where it came from, and the two sources are never conflated:
 *
 *   'agent'   skeleton_architect's own JSON, parsed out of its completed run.
 *   'matrix'  derived deterministically from the LANDED compliance matrix — the required
 *             sections a human already approved, in the order the solicitation states them.
 *
 * The matrix source is a fallback, not a fabrication: every section in it was read from the
 * solicitation and confirmed by a curator at the land gate. When neither is available we return
 * null and say so, rather than inventing a skeleton and letting it wear the agent's name.
 */
import { sql, sqlBypass } from '@/lib/db';
import type { JSONValue } from 'postgres';
import { CANVAS_PRESETS, type CanvasDocument, type CanvasNode } from '@/lib/types/canvas-document';
import { buildArtifactSpecs } from '@/lib/artifact-spec';

export type OutlineSource = 'agent' | 'matrix';

export interface OutlineSection {
  section: string;
  templateType: string;
  pageBudget: number | null;
  characterBudget: number | null;
}
export interface OutlineVolume {
  volumeNumber: number;
  volume: string;
  pageLimit: number | null;
  /** Tracked-only volumes are listed so the skeleton is complete, but never get a mold. */
  dsipOnly: boolean;
  sections: OutlineSection[];
}
export interface ProposedOutline {
  source: OutlineSource;
  volumes: OutlineVolume[];
  notes: string | null;
}

/** The template_type values document_templates accepts (its CHECK constraint). */
const TEMPLATE_TYPES = new Set([
  'technical_volume', 'cost_volume', 'slide_deck', 'past_performance', 'key_personnel',
  'commercialization', 'abstract', 'cover_sheet', 'supporting_docs', 'collaboration', 'custom',
]);

/** Map a volume/item name to a template_type the CHECK allows. Unrecognised → 'custom'. */
export function inferTemplateType(volumeName: string, itemName: string): string {
  const s = `${volumeName} ${itemName}`.toLowerCase();
  if (/cost|budget|price/.test(s)) return 'cost_volume';
  if (/technical volume|technical narrative/.test(s)) return 'technical_volume';
  if (/abstract|project summary|anticipated benefit/.test(s)) return 'abstract';
  if (/cover sheet/.test(s)) return 'cover_sheet';
  if (/commercial/.test(s)) return 'commercialization';
  if (/key personnel|resume|bio/.test(s)) return 'key_personnel';
  if (/past performance|prior|related work/.test(s)) return 'past_performance';
  if (/supporting|attachment|letter|certification|appendix/.test(s)) return 'supporting_docs';
  if (/slide|deck|brief/.test(s)) return 'slide_deck';
  return 'custom';
}

/**
 * Pull skeleton_architect's proposed skeleton out of its completed run.
 *
 * The agent is told to emit JSON, but it answers in prose that CONTAINS the JSON, and a run that
 * safe-skipped or that an emulator answered carries no JSON at all. So this searches the result
 * text for a balanced object with a `volumes` array and returns null when there is not one —
 * "the agent proposed nothing parseable" is a real answer the gate can show, and a much better
 * one than a silently invented skeleton.
 */
export function parseAgentOutline(resultText: unknown): { volumes: unknown[]; notes: string | null } | null {
  if (typeof resultText !== 'string' || !resultText.includes('"volumes"')) return null;
  // Scan for the outermost balanced {...} containing "volumes".
  for (let i = resultText.indexOf('{'); i >= 0; i = resultText.indexOf('{', i + 1)) {
    let depth = 0;
    for (let j = i; j < resultText.length; j++) {
      if (resultText[j] === '{') depth++;
      else if (resultText[j] === '}') {
        depth--;
        if (depth === 0) {
          try {
            const o = JSON.parse(resultText.slice(i, j + 1)) as { volumes?: unknown; notes?: unknown };
            if (Array.isArray(o.volumes) && o.volumes.length) {
              return { volumes: o.volumes, notes: typeof o.notes === 'string' ? o.notes : null };
            }
          } catch { /* not JSON — keep scanning */ }
          break;
        }
      }
    }
  }
  return null;
}

interface VolRow {
  id: string; volumeNumber: number; volumeName: string; dsipOnly: boolean;
}
interface ItemRow {
  id: string; volumeId: string; itemNumber: number; itemName: string; itemType: string;
  pageLimit: number | null; characterLimit: number | null; dsipOnly: boolean; templateId: string | null;
}

async function loadStructure(solId: string): Promise<{ volumes: VolRow[]; items: ItemRow[] }> {
  const volumes = await sqlBypass<VolRow[]>`
    SELECT id, volume_number, volume_name,
           coalesce((metadata->>'dsipOnly')::boolean, false) AS dsip_only
    FROM solicitation_volumes WHERE solicitation_id = ${solId}::uuid ORDER BY volume_number`;
  const items = volumes.length
    ? await sqlBypass<ItemRow[]>`
        SELECT id, volume_id, item_number, item_name, item_type, page_limit, character_limit,
               coalesce((metadata->>'dsipOnly')::boolean, false) AS dsip_only, template_id
        FROM volume_required_items WHERE volume_id = ANY(${volumes.map((v) => v.id)}::uuid[])
        ORDER BY item_number`
    : [];
  return { volumes, items };
}

/**
 * Propose the master skeleton. Prefers the agent's own JSON; falls back to the landed matrix.
 * Returns null only when there is no landed structure at all to describe.
 */
export async function proposeOutline(solId: string): Promise<ProposedOutline | null> {
  const { volumes, items } = await loadStructure(solId);
  if (volumes.length === 0) return null;

  // 1. The agent's proposal, if its last molds run produced parseable JSON.
  let agent: { volumes: unknown[]; notes: string | null } | null = null;
  try {
    const [run] = await sqlBypass<Array<{ text: string | null }>>`
      SELECT step_results #>> '{build_molds,result,result,text}' AS text
      FROM process_instances
      WHERE workflow_name = 'OnIngestPhaseRequestedMolds'
        AND payload ->> 'solicitation_id' = ${solId}
        AND status = 'completed'
      ORDER BY created_at DESC LIMIT 1`;
    agent = parseAgentOutline(run?.text);
  } catch (e) {
    console.error('[molds] agent-outline read failed (falling back to the matrix)', e);
  }

  const byVol = new Map<string, ItemRow[]>();
  for (const it of items) byVol.set(it.volumeId, [...(byVol.get(it.volumeId) ?? []), it]);

  // 2. Either way the SHAPE comes from the landed structure — the volumes and required items a
  //    curator approved. The agent's contribution is the per-section budget/type refinement; it
  //    never gets to invent a volume that is not in the solicitation.
  const agentSections = new Map<string, { pageBudget: number | null; templateType: string }>();
  if (agent) {
    for (const v of agent.volumes as Array<{ sections?: unknown }>) {
      for (const s of (Array.isArray(v.sections) ? v.sections : []) as Array<Record<string, unknown>>) {
        const name = String(s.section ?? '').trim().toLowerCase();
        if (!name) continue;
        const pb = typeof s.page_budget === 'number' && s.page_budget > 0 ? s.page_budget : null;
        const tt = String(s.template_type ?? '');
        agentSections.set(name, { pageBudget: pb, templateType: TEMPLATE_TYPES.has(tt) ? tt : '' });
      }
    }
  }

  const out: OutlineVolume[] = volumes.map((v) => ({
    volumeNumber: v.volumeNumber,
    volume: v.volumeName,
    pageLimit: null,
    dsipOnly: v.dsipOnly,
    sections: (byVol.get(v.id) ?? [])
      .filter((it) => !it.dsipOnly)
      .map((it) => {
        const hint = agentSections.get(it.itemName.trim().toLowerCase());
        return {
          section: it.itemName,
          templateType: hint?.templateType || inferTemplateType(v.volumeName, it.itemName),
          pageBudget: it.pageLimit ?? hint?.pageBudget ?? null,
          characterBudget: it.characterLimit ?? null,
        };
      }),
  }));

  return {
    source: agent ? 'agent' : 'matrix',
    volumes: out,
    notes: agent?.notes
      ?? 'Derived from the landed compliance matrix — the required items a curator approved, in the solicitation’s own order.',
  };
}

/** Stage a proposed skeleton for review. Advisory: writing this builds no molds. */
export async function stageOutline(
  solId: string, outline: ProposedOutline, userId: string | null,
): Promise<{ outlineId: string }> {
  const [row] = await sqlBypass<Array<{ id: string }>>`
    INSERT INTO solicitation_outlines (solicitation_id, outline, notes, created_by)
    VALUES (${solId}::uuid, ${sqlBypass.json(outline as unknown as JSONValue)},
            ${outline.notes}, ${userId}::uuid)
    RETURNING id`;
  return { outlineId: row.id };
}

/** The most recently staged skeleton, or null. */
export async function getStagedOutline(solId: string): Promise<(ProposedOutline & { outlineId: string; createdAt: Date }) | null> {
  const [row] = await sqlBypass<Array<{ id: string; outline: ProposedOutline; createdAt: Date }>>`
    SELECT id, outline, created_at FROM solicitation_outlines
    WHERE solicitation_id = ${solId}::uuid ORDER BY created_at DESC LIMIT 1`;
  if (!row) return null;
  return { ...row.outline, outlineId: row.id, createdAt: row.createdAt };
}

export interface MoldsStatus {
  /** Authored items that SHOULD carry a mold (DSIP-only items are excluded — nothing to author). */
  itemsToMold: number;
  /** …of those, how many actually have one linked. This is the number the gate lives or dies on. */
  itemsWithMold: number;
  outlineStagedAt: string | null;
  outlineSource: OutlineSource | null;
  sectionsProposed: number;
}

/**
 * What the molds gate can honestly claim. `itemsWithMold === 0` is the state that used to render
 * as a finished phase; the panel now has the number to say otherwise.
 */
export async function moldsStatus(solId: string): Promise<MoldsStatus> {
  const { volumes, items } = await loadStructure(solId);
  const authoredVols = new Set(volumes.filter((v) => !v.dsipOnly).map((v) => v.id));
  const toMold = items.filter((i) => authoredVols.has(i.volumeId) && !i.dsipOnly);
  const staged = await getStagedOutline(solId);
  return {
    itemsToMold: toMold.length,
    itemsWithMold: toMold.filter((i) => i.templateId).length,
    outlineStagedAt: staged?.createdAt?.toISOString() ?? null,
    outlineSource: staged?.source ?? null,
    sectionsProposed: staged ? staged.volumes.reduce((a, v) => a + v.sections.length, 0) : 0,
  };
}

// ── Building the mold canvas ────────────────────────────────────────────────

function node(type: string, content: Record<string, unknown>, style?: Record<string, unknown>): CanvasNode {
  return {
    id: crypto.randomUUID(), type, content,
    ...(style ? { style } : {}),
  } as unknown as CanvasNode;
}

/**
 * The starting document a buyer opens for one required item.
 *
 * It is a SKELETON, not content: the item's own heading, the rules that govern it stated in the
 * solicitation's terms, and — for a volume whose required sections the matrix names — one heading
 * per mandated section in the mandated order. That order is the single most common compliance
 * failure in a technical volume, and it is knowable at curation time, so the buyer should never
 * have to reconstruct it from the announcement.
 */
export function buildMoldCanvas(opts: {
  itemName: string;
  volumeName: string;
  pageLimit: number | null;
  characterLimit: number | null;
  requiredSections: string[];
  formatSpec: Record<string, unknown>;
}): CanvasDocument {
  const { itemName, volumeName, pageLimit, characterLimit, requiredSections, formatSpec } = opts;
  const nodes: CanvasNode[] = [node('heading', { text: itemName, level: 1 })];

  const rules: string[] = [];
  if (pageLimit != null) rules.push(`${pageLimit} page${pageLimit === 1 ? '' : 's'} maximum`);
  if (characterLimit != null) rules.push(`${characterLimit.toLocaleString()} characters maximum — the agency form truncates the overflow`);
  const f = formatSpec as { font_default?: { family?: string; size?: number }; min_font_size?: number; margins?: { top?: number } };
  if (f.font_default?.family) rules.push(`${f.font_default.family}${f.font_default.size ? ` ${f.font_default.size}pt` : ''}`);
  if (f.min_font_size) rules.push(`nothing smaller than ${f.min_font_size}pt`);
  if (rules.length) {
    nodes.push(node('callout', {
      text: `${volumeName} — ${rules.join(' · ')}.`,
      variant: 'info',
    }));
  }

  for (const s of requiredSections) {
    nodes.push(node('heading', { text: s, level: 2 }));
    nodes.push(node('text_block', { text: '' }));
  }
  if (requiredSections.length === 0) nodes.push(node('text_block', { text: '' }));

  const now = new Date().toISOString();
  return {
    version: 1,
    document_id: crypto.randomUUID(),
    canvas: {
      ...JSON.parse(JSON.stringify(CANVAS_PRESETS.letter_standard)),
      ...formatSpec,
    },
    nodes,
    metadata: {
      title: itemName, status: 'draft', version_number: 1,
      created_at: now, last_modified_at: now,
    },
  } as unknown as CanvasDocument;
}

export interface BuildMoldsResult {
  built: number;
  skipped: number;
  linked: number;
  molds: Array<{ itemId: string; itemName: string; templateId: string; nodes: number }>;
}

/**
 * Turn the staged skeleton into real molds — one platform `document_templates` row per authored
 * required item, linked back onto the item so provision interpolates it into the buyer's section.
 *
 * Platform-scope (tenant_id NULL, is_system true) deliberately: a master item may only ever link
 * a mold every buyer can load at release, which is the same rule volume.add_required_item's
 * FK-check enforces. Re-runnable: an item that already has a mold is left alone rather than
 * duplicated, so an admin can add an item later and build only what is missing.
 */
export async function buildMolds(
  solId: string, userId: string | null,
): Promise<BuildMoldsResult> {
  const outline = await getStagedOutline(solId);
  if (!outline) return { built: 0, skipped: 0, linked: 0, molds: [] };

  const { volumes, items } = await loadStructure(solId);
  const volById = new Map(volumes.map((v) => [v.id, v]));

  const [comp] = await sqlBypass<Array<Record<string, unknown>>>`
    SELECT * FROM solicitation_compliance WHERE solicitation_id = ${solId}::uuid LIMIT 1`;
  const compliance = (comp ?? {}) as Record<string, unknown>;
  const matrixSections = Array.isArray(compliance.requiredSections)
    ? (compliance.requiredSections as string[])
    : [];

  const sectionByName = new Map<string, OutlineSection>();
  for (const v of outline.volumes) for (const s of v.sections) sectionByName.set(s.section.toLowerCase(), s);

  const [sol] = await sqlBypass<Array<{ topicNumber: string | null; solicitationNumber: string | null }>>`
    SELECT topic_number, solicitation_number FROM curated_solicitations WHERE id = ${solId}::uuid`;
  const prefix = sol?.topicNumber || sol?.solicitationNumber || 'Master';

  const out: BuildMoldsResult = { built: 0, skipped: 0, linked: 0, molds: [] };

  for (const item of items) {
    const vol = volById.get(item.volumeId);
    if (!vol || vol.dsipOnly || item.dsipOnly) { out.skipped++; continue; }
    if (item.templateId) { out.skipped++; continue; }

    const planned = sectionByName.get(item.itemName.toLowerCase());
    const templateType = planned?.templateType ?? inferTemplateType(vol.volumeName, item.itemName);

    // The volume's frozen format spec — the same builder provision and the export gate use, so a
    // mold can never be laid out against different rules than the artifact it seeds.
    const { formatSpec } = buildArtifactSpecs({
      artifactType: templateType === 'cost_volume' ? 'cost' : 'narrative',
      items: [item as unknown as Record<string, unknown>],
      compliance,
    });

    // Only the TECHNICAL volume carries the matrix's mandated section order; stamping those
    // headings into a cost form or a one-page abstract would be noise, not structure.
    const requiredSections = templateType === 'technical_volume' ? matrixSections : [];

    const canvas = buildMoldCanvas({
      itemName: item.itemName,
      volumeName: vol.volumeName,
      pageLimit: item.pageLimit,
      characterLimit: item.characterLimit,
      requiredSections,
      formatSpec: formatSpec as unknown as Record<string, unknown>,
    });
    const nodeCount = (canvas.nodes ?? []).length;

    try {
      const name = `${prefix} — ${item.itemName}`;
      const [tpl] = await sqlBypass<Array<{ id: string }>>`
        INSERT INTO document_templates
          (name, description, template_type, canvas_preset, canvas_document, node_count,
           is_system, tenant_id, created_by, metadata)
        VALUES (${name},
                ${`Master mold for ${vol.volumeName} · ${item.itemName}`},
                ${templateType},
                ${sqlBypass.json(formatSpec as unknown as JSONValue)},
                ${sqlBypass.json(canvas as unknown as JSONValue)},
                ${nodeCount}, true, ${null}, ${userId}::uuid,
                ${sqlBypass.json({ solicitationId: solId, volumeNumber: vol.volumeNumber, itemId: item.id, outlineSource: outline.source } as unknown as JSONValue)})
        ON CONFLICT (name) WHERE is_system = true DO UPDATE
          SET canvas_document = EXCLUDED.canvas_document,
              canvas_preset = EXCLUDED.canvas_preset,
              node_count = EXCLUDED.node_count,
              updated_at = now()
        RETURNING id`;
      await sqlBypass`UPDATE volume_required_items SET template_id = ${tpl.id}::uuid, updated_at = now() WHERE id = ${item.id}::uuid`;
      out.built++; out.linked++;
      out.molds.push({ itemId: item.id, itemName: item.itemName, templateId: tpl.id, nodes: nodeCount });
    } catch (e) {
      console.error('[molds] build failed for item', item.id, e);
      out.skipped++;
    }
  }
  return out;
}

/** Re-export for the route's benefit; keeps the tenant-context `sql` import used. */
export const _sql = sql;
