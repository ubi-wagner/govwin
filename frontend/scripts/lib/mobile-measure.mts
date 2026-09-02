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
 *
 * ── WHY IT WALKS THE WHOLE ANCESTOR CHAIN ────────────────────────────────────────────────────
 * It used to look at the element and its immediate parent only, and that is not where a tooltip
 * comes from. A browser shows the title of the NEAREST ANCESTOR that has one, at any depth — so a
 * component that puts the title on the card and truncates a span two levels inside it is correctly
 * recoverable, and this reported it as text with no way back. That is what it did to the workflow
 * map: every node carries `title={label — sublabel}` on the node box, the label span sits inside a
 * flex row inside that box, and four node labels were reported as unrecoverable on a page whose
 * recovery works fine by hand.
 *
 * The walk stays honest because the title must still CONTAIN the clipped text. An ancestor with
 * some unrelated title does not launder a truncation, and an element with no titled ancestor at
 * all still fails — which is the case the check exists to catch.
 */
export async function clipped(page: Page): Promise<Clipped[]> {
  return page.evaluate(() => {
    // NO NAMED HELPERS IN HERE. This body is serialised and evaluated in the browser, where
    // esbuild's keep-names shim does not exist — a `const f = (…) => …` compiles to a call to
    // `__name`, and the whole probe dies with "__name is not defined" at the first route. Inline
    // the condition instead.
    const out: Array<{ text: string; cls: string }> = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const e = el as HTMLElement;
      if (e.children.length > 0) continue;
      const cs = getComputedStyle(e);
      if (cs.overflow === 'visible' && cs.textOverflow !== 'ellipsis') continue;
      if (e.scrollWidth <= e.clientWidth + 2) continue;
      const text = (e.innerText ?? '').trim();
      if (!text) continue;
      // The ellipsis is painted by CSS, so it is not in the string; strip a literal one anyway for
      // the cases where the app truncated the text itself.
      const needle = text.replace(/…$/, '').trim().slice(0, 12);
      if (!needle) continue;
      let recoverable = false;
      for (let n: HTMLElement | null = e; n && n !== document.body; n = n.parentElement) {
        if ((n.title ?? '').includes(needle)
            || (n.getAttribute('aria-label') ?? '').includes(needle)) { recoverable = true; break; }
      }
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
export async function openEverything(page: Page): Promise<{ opened: number; candidates: number }> {
  let opened = 0;
  const click = async (loc: { click: (o: { timeout: number }) => Promise<void> }) => {
    try { await loc.click({ timeout: 1500 }); opened += 1; } catch { /* not openable here */ }
  };

  // ARIA disclosures first: the honest signal, and the one the codebase uses for its own panels.
  for (const b of await page.locator('button[aria-expanded="false"]').all()) await click(b);

  // Then the verbs that reveal a panel, a modal or an inline editor. Named rather than matched by
  // shape, because "every button on the page" would submit forms and navigate away — this probe is
  // READ-ONLY and a click that writes would make it a mutation harness nobody thinks it is.
  //
  // Every verb below was checked against its handler before being added, and the ones deliberately
  // NOT here are the reason the list is short: "Use this template", "Atomize", "Archive", "Save",
  // "Advance", "Cancel" and "Apply" all sit on these same routes and all write.
  //   · 'Preview' opens a read-only CanvasDocument modal (TemplatePreviewer / template-stable-
  //     gallery openPreview) — it is a dialog, so it correctly carries no aria-expanded and the
  //     first loop can never reach it. It is also the densest overlay the templates routes have.
  for (const name of ['Edit', 'Add someone', 'Add task', 'Comment', 'Reply', 'Show more', 'Details',
                      'Preview']) {
    for (const b of await page.getByRole('button', { name, exact: false }).all()) await click(b);
  }

  // <details> is not a button and no click reaches it via the two loops above.
  for (const d of await page.locator('details:not([open]) > summary').all()) await click(d);

  // TABS. Switching a tab shows a panel that already exists and writes nothing — the safest
  // disclosure there is, and the one that reveals the most: the architecture explorer, the
  // proposal workspace and half the admin consoles keep whole views behind one. Added after the
  // finish probe reported "opened 19 of 1319 candidates" and the gap turned out to be structural
  // rather than a shortage of named verbs. `aria-selected="false"` only, so the tab already
  // showing is not clicked back and forth.
  for (const t of await page.locator('[role="tab"][aria-selected="false"]').all()) await click(t);

  await page.waitForTimeout(500);

  // ── WHY THE SECOND NUMBER EXISTS ────────────────────────────────────────────────────────────
  // "opened 0" has two completely different meanings and the caller could not tell them apart:
  // a page that genuinely has nothing to open (the tenant documents index is nav plus a list —
  // three buttons, all chrome), and a page dense with disclosures this probe simply cannot name
  // (the workflow monitor carries 164 buttons). The first is covered; the second is a harness
  // gap wearing the same words. Counting the non-chrome controls that EXIST separates them, so
  // the report can say which one it is instead of making the reader guess.
  const candidates = await page.evaluate(() => {
    const chrome = /^(sign out|☰|\d+\+?|)$/i;
    return Array.from(document.querySelectorAll('button, [role="button"], details > summary'))
      .filter((el) => {
        const t = (el.textContent || '').trim();
        if (chrome.test(t)) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;      // a control nobody can see is not a disclosure
      }).length;
  });
  return { opened, candidates };
}

/**
 * THE INSTRUMENT BEFORE THE FINDING — a known-answer test for `clipped()`.
 *
 * `clipped()` is the subtlest check in this file: it must ignore truncation the page gives you a
 * way back from, and report truncation it does not. Both halves are easy to break in the same
 * edit, and neither shows up as an error — a too-strict version buries the real finding in noise
 * about the workflow map, a too-loose one reports a clean page forever. Nothing downstream can
 * tell which you have.
 *
 * So it is run against a fixture with a known answer BEFORE any route is measured, and the caller
 * exits 2 as a HARNESS DEFECT if it disagrees. Same contract as `verify-surfaces` opening each
 * actor lane on a page that is definitely broken: a clean sweep below an unvalidated instrument is
 * unearned. Three cases, and the middle one is the one that matters — it is the check itself.
 */
export async function selfTestClipped(page: Page): Promise<{ ok: boolean; detail: string }> {
  const saved = await page.evaluate(() => document.body.innerHTML);
  await page.setContent(`<body style="margin:0">
    <div title="project.collaboration_requested — full"><div style="display:flex;min-width:0">
      <span style="display:block;width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">project.collaboration_requested</span>
    </div></div>
    <div><div style="display:flex;min-width:0">
      <span style="display:block;width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">schedule login reminder now</span>
    </div></div>
    <div title="something else entirely"><div>
      <span style="display:block;width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">ai onboarding concierge</span>
    </div></div>
  </body>`);
  const texts = (await clipped(page)).map((c) => c.text);
  const titledAncestor = texts.some((t) => t.startsWith('project.collaboration'));  // must be CLEAN
  const noTitle = texts.some((t) => t.startsWith('schedule login'));                // must be FOUND
  const unrelated = texts.some((t) => t.startsWith('ai onboarding'));               // must be FOUND
  await page.setContent(`<body>${saved}</body>`).catch(() => {});
  const ok = !titledAncestor && noTitle && unrelated;
  return {
    ok,
    detail: `titled-ancestor ${titledAncestor ? 'REPORTED (false positive)' : 'clean'} · `
          + `no-title ${noTitle ? 'found' : 'MISSED (blind)'} · `
          + `unrelated-title ${unrelated ? 'found' : 'MISSED (laundered)'}`,
  };
}
