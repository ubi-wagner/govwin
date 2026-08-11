/**
 * Capture → annotate → atomize (drivable core; the `/atoms/capture` route is a thin
 * wrapper). A screen capture is boxed into regions in the browser (the same box-and-tag
 * interaction as the Atomize tab); each region arrives here as a cropped PNG + tags and
 * becomes a tagged **draft image atom**, anchored to a reference atom for the whole frame
 * — mirroring `atomize-package`'s reference-cocoon + primitives + optional group shape.
 *
 * ONE-WAY by construction: this only reads the blobs the user chose to send and writes
 * INTO the tenant library. It never holds source credentials, opens no connection back to
 * the source, and writes nothing outward. See docs/BROWSER_CAPTURE_RND_DESIGN.md.
 */
import { randomUUID } from 'crypto';
import { createAtom, type AtomTagInput, type CreatorKind } from '@/lib/atoms';
import { withTenant } from '@/lib/rls';
import type { CanvasNode } from '@/lib/types/canvas-document';
import { putObject } from '@/lib/storage/s3-client';
import { customerImagePath } from '@/lib/storage/paths';
import { enrichImages, type Enriched } from '@/lib/atom-enrich';

export const MAX_REGIONS = 24;
export const MAX_CAPTURE_BYTES = 12 * 1024 * 1024; // 12MB per image

export interface CaptureImage {
  buffer: Buffer;
  contentType: string;
  width?: number;
  height?: number;
}
export interface CaptureRegionInput extends CaptureImage {
  title?: string;
  tags?: AtomTagInput[];
}
export interface CaptureInput {
  full?: CaptureImage; // the whole captured frame (kept as the reference atom)
  regions: CaptureRegionInput[]; // the boxed regions → primitive image atoms
  sourceUrl?: string;
  note?: string;
  groupName?: string; // when set, wrap the region atoms into a section group
  ctxTags: AtomTagInput[];
  actor: { id: string; kind: CreatorKind };
}
export interface CaptureResult {
  cocoonId: string | null;
  referenceId: string | null;
  atoms: number;
  groupId: string | null;
  regionIds: string[];
}

const IMG_FMT_TAG: AtomTagInput = { dimension: 'fmt', value: 'image', source: 'auto', confirmed: true };
const IMG_KIND_TAG: AtomTagInput = { dimension: 'kind', value: 'figure', source: 'auto', confirmed: true };

/** A minimal, renderer-compatible image node. The renderer resolves storage_key → signed URL. */
function imageNode(storageKey: string, opts: { alt?: string; caption?: string; width?: number; height?: number }): CanvasNode {
  return {
    id: `img_${randomUUID()}`,
    type: 'image',
    content: {
      storage_key: storageKey,
      alt_text: opts.alt ?? '',
      width: opts.width ?? 1200,
      height: opts.height ?? 800,
      caption: opts.caption,
    },
    style: {},
    provenance: { source: 'imported' },
    history: [],
    library_eligible: true,
  } as unknown as CanvasNode;
}

/** Blob writer — injectable so the atom logic is drivable without reachable object storage. */
export type StoreFn = (tenantSlug: string, img: CaptureImage) => Promise<{ key: string }>;

const defaultStore: StoreFn = async (tenantSlug, img) => {
  const ext = img.contentType.includes('jpeg') ? 'jpg' : 'png';
  const key = customerImagePath(tenantSlug, `capture-${randomUUID()}.${ext}`);
  await putObject({ key, body: img.buffer, contentType: img.contentType });
  return { key };
};

/** Human provenance line stamped into each captured atom's summary. */
function provenanceLine(sourceUrl?: string, note?: string): string {
  const host = (() => { try { return sourceUrl ? new URL(sourceUrl).host : ''; } catch { return sourceUrl ?? ''; } })();
  const parts = ['Screen capture'];
  if (host) parts.push(`from ${host}`);
  parts.push(`· ${new Date().toISOString()}`);
  if (note) parts.push(`· ${note.slice(0, 200)}`);
  return parts.join(' ');
}

