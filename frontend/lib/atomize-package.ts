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
import { randomUUID } from 'crypto';
import { detectDsipFromBlocks, volumeOfBlock, detectDsipProposal, volumeOfOffset, detectDsipFromPages, volumeOfPage } from '@/lib/library/dsip-deconstruct';
import { stripDocumentFurniture } from '@/lib/library/page-furniture';

export const MAX_FILES = 20; // a real DSIP package = Full_Proposal + ~13 sidecars
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

export interface DocAtomizeResult { file: string; format: string; atoms: number; skipped?: number; cocoonId: string | null; reference?: boolean; error?: string; volumes?: number }

/** One primitive atom the plan proposes to mint (pre-write). */
export interface PlannedAtom { blockIndex: number; title: string; wordCount: number; content: string; nodes: CanvasNode[]; tags: AtomTagInput[]; volumeNumber?: number }
/** One DSIP volume the deconstruct plan proposes as a FOUNDATION document. */
export interface PlannedVolume { volumeNumber: number; volumeName: string; volKey: string | null; markerExcerpt: string; text: string; wordCount: number; blockCount: number; pageStart?: number; pageEnd?: number; inferred?: boolean }
/** The dry-run plan for one document — exactly what atomize WOULD create, computed with NO DB write. */
export interface DocPlan { file: string; format: string; fmt: string; fullText: string; allNodes: CanvasNode[]; parsedCount: number; planned: PlannedAtom[]; skipped: number; error?: string; unextractable?: UnextractableSignal; dsip?: { volumes: PlannedVolume[] };
  /** Running header/footer lines removed from every page before atomizing — surfaced so the
   *  curator sees what was dropped instead of text vanishing silently. */
  strippedFurniture?: string[] }

/**
 * Parse + segment one document into the primitives it WOULD atomize into — with NO DB
 * writes. This is the shared brain behind BOTH the preview (dry-run) and the commit
 * (`atomizeDocumentIntoLibrary`), so what a user previews is exactly what gets created.
 * Pure aside from the parse, so it is unit-testable and drivable in a harness.
 */
