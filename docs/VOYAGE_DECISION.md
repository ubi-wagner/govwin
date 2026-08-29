# Voyage — cost, isolation, and what actually leaves the box

**Question:** should semantic atom retrieval ship enabled for V1?
**Short answer:** the cost is negligible and the in-system isolation is already proven. This is a
**data-governance decision**, not a technical or financial one — and there is one gate missing.

**Code:** `lib/embeddings.ts` · `lib/atom-embed.ts` · mig 171 `atom_embeddings` ·
`docs/SEMANTIC_RETRIEVAL.md`

---

## 1 · What it actually does

The atom selector gains a **vector axis**. When an engine is live, the section's query text is
embedded once and blended into the existing score:

```
blend = cosine(atom, query) · 3   +   ctxMatches · 2   +   outcome_score   +   ln(1+usage)·0.1
```

**Context stays authoritative** — a perfect cosine is worth about 1.5 context tags. Semantics
*assist*; they never override scope. With embeddings off the vector term is 0 and the ordering falls
back to the exact pre-vector tiebreakers: **zero regression** either way.

Three states, and the default is the one people miss:

| State | Set | Behaviour |
|---|---|---|
| **Voyage** | `VOYAGE_API_KEY` | real neural semantics |
| **Local** | `ATOM_EMBED=local` | a deterministic hashed-n-gram embedder — **lexical, not neural** |
| **Disabled** | neither | `selectForSection` is exactly the pre-vector selector — the feature is **off** |

> The local engine is **not a middle ground for production.** It clusters by shared vocabulary and
> character-grams, which is largely what the tag axis already does. It exists to prove the pipeline
> end-to-end with no key and no data leaving the box — a test instrument, not a lite tier.

---

## 2 · Cost — measured, not estimated

`atomEmbedText` sends *title + summary + content*, whitespace-collapsed, **capped at 8,000
characters**. Measured against the real library:

```
853 atoms · mean 725 chars (capped) · p95 3,963 · 618,680 chars total
                                              ≈ 162,811 tokens
```

At voyage-4 ($0.06/M):

| Library size | Tokens | One-off backfill |
|---:|---:|---:|
| 853 (today) | 163 K | **$0.01** |
| 10,000 | 1.9 M | **$0.11** |
| 100,000 | 19 M | **$1.15** |
| 1,000,000 | 191 M | **$11.45** |

**Voyage gives every account 200 M free tokens on the voyage-4 generation** — roughly **one million
atoms of this size, at no cost.**

Ongoing:

- **Queries** are capped at 500 chars (~132 tokens). 100,000 selections/month ≈ 13 M tokens ≈
  **$0.79/month.**
- **Re-embedding is idempotent** via `content_hash` — an atom is re-embedded only when its text
  changes, not on a schedule.
- The Batch API takes another 33% off.
- Cheaper tiers exist (voyage-4-lite at $0.02/M); voyage-4 at $0.06/M is the sensible default.

**Conclusion: cost is not a factor in this decision at any scale you will reach.** Do not let it be
the reason you say yes, and do not let it be the reason you say no.

---

## 3 · Data segmentation — inside our system, this is already strong

`atom_embeddings` (mig 171) is **triple-scoped**, and `scripts/verify-embeddings.mts` asserts all
three live rather than assuming them:

1. **At rest** — zero rows whose `tenant_id` ≠ their atom's tenant. `tenant_id` is `NOT NULL` with an
   FK to `tenants` and `ON DELETE CASCADE`.
2. **RLS** — `FORCE ROW LEVEL SECURITY` with the null-safe `tenant_isolation` policy. As the
   `NOBYPASSRLS` app role: no tenant context → **0 rows**; a tenant context → only that tenant's
   rows; and **a raw ANN search with no app-layer `WHERE` still returns only in-tenant neighbours.**
   That last one is the real test — a vector index that leaked would leak exactly there.
3. **App layer** — `selectForSection` filters `a.tenant_id` *and* joins on
   `ae.tenant_id = a.tenant_id AND ae.model = <active>`.

Every vector is stamped with its `model` and only ever compared within one model, so a local-hash
vector is never cosine-compared against a Voyage one.

**One tenant's atoms can never influence another tenant's retrieval.** There is no shared corpus and
no cross-tenant learning — by design, and correctly. It also means the feature does not compound
across your customer base: each tenant's library benefits only itself.

---

## 4 · Security — the part that is actually a decision

Segmentation *inside* the system is settled. The open question is what **leaves** it.

### What is sent