export async function atomizeCaptureIntoLibrary(
  tenantId: string,
  tenantSlug: string,
  input: CaptureInput,
  opts?: { store?: StoreFn; enrich?: (buffers: Buffer[]) => Promise<Enriched[]> },
): Promise<CaptureResult> {
  const { full, regions, sourceUrl, note, groupName, ctxTags, actor } = input;
  const doStore = opts?.store ?? defaultStore;
  const doEnrich = opts?.enrich ?? enrichImages;
  const prov = provenanceLine(sourceUrl, note);

  // OCR every region up front (one worker for the whole batch) so each image atom carries searchable,
  // machine-legible text. Best-effort — a failure just leaves the atoms text-less, never aborts.
  let enriched: Enriched[] = regions.map(() => ({ text: '', engine: 'none' }));
  try { enriched = await doEnrich(regions.map((r) => r.buffer)); }
  catch (e) { console.error('[atomize-capture] enrich failed (non-fatal)', e); }

  // 1) Foundational cocoon for this capture.
  let cocoonId: string | null = null;
  try {
    const [row] = await withTenant<Array<{ id: string }>>(tenantId, async (tx) =>
      tx`INSERT INTO document_cocoons (tenant_id, name, scope, source)
         VALUES (${tenantId}::uuid, ${`Screen capture — ${new Date().toISOString()}`}, 'document', 'upload')
         RETURNING id`);
    cocoonId = row?.id ?? null;
  } catch (e) { console.error('[atomize-capture] cocoon insert failed (non-fatal)', e); }

  // 2) Reference atom for the whole frame (kept for anchoring + context).
  let referenceId: string | null = null;
  if (full) {
    try {
      const { key } = await doStore(tenantSlug, full);
      const ref = await createAtom(tenantId, {
        grain: 'reference',
        title: `Screen capture ${sourceUrl ? `(${(() => { try { return new URL(sourceUrl).host; } catch { return sourceUrl; } })()})` : ''}`.trim(),
        content: null,
        canvasNodes: [imageNode(key, { alt: 'screen capture', caption: note, width: full.width, height: full.height })],
        summary: prov,
        source: 'upload',
        status: 'draft',
        cocoonId,
        tags: [IMG_FMT_TAG, ...ctxTags],
      }, actor);
      referenceId = ref.atomId;
    } catch (e) { console.error('[atomize-capture] reference atom failed (non-fatal)', e); }
  }

  // 3) One primitive image atom per boxed region, anchored to the reference.
  const regionIds: string[] = [];
  for (let i = 0; i < regions.length && i < MAX_REGIONS; i++) {
    const r = regions[i];
    try {
      const { key } = await doStore(tenantSlug, r);
      const title = (r.title || `Region ${i + 1}`).slice(0, 120);
      const ocr = enriched[i]?.text ?? ''; // extracted text → searchable (summary) + machine-legible (content)
      const created = await createAtom(tenantId, {
        grain: 'primitive',
        title,
        content: ocr || null,
        canvasNodes: [imageNode(key, { alt: title, caption: r.title, width: r.width, height: r.height })],
        summary: ocr ? `${prov} — ${ocr.slice(0, 200)}` : prov,
        source: 'upload',
        status: 'draft',
        cocoonId,
        sourceAnchor: referenceId ? [{ sourceAtomId: referenceId, region: `r${i}` }] : undefined,
        tags: [IMG_KIND_TAG, IMG_FMT_TAG, ...(r.tags ?? []), ...ctxTags],
      }, actor);
      regionIds.push(created.atomId);
    } catch (e) { console.error('[atomize-capture] region atom failed', i, e); }
  }

  // 4) Optional section group over the region atoms (the Atomizer's "Box section").
  let groupId: string | null = null;
  if (groupName && groupName.trim() && regionIds.length > 0) {
    try {
      const grp = await createAtom(tenantId, {
        grain: 'group',
        title: groupName.trim().slice(0, 120),
        content: null,
        summary: prov,
        source: 'upload',
        status: 'draft',
        cocoonId,
        memberAtomIds: regionIds,
        tags: [IMG_FMT_TAG, ...ctxTags],
      }, actor);
      groupId = grp.atomId;
    } catch (e) { console.error('[atomize-capture] group atom failed (non-fatal)', e); }
  }

  return { cocoonId, referenceId, atoms: regionIds.length, groupId, regionIds };
}
