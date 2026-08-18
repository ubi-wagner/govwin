# Ingest provenance — where every compliance value came from

**Canonical.** Read this before touching `lib/ingest/*`, `solicitation_compliance`, or the
compliance panel in the curation workspace.

The rule this whole subsystem exists to enforce:

> **A value the product did not read from the solicitation must never look like one it did.**

A compliance matrix is a contract. A page limit, a minimum font size, a volume list — a customer
builds a submission against those numbers and gets rejected if they are wrong. So every value
carries where it came from, the UI shows it, and the fallbacks are visibly fallbacks.

---

## What went wrong (the case this was built from)

Driving the real **DoW 2026 SBIR BAA** through admin ingest, the matrix came back:

```
page_limit_technical | 10
font_family          | Times New Roman
volumes              | 6
```

…and came back **byte-identical whether the shredder had extracted 0 characters or 165,268**.

Those are `DEFAULT_SBIR_CSO_SKELETON` (`lib/ingest/skeleton.ts`) — a deliberate fallback so one
click always yields a workable starting skeleton. The intent was sound. Two things were not:

1. **The presentation.** The defaults landed in `solicitation_compliance` indistinguishable from
   values actually read out of the document.
2. **The timing.** Upload only *emits* `finder:rfp.uploaded`; `OnRfpUploaded` shreds
   asynchronously. Ingest Assist fired immediately after upload — so at that instant `full_text`
   was empty, and the "parse" was never anything but the defaults.

For this BAA the defaults are wrong in ways that sink a submission:

| Field | Default asserted | What the BAA actually says |
|---|---|---|
| Page limit | 10 | **No number** — deferred to Component-specific instructions |
| Typeface | Times New Roman | **No typeface mandated**, only "no type smaller than 10-point" |
| Volumes | 6 | **7** — adds Vol 7, Disclosures of Foreign Affiliations |
| Artifact | "white paper" | A full Technical Volume |

---

## The three layers

`parseSolicitation` (`lib/ingest/parse-solicitation.ts`) merges three layers **per field**,
strongest first. Each field records the layer that actually set it.

### 1. `pattern_match` — deterministic, cited
`lib/ingest/pattern-extract.ts`. Reads the shredded text and lifts only rules stated
unambiguously, each with the sentence it came from, its character offset, and its page. No API
key, no network, no model: same text in, same rules out.

It is deliberately narrow, and that is the feature:

- **Extracts only what it can prove.** A field with no confident match is simply absent.
- **Absence is itself a finding.** When the document says the rule lives elsewhere, that is
  recorded as a **deferral** — a positive statement that this document sets no such rule.
  Silence and deferral are different facts.
- **Every value is cited**, which is why it outranks `ai`: the value is not merely asserted, it
  is checkable in one glance.

Currently reads: minimum font size · margins · paper/column/spacing (composed into
`submission_format`) · typeface (only when a real typeface name sits beside a font token) ·
technical-volume page limit (positive forms **and** deferrals) · the numbered volume list · the
mandated Technical Volume section order · deadline time, media bans, encryption bans (as notes).

### 2. `ai` — broader, unanchored
The model parse. Fills what layer 1 could not prove, and supplies what patterns cannot see:
topics, per-volume items, cost caps. Every numeric is clamped before it can reach the DB, and
the solicitation text is fenced as untrusted data.

### 3. `default` — the fallback floor
`DEFAULT_SBIR_CSO_SKELETON`, so one click still yields a workable starting skeleton — marked
`default` so the UI flags it red as unverified.

**Volumes** follow the same precedence with one refinement: the document's own numbered list
sets the names, count, and order, and each volume then takes its *items* from the first donor
that **names** it (AI parse, else the default molds). Matching is by name, never by index — the
donors have their own count and order, and an index graft would file the Cost Volume's items
under the Technical Volume. A volume no donor names gets no items rather than borrowed ones.

---

## Trust order

```
hitl > verified > override > pattern_match > ai > default
```

| Tier | Meaning | Badge |
|---|---|---|
| `hitl` | A curator **highlighted it in the source** — carries a `SourceAnchor` (page + excerpt + rects) | Highlighted (emerald) |
| `verified` | A curator confirmed/corrected it against the document, unanchored | Verified (green) |
| `override` | Supplied wholesale by an admin-reviewed parse | — |
| `pattern_match` | **Read deterministically off this solicitation's text, with the sentence cited** | Read from source (sky) |
| `ai` | Extracted by the model parse, unanchored | AI (yellow) |
| `default` | **A system fallback — not read from this solicitation at all** | Default — unverified (red) |
| *(deferral)* | The document states the rule lives elsewhere; the NULL is the answer | Set elsewhere (violet) |

