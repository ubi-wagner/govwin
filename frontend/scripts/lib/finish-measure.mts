/**
 * THE ONE DEFINITION OF "FINISH" — what a customer actually sees, measured from the DOM.
 *
 * ── WHY THIS IS NOT A SQL LENS, AND THE TWO PHANTOMS THAT PROVED IT ──────────────────────────
 * The obvious way to audit customer experience is from the database: find cards past their close
 * date still marked open, find tenants holding opportunities with no ranking lens. Both were tried
 * first, both counted real rows — 21 cards and 6 tenants — and **both were phantom**:
 *
 *   · the cards API says so in its own comment: "the date-derived closure is filtered client-side,
 *     where the badge computes it", and `pipeline-cards.tsx:393` does exactly that;
 *   · `spotlight-buckets.tsx:339` carries an empty state written for precisely that customer,
 *     explaining what a bucket is and stating the fallback so an absence does not read as a loss.
 *
 * Both places were the ones somebody had already thought hardest about. That is the same shape
 * CLAUDE.md records for text-searching a bug pattern: **an instrument aimed at the wrong layer
 * reports the most defects exactly where the most care was taken.** Luxury is a property of the
 * rendered page, so it has to be measured on the rendered page.
 *
 * ── WHAT IT MEASURES ─────────────────────────────────────────────────────────────────────────
 *   brokenValue   `NaN` · `undefined` · `null` · `[object Object]` · `Invalid Date` in PROSE — the
 *                 JavaScript stringification artifacts. A `Date` sliced as a string put
 *                 "NaN days early" on a live page and "Tue Apr 28", no year, in a 409 message.
 *   identifier    a UUID visible to a customer: an id where a name belongs.
 *   jargon        a raw `snake_case` / `dotted.identifier` system token in prose. 33 event types
 *                 once reached a customer as bare type strings.
 *   deadEnd       a page whose main region says there is nothing here and offers no way to change
 *                 that. The gold standard for the opposite is `spotlight-buckets.tsx` — it names
 *                 the thing, says what it is for, and states the fallback.
 *
 * ── THE EXCLUSION IS THE WHOLE DISCRIMINATOR (B127, learned once already) ─────────────────────
 * `scripts/lib/error-surface.mjs` had to learn that an event monitor DISPLAYING an error is not a
 * broken page: matching the text anywhere turned the four pages an operator uses to find real
 * problems permanently red. The same trap is live here — a page rendering a JSON payload will
 * legitimately contain the literal `null`.
 *
 * So every detector reads PROSE ONLY: never inside `pre`, `code`, `kbd`, `samp`, a mono-font
 * element, a form control, or anything `aria-hidden`. That exclusion is not a convenience — it is
 * the difference between a finding and a false positive, and `probe-customer-finish.mts` proves it
 * with a control case that must stay silent before any real finding is reported.
 */
import type { Page } from 'playwright';

export interface Finding {
  kind: 'brokenValue' | 'identifier' | 'jargon' | 'deadEnd';
  /** The offending text, trimmed to something a human can recognise on the page. */
  text: string;
  /** Where it sits, as a coarse selector path — enough to find it, not a brittle locator. */
  where: string;
}

/**
 * Collect visible prose text nodes with their location.
 *
 * Runs in the page. Returns one entry per text node that a customer can actually read: attached,
 * non-empty, laid out (a zero-area rect means collapsed or hidden), and outside every excluded
 * container. The exclusion list is applied to the whole ancestor chain, not just the parent — a
 * `<span>` inside a `<pre>` is still inside a `<pre>`.
 */