For each atom: **title + summary + content**, up to 8,000 characters, as plaintext over HTTPS to
`api.voyageai.com`. In this product that is customer proposal content — technical approach, past
performance, teaming, pricing narrative. It is among the most commercially sensitive material a
tenant owns.

### Voyage's default terms

Per Voyage's Terms of Service, unless you opt out you grant a **worldwide, irrevocable, perpetual,
royalty-free licence** to use, copy, reproduce, distribute and prepare derivative works of customer
content **to train and improve the service**.

**There is an opt-out**, and it is the whole ballgame: opting out gives **zero-day retention** for
Voyage-hosted endpoints. It requires a payment method on file and organisation-admin rights.

> **Opt out BEFORE the first embed call.** The licence attaches to content already sent; a later
> opt-out does not retroactively cover the backfill you have already run.

### The gate that does not exist

The product models export control — `solicitation_compliance.itar_required` and
`clearance_required` are real columns, seeded as compliance variables and read by the resolver and
the ingest path.

**Nothing gates the embed path on any of it.** `upsertAtomEmbedding` embeds every atom it is given,
and the backfill selects every atom where `vault_id IS NULL AND archived_at IS NULL`. So an atom
derived from ITAR-flagged work is embedded and transmitted like any other.

The one exclusion that does exist — `vault_id IS NULL` — is the **collaboration-vault** boundary
(mig 134, the segregated external-partner bridge). It keeps partner-scoped content out, which is
correct and useful, but it is about *partner visibility*, not export control. It is not the gate.

**This is not a reason to say no.** It is a thing to decide deliberately, and there are three honest
options:

| Option | What it means |
|---|---|
| **Accept** | opt out of training, treat Voyage as a subprocessor, disclose it in your DPA/privacy terms |
| **Gate it** | skip embedding for tenants or solicitations flagged ITAR/clearance — a `WHERE` clause and a per-atom flag |
| **Per-tenant opt-out** | let a customer switch semantic retrieval off for their library; the feature degrades to tags, which is a real and complete fallback |

---

## 5 · Benefits — platform side

- **Better first drafts.** The drafter's atom selection is what a generated section is *made of*.
  Better selection is less human editing, which is the product's core promise.
- **A bounded failure mode.** Semantics are weighted below context, so a bad embedding produces a
  slightly worse ordering, never an out-of-scope atom. Few AI features degrade this gracefully.
- **It is the cheapest quality lever you have.** At roughly a dollar a year of spend, nothing else in
  the stack has this ratio.
- **It is a real differentiator** against keyword-matching competitors, and it is genuinely hard to
  add later once a library is large — the backfill is easy, the *design* is what is hard, and it is
  already done.
- **A subprocessor to disclose.** Adds one name to your data-handling story. Government-adjacent
  customers will ask.

## 6 · Benefits — tenant side

- **Finding what they wrote.** "Thermal control in additive manufacturing" matches an atom they
  titled "heat management in AM." Tags cannot do that without someone having anticipated the synonym.
- **Visible, not magic.** The insert panel renders a `◈ semantic N%` badge per candidate, so a
  builder can see why something was suggested and overrule it.
- **It flows into Draft-All.** Semantically matched atoms reach the generated draft, not just the
  manual picker.
- **The value compounds with library size — and only then.** At 50 atoms, tags are fine. At 5,000,
  semantic retrieval is the difference between finding the paragraph and rewriting it. That makes it
  a **retention feature**: the longer a tenant uses the product, the more their library is worth and
  the more expensive leaving becomes.

---

## 7 · Recommendation

**Turn it on — after doing three things, in this order.**

1. **Opt out of training in the Voyage account**, before any key reaches a running service. Payment
   method on file, org admin. This is the step that converts the default terms into zero-day retention.
2. **Decide the export-control question** and write the answer down. Accept, gate, or per-tenant
   opt-out. Any of the three is defensible; not having decided is not.
3. **Add Voyage to your subprocessor list** in whatever terms your tenants sign.

Then set `VOYAGE_API_KEY`, run `scripts/embed-atoms.mts` once, and confirm `atom_embeddings.model`
reads `voyage-…` rather than the local engine id — the selector only compares within one model, so a
mixed table silently leaves half the library outside the semantic axis.

**If you are not ready to answer #2 for V1, ship with it off.** The feature is inert by default,
`selectForSection` behaves exactly as it does today, and turning it on later costs one backfill and
about a dollar. That is a genuinely cheap option to keep open — which is the argument for deciding
properly rather than quickly.
