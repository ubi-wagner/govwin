# Atom Vectorization + Image Atoms — Implementation Plan (2026-07-01)

Turns "Step 1" (make library atoms semantically retrievable) into a concrete, grounded
build, and extends the atom model to **images extracted on ingest and contextualized by
customer or admin**. Grounded against the current code; no assumptions.

## Objective
Populate `library_units.embedding` and switch atom retrieval from recency/tag ordering to
**tenant-scoped semantic (hybrid) ranking**, so the tenant's proven content actually
reaches the drafter's working memory by relevance. Add **image atoms** as first-class,
human-contextualized library units in the same retrieval space.

## Hard constraints (get these wrong and the vector space corrupts)
1. **One embedding model everywhere:** OpenAI `text-embedding-3-small`, **1536-dim** — must
   match `pipeline/src/agents/embeddings.py` exactly (Voyage 1024 is already blocked there).
   The frontend and pipeline write/read the *same* column, so they must share the model.
2. **Tenant isolation lives in the query, not RLS.** The three memory tables + `library_units`
   have `ENABLE ROW LEVEL SECURITY` but **zero policies**, and the app connects as the DB owner
   (RLS bypassed). Isolation is enforced *only* by `WHERE tenant_id = $1`. **Every vector query
   MUST keep the tenant filter** — a bare `ORDER BY embedding <=> $vec` ranks across tenants.
3. **Text-only embeddings.** `text-embedding-3-small` cannot embed pixels. Image atoms are
   embedded on their **textual context** (alt text + caption + human description + nearest
   heading). Do **not** put CLIP/pixel vectors in the same 1536 column — different geometry.

## No migration required
- `library_units.embedding vector(1536)` + `idx_library_embedding` HNSW already exist (mig 001).
- Image atoms fit the existing schema: `canvas_nodes` (the image node), `source_storage_key`
  (R2 key), `content` (context text → embedding source), `heading_text` (caption),
  `meta.kind='image'`, tag `image`. Dimensions live in the `ImageContent{width,height}` node.
- Optional (nice-to-have, not required): `ALTER TABLE library_units ADD COLUMN embedded_at TIMESTAMPTZ`
  to make the backfill sweep idempotent without relying on NULL/zero checks.

---

## Part A — Atom vectorization

### A1. Embedding helper (frontend)
New `frontend/lib/embeddings.ts`, mirroring the pipeline contract:
- `embed(text): Promise<number[] | null>` and `embedBatch(texts): Promise<(number[]|null)[]>`.
- Model `text-embedding-3-small`, asserts 1536 dims, returns `null` when `OPENAI_API_KEY` /
  `EMBEDDINGS_PROVIDER` absent (default-off parity — never throws, never zero-pads silently).
- To pgvector literal: `'[' + vec.join(',') + ']'` written as `${vecLiteral}::vector`.
- **Prereq:** `OPENAI_API_KEY` in the frontend env. (Alternative to avoid a second vendor in
  Next: expose an internal `POST /embed` on the pipeline and have the frontend call it — one
  network hop, single-homed keys. Pick one; the plan assumes the local helper.)

### A2. Embed-on-approve (single chokepoint)
An atom becomes embeddable when it reaches `approved` with non-empty `content`. Embed there:
- `frontend/app/api/portal/[tenantSlug]/library/[unitId]/route.ts` — PATCH when `status→approved`
  (rail Accept). Embed `content`, `UPDATE ... SET embedding = ${lit}::vector`.
- `frontend/app/api/portal/[tenantSlug]/library/route.ts` — POST bulk `approve`: `embedBatch`
  the approved rows' content, one `UPDATE ... FROM (values ...)`.
- `frontend/lib/proposal-harvest.ts` — `harvestSectionNodes` + `harvestNodeToLibrary` insert
  atoms already `approved`; embed inline right after the `RETURNING id` (low volume, fine).
- Atomized children are created `draft` → embedded when the rail approves them (covered above).
  Skip embedding the **seminal** parent (100k chars; not a retrieval unit).
- All are **best-effort**: embedding failure logs and leaves `embedding` NULL; the backfill and
  the query fallback (A4) keep the system correct.

### A3. Backfill (pipeline, existing corpus + safety net)
- Point `pipeline/src/agents/embeddings.py::backfill_embeddings()` at `library_units`
  (`WHERE embedding IS NULL OR embedding = zero AND content <> '[pending extraction]' AND status='approved'`),
  `embed_batch` in pages of 100. Run once for the corpus; schedule daily as the net for any
  write-path misses. Also sweep the compactor's zero-vector `semantic_memories` while here.

### A4. Hybrid retrieval (the three read sites) — with safe fallback
Ranking = cosine similarity reranked by the outcome learning loop, tenant-scoped, with a
graceful fallback to today's behavior (so shipping with embeddings still OFF is a no-op).
- `frontend/app/api/portal/[tenantSlug]/library/similar/route.ts` (the documented "Phase-4" site):
  - Embed the section text (`title + section_type + RFP excerpt`) → `$vec`.
  - If `$vec` present: `WHERE tenant_id=$1 AND status='approved' AND embedding IS NOT NULL {scope}
    ORDER BY (1 - (embedding <=> $vec)) * (0.5 + 0.5*coalesce(outcome_score,0.5)) DESC LIMIT k`.
  - Else (no key / no embeddable text / <N vector hits): fall back to the **current** tag+outcome
    ordering unchanged. Keep the existing `{scope}` and `excludeOwn` fragments.
