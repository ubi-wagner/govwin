# Multi-granular scope → assist · review · HITL resolution

**Status: PLAN, awaiting sign-off.** Nothing in this document is built beyond the two pure
libraries named in "Already true" below.

The end state: a proposal can be drafted **100% by agents**, then **collaboratively resolved** by
the tenant's people and their external collaborators — with every assist, every review and every
gate addressing a *scope* (a primitive, a group, a section, a page range, or the whole document)
rather than a fixed granularity, and with continuity across the document regardless of where the
panel was opened from.

---

## Already true

| | |
|---|---|
| `lib/types/canvas-document.ts` | ruler composes: `sectionPageSpan` (intra-segment) bounded by `paginate()` (universal fold); break-affinity exhaustive over `NodeType` |
| `lib/canvas/assemble-from-atoms.ts` | atoms → groups → section, budget-fitted by the intra-segment ruler. **No caller.** |
| `lib/canvas/scope.ts` | `resolveScope(doc, selection)` → node · group · section · pages · document, each with content, page range, characters, atom provenance. **No caller.** |
| `scripts/verify-compliance-matrix.mts` | 22 primitives × mixed orders × 7 agency matrices, aggregating through `validateCanvasAgainstSpec` |

## Two asymmetries the grounding exposed

These are not incidental; they set the shape of the work.

**1. Comments went sub-section. Reviews did not.**
`proposal_comments` carries `section_id` **and `anchor`** (mig 183 — span/node anchors).
`agent_task_queue` carries `section_id` and nothing finer. The product already knows how to
address a span; the review queue simply never followed. So Phase A is *following an established
pattern*, not inventing a scoping scheme — and the anchor format should be reused verbatim rather
than parallel-invented.

**2. Collaborator access is coarser than the ladder.**
`collaborator_stage_access` is `(stage, artifact_types, permission)`. An external collaborator is
granted a *stage* and *artifact types* — not a section, and certainly not a node. The scope ladder
reaches primitives; collaborator permission stops several levels above.

This matters for the end goal. "Collaboratively resolved with external collaborators" can mean two
different products:

- **(a)** collaborators keep stage/artifact-level access and *resolve* scoped findings inside what
  they can already reach — no permission change, and Phase F is small;
- **(b)** collaborators are granted access at section or node level — a real permission-model
  change, an RLS surface, and a much larger, riskier phase.

**I have assumed (a).** If you want (b), say so and Phase F is re-planned as its own programme —
it is not a variation, it is a different piece of work.

## One thing that makes Phase E smaller than it looks

There is **no findings table, and none is needed**. A colour-team finding IS a `proposal_comments`
row with `recommendation_type='ai_review'`, and that row already carries `resolved boolean` **and**
`anchor jsonb` (indexed on `anchor->>'nodeId'`). So "resolve a scoped finding" is an UPDATE to a
column that exists, against an anchor that exists. Phase E is a read-and-gate change, not a new
storage model.

## One hazard, named so it cannot bite

The comments API **already overloads the word `nodeId`**, and it means two different things three
lines apart:

```
app/api/.../comments/route.ts:137   AND pc.section_id = ${nodeId}      ← the query param means SECTION
app/api/.../comments/route.ts:194   nodeId: c.sectionId,               ← the response says nodeId, returns SECTION
app/api/.../comments/route.ts:113   anchor: { nodeId?: string; … }     ← the anchor means NODE
```

Any scope work that reads this surface without noticing will wire a node-scoped review to a section
id and be confident about it. **Phase A resolves the collision before it uses the surface** — the
scope vocabulary is `scope_level` + `scope_ref`, and where it touches the comments API it addresses
the anchor's `nodeId`, never the parameter's. I will not silently rename the existing param (that is
a live client contract); I will make the new path unambiguous and note the old one.

---

## Phases

Each phase is independently shippable and independently verifiable. Every one ends green on the
four lenses plus the backbone; none is merged on my own judgement of "done".

### Phase A — the review queue learns scope

Make `agent_task_queue` addressable at the ladder's levels, reusing the comment anchor format.

- Migration: `scope_level` (`node|group|section|pages|document`) + `scope_ref` (jsonb: the anchor
  for a node/group, `{start,end}` for pages, null for section/document). `section_id` stays for
  compatibility and is derived from the scope, never set independently.
- `requestAiReview` takes a scope instead of iterating sections. Section-scoped stays the default,
  so today's behaviour is byte-identical when no scope is passed.
- `color_team_reviewer`'s prompt receives the scope's nodes — from `resolveScope`, so the reviewer
  and the UI cannot disagree about what "this" is.
- `getColorTeamStatus` rolls up per scope rather than per section.