export async function planDocumentAtomization(
  opts: { buffer: Buffer; filename: string; ctxTags: AtomTagInput[]; docType?: string | null },
): Promise<DocPlan> {
  const { buffer, filename, ctxTags, docType } = opts;
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
  // Per-block cleaned texts — the units the DSIP volume segmenter runs over (block
  // headings carry the volume separators; the reader space-joins node text, so char-level
  // line anchoring would miss markers that block mode catches).
  const blockTexts = parsed.atoms.map((a) => cleanText(textOfNodes(a.nodes)));
  const fullText = blockTexts.join('\n\n');

  // DSIP full-proposal deconstruct: the uploader declared a complete past proposal
  // (docType='past_proposal'), or a PDF auto-detects as one (strict threshold — see
  // lib/library/dsip-deconstruct.ts). Each detected volume becomes a FOUNDATION document
  // and every primitive inside it carries that volume's canonical vol tag. TWO detection
  // passes: BLOCK mode over the reader's heading-grouped structure, then TEXT mode over
  // the raw joined text — a flat PDF read (one giant block, newlines intact inside its
  // node) carries its volume separators as LINES, invisible to block mode.
  const declared = (docType ?? '').toLowerCase() === 'past_proposal';
  const tryDsip = declared || parsed.sourceFormat === 'pdf';
  // PAGE mode first: a REAL DSIP merge has no volume banners — its anatomy lives in the
  // page heads (cover sheet p1 · cost-form head · CCR head · tech-doc furniture), which
  // the reader's "-- N of M --" separators expose. Banner-based block/text modes remain
  // as fallbacks for synthetic or re-typeset merges.
  const dsipPages = tryDsip && parsed.sourceFormat === 'pdf'
    ? detectDsipFromPages(fullText)
    : { isDsipProposal: false as const, pages: [] as string[], segments: [], distinctVolumes: 0 };
  const dsipBlocks = tryDsip && !dsipPages.isDsipProposal
    ? detectDsipFromBlocks(parsed.atoms.map((a, i) => ({ heading: a.headingText, text: blockTexts[i] })), { declared })
    : { isDsipProposal: false as const, segments: [], distinctVolumes: 0 };
  const dsipText = tryDsip && !dsipPages.isDsipProposal && !dsipBlocks.isDsipProposal
    ? detectDsipProposal(fullText, { declared })
    : { isDsipProposal: false as const, segments: [], distinctVolumes: 0 };
  // Block char offsets into fullText — maps text-mode segments back onto reader blocks.
  const blockOffsets: number[] = [];
  { let off = 0; for (const t of blockTexts) { blockOffsets.push(off); off += t.length + 2; } }
  const volumeOfBlockIndex = (i: number): { volumeNumber: number; volKey: string | null } | null => {
    if (dsipBlocks.isDsipProposal) {
      const s = volumeOfBlock(dsipBlocks.segments, i);
      return s ? { volumeNumber: s.volumeNumber, volKey: s.volKey } : null;
    }
    if (dsipText.isDsipProposal) {
      const s = volumeOfOffset(dsipText.segments, blockOffsets[i]);
      return s ? { volumeNumber: s.volumeNumber, volKey: s.volKey } : null;
    }
    return null;
  };
  // Flat read + text-mode hit: the reader produced no usable structure (≤2 blocks), so the
  // deconstructor owns the granularity — per-volume paragraph primitives replace the one
  // giant block (which still lands whole as the reference atom's content).
  const flatDeconstruct = dsipText.isDsipProposal && parsed.atoms.length <= 2;
  const paraNode = (text: string): CanvasNode => ({
    id: randomUUID(), type: 'text_block', content: { text }, style: {},
    provenance: { source: 'imported' }, history: [], library_eligible: true,
  } as unknown as CanvasNode);

  const planned: PlannedAtom[] = [];
  let skipped = 0; // substantive-looking blocks dropped for being under MIN_ATOM_WORDS — surfaced, not silent.
  let strippedFurniture: string[] = []; // running header/footer removed — reported, never silent.
  if (dsipPages.isDsipProposal) {
    // Page-grain primitives: one atom per PAGE, cited by its page number and tagged with
    // its volume — deterministic units that spread the atom budget across ALL volumes
    // (paragraph-guessing on extraction text let Volume 1 exhaust the cap).
    //
    // Strip the running header/footer FIRST. A page's extracted text includes whatever the word
    // processor repeats on every page, and on a DSIP submission that is the SOURCE solicitation's
    // identifiers ("Topic: X23.5_CSO   Proposal Number: FX235-CSO1-0859"). Kept, they are welded
    // into every atom from the document, and a section grounded on those atoms cites a different
    // agency's topic number in the new proposal — observed verbatim on the T3CP build. Detection
    // is repetition-based, so it holds for footers we have never seen.
    const furniturePass = stripDocumentFurniture(dsipPages.pages);
    if (furniturePass.furniture.length) {
      strippedFurniture = furniturePass.furniture;
    }
    for (let pg = 1; pg <= furniturePass.pages.length && planned.length < MAX_ATOMS_PER_DOC; pg++) {
      const pageText = cleanText(furniturePass.pages[pg - 1] ?? '').trim();
      const words = pageText ? pageText.split(/\s+/).length : 0;
      if (!pageText || words < MIN_ATOM_WORDS) { if (pageText) skipped++; continue; }
      const seg = volumeOfPage(dsipPages.segments, pg);
      planned.push({
        blockIndex: pg,
        title: `p${pg} · ${pageText.slice(0, 54)}`.slice(0, 120),
        wordCount: words,
        content: pageText,
        nodes: [paraNode(pageText)],
        tags: [
          { dimension: 'kind', value: 'narrative', source: 'auto', confirmed: false },
          { dimension: 'fmt', value: fmt, source: 'auto', confirmed: false },
          ...(seg?.volKey ? [{ dimension: 'vol', value: seg.volKey, source: 'auto' as const, confirmed: !seg.inferred }] : []),
          ...ctxTags,
        ],
        ...(seg ? { volumeNumber: seg.volumeNumber } : {}),
      });
    }
  } else if (flatDeconstruct) {
    let synthIndex = 0;
    for (const seg of dsipText.segments) {
      const volText = fullText.slice(seg.startOffset, seg.endOffset).trim();
      for (const para of volText.split(/\n{2,}|\n(?=\S)/).map((x) => x.trim()).filter(Boolean)) {
        if (planned.length >= MAX_ATOMS_PER_DOC) break;
        const words = para.split(/\s+/).length;
        if (words < MIN_ATOM_WORDS) { skipped++; continue; }
        planned.push({
          blockIndex: synthIndex++,
          title: para.slice(0, 60),
          wordCount: words,
          content: para,
          nodes: [paraNode(para)],
          tags: [
            { dimension: 'kind', value: 'narrative', source: 'auto', confirmed: false },
            { dimension: 'fmt', value: fmt, source: 'auto', confirmed: false },
            ...(seg.volKey ? [{ dimension: 'vol', value: seg.volKey, source: 'auto' as const, confirmed: true }] : []),
            ...ctxTags,
          ],
          volumeNumber: seg.volumeNumber,
        });
      }
    }
  } else {
    for (let i = 0; i < parsed.atoms.length && planned.length < MAX_ATOMS_PER_DOC; i++) {
      const a = parsed.atoms[i];
      const text = blockTexts[i].trim();
      const words = text ? text.split(/\s+/).length : 0;
      if (!text || words < MIN_ATOM_WORDS) { if (text) skipped++; continue; }
      const segment = volumeOfBlockIndex(i);
      const vol = segment?.volKey ?? CATEGORY_TO_VOL[a.suggestedCategory];
      const kind = CATEGORY_TO_KIND[a.suggestedCategory] ?? 'narrative';
      // Machine-guessed tags land UNconfirmed (a human confirms in the Library) — so auto guesses
      // don't masquerade as reviewed. The uploader's own context tags (ctxTags) keep their setting.
      // EXCEPTION: a DSIP segment's vol is READ from the document's own volume separator
      // (deterministic + cited, pattern_match-grade per docs/INGEST_PROVENANCE.md) → confirmed.
      const tags: AtomTagInput[] = [
        { dimension: 'kind', value: kind, source: 'auto', confirmed: false },
        { dimension: 'fmt', value: fmt, source: 'auto', confirmed: false },
        ...(vol ? [{ dimension: 'vol', value: vol, source: 'auto' as const, confirmed: !!segment?.volKey }] : []),
        ...ctxTags,
      ];
      planned.push({
        blockIndex: i,
        title: cleanText(a.headingText || text.slice(0, 60)).slice(0, 120),
        wordCount: words,
        content: text,
        nodes: a.nodes.length ? cleanNodes(a.nodes as CanvasNode[]) : [],
        tags,
        ...(segment ? { volumeNumber: segment.volumeNumber } : {}),
      });
    }
  }

  const plan: DocPlan = { file: filename, format: parsed.sourceFormat, fmt, fullText, allNodes, parsedCount: parsed.atoms.length, planned, skipped, unextractable: parsed.unextractable, ...(strippedFurniture.length ? { strippedFurniture } : {}) };
  if (dsipPages.isDsipProposal) {
    plan.dsip = {
      volumes: dsipPages.segments.map((s) => {
        const text = dsipPages.pages.slice(s.pageStart - 1, s.pageEnd).join('\n\n').trim();
        return {
          volumeNumber: s.volumeNumber, volumeName: s.volumeName, volKey: s.volKey, markerExcerpt: s.markerExcerpt,
          text, wordCount: text ? text.split(/\s+/).length : 0,
          blockCount: planned.filter((p) => p.volumeNumber === s.volumeNumber).length,
          pageStart: s.pageStart, pageEnd: s.pageEnd, inferred: s.inferred,
        };
      }),
    };
  } else if (dsipBlocks.isDsipProposal) {
    plan.dsip = {
      volumes: dsipBlocks.segments.map((s) => {
        const text = blockTexts.slice(s.blockStart, s.blockEnd).join('\n\n').trim();
        return {
          volumeNumber: s.volumeNumber, volumeName: s.volumeName, volKey: s.volKey, markerExcerpt: s.markerExcerpt,
          text, wordCount: text ? text.split(/\s+/).length : 0,
          blockCount: planned.filter((p) => p.volumeNumber === s.volumeNumber).length,
        };
      }),
    };
  } else if (dsipText.isDsipProposal) {
    plan.dsip = {
      volumes: dsipText.segments.map((s) => {
        const text = fullText.slice(s.startOffset, s.endOffset).trim();
        return {
          volumeNumber: s.volumeNumber, volumeName: s.volumeName, volKey: s.volKey, markerExcerpt: s.markerExcerpt,
          text, wordCount: text ? text.split(/\s+/).length : 0,
          blockCount: planned.filter((p) => p.volumeNumber === s.volumeNumber).length,
        };
      }),
    };
  }
  return plan;
}