- `pipeline/src/agents/context.py::_load_library_atoms` and `tools.py::_library_search`: already
  have vector branches that activate when `EMBEDDINGS_PROVIDER` is on — they light up for free
  once atoms are populated (A2/A3). Verify both keep `WHERE tenant_id = $1` (constraint #2).

Net effect: `draft_v0`'s auto-injected atoms and the LibraryPicker go from *most-recent* to
*most-relevant, winners-first* — which is the fix for the V0 grounding gap.

---

## Part B — Image atoms (extract on ingest + human-contextualize)

### B1. Extraction on ingest (per-format, honest feasibility)
- **docx — feasible now.** `frontend/lib/import/docx-reader.ts` calls `mammoth.convertToHtml({buffer})`.
  Add `{ convertImage: mammoth.images.imgElement(async (image) => { const buf = await image.read();
  /* capture buf + image.contentType */ }) }`. Emit an **image atom** per captured image, carrying
  the alt text and the nearest preceding heading as initial context.
- **pptx — feasible, more work.** `pptx-reader.ts` already unzips slide XML; extract `ppt/media/*`
  and resolve `<a:blip r:embed>` → media file → image node; slide title becomes context.
- **pdf — fast-follow (harder).** `pdf-parse` is text-only. Real extraction needs `pdfjs-dist`
  (enumerate `OPS.paintImageXObject`). Ship docx/pptx first; **`log()` that PDF images are skipped**
  so it isn't silently "handled."
- Extend `frontend/lib/import/types.ts` `ImportedAtom` to carry image nodes (or a distinct
  `ImportedImageAtom { imageBuffer, contentType, altText, contextHint, width?, height? }`).

### B2. Storage + atom creation (atomize route)
In `frontend/app/api/portal/[tenantSlug]/library/atomize/route.ts`:
- For each extracted image: `putObject` (`frontend/lib/storage/s3-client.ts`) under
  `customers/<slug>/library/<seminalId>/img-<n>.<ext>` (mirrors the existing `customerImagePath`
  image pattern); read back via `getSignedGetUrl` for display.
- Insert an **image atom** `library_units` row: `source_type='upload'`, `canvas_nodes=[imageNode
  {storage_key, alt_text, width, height, caption}]`, `source_storage_key=<key>`,
  `content = altText + contextHint` (seed; may be empty), `heading_text=caption`,
  `category` inherited from the surrounding section (or `figure`), tags `['image', type:…]`,
  `meta.kind='image'` + author/lineage/context (same helpers as text atoms). Status `draft`.

### B3. Human contextualization (customer **and** admin) — via the rail
Image atoms are only as findable as their text context, so contextualization is required, not
optional. Extend the shared rail:
- `frontend/components/atomization/atom-bubble-rail.tsx`: when a bubble is an image (`nodeType
  === 'image'`), render a **thumbnail** (signed URL) + a **Description/Caption** textarea in the
  open state, alongside the existing classify + multi-tag controls.
- Wire a new `onDescribe(id, text)` that PATCHes the atom `content` (the embeddable context).
  Reuse the existing `onClassify`/`onAddTag`/`onAccept` unchanged.
- This lands on all three rail surfaces already built:
  - **Customer:** portal library review (`atomize-rail-review.tsx`) + canvas rail.
  - **Admin:** RFP-curation Section Rail (`annotation-atomize-rail.tsx`) — the RFP's figures/
    exhibits extracted during shred become admin-contextualized reference atoms (or annotations
    with an image payload), same UI.
- **Accept** on an image atom → `status='approved'` → embed `content` (A2). No description ⇒ stays
  draft/un-embedded (shows in the rail awaiting context) — honest, not silently dropped.

### B4. Rendering
Image atoms already render through the canvas image node (`ImageContent.storage_key` → signed
URL) when inserted into a proposal via the LibraryPicker — no new renderer.

### B5. Multimodal (explicitly deferred, to avoid a subtle bug)
Visual similarity (search by picture) needs CLIP-style vectors in a **separate** column/space.
Do not co-mingle with the 1536 text column. Out of scope; noted so it isn't attempted casually.

---

## Rollout
1. **A1–A2 + A4 fallback** behind `EMBEDDINGS_PROVIDER` — ships as a no-op while off (zero risk).
2. **Turn on** (`EMBEDDINGS_PROVIDER=openai` + `OPENAI_API_KEY` frontend & pipeline) → run **A3**
   backfill → the three read sites go semantic automatically.
3. **B1–B3** (docx→pptx→pdf) — image atoms + rail contextualization.
4. Hybrid rerank tuning (weight of cosine vs `outcome_score`).

## Risks / gotchas (grounded)
- **Cross-tenant leakage under cosine** — the one that matters; keep `tenant_id` in every vector
  query (RLS won't save you). Add a test that asserts tenant B's atoms never rank for tenant A.
- **Model/dim drift** between the TS helper and `embeddings.py` → corrupt space. Pin both; assert 1536.
- **Zero-vector pollution** — rows written while OFF hold zero-vectors; backfill must sweep
  `embedding = zero`, not just NULL, or cosine returns garbage.
- **Latency** — batch (`embedBatch`) on bulk-approve and atomize; inline only for single/harvest.
- **PDF images** — don't claim coverage you don't have; `log()` the skip.
- **Cost** — `text-embedding-3-small` ≈ $0.02/1M tokens; atom + image-context volume is negligible.

## Verification
- Unit: TS `embed()` returns 1536 dims; null without key.
- DB: after approve, `embedding IS NOT NULL`; `<=>` returns a top hit that is the same-meaning atom;
  tenant-scoped query never returns another tenant's row (fixture with 2 tenants).
- E2E: upload a docx with an image → image atom created with thumbnail in the rail → add
  description + accept → atom embedded → appears in `/library/similar` for a matching section.
- Regression: with `EMBEDDINGS_PROVIDER` unset, all three read sites return exactly today's results.
</content>
