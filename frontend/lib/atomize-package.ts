/**
 * Package atomization core — the reusable logic behind
 * POST /api/portal/[tenantSlug]/atoms/atomize-package.
 *
 * `atomizeDocumentIntoLibrary` takes one uploaded document's bytes and turns it
 * into a foundational `document_cocoon` + a `reference` atom + one `primitive`
 * atom per substantive block, auto-tagged with content-class (kind/vol/fmt) and
 * the package-level source CONTEXT (the "FROM" pedigree). Extracted here so the
 * route stays thin and the behavior is drivable end-to-end in a harness/test.
 */
import { readDocument } from '@/lib/import';
import { textOfNodes } from '@/lib/atom-size';
import { createAtom, type AtomTagInput, type CreatorKind } from '@/lib/atoms';
import { withTenant } from '@/lib/rls';
import type { CanvasNode } from '@/lib/types/canvas-document';

export const MAX_FILES = 12;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_ATOMS_PER_DOC = 80;
const MIN_ATOM_WORDS = 10; // below this a block is skipped (headings / noise)

// Reader's legacy category → unified vol / kind (best-effort; confirmable later).
const CATEGORY_TO_VOL: Record<string, string> = {
  technical_approach: 'technical', past_performance: 'past_performance', key_personnel: 'key_personnel',
  capability_statement: 'overview', cost_volume: 'cost', management_approach: 'management',
  commercialization: 'commercialization', abstract: 'abstract', qualifications: 'key_personnel',
  schedule: 'milestones', facilities: 'facilities', teaming: 'key_personnel', transition_plan: 'transition_plan',
};
const CATEGORY_TO_KIND: Record<string, string> = {
  key_personnel: 'bio', qualifications: 'bio', teaming: 'bio', cost_volume: 'budget_data',
};
const FMT_OF: Record<string, string> = { docx: 'doc', pptx: 'slide', pdf: 'doc', txt: 'doc', md: 'doc' };

export const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** Package-level source-context tags from the uploader's inputs (the "FROM" pedigree). */
export function contextTags(ctx: Record<string, string | undefined>): AtomTagInput[] {
  const out: AtomTagInput[] = [];
  if (ctx.agency) out.push({ dimension: 'agency', value: slug(ctx.agency), source: 'auto', confirmed: true, isOther: true });
  const prog = (ctx.program ?? '').toLowerCase().match(/sbir|sttr|baa|ota|cso|rif/)?.[0];
  if (prog) out.push({ dimension: 'program', value: prog, source: 'auto', confirmed: true });
  const phase = (ctx.phase ?? '').toLowerCase().match(/(?:phase[_ -]?)?([123])/)?.[1];
  if (phase) out.push({ dimension: 'phase', value: `phase_${phase}`, source: 'auto', confirmed: true });
  if (ctx.sol) out.push({ dimension: 'sol', value: slug(ctx.sol), source: 'auto', confirmed: true, isOther: true });
  if (ctx.topic) out.push({ dimension: 'topic', value: slug(ctx.topic), source: 'auto', confirmed: true, isOther: true });
  return out;
}

export interface DocAtomizeResult { file: string; format: string; atoms: number; cocoonId: string | null; error?: string }

/**
 * Atomize a single uploaded document into the library. Best-effort per step —
 * a cocoon/reference failure never aborts the primitives; returns a per-doc summary.
 */
export async function atomizeDocumentIntoLibrary(
  tenantId: string,
  opts: { buffer: Buffer; filename: string; packageName?: string; ctxTags: AtomTagInput[]; actor: { id: string; kind: CreatorKind } },
): Promise<DocAtomizeResult> {
  const { buffer, filename, packageName, ctxTags, actor } = opts;
  let parsed;
  try {
    parsed = await readDocument(buffer, filename);
  } catch (e) {
    console.error('[atomize-package] parse failed', filename, e);
    return { file: filename, format: '', atoms: 0, cocoonId: null, error: 'could not parse' };
  }
  if (parsed.atoms.length === 0) return { file: filename, format: parsed.sourceFormat, atoms: 0, cocoonId: null, error: 'no extractable content' };

  const fmt = FMT_OF[parsed.sourceFormat] ?? 'doc';
  const allNodes = parsed.atoms.flatMap((a) => a.nodes);
  const fullText = parsed.atoms.map((a) => textOfNodes(a.nodes)).join('\n\n');

  // 1) Foundational document cocoon.
  let cocoonId: string | null = null;
  try {
    const [row] = await withTenant<Array<{ id: string }>>(tenantId, async (tx) =>
      tx`INSERT INTO document_cocoons (tenant_id, name, scope, source)
         VALUES (${tenantId}::uuid, ${packageName ? `${packageName} — ${filename}` : filename}, 'document', 'upload')
         RETURNING id`);
    cocoonId = row?.id ?? null;
  } catch (e) { console.error('[atomize-package] cocoon insert failed (non-fatal)', e); }

  // 2) Reference atom for the whole doc.
  let referenceId: string | null = null;
  try {
    const ref = await createAtom(tenantId, {
      grain: 'reference', title: filename, content: fullText || null, canvasNodes: allNodes.length ? allNodes : null,
      summary: `Uploaded ${parsed.sourceFormat} · ${parsed.atoms.length} objects${packageName ? ` · ${packageName}` : ''}`,
      source: 'upload', status: 'approved', cocoonId,
      tags: [{ dimension: 'fmt', value: fmt, source: 'auto', confirmed: true }, ...ctxTags],
    }, actor);
    referenceId = ref.atomId;
  } catch (e) { console.error('[atomize-package] reference atom failed (non-fatal)', e); }

  // 3) Auto-atomize each substantive block into a tagged, anchored primitive.
  let made = 0;
  for (let i = 0; i < parsed.atoms.length && made < MAX_ATOMS_PER_DOC; i++) {
    const a = parsed.atoms[i];
    const text = textOfNodes(a.nodes).trim();
    if (!text || text.split(/\s+/).length < MIN_ATOM_WORDS) continue;
    const vol = CATEGORY_TO_VOL[a.suggestedCategory];
    const kind = CATEGORY_TO_KIND[a.suggestedCategory] ?? 'narrative';
    const tags: AtomTagInput[] = [
      { dimension: 'kind', value: kind, source: 'auto', confirmed: true },
      { dimension: 'fmt', value: fmt, source: 'auto', confirmed: true },
      ...(vol ? [{ dimension: 'vol', value: vol, source: 'auto' as const, confirmed: true }] : []),
      ...ctxTags,
    ];
    try {
      await createAtom(tenantId, {
        grain: 'primitive',
        title: (a.headingText || text.slice(0, 60)).slice(0, 120),
        content: text, canvasNodes: a.nodes.length ? (a.nodes as CanvasNode[]) : null,
        summary: null, source: 'upload', status: 'approved', cocoonId,
        sourceAnchor: referenceId ? [{ sourceAtomId: referenceId, blockIds: [`b${i}`] }] : undefined,
        tags,
      }, actor);
      made++;
    } catch (e) { console.error('[atomize-package] primitive create failed', filename, i, e); }
  }
  return { file: filename, format: parsed.sourceFormat, atoms: made, cocoonId };
}