/**
 * Atomize a single uploaded document into the library. Best-effort per step —
 * a cocoon/reference failure never aborts the primitives; returns a per-doc summary.
 * Segments via `planDocumentAtomization`, so the write matches the preview exactly.
 */
export async function atomizeDocumentIntoLibrary(
  tenantId: string,
  opts: {
    buffer: Buffer; filename: string; packageName?: string; ctxTags: AtomTagInput[];
    actor: { id: string; kind: CreatorKind }; docType?: string | null;
    /** Join an EXISTING package cocoon (DSIP sidecars ride the Full_Proposal's cocoon). */
    sharedCocoonId?: string | null;
    /** Deterministic volume assignment from DSIP's own filename taxonomy. */
    volHint?: { volumeNumber: number; volKey: string; label: string } | null;
  },
): Promise<DocAtomizeResult> {
  const { buffer, filename, packageName, ctxTags, actor, docType, sharedCocoonId, volHint } = opts;
  // A collaborator (cross-company partner_user) OFFERS content up — it lands DRAFT for the company
  // to review before it's reuse-eligible, mirroring the capture path. Company staff uploads stay
  // approved. (selectForSection only pulls status='approved', so draft = not-yet-reusable.)
  const status = actor.kind === 'collaborator' ? 'draft' : 'approved';
  const plan = await planDocumentAtomization({ buffer, filename, ctxTags, docType });
  if (plan.error) return { file: filename, format: plan.format, atoms: 0, skipped: plan.skipped, cocoonId: null, error: plan.error };

  // Sidecar vol tag: DSIP's filename taxonomy is deterministic → confirmed.
  const hintTags: AtomTagInput[] = volHint
    ? [{ dimension: 'vol', value: volHint.volKey, source: 'auto', confirmed: true }]
    : [];

  // 1) Foundational document cocoon. For a DSIP full-proposal deconstruct, THIS id is the
  //    shared past-proposal UUID: every volume foundation doc and every primitive links to
  //    it, and the structure records the volume map (the reverse of the pipeline build-up).
  //    A sidecar JOINS the package cocoon instead of minting its own.
  let cocoonId: string | null = sharedCocoonId ?? null;
  if (!cocoonId) try {
    const structure = plan.dsip
      ? {
          dsip: {
            sourceFile: filename,
            volumes: plan.dsip.volumes.map((v) => ({
              volume: v.volumeNumber, name: v.volumeName, vol: v.volKey,
              words: v.wordCount, marker: v.markerExcerpt,
            })),
          },
        }
      : {};
    const [row] = await withTenant<Array<{ id: string }>>(tenantId, async (tx) =>
      tx`INSERT INTO document_cocoons (tenant_id, name, scope, source, structure)
         VALUES (${tenantId}::uuid, ${packageName ? `${packageName} — ${filename}` : filename}, 'document', 'upload', ${tx.json(structure)})
         RETURNING id`);
    cocoonId = row?.id ?? null;
  } catch (e) { console.error('[atomize-package] cocoon insert failed (non-fatal)', e); }

  // 2) Reference atom for the whole doc.
  let referenceId: string | null = null;
  try {
    const ref = await createAtom(tenantId, {
      grain: 'reference', title: filename, content: plan.fullText || null, canvasNodes: plan.allNodes.length ? plan.allNodes : null,
      summary: `${volHint ? `${volHint.label} (Volume ${volHint.volumeNumber} sidecar) · ` : ''}Uploaded ${plan.format} · ${plan.parsedCount} objects${packageName ? ` · ${packageName}` : ''}`,
      source: 'upload', status, cocoonId,
      tags: [{ dimension: 'fmt', value: plan.fmt, source: 'auto', confirmed: true }, ...hintTags, ...ctxTags],
    }, actor);
    referenceId = ref.atomId;
  } catch (e) { console.error('[atomize-package] reference atom failed (non-fatal)', e); }

  // 2b) DSIP deconstruct: one FOUNDATION document per detected volume — the Volume 1..5
  //     library documents of the past proposal, all under the same cocoon (proposal UUID),
  //     each citing the marker line it was segmented on.
  const volumeFoundations = new Map<number, string>(); // volumeNumber → atomId
  if (plan.dsip) {
    for (const v of plan.dsip.volumes) {
      try {
        const f = await createAtom(tenantId, {
          grain: 'foundation',
          title: `Volume ${v.volumeNumber} — ${v.volumeName}`,
          content: v.text || null,
          summary: `DSIP past-proposal volume ${v.volumeNumber}${v.pageStart ? ` · pp ${v.pageStart}–${v.pageEnd}` : ''}${v.inferred ? ' · boundary INFERRED — review' : ''} · deconstructed from ${filename} · marker "${v.markerExcerpt}"${packageName ? ` · ${packageName}` : ''}`,
          source: 'upload', status, cocoonId,
          sourceAnchor: referenceId ? [{ sourceAtomId: referenceId }] : undefined,
          tags: [
            ...(v.volKey ? [{ dimension: 'vol', value: v.volKey, source: 'auto' as const, confirmed: true }] : []),
            { dimension: 'fmt', value: plan.fmt, source: 'auto', confirmed: true },
            ...ctxTags,
          ],
        }, actor);
        volumeFoundations.set(v.volumeNumber, f.atomId);
      } catch (e) { console.error('[atomize-package] volume foundation failed', filename, v.volumeNumber, e); }
    }
  }

  // 3) Create each planned primitive (tagged + anchored back to its volume foundation when
  //    the block sits inside a deconstructed DSIP volume, else the whole-doc reference).
  let made = 0;
  for (const p of plan.planned) {
    try {
      const anchorId = (p.volumeNumber != null ? volumeFoundations.get(p.volumeNumber) : undefined) ?? referenceId;
      await createAtom(tenantId, {
        grain: 'primitive',
        title: p.title,
        content: p.content, canvasNodes: p.nodes.length ? p.nodes : null,
        summary: null, source: 'upload', status, cocoonId,
        sourceAnchor: anchorId ? [{ sourceAtomId: anchorId, blockIds: [`b${p.blockIndex}`] }] : undefined,
        tags: [...p.tags, ...hintTags.filter((h) => !p.tags.some((t) => t.dimension === h.dimension))],
      }, actor);
      made++;
    } catch (e) { console.error('[atomize-package] primitive create failed', filename, p.blockIndex, e); }
  }
  return { file: filename, format: plan.format, atoms: made, skipped: plan.skipped, cocoonId, reference: !!referenceId, ...(plan.dsip ? { volumes: volumeFoundations.size } : {}) };
}
