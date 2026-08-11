/**
 * Vision captioning — the drop-in "read what the image SHOWS" engine that complements OCR.
 *
 * OCR (lib/atom-enrich) recovers the TEXT inside a crop; this describes what the crop DEPICTS — a
 * chart, a diagram, a photo, a logo — which OCR can't read. Together they make a boxed image fully
 * searchable + agent-legible. Engine = Claude vision (the platform's trusted, already-installed model
 * `@anthropic-ai/sdk`; model pinned via VISION_MODEL). Direct-to-Anthropic (anthropic.com is in NO_PROXY).
 *
 * GATED: runs only when a real ANTHROPIC_API_KEY is present (absent / `sk-noop` in the sandbox → the
 * enrich pipeline just uses OCR). BEST-EFFORT: any failure yields an empty caption, never throws.
 */
export type VisionEngine = 'vision' | 'none';
export interface VisionResult { caption: string; engine: VisionEngine }

const KEY = process.env.ANTHROPIC_API_KEY;
const VISION_ENABLED = !!KEY && KEY !== 'sk-noop' && process.env.ATOM_VISION !== 'off';
const MODEL = process.env.VISION_MODEL || 'claude-sonnet-4-20250514'; // trusted platform default; overridable
type MediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

/** One-sentence caption of a cropped proposal image, for the reuse library. '' when gated off/failing. */
export async function describeImage(buffer: Buffer, mediaType: MediaType = 'image/png'): Promise<VisionResult> {
  if (!VISION_ENABLED || !buffer?.length) return { caption: '', engine: 'none' };
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk'); // dynamic — matches lib/tools/*
    const client = new Anthropic({ apiKey: KEY });
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      system: 'You caption cropped images from government-proposal documents for a reuse library. Reply with ONE factual sentence naming what the image is (chart / table / diagram / photo / logo) and its key labels, figures, or subject. No preamble, no markdown.',
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: buffer.toString('base64') } },
        { type: 'text', text: 'Caption this image in one sentence for search and reuse.' },
      ] }],
    });
    const block = res.content.find((b) => b.type === 'text');
    const caption = block && block.type === 'text' ? block.text.trim().replace(/\s+/g, ' ').slice(0, 400) : '';
    return { caption, engine: caption ? 'vision' : 'none' };
  } catch (e) {
    console.error('[vision] describeImage failed', e instanceof Error ? e.message : e);
    return { caption: '', engine: 'none' };
  }
}

/** Batch describe (sequential — small N, keeps rate/cost bounded). All 'none' when the engine is gated off. */
export async function describeImages(buffers: Buffer[], mediaType: MediaType = 'image/png'): Promise<VisionResult[]> {
  if (!VISION_ENABLED || buffers.length === 0) return buffers.map(() => ({ caption: '', engine: 'none' }));
  const out: VisionResult[] = [];
  for (const b of buffers) out.push(await describeImage(b, mediaType));
  return out;
}
