# Content queue — program-primer guides drafted + queued for review (#168)

The platform serves **SBIR · STTR · BAA · OTA · CSO · Grants**, but the published front-facing
guides only covered **SBIR/STTR** (and DSIP). This drafts the four missing **program primers** and
queues each for the admin to review + publish — nothing goes live until a human publishes it.

## What was authored

Four `guide` documents, authored **canvas-native** through the real Content Studio pipeline
(markdown → `canvasFromDocBody` → CanvasDocument → HTML projection), landed as **drafts**:

| Guide | Slug | Covers |
|---|---|---|
| What Is a BAA? Broad Agency Announcements in 5 Minutes | `what-is-a-baa` | FAR 6.102/35.016 research solicitation; white-paper → full proposal; DARPA/ONR/AFRL |
| What Is an OTA? Other Transaction Agreements Explained | `what-is-an-ota` | 10 U.S.C. §4021/4022/4023; prototype → follow-on production; consortia |
| What Is a CSO? Commercial Solutions Openings, Explained | `what-is-a-cso` | 10 U.S.C. §3458; solutions-based commercial buy; pitch-first; DIU |
| Federal Grants & NOFOs: A First-Timer’s Guide | `federal-grants-nofo-primer` | 2 CFR 200 assistance; NOFO on Grants.gov; SF-424 family |

Each is a 5-minute primer in the house style: what it is, how it differs from an SBIR/STTR topic,
who uses it, how to respond, and how the platform helps — closing with the compliance/cost-form tie-in
(e.g. the grants guide points at the **SF-424A** cost form the platform renders).

## How it's queued for review

Each draft raises a **`content_publish` HITL ToDo** (`lib/tasks`) assigned to `rfp_admin`, carrying
the `content_pages` row id as its entity. In the admin queue it shows the **Draft → Review → Publish**
trail with **Open → / Approve·Done / Dismiss**; **Open →** deep-links (`/admin/site/content/[id]` →
resolver) straight into the **Content Studio** editor, where the admin reads the canvas, edits, and
**Publishes** — which promotes the draft to `active` and projects the public HTML.

![content-review ToDos in the admin inbox](assets/content-queue/01-content-review-todos.png)
![a guide open in the Content Studio](assets/content-queue/03-guide-in-studio.png)

## Guardrails

- **Nothing publishes itself.** All four are `status='draft'` (0 active) — the public marketing site
  shows only `active` documents, so none appears on the site until the admin publishes. Verified live.
- **Canvas is the source of truth.** `metadata.canvas` holds the CanvasDocument; the public
  `blocks[0].body` is its server-side HTML projection — a client can't inject an arbitrary body.
- The seed parser handles headings/lists/paragraphs; inline `**bold**`/`*italic*` markers are stripped
  before authoring so the primers read as clean prose (structure carries the hierarchy).

## Durability

Captured as **migration 176** (`176_seed_program_guide_drafts.sql`) — the four draft rows + their
content_publish ToDos, `ON CONFLICT (id) DO NOTHING` — so on a fresh deploy the guides arrive already
drafted and queued for the admin to review. Authored by `scripts/seed-program-guides.mts`.

## Verdict

Four accurate program primers (BAA · OTA · CSO · Grants/NOFO) drafted canvas-native and queued for
review via the real `content_publish` HITL flow — proven live (drafts land, ToDos surface, the guide
opens in the Studio, nothing is public until published). Durable via mig 176. `tsc` 0 · `vitest` 1085.
