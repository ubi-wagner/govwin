# Ingest Studio — the gated, adversarially-reviewed ingest

> ⚠️ **ONE STALE PATH — verified 2026-09-01 against the tree.**
> `pipeline/src/workflows/ingest_adversarial_overlay.py` does not exist; the adversarial overlay
> shipped as `pipeline/src/workflows/advisory_overlay.py` (the reusable `AdvisoryOverlay`).

**Canonical.** Read with `docs/INGEST_PROVENANCE.md` (what provenance means) and
`docs/AGENT_WORKFORCE.md` (the agent safety contract). This document is the *control flow*;
those two are the *data contract* and the *safety contract*.

---

## The problem this fixes

Today's ingest is one button. `POST …/ingest-assist` parses the solicitation and, in the same
call, **writes `solicitation_compliance` and builds every volume and section mold**. That single
call:

1. **Breaks our own agent invariant.** `docs/AGENT_WORKFORCE.md` states the non-negotiable rule:
   *advisory → guardrail → land-or-review; agent output NEVER auto-writes a business table.*
   The compliance matrix is the most consequential business table we own — a customer builds a
   submission against it and is rejected if it is wrong — and it is the one place we skipped the
   gate.
2. **Conflates two different jobs.** Reading rules out of a document (*did we read it right?*)
   and authoring molds from those rules (*is this the right shape to respond in?*) have different
   failure modes, different expertise, and different reviewers. Fused, a misread page limit
   silently becomes a wrong mold, and nobody can tell which step was at fault.
3. **Has no adversarial pass.** Nothing ever tries to *disprove* an extracted value before a
   customer builds on it.

## What changed underneath that makes this worth doing now

The deterministic extractor (`lib/ingest/pattern-extract.ts`) gives an adversarial reviewer
something **checkable**. Every `pattern_match` value carries the sentence it came from, its page,
and which document. Every `default` is a claim with nothing behind it. So "refute this matrix"
stops being a vibe and becomes a verifiable question: *does p.2 of document 2 actually say the
Technical Volume may not exceed 10 pages?*

Without citations, an adversarial gate is theater. With them, it is an audit.

---

## The four gates

```
   ┌── shred (OnRfpUploaded, unchanged) ────────────────────────────────┐
   │  every rule-bearing document → extracted_text → full_text          │
   └────────────────────────────────────────────────────────────────────┘
                                  ↓
  1. EXTRACT      ingest_analyst          text → structured reading
                                  ↓
  2. MATRIX       matrix_stager           reading → a STAGED matrix        ← nothing landed yet
                                  ↓
  3. REVIEW       curation_qa × N lenses  refute the staged values
                  advisory_manager        reconcile → verdict
                                  ↓
  4. LAND         (human or auto)         staged → solicitation_compliance ← the only writer
                                  ↓
   ┌── MOLDS (separate manager) ────────────────────────────────────────┐
   │  reads ONLY a landed matrix → volumes + section molds + templates   │
   └────────────────────────────────────────────────────────────────────┘
```

**No new archetypes.** All five actors are already registered and were dormant:
`tool.solicitation.ingest`→`ingest_analyst`, `tool.matrix.stage`→`matrix_stager`,
`tool.curation.qa`→`curation_qa`, `tool.advisory.reconcile`→`advisory_manager`,
`tool.skeleton.build`→`skeleton_architect`. We are at 36 archetypes with most asleep; the fix
for that is to wake them, not to mint more.

### Why REVIEW comes after MATRIX, not before

An adversarial pass needs an artifact to attack. You cannot review a matrix that does not exist.
So the matrix is **staged** — proposed, complete, inspectable — and the gate stands between
staging and landing. This is the same shape as the full-draft cohort's read-on-review landing
(`docs/FULL_DRAFT_LANDING_DESIGN.md`): produce into a staging area, review, then a human or an
explicit auto-policy promotes it.

---

## State

`curated_solicitations.ingest_phase` (mig 189), the same idiom as `proposals.studio_phase`:

| phase | meaning |
|---|---|
| `not_started` | no ingest run yet |
| `extract` | ingest_analyst running / awaiting its gate |
| `matrix` | matrix_stager has staged a matrix / awaiting its gate |
| `review` | the adversarial cohort has produced a verdict / awaiting its gate |
| `landed` | the matrix is in `solicitation_compliance` |
| `molds` | the mold manager is authoring volumes + section molds |
| `complete` | molds authored; ready for the existing curation/QA → push flow |

