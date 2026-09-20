/**
 * WHICH LINKS ON THIS PAGE ARE THE SOLICITATION'S DOCUMENTS?
 *
 * Pure, DB-free, network-free, so it is unit-testable without a fixture server — the same split
 * `lib/scout/classify.ts` makes between the decision and its database wrapper.
 *
 * ── THE PROBLEM IS PRECISION, NOT RECALL ───────────────────────────────────────────────────────
 * An agency solicitation page is mostly navigation. A permissive extractor returns the privacy
 * policy, the accessibility statement, a "download Acrobat Reader" link and the agency's annual
 * report — and every one of those then gets fetched, hashed, stored, and offered to a curator as
 * a document belonging to this opportunity. Noise here is not untidy; it is a queue nobody reads.
 *
 * So the rule is: a link is a document when its EXTENSION says so, or when its surrounding text
 * says so and the URL is at least plausible. Everything else is skipped, and skipping is silent
 * because a page has hundreds of links and reporting each one would drown the finding.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────────────────────────
 * It does not parse HTML into a DOM. A regex over anchors is enough for the one question asked
 * here, and a DOM parser is a dependency plus an attack surface for pages nobody here wrote. It
 * also does not follow anything: the harvester decides what to fetch, this only says what is
 * worth considering.
 *
 * ⚠️ EVERY STRING HERE IS UNTRUSTED. It comes from a page the product did not write. Nothing is
 * evaluated, interpreted, or used to build a filesystem path — a filename is carried as data and
 * sanitised at the storage boundary, not here.
 */

