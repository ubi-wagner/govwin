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
import type { UnextractableSignal } from '@/lib/import/types';
import { textOfNodes } from '@/lib/atom-size';
import { createAtom, type AtomTagInput, type CreatorKind } from '@/lib/atoms';
import { withTenant } from '@/lib/rls';
import type { CanvasNode } from '@/lib/types/canvas-document';
import { cleanText } from '@/lib/clean-text';

export const MAX_FILES = 12;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_ATOMS_PER_DOC = 80;
const MIN_ATOM_WORDS = 10; // below this a block is skipped (headings / noise)

// Reader's legacy category → unified vol / kind (best-effort; confirmable later).
// Covers every category the reader emits (lib/import) — an unmapped category simply drafts
// with no vol guess (the same graceful fallback as before). vol values are drawn from the
// canonical set the section selector + librarian use (technical | cost | past_performance |
// key_personnel | commercialization | overview | management | abstract | milestones |
// facilities | transition_plan | supporting).
const CATEGORY_TO_VOL: Record<string, string> = {
  technical_approach: 'technical', past_performance: 'past_performance', key_personnel: 'key_personnel',
  capability_statement: 'overview', cost_volume: 'cost', management_approach: 'management',
  commercialization: 'commercialization', abstract: 'abstract', qualifications: 'key_personnel',
  schedule: 'milestones', facilities: 'facilities', teaming: 'key_personnel', transition_plan: 'transition_plan',
  // Newly covered reader categories → the nearest canonical vol.
  risk_management: 'management', quality: 'management', security: 'supporting', data_rights: 'supporting',
};
const CATEGORY_TO_KIND: Record<string, string> = {
  key_personnel: 'bio', qualifications: 'bio', teaming: 'bio', cost_volume: 'budget_data',
  // past-performance write-ups are the distinctive `past_perf_blurb` kind (matches the section
  // selector's VOL_DEFAULT_KINDS), so they broaden recall past the vol tag alone.
  past_performance: 'past_perf_blurb',
};
const FMT_OF: Record<string, string> = { docx: 'doc', pptx: 'slide', pdf: 'doc', txt: 'doc', md: 'doc', xlsx: 'table' };

export const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const deepCleanStrings = (v: unknown): unknown =>
  typeof v === 'string' ? cleanText(v)
  : Array.isArray(v) ? v.map(deepCleanStrings)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepCleanStrings(x)]))
  : v;
/** Deep-clean every string inside a node's content (canvasNodes jsonb path). */
const cleanNodes = (nodes: CanvasNode[]): CanvasNode[] => nodes.map((n) => ({ ...n, content: deepCleanStrings(n.content) }) as CanvasNode);
/** Coerce an unknown (from JSON.parse) to a trimmed string — never throws on a number/array/object. */
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Package-level source-context tags from the uploader's inputs (the "FROM" pedigree).
 * Best-effort: non-string values (a numeric/array JSON field) are ignored, never thrown.
 */
export function contextTags(ctx: Record<string, unknown>): AtomTagInput[] {
  const out: AtomTagInput[] = [];
  // `JSON.parse("null")` returns null WITHOUT throwing, so the caller's parse-guard misses it —
  // reading ctx.agency off null would 500 the whole upload. Treat any non-object as no context.
  if (!ctx || typeof ctx !== 'object') return out;
  const agency = str(ctx.agency), program = str(ctx.program).toLowerCase(), phase = str(ctx.phase).toLowerCase(), sol = str(ctx.sol), topic = str(ctx.topic);
  if (agency) out.push({ dimension: 'agency', value: slug(agency), source: 'auto', confirmed: true, isOther: true });
  const prog = program.match(/sbir|sttr|baa|ota|cso|rif/)?.[0];
  if (prog) out.push({ dimension: 'program', value: prog, source: 'auto', confirmed: true });
  const ph = phase.match(/(?:phase[_ -]?)?([123])/)?.[1];
  if (ph) out.push({ dimension: 'phase', value: `phase_${ph}`, source: 'auto', confirmed: true });
  if (sol) out.push({ dimension: 'sol', value: slug(sol), source: 'auto', confirmed: true, isOther: true });
  if (topic) out.push({ dimension: 'topic', value: slug(topic), source: 'auto', confirmed: true, isOther: true });
  return out;
}

export interface DocAtomizeResult { file: string; format: string; atoms: number; skipped?: number; cocoonId: string | null; reference?: boolean; error?: string }

/** One primitive atom the plan proposes to mint (pre-write). */
export interface PlannedAtom { blockIndex: number; title: string; wordCount: number; content: string; nodes: CanvasNode[]; tags: AtomTagInput[] }
/** The dry-run plan for one document — exactly what atomize WOULD create, computed with NO DB write. */
export interface DocPlan { file: string; format: string; fmt: string; fullText: string; allNodes: CanvasNode[]; parsedCount: number; planned: PlannedAtom[]; skipped: number; error?: string; unextractable?: UnextractableSignal }

/**
 * Parse + segment one document into the primitives it WOULD atomize into — with NO DB
 * writes. This is the shared brain behind BOTH the preview (dry-run) and the commit
 * (`atomizeDocumentIntoLibrary`), so what a user previews is exactly what gets created.
 * Pure aside from the parse, so it is unit-testable and drivable in a harness.
 */
