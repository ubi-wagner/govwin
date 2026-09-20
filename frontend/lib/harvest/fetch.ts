/**
 * THE ONE PLACE HARVESTING REACHES THE OUTSIDE WORLD.
 *
 * Everything the harvester fetches goes through here, for the same reason every outbound email
 * goes through `lib/email`: a second path is a path nobody measures. Never call `fetch()` from the
 * harvest tree directly.
 *
 * ── WHY THERE IS A FIXTURE DRIVER ──────────────────────────────────────────────────────────────
 * This box cannot reach a solicitation site. Measured, not assumed:
 *
 *     curl https://sam.gov              → 000
 *     curl https://www.dodsbirsttr.mil  → 000
 *
 * The environment's network policy refuses them. So a harvester with only a live driver would be
 * code that has never once run end to end here — and "it compiles" is the weakest rung this repo
 * recognises. The answer is the one the codebase already uses for the Claude API: a committed
 * stand-in that exercises the real path with no live dependency (`EMULATE=1` → the :8787 harness,
 * docs/AI_FLOWS_PROOF.md). `HARVEST_DRIVER=fixture` is that, for HTTP.
 *
 * ── AND WHY THE DRIVER IS STAMPED ON EVERY ROW ─────────────────────────────────────────────────
 * `scout_finding_documents.harvest_driver` is NOT NULL with no default, and this module is why. A
 * document that came from a committed fixture MUST NOT be indistinguishable from one fetched off
 * an agency server, or every later claim about "the same file appears on two sites" rests on
 * bytes this repo wrote itself. That is the ingest-provenance rule of this codebase
 * (docs/INGEST_PROVENANCE.md) applied one layer earlier: *a value the product did not read from
 * the source must never look like one it did.*
 *
 * ── THE BOUNDS ARE PART OF THE CONTRACT ────────────────────────────────────────────────────────
 * Fetching is driven by URLs found on a page nobody here wrote, so every limit below is a refusal
 * this module owns rather than a hope about what agencies publish: a per-request timeout, a
 * maximum body size enforced WHILE STREAMING (a `Content-Length` is a claim, not a fact), a
 * redirect cap, and http(s) only.
 */
import fs from 'node:fs';
import path from 'node:path';

export type HarvestDriver = 'live' | 'fixture';

/**
 * Which driver is in force.
 *
 * DEFAULTS TO `fixture`, and that is deliberate for a capability this young: the failure mode of
 * defaulting to `live` is a background job quietly reaching out to government servers from
 * whatever machine happens to run it. Production sets `HARVEST_DRIVER=live` explicitly, the same
 * way `EMAIL_DRIVER` is set explicitly rather than inferred.
 */
export function harvestDriver(): HarvestDriver {
  return process.env.HARVEST_DRIVER === 'live' ? 'live' : 'fixture';
}

export interface FetchResult {
  ok: boolean;
  status: number;
  contentType: string | null;
  contentDisposition: string | null;
  body: Buffer;
  /** Where the bytes really came from — carried so a caller cannot forget to record it. */
  driver: HarvestDriver;
  /** Set when the fetch did not produce bytes. A failure is a value, not a throw. */
  error?: string;
}

export interface FetchOptions {
  /** Hard ceiling on the body, enforced while streaming. */
  maxBytes?: number;
  timeoutMs?: number;
}

const DEFAULT_MAX_BYTES = 40 * 1024 * 1024;   // 40 MB — the DoW SBIR set's largest is ~21 MB
const DEFAULT_TIMEOUT_MS = 30_000;

/** Where the fixture driver reads from. A directory of saved pages and documents. */
export function fixtureRoot(): string {
  return process.env.HARVEST_FIXTURE_DIR
    ?? path.join(process.cwd(), 'scripts/fixtures/harvest');
}

/**
 * A URL → a path under the fixture root.
 *
 * The mapping is `host/pathname`, so a fixture is findable by eye from the URL it stands for, and
 * a new one is added by saving a file rather than by editing a registry. A query string becomes
 * part of the leaf so two downloads that differ only by `?id=` do not collide.
 *
 * ⚠️ Every segment is sanitised: the URL is untrusted, and this builds a filesystem path.
 */
export function fixturePathFor(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 120);
  const segs = u.pathname.split('/').filter(Boolean).map(safe);
  const leaf = (segs.pop() ?? 'index') + (u.search ? `__${safe(u.search)}` : '');
  return path.join(fixtureRoot(), safe(u.host), ...segs, leaf || 'index');
}

function guessContentType(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.html' || ext === '.htm') return 'text/html; charset=utf-8';
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === '.zip') return 'application/zip';
  if (ext === '.txt') return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

/**
 * Fetch a URL through the driver in force. NEVER throws: a harvest that dies on one bad link
 * loses the whole page, and the failure is exactly what the row's `error` column is for.
 */
export async function harvestFetch(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const driver = harvestDriver();
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const empty = { contentType: null, contentDisposition: null, body: Buffer.alloc(0), driver };

  let parsed: URL;
  try { parsed = new URL(url); } catch {
    return { ok: false, status: 0, ...empty, error: 'not a URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, status: 0, ...empty, error: `refused scheme ${parsed.protocol}` };
  }

  if (driver === 'fixture') {
    const p = fixturePathFor(url);
    if (!p || !fs.existsSync(p)) {
      // A MISS IS A 404, not a throw and not a silent skip. The fixture corpus standing in for the
      // internet has to be able to say "that page is not here" in the same shape the internet does.
      return { ok: false, status: 404, ...empty, error: 'no fixture for this URL' };
    }
    try {
      const body = fs.readFileSync(p);
      if (body.byteLength > maxBytes) {
        return { ok: false, status: 0, ...empty, error: `fixture exceeds maxBytes (${body.byteLength})` };
      }
      return {
        ok: true, status: 200, driver, body,
        contentType: guessContentType(p),
        contentDisposition: null,
      };
    } catch (e) {
      return { ok: false, status: 0, ...empty, error: `fixture read failed: ${String(e).slice(0, 120)}` };
    }
  }

  // ── live ─────────────────────────────────────────────────────────────────────────────────
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: {
        // Identify honestly. A crawler that hides what it is cannot be asked to stop.
        'user-agent': 'RFPPipelineHarvester/1.0 (+https://rfppipeline.com/robots)',
        accept: '*/*',
      },
    });

    const contentType = res.headers.get('content-type');
    const contentDisposition = res.headers.get('content-disposition');
    if (!res.ok) {
      return {
        ok: false, status: res.status, contentType, contentDisposition,
        body: Buffer.alloc(0), driver, error: `http ${res.status}`,
      };
    }

    // SIZE IS ENFORCED WHILE READING. `Content-Length` is a claim by a server nobody here controls,
    // and a missing or lying one is the difference between a bounded fetch and an unbounded one.
    const reader = res.body?.getReader();
    if (!reader) {
      return { ok: false, status: res.status, contentType, contentDisposition, body: Buffer.alloc(0), driver, error: 'no body' };
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return {
          ok: false, status: res.status, contentType, contentDisposition,
          body: Buffer.alloc(0), driver, error: `body exceeded ${maxBytes} bytes`,
        };
      }
      chunks.push(Buffer.from(value));
    }
    return { ok: true, status: res.status, contentType, contentDisposition, body: Buffer.concat(chunks), driver };
  } catch (e) {
    const msg = String((e as Error)?.name === 'AbortError' ? 'timed out' : e).slice(0, 160);
    return { ok: false, status: 0, ...empty, error: msg };
  } finally {
    clearTimeout(timer);
  }
}