**Risk:** this is a live path on a shared table. Mitigated by the default-to-section behaviour and
by a red-first test that proves a scoped request queues the scoped content and an unscoped one
queues exactly what it queues today.

**Verified by:** migration idempotency, CRUD lens extended to the queue, and a before/after showing
an unscoped request produces an identical row.

### Phase B — the assist bar becomes a function of scope

- The canvas surfaces publish a `Selection`; the right bar renders `resolveScope`'s ladder as a
  breadcrumb with widen/narrow.
- Actions are filtered by level — "regenerate this figure" at node, "re-assemble from library" at
  group/section, "review this page range" at pages, "full draft" at document.
- Continuity: the scope survives navigation. Opening the panel from a page thumbnail, a section
  rail entry, or a click in the fluid document all resolve through the same function, so the panel
  says the same thing about the same content wherever it was opened.

**Verified by:** all four lenses on a real build, plus `verify-surfaces` proving the panel renders
at every level on every surface (doc · deck · sheet).

### Phase C — the groups overlay

`OverlayKey` is `sections | atoms | provenance`. There is **no group chip**, so the layer the
assembler now populates and the resolver now addresses is invisible. Add it, with `keep_together`
rendered distinctly — an author needs to see which runs will move as one.

Small, but it closes a visible inconsistency between the model and the UI.

### Phase D — assemble-from-library, wired

`assembleSectionFromAtoms` has no caller. Give it one: a scoped action that runs
`selectForSection` → assemble → land as a proposed `ai_revision` version (the existing
read-on-review landing, so it goes through the same human gate as everything else — never a direct
write).

**Verified by:** the DB CRUD lens, including the `canvas_versions` numbering invariant
(`proposal_sections.version` must stay ahead of `MAX(version_number)`) which this path must respect.

### Phase E — the HITL gates, made scope-aware

The gates exist (`proposal-advance.ts`, the Studio's three loops, the full-draft review gate). What
they lack is scoped resolution: a gate is passed or not, with no notion of "these four findings are
resolved and those two are not."

- A gate's blocking set becomes the unresolved findings *within its scope* — read off
  `proposal_comments WHERE recommendation_type='ai_review' AND NOT resolved`, filtered by scope via
  `resolveScope`'s node set. No new table (see above).
- Resolving a finding is an explicit human act recorded against the scope, so the gate can state
  exactly what is outstanding and where.
- The AI-manager auto-advance path (TW-8) stays advisory and cannot resolve a human finding.

**This is the phase that makes "100% agent-drafted, then collaboratively resolved" real** — the
draft lands, the findings land against scopes, and the gate is a live checklist rather than a
single boolean.

### Phase F — external collaborators resolve within their grant

Under assumption (a): a `partner_user` sees scoped findings inside the stages and artifact types
they already hold, can resolve or comment on them, and cannot see or act outside that grant. No
permission-model change; the existing `verifyTenantAccess` / stage-access gates stand.

**Verified by:** the CRUD lens's cross-tenant refusal pattern extended to cross-*grant* refusal —
a collaborator's scoped resolve attempt outside their stage must be refused, and that must be
proven, not assumed.

### Phase G — the end-to-end proof

One build, driven start to finish: agent full draft (Mode C) → scoped adversarial review across
several levels → human resolution of some findings → collaborator resolution of others → gates
advance on the resolution set → package exports and passes the compliance matrix.

**Verified by:** the four lenses, the compliance matrix, the ruler safety gates, and a written
narrative of what actually happened with the numbers — not a green tick.

---

## What I will not do without asking

- Change the collaborator permission model (assumption (b) above).
- Let any agent path write business tables directly. Everything lands proposed and a human accepts
  — the workflow engine's invariant, and I will not route around it.
- Touch the demo fixture. Harnesses create and destroy their own scratch builds.
- Treat a green lens as proof on its own where it matters; cross-check by a second method.

## Still open, and genuinely yours

1. **`image`** — suppressed demand or absent. The measurement cannot resolve it (the library holds
   only what the pipeline could emit, which is the thing under investigation).
2. **Collaborator granularity** — assumption (a) or (b).
3. **`assembleSections().totalPages`** — currently a documented upper bound (sections can share a
   page). A true document total means routing through `paginate`; that is a decision about what the
   number is *for*.

## Sequencing note

A → B → C are the spine and should land in order; C is small enough to fold into B if you would
rather see one UI change than two. D is independent and could go earlier if you want the assembler
earning its keep sooner. E depends on A. F depends on E. G depends on all of them.

I would not attempt E before A and B are green on a real build, because a scope-aware gate whose
scope resolution is untested is a gate that blocks the wrong things.
