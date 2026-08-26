/** #168 CONTENT-QUEUE — draft + queue program guides (BAA · OTA · CSO · Grants/NOFO) for review.
 *
 * The platform serves SBIR/STTR/BAA/OTA/CSO/Grants, but the published guides only cover
 * SBIR/STTR/DSIP. This authors the four MISSING program primers as canvas-native DRAFTS via the
 * real Content Studio pipeline (canvasFromDocBody → saveDocumentDraft) and QUEUES each for the
 * admin to review + publish in the Studio (a content_publish HITL ToDo). Nothing goes live until
 * a human reviews it. Idempotent: re-run replaces the draft + re-queues.
 *
 * cd frontend && DATABASE_URL=… node --import tsx scripts/seed-program-guides.mts
 */
import postgres from 'postgres';
import { canvasFromDocBody } from '@/lib/content-canvas';
import { saveDocumentDraft } from '@/lib/content-admin';
import { createTask } from '@/lib/tasks/tasks';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://govtech:changeme@localhost:5432/govtech_intel', { max: 3 });
// Author/reviewer: a real master_admin (created_by + task assignee bucket).
const USER = { id: '3667ead2-3b5e-4cc8-97f7-b2ab1cfa907d', email: 'eric@rfppipeline.com' };

interface Guide { slug: string; title: string; excerpt: string; tags: string[]; body: string; }