`solicitation_compliance_drafts` (mig 189) holds the staged matrix:

- `parsed` — the whole `ParsedSolicitation` (compliance + volumes + topics)
- `field_provenance` — per-field source + citation, identical in shape to the landed column
- `audit` — the deterministic `auditProvenance()` result at staging time
- `review` — the adversarial verdict once phase 3 runs
- `status` — `staged | reviewed | landed | superseded | rejected`

A draft is immutable once landed. Re-running a phase supersedes the prior draft rather than
mutating it, so "what did we propose, what did the reviewers say, and what did we land" is
answerable forever.

---

## HITL vs auto

Per phase, the admin gets exactly three affordances — the Proposal Studio vocabulary, because an
admin who has learned one should have learned both:

| control | effect |
|---|---|
| **Comment + regenerate** | the comment is threaded into the phase's agents as `guidance`; the phase re-runs and supersedes its draft |
| **Approve → next** | advance to the next phase |
| **Run all automatically** | chain every remaining phase; each still records its verdict, nothing is skipped |

Autonomy is **not** a new mechanism. The global automation-policy layer (#190) is where per-tenant
/ per-phase autonomy belongs; `advance_ingest_phase` reads the policy and falls back to manual.
Until a policy says otherwise, every gate is human.

### The one gate that is never auto

**Landing with an unresolved blocker.** If the provenance audit reports a blocker — an unresolved
deferral with no rule-bearing document on file, or a matrix where nothing at all was read — the
land step refuses even under `auto`, and parks a human. An automation policy may decide *how much
review* a good matrix needs; it may not decide to publish a matrix we know is unfounded.

---

## The adversarial pass, concretely

`IngestAdversarialOverlay`, cloned from `AdvisoryOverlay` (same six overlay parameters, same
bounded fan-out, same reconcile-then-land shape). The differences:

- **Target** is `tool.curation.qa` (platform-scope, admin-side) rather than the tenant-side
  continuity reviewer.
- **Lenses** are chosen for what actually goes wrong in an extraction:
  - `citation` — *for every value claiming to be read, does the cited excerpt actually support it?*
  - `completeness` — *which binding rules in the source have no row at all?*
  - `consistency` — *do the volumes, the required sections and the compliance values contradict
    each other or the source?*
- **Subject** is the staged draft, fenced as untrusted content alongside the source text.

Reconcile (`advisory_manager`) applies the resolution rule and produces a verdict. Advisory
throughout: it never writes `solicitation_compliance`, never advances a phase, never pushes.
The verdict lands on the draft row; a human or the auto-policy decides what to do with it.

---

## Invariants

1. **One writer.** `solicitation_compliance` and `solicitation_volumes` are written by the LAND
   step alone. No agent, no parse, no route writes them directly.
2. **Staging is not landing.** A staged matrix is inspectable and supersedable and has no effect
   on any tenant.
3. **The adversarial pass is advisory.** It produces a verdict, never a write and never an advance.
4. **A blocker beats an auto-policy.** Automation may reduce review; it may not publish a matrix
   with a known-unfounded value.
5. **Molds read a landed matrix only.** The mold manager cannot see a staged draft, so a mold can
   never be built on a value that was never approved.
6. **No dead ends.** Every phase's agents are independent and safe-skip; a failed agent leaves the
   phase at its gate with a human able to act, never a stuck instance.

---

## Files

| Path | Role |
|---|---|
| `db/migrations/189_ingest_studio.sql` | `ingest_phase` + `solicitation_compliance_drafts` |
| `frontend/lib/ingest/stage-skeleton.ts` | `stageSkeleton()` / `landSkeleton()` — the split |
| `frontend/lib/ingest/provenance-audit.ts` | the deterministic evidence the review reasons over |
| `frontend/app/api/admin/rfp-curation/[solId]/ingest-phase/route.ts` | start / regenerate / approve / auto |
| `frontend/components/rfp-curation/ingest-studio.tsx` | the 4-gate panel |
| `pipeline/src/workflows/on_ingest_phase_requested.py` | the four phase workflows |
| `pipeline/src/workflows/ingest_adversarial_overlay.py` | the color team |
| `pipeline/src/workflows/actions/ingest_actions.py` | `advance_ingest_phase` (the state machine) |
