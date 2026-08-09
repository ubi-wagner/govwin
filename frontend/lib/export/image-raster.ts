/**
 * Shared image rasterizer for the export engines.
 *
 * The canvas model stores generated figures as `data:` URIs — almost always
 * inline SVG (architecture diagrams, charts, headshot/facility placeholders).
 * The PDF path renders those natively in HTML, but PowerPoint (.pptx) and Word
 * (.docx) need a raster bitmap. This turns any `data:` URI (SVG or raster) into
 * a PNG data-URI plus its intrinsic pixel size, so the exporters can embed a
 * real picture and size it to the right aspect ratio.
 *
 * Best-effort: returns null on a non-data URI or any decode/render failure, so
 * callers fall back to a text placeholder rather than throwing an export.
 */
import sharp from 'sharp';
import { getObjectBuffer } from '@/lib/storage/s3-client';
import type { CanvasDocument, CanvasNode } from '@/lib/types/canvas-document';

const EXT_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
};

/**
 * Resolve an image node's stored reference to a `data:` URI the rasterizer can embed.
 * Generated figures (charts/diagrams/placeholders) are already `data:` URIs — returned as-is.
 * UPLOADED images are S3 storage keys (`customers/<slug>/images/…`): fetch the bytes and inline
 * them so a customer's logo / screenshots SURVIVE the download instead of exporting as a
 * "[Image: …]" text stub (the G3 bug). Returns null on a missing key or fetch failure, so the
 * caller falls back to the stub rather than throwing the whole export.
 */
export async function resolveImageDataUri(keyOrUri: string | null | undefined): Promise<string | null> {
  if (!keyOrUri) return null;
  if (keyOrUri.startsWith('data:')) return keyOrUri;
  try {
    const buf = await getObjectBuffer(keyOrUri);
    if (!buf || buf.length === 0) return null;
    const ext = keyOrUri.split('.').pop()?.toLowerCase() ?? 'png';
    const mime = EXT_MIME[ext] ?? 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

export interface RasterPng {
  /** `data:image/png;base64,…` — ready for pptxgenjs addImage / docx ImageRun. */
  dataUri: string;
  /** Raw PNG bytes (docx ImageRun wants a Buffer). */
  buffer: Buffer;
  /** Intrinsic pixel dimensions (for aspect-ratio-correct placement). */
  width: number;
  height: number;
}

/**
 * Rasterize a `data:` URI to PNG. SVGs are rendered at `scale`× density for
 * crispness (the intrinsic aspect ratio is preserved regardless). Returns null
 * for anything that isn't a decodable data URI.
 */
export async function rasterizeDataUri(
  uri: string | null | undefined,
  opts: { scale?: number } = {},
): Promise<RasterPng | null> {
  if (!uri || !uri.startsWith('data:')) return null;
  const comma = uri.indexOf(',');
  if (comma < 0) return null;
  try {
    const header = uri.slice(5, comma); // e.g. "image/svg+xml;base64"
    const payload = uri.slice(comma + 1);
    let bytes = header.includes(';base64')
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8');

    // SVG robustness: browsers accept a raw `&` in text (e.g. "AI & ML"), but the
    // strict libxml parser sharp uses rejects it as a bad entity. Escape bare
    // ampersands that aren't already a valid entity so real-world SVGs rasterize.
    if (header.includes('svg')) {
      const txt = bytes.toString('utf8').replace(/&(?!(?:[a-zA-Z][\w.-]*|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');
      bytes = Buffer.from(txt, 'utf8');
    }

    const scale = opts.scale ?? 2.5; // 2.5× → crisp when the slide scales it down
    // density only affects vector (SVG) inputs; raster inputs ignore it.
    const png = await sharp(bytes, { density: Math.round(72 * scale) }).png().toBuffer();
    const meta = await sharp(png).metadata();
    return {
      dataUri: 'data:image/png;base64,' + png.toString('base64'),
      buffer: png,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
    };
  } catch {
    return null;
  }
}

async function inlineImageNode(n: CanvasNode): Promise<CanvasNode> {
  if (n.type !== 'image') return n;
  const key = (n.content as { storage_key?: string })?.storage_key;
  if (!key || key.startsWith('data:')) return n;
  const dataUri = await resolveImageDataUri(key);
  if (!dataUri) return n;
  return { ...n, content: { ...(n.content as Record<string, unknown>), storage_key: dataUri } as CanvasNode['content'] };
}

/**
 * Return a copy of the doc with every image node's storage_key resolved to an inline data: URI —
 * for the HTML/PDF path, whose sync `<img src="…">` render can't fetch an S3 key. Walks both the
 * v1 flat node list and the v2 section→group→node tree. data: URIs and unresolvable keys pass
 * through unchanged (the render then falls back to its own placeholder).
 */
export async function inlineImageDataUris(doc: CanvasDocument): Promise<CanvasDocument> {
  const nodes = Array.isArray(doc.nodes) ? await Promise.all(doc.nodes.map(inlineImageNode)) : doc.nodes;
  let sections = doc.sections;
  if (Array.isArray(doc.sections)) {
    sections = await Promise.all(doc.sections.map(async (s) => ({
      ...s,
      groups: Array.isArray(s.groups)
        ? await Promise.all(s.groups.map(async (g) => ({
            ...g,
            nodes: Array.isArray(g.nodes) ? await Promise.all(g.nodes.map(inlineImageNode)) : g.nodes,
          })))
        : s.groups,
    })));
  }
  return { ...doc, nodes, sections };
}

/** Fit intrinsic (natW×natH) into a (maxW×maxH) box, preserving aspect ratio. */
export function fitBox(
  natW: number,
  natH: number,
  maxW: number,
  maxH: number,
): { w: number; h: number } {
  if (natW <= 0 || natH <= 0) return { w: maxW, h: maxH };
  const aspect = natW / natH;
  let w = maxW;
  let h = w / aspect;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  return { w, h };
}