const GUIDES: Guide[] = [
  {
    slug: 'what-is-a-baa',
    title: 'What Is a BAA? Broad Agency Announcements in 5 Minutes',
    excerpt: 'How Broad Agency Announcements fund basic and applied research — and how to respond to one.',
    tags: ['BAA', 'research', 'DARPA', 'getting-started'],
    body: `# What Is a BAA?

A **Broad Agency Announcement (BAA)** is a competitive solicitation an agency uses to fund **basic and applied research** — work that advances science and technology without pointing at one specific system the government already knows it wants to buy. BAAs are authorized under FAR 6.102(d)(2) and 35.016, and evaluated through **scientific/peer review** rather than a lowest-price bid.

## How a BAA differs from an SBIR/STTR topic

- **Open-ended, not topic-locked.** An SBIR topic asks for a specific innovation on a fixed cycle. A BAA states a broad research interest and invites *your* idea against it.
- **Rolling windows.** Many BAAs stay open for a year or more with periodic submission dates, not a single close date.
- **Any organization.** BAAs are generally not small-business-set-aside — universities, large primes, and small businesses all compete (though some have small-business tracks).
- **Two-step submission.** Most agencies want a short **white paper** first; if it's encouraged, you're invited to submit a **full proposal**.

## Who uses them

DARPA, the Office of Naval Research (ONR), the Air Force Research Laboratory (AFRL), the Army Research Office (ARO), and many science agencies run standing BAAs. DARPA's program-specific BAAs are the best-known example.

## How to respond

1. **Read the research areas.** Map your capability to a named thrust or program manager's interest.
2. **Send a white paper.** A few pages: the idea, why it's novel, the technical approach, and rough cost. This is a go/no-go gate — treat it as your pitch.
3. **Wait for encouragement.** Agencies reply "encouraged" or "not encouraged." Only invest in a full proposal if encouraged.
4. **Write the full proposal.** Technical volume + cost volume, to the BAA's page limits and format.

## How this platform helps

When a BAA is curated onto your opportunity cards, the compliance side captures its page limits, format, and evaluation factors, and the Proposal Studio drafts the technical and cost volumes against them — white-paper first, full proposal on encouragement. The cost volume renders in the form the agency requires.`,
  },
  {
    slug: 'what-is-an-ota',
    title: 'What Is an OTA? Other Transaction Agreements Explained',
    excerpt: 'Other Transactions fund prototypes and research outside the FAR — often through consortia. Here is how they work.',
    tags: ['OTA', 'prototype', 'consortium', 'getting-started'],
    body: `# What Is an OTA?

An **Other Transaction (OT) agreement** is a funding instrument the Department of Defense (and a few civilian agencies) uses **outside the Federal Acquisition Regulation**. Congress created OT authority to let the government work with innovators — especially **nontraditional defense contractors** — without the full weight of FAR-based contracting. The core authorities are 10 U.S.C. § 4021 (research) and § 4022 (prototype projects), with a path to follow-on production under § 4023.

## Why OTs exist

Standard FAR contracts carry cost-accounting, IP, and compliance requirements that many commercial and early-stage companies can't (or won't) take on. OTs are **negotiated agreements** — terms, IP, and milestones are tailored to the project — which lowers the barrier for firms that have never sold to the government.

## The three flavors

- **Research OT (§ 4021)** — basic/applied research, often cost-shared.
- **Prototype OT (§ 4022)** — build and demonstrate a prototype that addresses a defense need. The most common entry point.
- **Follow-on Production OT (§ 4023)** — a **successful prototype** can transition to production **without a new competition**. This is the prize: prototype well, and production can follow.

## Consortia — the usual front door

Many prototype OTs are awarded through **consortia** managed by a Consortium Management Firm: NSTXL, MTEC, C5, SOSSEC, and others, plus the Defense Innovation Unit (DIU). You join the consortium (often free or low-cost), then respond to **request-for-solutions/prototype-project announcements** with a short solution brief and, if selected, a proposal.

## How to respond

1. **Find the consortium** that fields your technology area and become a member.
2. **Watch for solution calls.** They read like a problem statement, not a spec.
3. **Submit a solution brief** — concise, outcome-focused, milestone-driven.
4. **Negotiate the agreement** if selected: scope, milestones, payments, and IP.

## How this platform helps

OT solicitations don't look like RFPs — they're problem statements with milestone-based deliverables. When one is curated onto your cards, the compliance side captures the milestone structure and the Studio drafts a solution brief and a milestone/payment plan against it, with the cost volume computed in the required form.`,
  },
  {
    slug: 'what-is-a-cso',
    title: 'What Is a CSO? Commercial Solutions Openings, Explained',
    excerpt: 'A Commercial Solutions Opening buys innovative commercial technology through a pitch-first, solutions-based process.',
    tags: ['CSO', 'commercial', 'innovation', 'getting-started'],
    body: `# What Is a CSO?

A **Commercial Solutions Opening (CSO)** is a competitive procedure the government uses to acquire **innovative commercial products and services** that close a capability gap. Made a permanent authority in the FY22 NDAA (10 U.S.C. § 3458), a CSO is **solutions-based**: the government publishes a problem or area of interest, and companies pitch *how* they'd solve it — rather than responding to a rigid specification.

## What makes a CSO different

- **Problem, not spec.** The solicitation describes an outcome or capability gap. You propose the solution.
- **Commercial-first.** CSOs target commercial or dual-use technology that already exists or is close to market — not ground-up development.
- **Pitch-driven.** Most CSOs start with a short **white paper or pitch**; promising ideas are invited to a full proposal or an oral pitch.
- **Flexible award.** A CSO can lead to a FAR contract or an Other Transaction, and awards are made on merit — there's no requirement to pick the lowest price.

## Who uses them

The Defense Innovation Unit (DIU) pioneered the CSO-style "commercial solutions" process, and military services and agencies now run their own CSOs to reach commercial vendors quickly.

## How to respond

1. **Match the problem statement.** Show that your commercial capability maps to the stated gap.
2. **Submit a concise pitch/white paper.** Lead with the outcome and the evidence it works (customers, TRL, results).
3. **Prepare for an oral pitch.** Many CSOs invite finalists to present.
4. **Negotiate the award** — contract or OT — on scope, price, and delivery.

## CSO vs BAA vs OTA

- A **BAA** funds *research* (advancing the science). A **CSO** buys *commercial solutions* (fielding what largely exists).
- A **CSO** is a *procedure* for selecting a solution; an **OTA** can be the *instrument* that funds it. They're often used together.

## How this platform helps

A CSO rewards a crisp, evidence-backed pitch. When one is curated onto your cards, the Studio drafts the white paper and pitch narrative around your capability statement and past performance, and the compliance side tracks the submission format and evaluation factors so nothing is missed before you submit.`,
  },
  {
    slug: 'federal-grants-nofo-primer',
    title: 'Federal Grants & NOFOs: A First-Timer’s Guide',
    excerpt: 'Grants are assistance, not procurement. Here is how a NOFO works, the SF-424 forms, and how to apply on Grants.gov.',
    tags: ['grants', 'NOFO', 'Grants.gov', 'getting-started'],
    body: `# Federal Grants & NOFOs

A **federal grant** is **financial assistance** — the government funds a project that advances a public purpose, rather than buying a product or service for its own use. That distinction matters: grants run under the **Uniform Guidance (2 CFR 200)**, not the FAR, and they're judged on the merit and impact of your project.

## The NOFO

Opportunities are published as a **Notice of Funding Opportunity (NOFO)** — you'll also see the older terms *FOA* (Funding Opportunity Announcement) and *NOFA*. A NOFO tells you:

- **Who's eligible** (small businesses, universities, nonprofits, states — it varies by program).
- **How much** funding is available and typical award sizes.
- **What the review criteria are** — the exact factors reviewers score.
- **Cost sharing / matching** requirements, if any.
- **Deadlines** and how to submit.

Most NOFOs are posted on **Grants.gov**, the government-wide portal.

## Grant vs cooperative agreement

Both are assistance. The difference is **federal involvement**: a **grant** is mostly hands-off; a **cooperative agreement** means the agency is substantially involved (joint milestones, oversight). The NOFO says which it is.

## The application

Grant applications use the **SF-424 family** of forms plus a project narrative:

- **SF-424** — the application cover form.
- **SF-424A / SF-424C** — the **budget** (non-construction / construction).
- **Project narrative** — your plan, written to the review criteria.
- **Budget narrative** — justifying every line of the SF-424A.
- Plus attachments the NOFO requires (bio-sketches, letters, data-management plan, etc.).

## How to apply

1. **Register first.** You need a **UEI (SAM.gov)** and a **Grants.gov** account. Start early — registration takes time.
2. **Read the NOFO twice.** Confirm eligibility and map your project to every review criterion.
3. **Build the budget.** SF-424A line items with a narrative that justifies each cost.
4. **Write to the criteria.** Reviewers score against the stated factors — answer them in order.
5. **Submit on Grants.gov** before the deadline (there are no late exceptions).

## Which agencies

NSF, NIH, the Department of Energy, USDA, the Department of Education, and many others run grant programs — including the grant-based side of **SBIR/STTR** at NSF, NIH, and DOE.

## How this platform helps

When a NOFO is curated onto your cards, the compliance side captures its review criteria and required forms, and the cost volume renders as the **SF-424A** the grant requires. The Studio drafts the project narrative **to the review criteria**, section by section, and readiness rolls up the computed budget and required attachments before you submit.`,
  },
];

