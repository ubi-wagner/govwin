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