async function proseNodes(page: Page): Promise<Array<{ text: string; where: string }>> {
  return page.evaluate(() => {
    // NO NAMED HELPERS IN HERE — the same trap `mobile-measure.mts` documents. This body is
    // serialised and evaluated in the browser, where esbuild's keep-names shim does not exist, so
    // a `const f = (…) => …` compiles to a call to `__name` and the probe dies at the first page.
    // Both loops below are written out for that reason, not for want of a helper.
    const SKIP_TAG = new Set(['PRE', 'CODE', 'KBD', 'SAMP', 'SCRIPT', 'STYLE', 'NOSCRIPT',
      'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'SVG', 'PATH']);
    const out: Array<{ text: string; where: string }> = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.nodeValue || '').trim();
      if (!text) continue;
      const el = n.parentElement;
      if (!el) continue;
      let excluded = false;
      for (let a: Element | null = el; a; a = a.parentElement) {
        const font = getComputedStyle(a).fontFamily.toLowerCase();
        if (SKIP_TAG.has(a.tagName) || a.getAttribute('aria-hidden') === 'true'
          || font.includes('mono') || font.includes('courier') || font.includes('consolas')) {
          excluded = true; break;
        }
      }
      if (excluded) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;      // laid out, or the customer cannot read it
      const parts: string[] = [];
      for (let a: Element | null = el; a && parts.length < 3 && a.tagName !== 'BODY'; a = a.parentElement) {
        const cls = String(a.className || '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
        parts.unshift(a.tagName.toLowerCase() + (cls ? '.' + cls : ''));
      }
      out.push({ text, where: parts.join(' > ') });
    }
    return out;
  });
}

/**
 * JavaScript stringification artifacts that reached the page.
 *
 * Whole-token matching, so "Nancy" is not a NaN and "nullify" is not a null. `null` and `undefined`
 * are only reported when they stand alone or follow a label — the shape a template literal produces
 * when a value was missing — never as part of a sentence about them.
 */
export async function brokenValues(page: Page): Promise<Finding[]> {
  const nodes = await proseNodes(page);
  const PATTERNS: Array<[RegExp, string]> = [
    [/\bNaN\b/, 'NaN'],
    [/\[object \w+\]/, '[object Object]'],
    [/\bInvalid Date\b/, 'Invalid Date'],
    [/(^|[:\s])undefined($|[\s.,)])/, 'undefined'],
    [/(^|[:\s])null($|[\s.,)])/, 'null'],
  ];
  const out: Finding[] = [];
  for (const n of nodes) {
    for (const [re, label] of PATTERNS) {
      if (re.test(n.text)) { out.push({ kind: 'brokenValue', text: `${label} in “${n.text.slice(0, 90)}”`, where: n.where }); break; }
    }
  }
  return out;
}

/** A UUID a customer can read. An identifier is not a name. */
export async function visibleIdentifiers(page: Page): Promise<Finding[]> {
  const nodes = await proseNodes(page);
  const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
  return nodes.filter((n) => UUID.test(n.text))
    .map((n) => ({ kind: 'identifier' as const, text: n.text.slice(0, 90), where: n.where }));
}

/**
 * A system identifier rendered as prose — `proposal:section_saved`, `curation_pending`.
 *
 * Deliberately narrow: at least two segments joined by `_` or `.`, all lower case, no spaces, and
 * not a filename or a domain. A single lower-case word is just a word.
 */
export async function visibleJargon(page: Page): Promise<Finding[]> {
  const nodes = await proseNodes(page);
  const TOKEN = /(?:^|[\s(])([a-z][a-z0-9]*(?:[_.][a-z0-9]+){1,4})(?=$|[\s.,;:)])/;
  const ALLOW = /\.(com|org|net|io|gov|edu|pdf|docx|pptx|xlsx|csv|md|json)$/;
  const out: Finding[] = [];
  for (const n of nodes) {
    const m = TOKEN.exec(n.text);
    if (!m || ALLOW.test(m[1])) continue;
    out.push({ kind: 'jargon', text: `${m[1]} — “${n.text.slice(0, 80)}”`, where: n.where });
  }
  return out;
}

/**
 * A page that says there is nothing here and gives no way to change that.
 *
 * ROUTE-LEVEL, not element-level, and that is deliberate. An individual empty panel beside a full
 * page is fine; what harms a customer is arriving somewhere and finding a wall. So this asks about
 * the MAIN region: does it read as empty, and does it contain any control at all?
 *
 * Nav is excluded by scoping to `main`. If a page has no `main`, this reports nothing rather than
 * guessing at a content root — an instrument that cannot see must report silence.
 */
export async function deadEndPage(page: Page): Promise<Finding[]> {
  return page.evaluate(() => {
    const main = document.querySelector('main') || document.querySelector('[role="main"]');
    if (!main) return [];
    // `innerText`, NOT `textContent`. textContent concatenates across element boundaries with no
    // separator, so `<h1>Documents</h1><p>No documents yet.</p>` reads "DocumentsNo documents yet."
    // — and the word boundary in the pattern below then fails against the very phrase it was
    // written for. The self-test caught this before a single real page was opened, which is the
    // entire reason it runs first.
    const text = ((main as HTMLElement).innerText || main.textContent || '').replace(/\s+/g, ' ').trim();
    // "Empty" phrasing, as the product actually writes it.
    const EMPTY = /\b(no (items|results|opportunities|proposals|documents|projects|tasks|notes|buckets|matches|data)\b|nothing (here|yet|to show|on the board)|none yet|you have no\b|is empty\b)/i;
    if (!EMPTY.test(text)) return [];
    // Any way forward at all — a button, a link, a form control.
    const actions = main.querySelectorAll('a[href], button, input, select, textarea, [role="button"]');
    if (actions.length > 0) return [];
    return [{
      kind: 'deadEnd' as const,
      text: text.slice(0, 140),
      where: 'main',
    }];
  });
}

/** All four, in one pass, in a stable order. */
export async function measureFinish(page: Page): Promise<Finding[]> {
  const [broken, ids, jargon, dead] = await Promise.all([
    brokenValues(page), visibleIdentifiers(page), visibleJargon(page), deadEndPage(page),
  ]);
  return [...broken, ...ids, ...jargon, ...dead];
}
