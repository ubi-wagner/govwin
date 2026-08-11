# Semantic Retrieval — the vector axis on the atom library

**Status:** built + proven (mig 171). **Inert by default** — no engine, no rows, `selectForSection` is
byte-for-byte the pre-vector selector until an engine is switched on.

## Why

The atom selector (`lib/atoms.selectForSection`) found reuse candidates for a section by **taxonomy
overlap** — shared `vol`/`kind` tags and opp-card context (agency/program/phase/tech/dept). That misses
atoms that are *about the same thing* but tagged differently: an atom on "additive manufacturing
throughput" never surfaces for a section on "print speed" if they share no tag. This adds a **semantic
axis** — one embedding per atom — so meaning, not just labels, drives retrieval. It's the anticipated
successor the selector comment already called out ("the scored selector (pre-vector)").

## Engines (gated exactly like vision/OCR — `lib/embeddings.ts`)

| Mode | Trigger | Behavior |
|---|---|---|
| **Voyage** (prod) | `VOYAGE_API_KEY` set | Voyage AI (Anthropic's recommended embeddings partner). `voyage-3.5`, 1024-d, called via `fetch` — **no SDK/install**. Real neural semantics. `EMBED_MODEL` overrides the model. |
| **Local** (offline) | `ATOM_EMBED=local` | A deterministic, dependency-free hashed-n-gram embedder (word uni/bi-grams + intra-word char-3-grams, signed-hashed into 1024 dims, L2-normalized). **Lexical**, not neural — it clusters by shared vocabulary. Exists so the whole pipeline is real + provable with **no key and no data leaving the box**. |
| **Disabled** (default) | neither | `embedTexts` → `null`; `selectForSection` degrades to pure tag-ranking. |

Every vector is stored with its `model`, and the selector only ever compares **within one model**, so a
`local-hash-v1` vector is never cosine-compared against a `voyage-3.5` one. Best-effort everywhere: a
failed embed yields `null` and the caller degrades — it never throws into a request path.

## Schema (mig 171 `atom_embeddings`)

One row per atom: `atom_id` PK → `library_atoms` (ON DELETE CASCADE), `tenant_id`, `model`, `dim`,
`content_hash` (sha256(model‖text) → skip re-embed when unchanged), `embedding vector(1024)`. Indexes:
`(tenant_id)`, `(tenant_id, model)`, and an **HNSW** cosine index. Column is fixed at 1024; both engines
emit exactly `EMBED_DIM`.

## Isolation — proven on three layers (`scripts/verify-embeddings.mts`)

The user's hard requirement: **no leakage across tenants**. The vector index enforces it three ways, and
the proof drive asserts all three live:

1. **At rest** — zero rows whose `tenant_id` ≠ their atom's tenant.
2. **RLS** — `atom_embeddings` is `FORCE ROW LEVEL SECURITY` with the same null-safe `tenant_isolation`
   policy as mig 136. As the `NOBYPASSRLS` app role (`govtech_app`, the prod cutover role): no tenant
   context → **0 rows**; a tenant context → **only** that tenant's rows; and a **raw ANN with no app-layer
   `WHERE`** still returns only in-tenant neighbors. (Today the app connects as the `govtech` superuser,
   which bypasses RLS, so isolation rests on the app-layer `WHERE` below — single-layer, exactly as the
   RLS-cutover doc describes; RLS is the armed second layer.)
3. **App layer** — the `selectForSection` query filters `a.tenant_id` **and** joins `atom_embeddings` on
   `ae.tenant_id = a.tenant_id AND ae.model = <active>`. Triple-scoped: `WHERE` + `JOIN` + RLS.

`atom_embeddings` is greenfield — **every** access path goes through `withTenant()` (which `SET LOCAL`s
`app.tenant_id`), so forcing RLS is airtight *and* safe (no legacy caller reads it outside a tenant frame).

## Hybrid ranking (`selectForSection`)

When an engine is live, the section's query text (explicit `q.text`, else derived from `vol`+`kinds`+
`context`) is embedded once and blended into the score:

```
blend = cosine(atom, query) · 3   +   ctxMatches · 2   +   outcome_score   +   ln(1+usage)·0.1
```

Context stays authoritative (a perfect cosine ≈ 1.5 context tags); semantics **assist, never override**
scope. With embeddings **off**, `blend`'s vector term is 0 and the `ORDER BY` falls back to the exact
pre-vector tiebreakers — **zero regression**. `RankedAtom.vectorSim` carries the cosine (or `null`).

## Writing vectors

- **On create** — `createAtom` calls `upsertAtomEmbedding` **post-commit** (gated, best-effort), so a
  provider network call never holds a business transaction open (`lib/atom-embed.ts`).
- **Backfill** — `scripts/embed-atoms.mts` (`ATOM_EMBED=local` or a key) re-embeds every approved,
  non-archived, non-reference atom; idempotent via `content_hash`.

## Turning it on

- **Prod (neural):** set `VOYAGE_API_KEY` (+ optionally `EMBED_MODEL`), run the backfill once.
- **Offline/demo (lexical):** `ATOM_EMBED=local`, run the backfill.
- **Off:** unset both — the library behaves exactly as before.
