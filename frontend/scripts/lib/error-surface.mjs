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
 * WHAT IS DELIBERATELY *NOT* HERE. Empty states. "No solicitations found", "No templates match" and
 * their kin are a page working correctly on an empty fixture, and matching them would fail healthy
 * surfaces. The `\bnot found\b` boundary is what separates the two: an empty state says "no X
 * found", never "X not found".
 */

/** Rendered text that means the page did not render its content. */
export const ERROR_SURFACE_RE =
  'Application error'
  + '|Unhandled Runtime Error'
  + '|Something went wrong'
  + '|failed to load'
  + '|Failed to load'
  + '|500 —'
  + '|This page could not be found'
  + '|Could not load'
  + '|\\bnot found\\b';

/** Playwright locator string for the above. */
export const ERROR_SURFACE_SELECTOR = `text=/${ERROR_SURFACE_RE}/i`;

/** How many error surfaces this page is rendering. 0 is the only passing answer. */
export const countErrorSurfaces = (page) => page.locator(ERROR_SURFACE_SELECTOR).count();
