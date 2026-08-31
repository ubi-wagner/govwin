/**
 * What "too wide", "too small" and "clipped" MEAN — in one place.
 *
 * ── WHY THIS IS A MODULE AND NOT A COPY ──────────────────────────────────────────────────────
 * `probe-project-mobile.mts` defined these three measurements for one page. Extending phone
 * coverage to the other nine pipelines meant either a second probe with a second definition of
 * overflow, or one definition both use. The first option is the exact defect the cross-pipeline
 * coherence review was written to find, so it was never really a choice: two probes that disagree
 * about what counts as overflow produce two numbers nobody can reconcile, and the disagreement
 * shows up as a page that passes one and fails the other for no reason a reader can see.
 *
 * `drive-ui-responsive.mjs` uses the same exclusion rule for inner scrollers, so all three
 * instruments answer the width question identically.
 */
import type { Page } from 'playwright';

export interface Overflow { tag: string; cls: string; right: number; text: string }
export interface SmallTarget { tag: string; label: string; w: number; h: number }
export interface Clipped { text: string; cls: string }

/**
 * Elements whose right edge passes the viewport.
 *
 * An ancestor with `overflow-x: auto|scroll` makes this legitimate — a wide table inside its own
 * scroller is the house idiom for admin surfaces, and reporting it would bury the real finding,
 * which is the BODY scrolling sideways.
 */
export async function overflowing(page: Page, vw: number): Promise<Overflow[]> {
  return page.evaluate((w) => {
    const out: Array<{ tag: string; cls: string; right: number; text: string }> = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const r = el.getBoundingClientRect();
      if (r.right <= w + 1 || r.width < 24) continue;
      let node: Element | null = el;
      let inScroller = false;
      while (node && node !== document.body) {
        const cs = getComputedStyle(node);
        if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') { inScroller = true; break; }
        node = node.parentElement;
      }
      if (inScroller) continue;
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: String((el as HTMLElement).className ?? '').slice(0, 70),
        right: Math.round(r.right),
        text: (el.textContent ?? '').trim().slice(0, 40),
      });
    }
    return out.slice(0, 8);
  }, vw);
}

/**
 * Controls smaller than the 44×44 CSS px touch target (WCAG 2.5.5 / iOS HIG).
 *
 * REPORTED, never failed. A dense row of inline verbs legitimately runs smaller, and failing on it
 * would only teach whoever runs this to stop reading the output — which costs more than the check
 * is worth.
 */
export async function smallTargets(page: Page): Promise<SmallTarget[]> {
  return page.evaluate(() => {
    const out: Array<{ tag: string; label: string; w: number; h: number }> = [];
    for (const el of Array.from(document.querySelectorAll('button, a, input, select, textarea'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height >= 44 && r.width >= 44) continue;
      out.push({
        tag: el.tagName.toLowerCase(),
        label: ((el as HTMLElement).innerText || el.getAttribute('aria-label') || '').trim().slice(0, 30),
        w: Math.round(r.width), h: Math.round(r.height),
      });
    }
    return out;
  });
}

/**
 * Text clipped by its own box WITH NO WAY TO RECOVER IT.
 *
 * ── TRUNCATION IS NOT THE DEFECT; UNRECOVERABLE TRUNCATION IS ────────────────────────────────
 * A work email is longer than a phone is wide. Left whole it becomes the entire row and pushes
 * everything else onto its own line, so this codebase truncates identifiers deliberately and keeps
 * the full value in a `title`. Reporting that as a finding would be the instrument disagreeing
 * with a decision, and its only effect would be to teach whoever runs this to ignore the line —
 * the first version of this check did exactly that on five chips.
 *
 * So the question narrowed to the one that matters: is the clipped text reachable at all? A
 * `title` or `aria-label` carrying it means yes. Nothing carrying it means a word is simply gone,
 * and the page photographs as tidy either way. That also makes the check STRONGER than the naive
 * version: a `truncate` added later without a title now fails, where before it was lost in noise.
 */
export async function clipped(page: Page): Promise<Clipped[]> {
  return page.evaluate(() => {
    const out: Array<{ text: string; cls: string }> = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const e = el as HTMLElement;
      if (e.children.length > 0) continue;
      const cs = getComputedStyle(e);
      if (cs.overflow === 'visible' && cs.textOverflow !== 'ellipsis') continue;
      if (e.scrollWidth <= e.clientWidth + 2) continue;
      const text = (e.innerText ?? '').trim();
      if (!text) continue;
      const recoverable = [e, e.parentElement].some((n) =>
        n instanceof HTMLElement
        && ((n.title && n.title.includes(text.replace(/…$/, '').trim().slice(0, 12)))
          || (n.getAttribute('aria-label') ?? '').includes(text.slice(0, 12))));
      if (recoverable) continue;
      out.push({ text: text.slice(0, 50), cls: String(e.className).slice(0, 50) });
    }
    return out.slice(0, 8);
  });
}

/**
 * Open every disclosure and inline editor on the page, and say how many opened.
 *
 * ── THE COUNT IS THE POINT ───────────────────────────────────────────────────────────────────
 * A probe that opens nothing measures the same page the responsive pass already photographed, and
 * reports it clean — which is indistinguishable from a page whose overlays are all fine. So the
 * caller gets the number, and a route where it is 0 is reported as OPENED NOTHING rather than
 * counted as covered. That is the same rule the rest of this tree runs on: uncovered is not
 * passing.
 *
 * Clicks are best-effort and individually timed out. A disclosure that navigates away, or a
 * button that is disabled, must not take the whole route down with it.
 */
export async function openEverything(page: Page): Promise<number> {
  let opened = 0;
  const click = async (loc: { click: (o: { timeout: number }) => Promise<void> }) => {
    try { await loc.click({ timeout: 1500 }); opened += 1; } catch { /* not openable here */ }
  };

  // ARIA disclosures first: the honest signal, and the one the codebase uses for its own panels.
  for (const b of await page.locator('button[aria-expanded="false"]').all()) await click(b);

  // Then the verbs that reveal an inline editor. Named rather than matched by shape, because
  // "every button on the page" would submit forms and navigate away — this probe is READ-ONLY and
  // a click that writes would make it a mutation harness nobody thinks it is.
  for (const name of ['Edit', 'Add someone', 'Add task', 'Comment', 'Reply', 'Show more', 'Details']) {
    for (const b of await page.getByRole('button', { name, exact: false }).all()) await click(b);
  }

  // <details> is not a button and no click reaches it via the two loops above.
  for (const d of await page.locator('details:not([open]) > summary').all()) await click(d);

  await page.waitForTimeout(500);
  return opened;
}
