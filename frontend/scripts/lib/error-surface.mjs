/**
 * THE ONE DEFINITION OF "THIS PAGE IS BROKEN", shared by every harness that looks at a page.
 *
 * WHY IT IS SHARED. `verify-surfaces.mjs` and `capture-guides.mjs` each carried their own copy of
 * this regex, and the copies drifted — which is not a hypothetical:
 *
 *   `/admin/documents/[documentId]` is backed by OBJECT STORAGE, not a table. The guide capture
 *   handed it a `tenant_documents.id`, the page rendered a red **"Document not found"**, and the
 *   harness reported `✓ 200` — because neither copy matched a bare "… not found". The screenshot
 *   went into the admin guide captioned "A platform document in the canvas". A guide illustrated
 *   with an error page is worse than a guide with no picture at all.
 *
 * The lesson is the one B78 already taught and this repeated at the next level up: **the rendered
 * text is the only evidence there is**, so the list of texts that count as failure has to be
 * complete, and there must be exactly one of it.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * AND THEN THE COMPLETE LIST WAS TOO COMPLETE (B127). Matching those texts ANYWHERE on the page
 * confuses two different things:
 *
 *     the page's own message  ·  vs ·  error text the page is DISPLAYING AS DATA
 *
 * `/admin/process`, `/admin/system`, `/admin/system-state` and `/portal/<t>/activity` are event
 * monitors. Their job is to render `system_events` rows, and a healthy platform produces rows like
 * `{"code":"NOT_FOUND","message":"proposal not found"}`. `\bnot found\b` matched the payload, and
 * all four were reported "error boundary" while rendering perfectly. On a database with no error
 * events yet — a freshly migrated box — they pass; after any real failure anywhere in the product,
 * they fail forever. A lens that turns red because the product logged an error it was supposed to
 * log is a false-positive generator aimed at the four pages an operator uses to find real problems.
 *
 * THE DISCRIMINATOR IS STRUCTURAL, NOT TEXTUAL, and it was measured rather than guessed. An error
 * surface REPLACES the page's content; a monitor displaying an error still has all of its own:
 *
 *   | page                                   | body text | where the match lives |
 *   |----------------------------------------|-----------|-----------------------|
 *   | /portal/<t>/library/foundation/<bad-id> |   468 ch  | H1 "Not found"        |
 *   | /admin/tenants/<bad-id>                 |   638 ch  | H1 "Tenant Not Found" |
 *   | /admin/process                          | 4,167 ch  | PRE, inside a payload |
 *   | /admin/system                           | 8,262 ch  | P, inside an event row|
 *   | /portal/<t>/activity                    | 11,685 ch | PRE, inside a payload |
 *
 * So the rule below splits the vocabulary in two. STRONG texts are never data — nothing legitimately
 * renders "Something went wrong" as content — and count wherever they appear. WEAK texts ("not
 * found", "failed to load") are ordinary content on a monitor, so they count only when the page has
 * nothing else: the match sits in a heading, or the whole page is short enough that the error IS the
 * page. The documented `/admin/documents/[documentId]` case is caught by the second arm — its
 * message is a `<p>`, not a heading, on a page that renders only that and a back-link.
 *
 * WHAT IS DELIBERATELY *NOT* HERE. Empty states. "No solicitations found", "No templates match" and
 * their kin are a page working correctly on an empty fixture, and matching them would fail healthy
 * surfaces. The `\bnot found\b` boundary is what separates the two: an empty state says "no X
 * found", never "X not found".
 */

/** Text that is never legitimate page content — a page showing this did not render. */
export const ERROR_SURFACE_STRONG_RE =
  'Application error'
  + '|Unhandled Runtime Error'
  + '|Something went wrong'
  + '|500 —'
  + '|This page could not be found';

/**
 * Text that means failure when it is the page's own message, and means DATA on a page whose job is
 * to display errors. Never matched on its own — see `countErrorSurfaces`.
 */
export const ERROR_SURFACE_WEAK_RE =
  'failed to load'
  + '|Failed to load'
  + '|Could not load'
  + '|\\bnot found\\b';

/** Kept for callers that want the full vocabulary as one pattern (reporting, greps). */
export const ERROR_SURFACE_RE = `${ERROR_SURFACE_STRONG_RE}|${ERROR_SURFACE_WEAK_RE}`;

/** Playwright locator string for the above. Prefer `countErrorSurfaces` — this cannot discriminate. */
export const ERROR_SURFACE_SELECTOR = `text=/${ERROR_SURFACE_RE}/i`;

/**
 * Below this many characters of visible body text, a page has not rendered content — it has
 * rendered a message. Measured, not chosen: the two real error surfaces on this fixture are 468 and
 * 638 characters (nav chrome included) and the nearest healthy page is 4,167. The threshold sits in
 * the gap with roughly 2× clearance on both sides. If a future error page is chattier than this,
 * the heading arm still catches it; both arms exist so neither has to be exact.
 */
const CONTENT_CHARS_FLOOR = 1500;

/**
 * How many error surfaces this page is rendering. 0 is the only passing answer.
 *
 * Runs in the page so it can see WHERE each match sits, which is the whole point — a locator count
 * cannot tell the page's own message from a string inside a rendered record.
 */
export const countErrorSurfaces = (page) =>
  page.evaluate(
    ({ strongSrc, weakSrc, floor }) => {
      const strong = new RegExp(strongSrc, 'i');
      const weak = new RegExp(weakSrc, 'i');
      const bodyLen = (document.body?.innerText ?? '').length;
      let n = 0;

      for (const el of document.querySelectorAll('body *')) {
        if (el.children.length) continue;                       // leaf nodes only — no double counting
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
        const text = (el.textContent ?? '').trim();
        if (!text) continue;

        if (strong.test(text)) { n += 1; continue; }
        if (!weak.test(text)) continue;

        // Serialized data rendered verbatim is never the page's own message.
        if (el.closest('pre, code')) continue;

        const heading = !!el.closest('h1, h2, h3') || /^H[1-3]$/.test(el.tagName);
        if (heading || bodyLen < floor) n += 1;
      }
      return n;
    },
    { strongSrc: ERROR_SURFACE_STRONG_RE, weakSrc: ERROR_SURFACE_WEAK_RE, floor: CONTENT_CHARS_FLOOR },
  );
