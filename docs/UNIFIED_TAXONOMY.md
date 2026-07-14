# Unified Library Taxonomy + Hand-Atomization (greenfield)

ONE tag scheme for the whole library — every dimension has a curated SBIR/STTR
vocabulary **plus `other`** so nothing is un-taggable. Atoms range from **primitives**
(one bio, one figure) to **groups** (a whole "Team" section for an Army proposal).
**Sections and volumes speak the exact same tags**, so matching an atom to a section is
one dimension-overlap query. Replaces the four conflicting category vocabularies
(`section_standards` / atom-review dropdown / import patterns / `SECTION_CATEGORY_MAP`)
with a single seeded `taxonomy_terms` table — greenfield, like the cards.

**Rule of the model:** a tag is always `dimension:value`. A dimension's `value` is either
a curated slug from `taxonomy_terms` or a free string flagged `other` (for open dims like
tech/party/sol/topic). Atoms carry whatever dimensions apply; sections declare the
dimensions they *want*; the selector scores by overlap. Keep it lean — most atoms need 3–5 tags.

---

## 1. The taxonomy — dimensions + SBIR/STTR vocab (+ `other` everywhere)

### Mold identity
**`vol:` — volume / section role** (what kind of section this is; the mold's identity)
> `cover · abstract · summary · overview · technical · work_plan · milestones · deliverables · key_personnel · past_performance · related_work · commercialization · facilities · equipment · cost · cost_narrative · certifications · support_letter · transition_plan · data_rights · other`

**`kind:` — content kind** (what the atom *is*, semantically)
> `narrative · bio · headshot · figure · diagram · table · chart · budget_data · past_perf_blurb · boilerplate · certification · letter · citation · resume · other`

**`grain:` — granularity** (individual vs aggregate)
> `primitive` (one object — "Eric Wagner bio", "product image") · `group` (an aggregate with richer context — "Team for Army proposal", a whole Technical section)

**`fmt:` — format affinity** (how it natively renders / best fits)
> `doc · slide · sheet · form · image · other`

### Opportunity context — the Department:Agency:Solicitation:Topic chain
(set by the admin at harvest, or stamped automatically at portal lock from the opp card)
- **`dept:`** > `dod · hhs · dhs · doe · nasa · usda · doc · dot · ed · other`
- **`agency:`** > `army · navy · air_force · space_force · darpa · mda · dha · socom · dla · nih · nsf · other`
- **`program:`** > `sbir · sttr · baa · ota · cso · other`
- **`phase:`** > `phase_1 · phase_2 · phase_3 · direct_to_phase_2 · other`
- **`sol:`** > free identifier (the solicitation number) · **`topic:`** > free identifier (the topic number)

### Subject — who / what the atom is about
- **`tech:`** — tech focus area (free + `other`): e.g. `autonomy · ai_ml · rf · cyber · space · sensors · materials · biotech · human_systems · other`
- **`party:`** — a named person or org (free): `eric_wagner · acme_corp · …`
- **`party_role:`** — the relationship > `employee · collaborator · customer · supplier · partner · prime · subcontractor · other`

### Access
**`access:`** — visibility / role > `admin_only · tenant · owner_only · shared_for_proposal`

That's the whole scheme: **4 mold dims + 6 context dims + 3 subject dims + 1 access dim.** Every
curated dim ends in `other`; open dims (`tech/party/sol/topic`) are free strings.

---

## 2. Atoms — primitive → group (worked examples)

| Atom | grain | Tags it carries |
|---|---|---|
| Eric Wagner bio | `primitive` | `kind:bio · party:eric_wagner · party_role:employee · fmt:doc · vol:key_personnel` |
| Product X hero image | `primitive` | `kind:figure · party:product_x · party_role:product · fmt:image` |
| Past-performance: Army C5ISR | `primitive` | `kind:past_perf_blurb · vol:past_performance · agency:army · dept:dod · tech:autonomy` |
| **"Team for Army Autonomy"** | **`group`** | `vol:key_personnel · agency:army · dept:dod · program:sbir · tech:autonomy · fmt:doc` — **aggregates** the Wagner bio + 3 other bios + an org-chart figure |

A **group** atom is a first-class atom whose content is the ordered aggregate of its member
primitives (an `atom_members` edge list) — so you can pluck "Team for Army" as one unit, or
drop in a single bio. This is the "click multiple deconstructed objects and group them" output.

---

## 3. Sections & volumes speak the same tags

A **volume** is just a `vol:` value (Summary, Technical, Cost, Commercialization, Certifications,
Support Letter …). A **section mold** (from the template) declares what it wants in the *same* tags:
its `vol:`, its `fmt:` (doc/slide/sheet), and the `kind:`s it expects — plus it inherits the
opportunity's `dept:/agency:/program:/phase:/topic:` from the card and the topic summary.

**Selecting the fill = one overlap query, scored (pre-vector, from SECTION_SPINE_DESIGN §3):**
1. **Scope:** atoms where `vol:` matches (or `kind:` ∈ the section's expected kinds), `access:` permits, `status=approved`.
2. **Context boost:** `+` for each of `agency:/program:/phase:/tech:` the atom shares with the section's opp card. (Exact agency+tech ranks above generic.)
3. **Lexical:** overlap of the section's topic-summary/prompt with the atom's `summary`.
4. **Quality/recency:** `outcome_score` → `usage_count` → recency.
5. Embeddings later add one cosine term inside this scope — the tags stay the recall gate.

The shortlist is fed to the drafter, which **reprompts the atoms into the mold** (bounded by the
word budget — already enforced) *or* free-flows several atoms into one section. Same tags drive
both the admin's manual pluck-and-place and the AI's pick.

---

## 4. Upload → hand-atomization UX (redo the canvas surface)

On upload the admin/user picks the disposition — **nothing is auto-atomized**:

- **Reference-only** — keep the whole doc as a single `reference` atom (`is_seminal`, viewable/
  downloadable, never shredded). Good for RFPs and source docs you cite but don't reuse verbatim.
- **Hand-shred** — the doc is **deconstructed into selectable OBJECTS** (headings, paragraphs,
  figures, tables, lists) rendered as blocks on the canvas surface (reuse the CanvasNode model —
  each object is a node). Then:
  1. **Draw an annotation box over / shift-click multiple objects** → **"Make atom from selection."**
  2. The selection's content is **aggregated into one atom** with computed **size** (word/char count);
     `grain:group` if >1 object, else `primitive`. A group records its member objects.
  3. A **tag panel** opens pre-filled with inferred tags (`kind:` from object type, `vol:` from the
     nearest heading, `dept:/agency:/program:/topic:` inherited from the source doc or the opp card)
     — the **admin adds the subject tags** (`party:`, `party_role:`, `tech:`) and a one-line `summary`.
  4. **Only what you box becomes atoms**; the rest stays reference or is dropped. "Shred your own docs
     by hand and only atomize the content you really like."

Harvest-on-lock is the same primitive in reverse: at portal lock, accepted section content is
offered for atomization with `dept:agency:sol:topic:` auto-stamped from the card and the admin
adding subject tags.

---

## 5. Greenfield schema (retire library_units fragmentation)

```
taxonomy_terms(dimension, value, label, sort, sbir_relevant, is_active)      -- the ONE seeded vocab (+ 'other' per dim)
library_atoms(
  id, tenant_id, grain,                       -- 'primitive' | 'group' | 'reference'
  content, canvas_nodes jsonb, summary,       -- text + structured body + the one-line match abstract
  word_count, char_count,
  status, confidence, outcome_score, usage_count,
  source, source_ref jsonb, embedding vector(1536) NULL,   -- upload/harvest/manual; embedding later
  owner_user_id, created_at, updated_at )
atom_tags(atom_id, dimension, value, is_other)   -- normalized tags; UNIQUE(atom_id,dimension,value); indexed (dimension,value)
atom_members(parent_atom_id, child_atom_id, ordinal)   -- a group aggregates primitives
```

- **`atom_tags` is the unified taxonomy** — every dimension in §1 is a row; faceting/matching is a
  join, not four disagreeing string maps. `taxonomy_terms` seeds the curated values + `other`.
- **`section_standards` folds into the `vol:` dimension** (one taxonomy for sections *and* volumes *and* atoms).
- **`atom_members`** implements primitive→group.
- Sections carry the same tags in their meta record (SECTION_SPINE_DESIGN §1), so the selector query
  is symmetric. Keep `outcome_score/usage_count/confidence/visibility` (they already work).

Cutover: greenfield the tables; a one-time backfill maps existing `library_units.category/subcategory/
tags/meta` onto `atom_tags` via a fixed crosswalk (fixing `cost_proposal`≠`cost_volume`).

---

## 6. The 30-minute proposal (the point of all this)

1. **Card → portal** provisions sections from the **template molds** (each carries `vol:`, `fmt:`,
   budget, required subsections, regen prompt).
2. Per section, the **selector** pulls the best-matching **tagged atoms** (primitives + groups) by
   the §3 overlap — the customer's own foundational content, already shredded and labeled.
3. **AI regen** composes those atoms **into the mold** (bounded by the word budget — shipped) or
   free-flows several into one section; the admin can pluck/swap atoms in the picker (same ranking).
4. **Collaborators accept, admin locks, stage advances** (SECTION_SPINE_DESIGN §4).

One person + AI agents, existing templates + a tagged library ⇒ a whole SBIR/STTR proposal in ~30 min.

---

## 7. Greenfield vs kept
- **Greenfield:** `taxonomy_terms`, `library_atoms`, `atom_tags`, `atom_members`; the upload
  disposition (reference vs hand-shred) + annotation-box grouping UX; the `vol:` volume taxonomy
  replacing the 4 vocabularies.
- **Kept/extended:** the CanvasNode model (objects = nodes; atoms store `canvas_nodes`), the scored
  selector + `outcome/usage/confidence/visibility` signals, the section meta record + word-budget
  guardrails (shipped), the harvest-on-lock hook.
- **Deferred:** embeddings (populate `library_atoms.embedding` as we go; add the cosine term to §3).

Lean, SBIR/STTR-shaped, one taxonomy, `other` everywhere — the framework is unified and each
dimension has a common curated set with an escape hatch, exactly as specified.