export async function planDocumentAtomization(
  opts: { buffer: Buffer; filename: string; ctxTags: AtomTagInput[] },
): Promise<DocPlan> {
  const { buffer, filename, ctxTags } = opts;
  const empty: DocPlan = { file: filename, format: '', fmt: 'doc', fullText: '', allNodes: [], parsedCount: 0, planned: [], skipped: 0 };
  let parsed;
  try {
    parsed = await readDocument(buffer, filename);
  } catch (e) {
    console.error('[atomize-package] parse failed', filename, e);
    return { ...empty, error: 'could not parse' };
  }
  if (parsed.atoms.length === 0) return { ...empty, format: parsed.sourceFormat, error: 'no extractable content', unextractable: parsed.unextractable };

  const fmt = FMT_OF[parsed.sourceFormat] ?? 'doc';
  const allNodes = cleanNodes(parsed.atoms.flatMap((a) => a.nodes) as CanvasNode[]);
  const fullText = cleanText(parsed.atoms.map((a) => textOfNodes(a.nodes)).join('\n\n'));

  const planned: PlannedAtom[] = [];
  let skipped = 0; // substantive-looking blocks dropped for being under MIN_ATOM_WORDS — surfaced, not silent.
  for (let i = 0; i < parsed.atoms.length && planned.length < MAX_ATOMS_PER_DOC; i++) {
    const a = parsed.atoms[i];
    const text = cleanText(textOfNodes(a.nodes)).trim();
    const words = text ? text.split(/\s+/).length : 0;
    if (!text || words < MIN_ATOM_WORDS) { if (text) skipped++; continue; }
    const vol = CATEGORY_TO_VOL[a.suggestedCategory];
    const kind = CATEGORY_TO_KIND[a.suggestedCategory] ?? 'narrative';
    // Machine-guessed tags land UNconfirmed (a human confirms in the Library) — so auto guesses
    // don't masquerade as reviewed. The uploader's own context tags (ctxTags) keep their setting.
    const tags: AtomTagInput[] = [
      { dimension: 'kind', value: kind, source: 'auto', confirmed: false },
      { dimension: 'fmt', value: fmt, source: 'auto', confirmed: false },
      ...(vol ? [{ dimension: 'vol', value: vol, source: 'auto' as const, confirmed: false }] : []),
      ...ctxTags,
    ];
    planned.push({
      blockIndex: i,
      title: cleanText(a.headingText || text.slice(0, 60)).slice(0, 120),
      wordCount: words,
      content: text,
      nodes: a.nodes.length ? cleanNodes(a.nodes as CanvasNode[]) : [],
      tags,
    });
  }
  return { file: filename, format: parsed.sourceFormat, fmt, fullText, allNodes, parsedCount: parsed.atoms.length, planned, skipped, unextractable: parsed.unextractable };
}

/**
 * Atomize a single uploaded document into the library. Best-effort per step —
 * a cocoon/reference failure never aborts the primitives; returns a per-doc summary.
 * Segments via `planDocumentAtomization`, so the write matches the preview exactly.
 */
export async function atomizeDocumentIntoLibrary(
  tenantId: string,
  opts: { buffer: Buffer; filename: string; packageName?: string; ctxTags: AtomTagInput[]; actor: { id: string; kind: CreatorKind } },
): Promise<DocAtomizeResult> {
  const { buffer, filename, packageName, ctxTags, actor } = opts;
  // A collaborator (cross-company partner_user) OFFERS content up — it lands DRAFT for the company
  // to review before it's reuse-eligible, mirroring the capture path. Company staff uploads stay
  // approved. (selectForSection only pulls status='approved', so draft = not-yet-reusable.)
  const status = actor.kind === 'collaborator' ? 'draft' : 'approved';
  const plan = await planDocumentAtomization({ buffer, filename, ctxTags });
  if (plan.error) return { file: filename, format: plan.format, atoms: 0, skipped: plan.skipped, cocoonId: null, error: plan.error };

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
      grain: 'reference', title: filename, content: plan.fullText || null, canvasNodes: plan.allNodes.length ? plan.allNodes : null,
      summary: `Uploaded ${plan.format} · ${plan.parsedCount} objects${packageName ? ` · ${packageName}` : ''}`,
      source: 'upload', status, cocoonId,
      tags: [{ dimension: 'fmt', value: plan.fmt, source: 'auto', confirmed: true }, ...ctxTags],
    }, actor);
    referenceId = ref.atomId;
  } catch (e) { console.error('[atomize-package] reference atom failed (non-fatal)', e); }

  // 3) Create each planned primitive (tagged + anchored back to the reference).
  let made = 0;
  for (const p of plan.planned) {
    try {
      await createAtom(tenantId, {
        grain: 'primitive',
        title: p.title,
        content: p.content, canvasNodes: p.nodes.length ? p.nodes : null,
        summary: null, source: 'upload', status, cocoonId,
        sourceAnchor: referenceId ? [{ sourceAtomId: referenceId, blockIds: [`b${p.blockIndex}`] }] : undefined,
        tags: p.tags,
      }, actor);
      made++;
    } catch (e) { console.error('[atomize-package] primitive create failed', filename, p.blockIndex, e); }
  }
  return { file: filename, format: plan.format, atoms: made, skipped: plan.skipped, cocoonId, reference: !!referenceId };
}
