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
const FMT_OF: Record<string, string> = { docx: 'doc', pptx: 'slide', pdf: 'doc', txt: 'doc', md: 'doc', xlsx: 'table' };

export const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/**
 * Strip bytes Postgres text/jsonb reject — NUL + other C0 control chars (except tab /
 * newline / CR) and lone UTF-16 surrogates — which malformed PDFs (e.g. Type-3 fonts)
 * emit during extraction. Without this the atom INSERT throws 22021 and the doc is lost.
 */
export function cleanText(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 && c !== 9 && c !== 10 && c !== 13) continue; // drop C0 controls (keep tab/newline/CR)
    if (c >= 0xd800 && c <= 0xdbff) { // high surrogate
      const n = s.charCodeAt(i + 1);
      if (n >= 0xdc00 && n <= 0xdfff) { out += s[i] + s[i + 1]; i++; continue; } // valid pair
      continue; // lone high surrogate
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue; // lone low surrogate
    out += s[i];
  }
  return out;
}
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
  const fullText = cleanText(parsed.atoms.map((a) => textOfNodes(a.nodes)).join('\n\n'));

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
      grain: 'reference', title: filename, content: fullText || null, canvasNodes: allNodes.length ? cleanNodes(allNodes) : null,
      summary: `Uploaded ${parsed.sourceFormat} · ${parsed.atoms.length} objects${packageName ? ` · ${packageName}` : ''}`,
      source: 'upload', status: 'approved', cocoonId,
      tags: [{ dimension: 'fmt', value: fmt, source: 'auto', confirmed: true }, ...ctxTags],
    }, actor);
    referenceId = ref.atomId;
  } catch (e) { console.error('[atomize-package] reference atom failed (non-fatal)', e); }

  // 3) Auto-atomize each substantive block into a tagged, anchored primitive.
  let made = 0;
  let skipped = 0; // substantive-looking blocks dropped for being under MIN_ATOM_WORDS — surfaced, not silent.
  for (let i = 0; i < parsed.atoms.length && made < MAX_ATOMS_PER_DOC; i++) {
    const a = parsed.atoms[i];
    const text = cleanText(textOfNodes(a.nodes)).trim();
    if (!text || text.split(/\s+/).length < MIN_ATOM_WORDS) { if (text) skipped++; continue; }
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
    try {
      await createAtom(tenantId, {
        grain: 'primitive',
        title: cleanText(a.headingText || text.slice(0, 60)).slice(0, 120),
        content: text, canvasNodes: a.nodes.length ? cleanNodes(a.nodes as CanvasNode[]) : null,
        summary: null, source: 'upload', status: 'approved', cocoonId,
        sourceAnchor: referenceId ? [{ sourceAtomId: referenceId, blockIds: [`b${i}`] }] : undefined,
        tags,
      }, actor);
      made++;
    } catch (e) { console.error('[atomize-package] primitive create failed', filename, i, e); }
  }
  return { file: filename, format: parsed.sourceFormat, atoms: made, skipped, cocoonId, reference: !!referenceId };
}
