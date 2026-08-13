# CANVAS_CAPABILITY_ANALYSIS.md — Phase 2: what a person can actually do

> **Historical analysis (Phase 2 snapshot).** Canonical canvas architecture: `docs/CANVAS_ARCHITECTURE.md`.

**Phase 2 of the Common-Canvas redesign.** Phase 1 mapped the machine; this grades the **human**
experience against the four reasons people live in Google Docs / M365 — the ones stated plainly:

> People use those tools not for obscure bells and whistles, but because they can **collaborate**,
> **track & audit**, **easily implement & change**, and **insert & refine** — together, without friction.

Every row is graded from the *user's* side of the screen and anchored to Phase-1 evidence
(`docs/CANVAS_ARCHITECTURE.md`, gaps G1–G17). Grades: **✅ Works** · **🟡 Partial** (there but
incomplete/awkward) · **🟠 Hollow** (looks present, dead-ends or fails in practice) · **⛔ Absent**.

---

## The scorecard — the four jobs

### JOB 1 — COLLABORATE (work on the same thing, together)
| Capability | Grade | What a person hits today | Ev. |
|---|---|---|---|
| Co-edit a doc live (see each other type) | ⛔ | Impossible. Two people open the same section; the 2nd to Save gets *"changed by someone else — reload before saving,"* and **their unsaved edits are gone**. | G1 |
| See who else is here / editing | ⛔ | No presence, no cursors, no "Jane is editing" — the columns for it exist but were never wired. | G1 |
| Share one doc with a teammate | 🟠 | Only a **tenant-admin** can, by emailing an invite that forces the invitee to set a password first. No "share link," no guest, and a contributor can't share their own work. | G9 |
| Add a same-company colleague | 🟠 | Adding them grants edit on **every** proposal in the company — all-or-nothing; you can't share just one. | G9 |
| Comment / discuss in context | 🟡 | Comments work — but attach to a whole **section**, not a sentence; no @mentions, no notifications; and they're **off entirely** for standalone letters/marketing docs. | G5 |
| Change someone's access later | ⛔ | No way to edit a collaborator's permission after inviting — you revoke and re-invite. | G9 |

**Read:** the single most-used verb in these tools — *work together, live, and share easily* — is the weakest we have.

### JOB 2 — TRACK & AUDIT (see and trust what changed)
| Capability | Grade | What a person hits today | Ev. |
|---|---|---|---|
| System-level audit trail | ✅ | Genuinely strong — every actor/agent/automation action is on `system_events` + activity logs. The *record* exists. | (event audit) |
| See a doc's version history | 🟡 | Yes for **proposal sections** — but **standalone documents and library artifacts have no history at all**. Same editor, no safety net. | G6 |
| See who changed what | 🟡 | Per-edit history + version authors exist but are passive; the diff/compare view is built but **never wired**; and history source badges **mislabel** almost everything as "Human Edit." | G5, G14 |
| Restore / roll back to an earlier version | ⛔ | **There is no restore anywhere.** You can *look* at history; you can't return to it. | G2 |

**Read:** we *capture* the truth better than most; we barely let the user *see or use* it — and can't undo.

### JOB 3 — EASILY IMPLEMENT & CHANGE (accept it, apply it, move on)
| Capability | Grade | What a person hits today | Ev. |
|---|---|---|---|
| Apply an AI-generated draft to the doc | 🟠 | The full-draft / Studio agents *stage* a proposed version — but with **no restore path it can never be applied**. "Apply AI-proposed revisions" lands it in history as a dead-end. | G2 |
| Accept / reject a suggested change (track-changes) | ⛔ | No suggestion mode. "Revert" only writes an audit line — it doesn't put the old content back. | G5 |
| Edit without losing work (autosave) | 🟠 | No autosave, no Ctrl+S; a crash or nav-away loses everything since the last manual Save. | G4 |
| Make a change safely with others around | 🟠 | The 409 conflict throws your edits away rather than merging. | G1 |

**Read:** the *"just accept the change and keep going"* loop — the reason AI-in-docs feels magic elsewhere — is broken end-to-end here.

