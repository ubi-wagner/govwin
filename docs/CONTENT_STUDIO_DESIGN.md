# Content Studio — Canvas-Native Front-Facing Content

**Status:** building (2026-08-12) · **Owner surface:** `/admin/site` · **Store:** main DB, frontend-owned

## Decision (why this doc exists)

Front-facing **content** and **dynamic pages** are managed **under the frontend against the
main DB** — NOT the `services/cms` FastAPI service (whose future is CRM: customer
identification, acquisition, management, later). This doc records that decision and the
rework that makes content authoring feel like our other flagship surface: the **proposal
Canvas**.

Today the site-content editor (`app/admin/site/docs/[type]/[slug]`) is a plain form with a
raw-markdown `<textarea>` for the body. The proposal builder, by contrast, is a rich
**Canvas** — block/node editing, formatting, image insert, autosave + recover, non-destructive
409, undo/redo, version restore, export. The ask: **bring that Canvas experience to content.**

## Architecture — canvas is source of truth, HTML is the public projection

The content store is unchanged and non-migrating: `content_pages` (main DB), the unified
versioned store (`content_type='page'` for the page-block editor; `blog_post` / `resource` /
`guide` / `testimonial` / `team_member` for documents). Draft → publish → archive lifecycle
in `lib/content-admin.ts` stays exactly as-is.

We add the **CanvasDocument as the authored source of truth**, carried in the row's
`metadata.canvas`, and keep the existing **`blocks[0].body` as an HTML projection** rendered
FROM the canvas on every save:

```
author in Canvas ──save──▶ metadata.canvas = CanvasDocument      (source of truth)
                           blocks[0].body  = renderCanvasBodyHtml(canvas)   (public projection)
                                    │
public read (lib/cms.ts) ──────────┘  reads blocks[0].body, UNCHANGED
marketing renderer: body.startsWith('<') ? sanitizeHtml(body) : renderMarkdown(body)
```

Because `renderCanvasBodyHtml` emits a `<div>`-led fragment, the **public renderer already
detects it as HTML** (`app/(marketing)/resources/[slug]/page.tsx`) and sanitizes it — **zero
public-side change, zero regression**. A doc that never gets canvas-edited keeps its existing
markdown/HTML body verbatim (the projection only runs when a canvas is submitted).

### Seed-on-open (the 16 existing docs)
Opening a legacy doc with no `metadata.canvas` synthesizes a starter CanvasDocument from its
existing body (`canvasFromDocBody`: markdown/HTML → heading / paragraph / list nodes). The
raw body is left intact until the first canvas save, so nothing is lost if the author backs
out.

## Reuse (no new editor engine)

The Canvas is already factored for standalone, non-proposal editing:
- `CanvasEditor` (`components/canvas/canvas-editor.tsx`) — the engine. Minimal mount needs only
  `initialDocument`, `onSave`, `actorId`, `actorName`, `autosaveKey`, `variables`.
- `TemplateCanvasEditor` (`components/admin/template-canvas-editor.tsx`) — the proven
  **admin-plane** mount pattern (canvas + `onSave`→admin route + minimal chrome). We mirror it.
- `renderCanvasBodyHtml` (`lib/export/canvas-html.ts`) — the pure canvas→HTML projection.
- `sectionsToCanvasDoc` / `createNode` — pure canvas builders for the seed.

New, small, pure module `lib/content-canvas.ts`:
- `docBodyFromCanvas(canvas) → html` — the public projection (wraps `renderCanvasBodyHtml`).
- `canvasFromDocBody(title, body) → CanvasDocument` — the seed (markdown/HTML → nodes).

## Surfaces

- **Data:** `DocFields.canvas?` + `saveDocumentDraft` persists `metadata.canvas` and writes the
  projected `blocks[0].body`. Server-side projection (never trust a client-sent HTML body).
- **Route:** `POST /api/admin/site/docs/[type]/[slug]/save` accepts `canvas`; the server renders
  the body. Publish / status / pages routes unchanged.
- **UI:** `SiteDocCanvasEditor` — the `CanvasEditor` as the main stage + a collapsible **Post
  details** panel (title · slug · excerpt · tags · featured image · external URL · audit note)
  + action bar (Save draft · Publish · Retire/Restore · View live). Autosave, non-destructive
  save, and version chips come from the Canvas engine for free.

## Guardrails

- Admin-only (`requireAdmin`); content is global (no tenant) — the Canvas mounts WITHOUT
  tenant/proposal context, so tenant-scoped features (comments, library atomize) stay off.
- The compliance floor `validateStandaloneCanvas` still applies at export; content is web
  content (`custom` preset — no page budget), so no false page-limit warnings.
- Every publish emits `system.content.document_published` (already wired) + revalidates the
  public path.

## Phasing

1. **Documents first** (this pass) — blog_post / resource / guide / testimonial / team_member.
   Single-body docs map 1:1 to a CanvasDocument. Highest value, cleanest.
2. **Pages next** (follow-up) — the page-block editor (`content_type='page'`) is multi-section;
   canvas-native page authoring reuses the same engine with a section-per-block model.