let ok = true;
const A = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ` — ${x}` : ''}`); ok = ok && c; };

try {
  console.log('\n── #168 CONTENT-QUEUE · draft + queue program guides ──\n');
  for (const g of GUIDES) {
    // Author canvas-native (the Content Studio pipeline: markdown → canvas → HTML projection).
    //
    // This used to strip `**`/`*` first, because the seed parser copied the markers through
    // literally. It now reads them as inline_formats, so the strip is gone and the emphasis
    // survives. NOTE the consequence: mig 176 captured these four bodies as they were seeded WITH
    // the strip, and the BAA guide has since been reviewed and published from that version. A
    // re-run of this script therefore re-authors all four with emphasis restored and re-queues
    // them for review — which is the right outcome when you want it, and not something that
    // happens on a rebuild, where mig 176 is what lands.
    const canvas = canvasFromDocBody(g.title, g.body);
    const nodeCount = (canvas.sections?.[0]?.groups?.[0]?.nodes ?? []).length;

    // Remove any prior draft for this slug so re-runs don't stack drafts.
    await sql`DELETE FROM content_pages WHERE page_key = ${g.slug} AND content_type = 'guide' AND status = 'draft'`;

    const draft = await saveDocumentDraft(
      g.slug, 'guide',
      { title: g.title, body: g.body, excerpt: g.excerpt, tags: g.tags, canvas },
      'Drafted program primer — queued for review (#168)',
      USER,
    );
    // Verify the public HTML projection is non-empty + canvas is the source of truth.
    const bodyLen = (draft.blocks?.[0]?.body ?? '').length;
    const hasCanvas = !!(draft.metadata?.canvas);
    A(`${g.slug}: draft v${draft.versionNo} (${nodeCount} nodes, ${bodyLen}B html, canvas=${hasCanvas})`, draft.status === 'draft' && bodyLen > 200 && hasCanvas);

    // Queue it for admin review in the Content Studio (content_publish HITL ToDo).
    // Idempotent-ish: clear any open ToDo for this same draft first.
    await sql`DELETE FROM tasks WHERE task_type = 'content_publish' AND entity_id = ${draft.id}::uuid AND status = 'open'`;
    const task = await createTask({
      actor: { id: USER.id, email: USER.email, role: 'master_admin', tenantId: null },
      taskType: 'content_publish',
      title: `Review & publish: ${g.title}`,
      description: `A new guide draft is ready for your review in the Content Studio. Read it, edit if needed, then publish to make it live on the marketing site.`,
      assigneeRole: 'rfp_admin',
      tenantId: null,
      entityType: 'content_pages',
      entityId: draft.id,
    });
    A(`  → queued content_publish ToDo ${task.ok ? task.data.taskId : '(FAILED: ' + task.error + ')'}`, task.ok);
  }

  // Summary read-back
  const drafts = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM content_pages WHERE content_type='guide' AND status='draft' AND page_key = ANY(${GUIDES.map((g) => g.slug)})`;
  const todos = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM tasks WHERE task_type='content_publish' AND status='open'`;
  A(`4 guide drafts queued`, drafts[0].n === 4, `drafts=${drafts[0].n}`);
  A(`content_publish ToDos open`, todos[0].n >= 4, `open=${todos[0].n}`);

  console.log(`\n${ok ? '✅ ALL PASS — 4 program guides drafted + queued for review' : '❌ FAILURES ABOVE'}\n`);
} catch (e) {
  console.error('SEED ERROR', e);
  ok = false;
} finally {
  await sql.end();
  process.exit(ok ? 0 : 1);
}