/** Extensions that ARE a document, whatever the link text says. */
const DOC_EXT = /\.(pdf|docx?|xlsx?|pptx?|zip|txt|rtf|csv)(?:$|[?#])/i;

/**
 * Link text that means "this is the solicitation" even when the href has no extension — agency
 * portals very often serve a download through a query string or an opaque id.
 *
 * Deliberately short. Each entry is a phrase that would be strange on a navigation link, which is
 * what keeps a privacy policy out: "download" alone is not here, because "Download Acrobat" is a
 * real link on real agency pages.
 */
const DOC_TEXT = /\b(solicitation|announcement|attachment|amendment|instructions?|q\s*&\s*a|questions? and answers?|statement of work|sow|pws|rfp|rfi|baa|broad agency|topic(?:s)? document|full text|package)\b/i;

/** Paths that are navigation on essentially every government site. */
const CHROME = /\/(privacy|accessibility|foia|no-?fear|usa\.gov|sitemap|contact|help|login|sign-?in|search|rss|feedback)\b/i;

export interface ExtractedLink {
  /** Absolute URL. */
  url: string;
  /** The anchor's visible text, trimmed — what a person would have clicked. */
  text: string;
  /** Why this link was kept: the honest half of the record. */
  reason: 'extension' | 'link-text';
}

/**
 * Decode the entity escapes an HTML ATTRIBUTE carries.
 *
 * ⚠️ NOT COSMETIC — this was a real defect, caught by the harvest drive on its first run.
 * `&amp;` is the CORRECT encoding for `&` inside an attribute, so a perfectly ordinary agency link
 *
 *     <a href="/download?doc=qa&amp;rev=3">
 *
 * yielded the URL `…?doc=qa&amp;rev=3` — a query string with a literal parameter named `amp;rev`.
 * The fetch then 404s or returns the wrong document, and the failure looks like the agency's, not
 * ours. Entity-encoded ampersands are the norm in hand-authored and CMS-generated markup alike, so
 * this would have mis-fetched a large share of every page harvested.
 */
function decodeAttr(raw: string): string {
  return raw
    .replace(/&amp;/gi, '&')
    .replace(/&#0*38;/g, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*34;/g, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#0*39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

/** Collapse entity escapes and whitespace in anchor text. A label is prose, not markup. */
function cleanText(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve against the page's own URL, and REFUSE anything that is not http(s).
 *
 * `javascript:`, `data:` and `mailto:` all appear in real anchors. A harvester that resolved them
 * would be handing a fetcher a scheme it was never meant to see; returning null here means the
 * decision is made once, in the pure layer, rather than trusted to every caller.
 */
function absolutize(href: string, pageUrl: string): string | null {
  const h = decodeAttr(href).trim();
  if (!h || h.startsWith('#')) return null;
  try {
    const u = new URL(h, pageUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Every anchor on the page that looks like a document, de-duplicated by URL.
 *
 * Order is preserved — the first link to a file is usually the primary one, and a caller applying
 * a cap should keep the top of the page rather than an arbitrary slice.
 */
export function extractDocumentLinks(html: string, pageUrl: string): ExtractedLink[] {
  const out: ExtractedLink[] = [];
  const seen = new Set<string>();

  // `<a ... href="..." ...>text</a>`, tolerant of attribute order, single/double/unquoted quotes,
  // and nested markup inside the label.
  const anchor = /<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))[^>]*>([\s\S]*?)<\/a>/gi;

  for (const m of html.matchAll(anchor)) {
    const href = m[1] ?? m[2] ?? m[3] ?? '';
    const text = cleanText(m[4] ?? '');
    const url = absolutize(href, pageUrl);
    if (!url) continue;
    if (seen.has(url)) continue;

    const byExt = DOC_EXT.test(url);
    // Chrome is skipped only when the extension does NOT vouch for it: a genuine
    // `/help/attachment-A.pdf` is a document that happens to live under a help path.
    if (!byExt && CHROME.test(url)) continue;

    const byText = !byExt && DOC_TEXT.test(text);
    if (!byExt && !byText) continue;

    seen.add(url);
    out.push({ url, text, reason: byExt ? 'extension' : 'link-text' });
  }

  return out;
}

/**
 * The filename a document should be recorded under.
 *
 * Preference order is deliberate: what the SERVER called it beats what the URL says, because a
 * `Content-Disposition` is an explicit statement and a URL path is an accident of routing. The
 * link text is the last resort and is never preferred — "Click here" is a common anchor.
 *
 * ⚠️ THE RESULT IS A NAME, NOT A PATH. Every separator is stripped, so a server that answers
 * `filename="../../etc/passwd"` yields `etcpasswd` and not a traversal. This is the one place that
 * matters, because the name reaches object storage.
 */
export function documentFilename(opts: {
  contentDisposition?: string | null;
  url: string;
  linkText?: string | null;
}): string {
  const fromDisposition = (() => {
    const cd = opts.contentDisposition ?? '';
    // RFC 5987 `filename*=UTF-8''name.pdf` first — it is the one that carries non-ASCII correctly.
    const star = cd.match(/filename\*\s*=\s*[^']*''([^;]+)/i);
    if (star) { try { return decodeURIComponent(star[1]); } catch { return star[1]; } }
    const plain = cd.match(/filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/i);
    return plain ? (plain[1] ?? plain[2] ?? '').trim() : '';
  })();

  const fromUrl = (() => {
    try {
      const p = new URL(opts.url).pathname;
      return decodeURIComponent(p.split('/').filter(Boolean).pop() ?? '');
    } catch { return ''; }
  })();

  const raw = fromDisposition || fromUrl || (opts.linkText ?? '').trim() || 'document';
  const safe = raw
    .replace(/[\\/]/g, '')          // no separators — a name, never a path
    .replace(/\.\.+/g, '.')          // no traversal dots
    .replace(/[\u0000-\u001f]/g, '') // no control characters
    // ── and no LEADING dot ──────────────────────────────────────────────────────────────────
    // Stripping separators first turns `../../etc/passwd` into `....etcpasswd`, which the dot
    // collapse above then makes `.etcpasswd`. That is already safe — no separator, no traversal —
    // but it is a HIDDEN file, and a harvested document that does not appear in an ordinary
    // listing is a bad thing to have created on a server's say-so. The test asserted the tidier
    // name before the code produced it, and the code was the one that was wrong.
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 180);
  return safe || 'document';
}