### JOB 4 — INSERT & REFINE (bring content in, then shape it)
| Capability | Grade | What a person hits today | Ev. |
|---|---|---|---|
| Insert from your library / reuse past work | 🟡🟠 | You can pull atoms into a section; but reusing a **whole prior proposal** is **admin-only**, **blind to anything you *uploaded***, and "save as template → start my next bid from it" **isn't wired**. | G16 |
| Get AI help in the doc ("help me write") | 🟡 | Real, but a **sidebar panel** (select a block → switch tabs → click) — no inline/at-cursor/slash prompt; and it's **off for standalone docs**. | G10 |
| Insert an image and have it survive | 🟠 | An **uploaded image never appears in the docx/pptx/xlsx download** — it exports as `[Image: alt]` text. | G3 |
| Refine formatting / structure | 🟡 | Only whole-block formatting (no inline bold-this-word); the section/layout intent is flattened away and unmanageable. | §1.1 |
| Download something that looks right | 🟠 | No compliance check on the whole-proposal export; three page-count estimators disagree on the #1 disqualifier; TOC/equations/links degrade. | G11, G12 |

**Read:** insertion works; *reuse of your own past work* (the biggest time-saver) and *faithful output* are where it breaks.

---

## Cross-cutting reality: "one canvas" is actually three
The same editor is a first-class AI-and-collaboration surface for a **proposal section**, but a stripped shell
for a **standalone letter/flyer/marketing doc** (no AI, no comments, no history, no review) and a third thing
again for a **library foundation** — with three different storage types, lock models, and history contracts
(G6, G7). A user who writes a support letter gets a visibly poorer tool than one who writes a proposal
paragraph, for no reason they can perceive.

## Actor reality check (can each actor do the four jobs?)
- **Tenant proposal builder (tenant_user):** edits everything, but can't share selectively, can't co-edit live, can't restore, can't apply an AI draft in one click, can't reuse an uploaded past proposal. The paying user hits every wall.
- **Tenant admin:** the only one who can invite/share — so *sharing is a bottleneck through one person*.
- **Collaborator / partner_user:** section-scoped and audited (good), but locked to one company per login, whole-doc-download-only in vaults, comment-only in practice.
- **RFP admin:** god-view + curation is strong, but has **no way to seed a winning example or template into libraries** except by impersonating a tenant (G8).
- **Agents/automation:** produce good drafts that **can't be landed** (G2) and never touch one-off artifacts (G7).

---

## Verdict — table-stakes vs enhancements
The strengths are **machine-facing** (node model, presets, compliance spec, a 36-agent workforce, an
airtight event ledger). The gaps are **exactly the human table-stakes** the four jobs name:

**Table-stakes we're missing (fix these to be credible):**
1. **Apply / accept a change** — one-click apply of an AI draft or a suggested edit *(J3, G2)*.
2. **Restore a version** — the universal safety net *(J2, G2)*.
3. **Co-presence + safe concurrent edit** — at minimum "who's here" + a merge/queue that never eats work *(J1, G1)*.
4. **Easy, granular sharing** — share one doc, link or guest, editable permissions, self-serve *(J1, G9)*.
5. **Autosave** *(J3, G4)*.
6. **Reuse your own past work** — including uploads, self-serve, template→new-bid *(J4, G16)*.
7. **One consistent canvas** — same collab/history/AI everywhere, incl. letters & marketing *(cross-cutting, G6/G7)*.
8. **Images + compliance survive the download** *(J4, G3/G11)*.

**Enhancements (after table-stakes):** anchored/inline comments + @mentions/notifications, inline "help me
write," true track-changes suggestion mode, live cursors, the richer export-fidelity items (TOC field,
equations, hyperlinks).

---

## What Phase 3 (adversarial, human lens) must stress-test
1. Is the table-stakes list **right and complete** from a *real user's* first week — or am I still thinking like the machine? Walk each actor through a real task (build a bid with a teammate; write a support letter; reuse last year's win) and find where they'd rage-quit.
2. Does "async-collaborative, real-time-ready" actually satisfy the collaborate/track/change jobs, or does it quietly require live co-editing to feel like Docs?
3. Which gaps are **load-bearing for stickiness** vs which merely *look* bad — and what's the smallest set that flips the feel from "capable government tool" to "I never want to leave this."
4. Sequencing: which fixes **unlock** others (e.g., restore is a prerequisite for the AI-apply loop AND for version-trust)?

_Phase 2 complete. Phase 3 = multi-agent adversarial critique of THIS analysis through the human lens; Phase 4 = the sequenced TODO. Execution gated on sign-off._
