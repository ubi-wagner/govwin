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
  kind: 'brokenValue' | 'identifier' | 'jargon' | 'deadEnd' | 'rawTimestamp' | 'unlabeledControl' | 'brokenLink';
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
    // `data-user-content` marks text a PERSON wrote that the page is displaying — a note, a
    // comment, an application. It is the same structural discriminator B127 forced on
    // `error-surface.mjs`: an event monitor rendering an error is not a broken page, and a notes
    // board where somebody wrote "the counters read NaN" is not a page with a NaN on it. The first
    // version reported exactly that, on notes written an hour earlier by this session.
    //
    // The marker is on the PRODUCT, not in a list here, and that is deliberate: a surface that
    // renders user text and does not say so is itself the finding — nobody downstream can tell
    // our prose from theirs, and neither can an injection fence.
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
          || a.hasAttribute('data-user-content')
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
  // Abbreviations are PROSE. The first version reported `e.g` three times, from our own template
  // placeholder copy ("[drivers — e.g., procurement reform]") — copy somebody wrote deliberately,
  // in the one place on the tenant surface where guidance text lives. A rule that fires on good
  // writing is not a stricter rule, it is a broken one: it would have pushed the next person to
  // reword a helpful placeholder to satisfy a check.
  const ABBREV = new Set(['e.g', 'i.e', 'etc', 'vs', 'viz', 'cf', 'et.al', 'a.m', 'p.m',
    'u.s', 'u.k', 'ph.d', 'no', 'approx', 'est']);
  const out: Finding[] = [];
  for (const n of nodes) {
    const m = TOKEN.exec(n.text);
    if (!m || ALLOW.test(m[1]) || ABBREV.has(m[1])) continue;
    // A dotted token whose every segment is one or two letters is an abbreviation nobody has
    // listed yet, not an identifier — `sam_gov` and `workflow_manager` both survive this.
    if (m[1].includes('.') && m[1].split('.').every((seg) => seg.length <= 2)) continue;
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

/**
 * A machine timestamp shown to a person: `2026-09-02T00:01:33.433Z`, or a bare epoch.
 *
 * The product has `<TimeAgo>` and `isoDate()` for this, and a raw ISO string beside them reads as a
 * field somebody forgot to format. Deliberately narrow — a plain `2026-09-02` is a date a person
 * can read, so only the T-and-offset form counts.
 */
export async function rawTimestamps(page: Page): Promise<Finding[]> {
  const nodes = await proseNodes(page);
  const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/;
  const EPOCH = /(^|\s)1[6-9]\d{11}(\s|$)/;                 // ms since epoch, this decade
  return nodes.filter((n) => ISO.test(n.text) || EPOCH.test(n.text))
    .map((n) => ({ kind: 'rawTimestamp' as const, text: n.text.slice(0, 90), where: n.where }));
}

/**
 * A control with no accessible name — an icon button nobody can describe.
 *
 * This is the finish defect that is also an accessibility defect: a screen reader announces
 * "button", and a person using a pointer has to guess from a glyph. Counted only for controls that
 * are actually visible, and only when there is NO name from any source — text, aria-label,
 * aria-labelledby, title, or an image's alt.
 */
export async function unlabeledControls(page: Page): Promise<Finding[]> {
  return page.evaluate(() => {
    // No named helpers here — see the note in proseNodes.
    const out: Array<{ kind: 'unlabeledControl'; text: string; where: string }> = [];
    const els = document.querySelectorAll('button, a[href], [role="button"], input[type="submit"]');
    for (const el of Array.from(els)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (el.getAttribute('aria-hidden') === 'true') continue;
      // EVERY source is considered, not the first truthy one. The control fixture caught the
      // first version doing `textContent || ariaLabel || …`: an icon button reading "✕" with a
      // perfectly good `aria-label="Dismiss"` never reached the label, because the glyph is
      // truthy — so a correctly-labelled button was reported as unlabelled. A `||` chain is the
      // wrong shape for "is it named ANYWHERE".
      const sources = [
        (el.textContent || '').trim(),
        el.getAttribute('aria-label') || '',
        el.getAttribute('title') || '',
        el.getAttribute('alt') || '',
        el.getAttribute('aria-labelledby')
          ? (document.getElementById(el.getAttribute('aria-labelledby') as string)?.textContent || '').trim()
          : '',
        (el.querySelector('img[alt]')?.getAttribute('alt') || '').trim(),
        (el.querySelector('svg title')?.textContent || '').trim(),
      ];
      // An emoji or a lone glyph is a picture, not a name — so each source is judged after the
      // pictographs come out, and the control passes if ANY source leaves real characters behind.
      let hasName = false;
      for (const s of sources) {
        if (s.replace(/[\p{Extended_Pictographic}\p{So}\s×✕✓·•←→↑↓…—–-]/gu, '').length > 0) { hasName = true; break; }
      }
      if (hasName) continue;
      const named = sources.find(Boolean) || '';
      const parts: string[] = [];
      for (let a: Element | null = el; a && parts.length < 3 && a.tagName !== 'BODY'; a = a.parentElement) {
        const cls = String(a.className || '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
        parts.unshift(a.tagName.toLowerCase() + (cls ? '.' + cls : ''));
      }
      out.push({
        kind: 'unlabeledControl',
        text: `<${el.tagName.toLowerCase()}> shows “${String(named).slice(0, 20) || '(nothing)'}” and has no name`,
        where: parts.join(' > '),
      });
    }
    return out;
  });
}

/** Every same-origin href on the page, deduplicated — the caller decides what to do with them. */
export async function internalLinks(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out = new Set<string>();
    for (const a of Array.from(document.querySelectorAll('a[href]'))) {
      const raw = a.getAttribute('href') || '';
      if (!raw || raw.startsWith('#') || /^(mailto|tel|javascript|data|blob):/i.test(raw)) continue;
      try {
        const u = new URL(raw, location.href);
        if (u.origin !== location.origin) continue;
        out.add(u.pathname + u.search);
      } catch { /* an href the browser cannot parse is its own kind of finding, but not this one */ }
    }
    return [...out];
  });
}

/** All six DOM measures, in one pass, in a stable order. Links are checked by the caller. */
export async function measureFinish(page: Page): Promise<Finding[]> {
  const [broken, ids, jargon, dead, stamps, unlabeled] = await Promise.all([
    brokenValues(page), visibleIdentifiers(page), visibleJargon(page), deadEndPage(page),
    rawTimestamps(page), unlabeledControls(page),
  ]);
  return [...broken, ...ids, ...jargon, ...dead, ...stamps, ...unlabeled];
}