A stronger source may overwrite a weaker one silently. The reverse must never happen — a re-run
of Ingest Assist stamping `default` over a curator's `hitl` is a bug.

---

## Storage

`solicitation_compliance.field_provenance` (jsonb, migrations **187** + **188**), keyed by
column name. Minimal entry:

```json
{"font_family": {"source": "default"}}
```

Cited entry:

```json
{"min_font_size": {"source": "pattern_match", "rule": "min_font.no_smaller_than",
                   "page": 19, "excerpt": "no type smaller than 10-point",
                   "charOffset": 64491, "docSegment": 1}}
```

Deferral — the column is NULL and that is the answer:

```json
{"page_limit_technical": {"source": "pattern_match", "deferred": true,
  "reason": "The solicitation defers the technical-volume page limit to the Service/Component-specific topic instructions.",
  "rule": "deferred", "page": 32,
  "excerpt": "refer to Service/Component-specific topic instructions for the page limit",
  "charOffset": 104815, "docSegment": 1}}
```

**`docSegment` matters.** A solicitation's `full_text` is every shredded `solicitation_documents`
row concatenated, so page numbering restarts at each file boundary — the live DoW ingest runs
1…50 (the BAA) then 1…4 (the topic). "p.19" is meaningless without saying p.19 of *which* file.
`page` is null when the extracted text carried no page markers at all; the excerpt is then the
only locator, and the extractor says so in its notes rather than inventing a page.

`field_provenance` holds **current state**. Transitions are separately auditable: the curator
path writes an episodic `curator` memory (`lib/tools/curation-memory.ts`) plus a
`triage_actions` row and a `system_events` entry. "What is it now" reads off the column; "how
did it get that way" reads off the memory/event ledger.

---

## The shred gate

`POST /api/admin/rfp-curation/[solId]/ingest-assist` **refuses** a solicitation with no usable
source text (`< 200` chars) — `409 SOURCE_TEXT_NOT_READY` — rather than writing a default
skeleton that reads like an extraction. The response distinguishes *waiting on a shred* from *no
document uploaded*, so the admin knows whether to wait or to upload.

- `GET` on the same route answers **"can this run yet?"** — `{ready, chars, documents, state}`,
  where state is `ready | shredding | shred_failed | no_document`. The upload form polls it and
  only fires Assist once the text exists (status: *Extracting document text…*), instead of
  racing the shred as it used to.
- An admin who genuinely wants the blank starting skeleton opts in explicitly with
  `allowDefaultSkeleton: true`. The workspace offers this as a second confirm on the 409, and
  says plainly that every value will be marked unverified.
- An admin-reviewed `parsed` body is exempt — it carries its own values and reads no text.

---

## Invariants

1. **Never present a value the product did not read as one it did.** Every write to
   `solicitation_compliance` stamps `field_provenance`.
2. **Never run a "parse" against text that is not there.** Refuse, or make the operator opt in.
3. **Absence is a finding.** A deferral clears the default rather than letting it stand — this
   BAA's page limit is empty *on purpose*, and the UI says why.
4. **The deterministic layer never guesses.** If a rule needs judgement to read, it belongs to
   the AI layer or to a human, not to a regex.
5. **Citations are per document.** Always carry `docSegment`, never claim an unresolved page.

## Files

| Path | Role |
|---|---|
| `lib/ingest/pattern-extract.ts` | The deterministic extractor + its rule table (pure, DB-free) |
| `lib/ingest/parse-solicitation.ts` | Layer merge (pattern → ai → default), per-field provenance |
| `lib/ingest/skeleton.ts` | Parse contract + `DEFAULT_SBIR_CSO_SKELETON` |
| `lib/ingest/materialize.ts` | Writes the matrix + volumes + stamps `field_provenance` |
| `app/api/admin/rfp-curation/[solId]/ingest-assist/route.ts` | The shred gate + the readiness GET |
| `components/rfp-curation/curation-workspace.tsx` | Badge rendering + the 409 opt-in |
| `__tests__/ingest-pattern-extract.test.ts` | Unit proof, fixture = real BAA text |
| `e2e/dow-assist-drive.spec.ts` | Live proof as a real rfp_admin |
| `db/migrations/187…`, `188…` | The column + its documented contract |
