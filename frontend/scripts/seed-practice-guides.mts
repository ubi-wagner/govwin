/**
 * #168 CONTENT-QUEUE, WAVE 3 — the three practice guides the other two waves still leave out.
 *
 * Wave 1 (mig 176, seed-program-guides.mts) covered WHICH VEHICLE: BAA · OTA · CSO · Grants/NOFO,
 * so every instrument the platform serves has a primer. Wave 2 (seed-followon-guides.mts) covered
 * three places bids are lost: the cost volume, the mechanical submission rules, and the Phase II
 * transition. Read those six together and three questions a first-time applicant reliably gets
 * wrong still have no answer anywhere:
 *
 *   · how to TRACK the requirements — wave 2 says a page limit will reject you, and stops there;
 *     nothing says how a team keeps 200 "shall" statements from losing one;
 *   · WHICH REGISTRATIONS gate submission — mentioned in one paragraph as a thing that expires,
 *     never as the multi-week sequence it actually is;
 *   · HOW MUCH WORK may leave the company — one bullet in the cost-volume guide, and it is the
 *     rule that most often makes an otherwise strong team ineligible.
 *
 * DELIBERATELY NOT DUPLICATED. This set was drafted at five and cut to three: a cost-volume guide
 * and a page-limits guide were written and then deleted, because wave 2 already covers both and a
 * reviewer's queue holding two guides on one topic is worse than a queue missing one. Where these
 * three touch the same ground they go deeper rather than restating — teaming owns the work-split
 * rule the cost guide mentions in passing, registrations owns the SAM lifecycle the compliance
 * guide names in a sentence.
 *
 * TRUTH DISCIPLINE, borrowed from the ingest-provenance rule (docs/INGEST_PROVENANCE.md): *a value
 * the product did not read from the solicitation must never look like one it did*. Marketing
 * content is under the same obligation. So these guides state STRUCTURE as fact (a cost volume has
 * direct labour, indirect rates, ODCs; STTR splits 40/30) and route every AGENCY-SPECIFIC NUMBER
 * back to the solicitation. A page limit or a fee ceiling printed here as a fact would be a
 * fabricated citation with our name on it, and it would rot the first time an agency changed it.
 *
 * They land as DRAFTS with a content_publish HITL ToDo — nothing goes live until a human publishes
 * it in the Content Studio. Idempotent: a re-run replaces the draft and re-queues the ToDo.
 *
 *   cd frontend && DATABASE_URL=<owner> node --import tsx scripts/seed-practice-guides.mts
 */
import postgres from 'postgres';
import { canvasFromDocBody } from '@/lib/content-canvas';
import { saveDocumentDraft } from '@/lib/content-admin';
import { createTask } from '@/lib/tasks/tasks';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://govtech:changeme@localhost:5432/govtech_intel', { max: 3 });
// Author/reviewer: a real master_admin (created_by + the ToDo's actor).
const USER = { id: '3667ead2-3b5e-4cc8-97f7-b2ab1cfa907d', email: 'eric@rfppipeline.com' };

interface Guide { slug: string; title: string; excerpt: string; tags: string[]; body: string }

const GUIDES: Guide[] = [
  {
    slug: 'compliance-matrix-primer',
    title: 'Build the Compliance Matrix Before You Write a Word',
    excerpt: 'A solicitation can carry two hundred requirements. The matrix is the one artifact that keeps a team from losing one — and it doubles as your proposal outline.',
    tags: ['compliance', 'proposal management', 'shall statements', 'getting started'],
    body: `# Build the Compliance Matrix Before You Write a Word

Knowing that a missing item gets you screened out is not the same as having a way to make sure nothing is missing. A mid-sized solicitation imposes well over a hundred separate obligations, scattered across the announcement, the instructions to offerors, the evaluation criteria, and whatever component-specific document the announcement points at. No one holds that in their head, and no one finds them all by re-reading at the end.

The compliance matrix is the artifact that solves it, and it costs an afternoon.

## What a compliance matrix is

A compliance matrix is a single table with one row for **every requirement the solicitation imposes on you**, and columns that answer: where is it addressed, who owns it, and is it done. Nothing more clever than that. Its power is that it converts a 60-page solicitation into a finite, checkable list.

A row typically records:

- The **requirement**, quoted, not paraphrased.
- **Where it comes from** — the section and page of the solicitation.
- **Where you answer it** — your volume, section and page.
- **Owner** — one named person.
- **Status** — not started, drafted, reviewed, done.

## Finding the requirements

Read the solicitation with a highlighter and pull every sentence containing:

- **shall**, **must**, **is required to**, **will provide** — hard requirements.
- **should**, **may** — softer, but frequently scored anyway.
- Anything in the **instructions to offerors** section, which is where format and submission rules hide.
- Anything in the **evaluation criteria**, which tells you what reviewers actually score.

Two rules that save proposals. First, quote the requirement **verbatim** — a paraphrase silently drops the qualifier that mattered. Second, split compound requirements: "the offeror shall describe the approach and provide a schedule and identify key personnel" is **three** rows, not one, because it is three ways to be incomplete.

## Requirements are not only in the narrative

The rows that get missed are rarely technical. They are the administrative ones: a letter of support, a current SAM registration, a signed certification, a data-management plan, a specific file naming convention, a page-limited summary, a form nobody read past the title of. Every one of those is a row.

## Working the matrix

Build it **before** you start writing, not after. Used properly it is the proposal outline — you write to the rows, and the volume structure falls out of it. Review it at every checkpoint: an item that is still unowned two days before the deadline is the item that will be missing.

The last pass before submission is a straight read of the matrix, row by row, against the assembled document. Not from memory. Against the document.

## How this platform helps

The matrix is not something you build by hand here. When an opportunity is curated, the compliance side captures the solicitation's requirements, and a matrix is instantiated with your proposal the moment it is provisioned — every required item already a row, tied to the volume and section that answers it.

From there it stays current on its own: locking a section advances the items it satisfies, and submission readiness reads the matrix directly, so the verdict on the overview page is the state of your requirements, not somebody's recollection of it. If the agency amends the solicitation, the change is detected, confirmed, and fanned out to every affected build with an acknowledgement — so a requirement that appeared after you started writing does not quietly stay missing.`,
  },
  {
    slug: 'registrations-before-you-bid',
    title: 'Registrations to Get Done Before You Bid',
    excerpt: 'SAM, your UEI, the SBIR company registry, agency portals — the accounts that gate submission, and why starting them the week of a deadline is too late.',
    tags: ['SAM.gov', 'UEI', 'registration', 'getting started'],
    body: `# Registrations to Get Done Before You Bid

The single most avoidable way to lose a federal opportunity is to find a good one, write a strong proposal, and then discover you cannot submit it because a registration is incomplete. These are administrative steps with **government processing times attached**. You cannot compress them by working harder the night before.

Start them now, before you have a deadline. They are good for years once done.

## The ones nearly everyone needs

**SAM.gov registration.** The System for Award Management is the government-wide registry of entities eligible to receive federal awards. Registering assigns your **UEI (Unique Entity Identifier)** — the number that replaced DUNS — and generally your **CAGE code** as well. You will need your legal entity name exactly as the IRS has it, your EIN, and banking details for electronic payment. Access goes through a Login.gov account with identity verification.

This is the one to start first. Validation of your legal business name and address is where registrations stall, and it is resolved by the government on its schedule, not yours. Renewal is annual — an **expired SAM registration blocks submission just as effectively as never having one**, and it expires quietly.

**The SBIR/STTR company registry.** SBIR.gov maintains a separate registration for small business concerns, which issues an SBC Control ID that agency proposal systems ask for. Doing your SAM registration does not do this one.

## Agency portals, on top of the above

Each agency runs its own submission system, and each needs its own account:

- **DoD/DoW** — the Defense SBIR/STTR Innovation Portal (DSIP), used across the services.
- **NSF** — Research.gov.
- **NIH** — eRA Commons, plus Grants.gov.
- **Grant-based programs generally** — Grants.gov, where an authorised organisational representative has to be designated before anyone can submit on the company's behalf.

Two things to know. First, several of these require a person to be *authorised by the organisation*, which is its own approval step with its own delay. Second, portal accounts are tied to individuals — if the only person with submission rights leaves, or is on a plane on deadline day, that is a problem you solve in advance or not at all.

## Eligibility facts worth confirming early

Registration proves you exist. It does not prove you qualify. Confirm separately that your company meets the ownership and size requirements for the program, that your principal investigator meets the employment rule the program imposes, and that the work will be performed where the program requires. Finding out otherwise after you have written a proposal is expensive; the eligibility checklist guide covers this in more detail.

## A working sequence

1. **Login.gov**, with identity verification completed.
2. **SAM.gov** registration — start here, and expect entity validation to take real time.
3. **SBIR.gov** company registry, once you have your UEI.
4. **Agency portal accounts** for the agencies you actually intend to bid, with more than one authorised person where the portal allows it.
5. **Calendar the SAM renewal** a month before it lapses, every year.

## How this platform helps

Nothing on this list is something software can do for you — these are your company's credentials, held by your company. What the platform does is make sure they are not what you are thinking about on deadline day: registration items appear as required rows in your compliance matrix, with an owner and a due date on the workflow, so they are tracked the same way as the rest of the submission rather than remembered. The published resources list links straight to SAM.gov, SBIR.gov, DSIP and Grants.gov.`,
  },
  {
    slug: 'teaming-and-subcontracts',
    title: 'Teaming: Subcontractors, Consultants, and the STTR Research Partner',
    excerpt: 'How much of the work you are allowed to send outside your company, what a research partner changes, and what to get in writing before you submit.',
    tags: ['teaming', 'subcontracts', 'STTR', 'compliance'],
    body: `# Teaming: Subcontractors, Consultants, and the Research Partner

You rarely have every skill a project needs in-house, and you are not expected to. What SBIR and STTR *do* expect is that the small business remains the one doing the work — and both programs enforce that with hard numbers. Get the split wrong and you are non-compliant, no matter how good the team is.

## The work-split rules

For **SBIR**, the small business concern must perform a minimum share of the research and analytical effort itself: at least **two-thirds in Phase I**, and at least **one-half in Phase II**. The rest may go to subcontractors, consultants and other partners.

For **STTR**, the structure is different by design — the program exists to move research out of institutions and into companies. The small business must perform at least **40 percent** of the work, and the single partnering **research institution** at least **30 percent**. The remaining 30 percent may be done by either partner or by additional third parties.

Two things about these percentages. They are measured on the **research and analytical effort**, which in practice usually means cost or labour as the solicitation defines it — read that definition rather than assuming. And an agency may impose a stricter split than the floor, so the solicitation always wins over the general rule.

## Who your principal investigator works for

For **SBIR**, the PI's **primary employment** must be with the small business — more than half their time during the project. A professor who intends to stay primarily at the university cannot be your SBIR PI.

For **STTR**, the PI may be primarily employed by *either* the small business or the research partner. This is one of the most useful practical differences between the two programs, and it is the reason a university-anchored team is often an STTR team.

## The STTR research partner

STTR requires a **single** partnering research institution — a university, a federally funded R&D center, or a qualifying nonprofit research organisation. Before you submit you will generally need:

- A **written agreement** between the company and the institution covering the allocation of rights in intellectual property and rights to carry out follow-on research.
- The institution's own budget and rates, which are frequently very different from yours and can consume a share of the award you did not expect.
- Sign-off from the institution's sponsored-programs office, which is a real approval with a real queue. Start it weeks out, not days.

## Subcontractor versus consultant

Both count against your outside share, but they document differently. A **subcontractor** is an organisation; expect to provide their statement of work, budget and basis of estimate, and sometimes a letter of commitment. A **consultant** is an individual, usually priced at a daily or hourly rate, and agencies commonly cap consultant rates or require justification above a threshold.

For either, get it in writing **before** you submit: scope, price, period of performance, and what happens to IP they touch. A commitment letter that says "we look forward to collaborating" is not a subcontract, and a partner who becomes unavailable after award is your problem, not the agency's.

## What to have in hand before the deadline

- A statement of work for every subcontractor, specific enough to price.
- Their budget, in enough detail that your cost volume can carry it as a line.
- Letters of commitment or support where the solicitation asks for them — noting whether they count against your page limit.
- For STTR, the executed or agreed allocation-of-rights agreement.
- A calculation, written down, showing your work split satisfies the program minimum.

## How this platform helps

Subcontractors and consultants are line items the cost engine carries through the burden build-up, so the work split is computed from the same numbers as the price rather than estimated separately — and it rolls into submission readiness alongside your page limits and required documents.

Partners can also work in the build itself. A collaborator is invited with **stage-scoped access** — view, comment, or edit, on the specific parts of the proposal you grant and nothing else — so a university partner can draft their section without seeing the rest of your bid. What they upload lands as a draft for your review before it enters anything.`,
  },
];

let ok = true;
const A = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ` — ${x}` : ''}`); ok = ok && c; };

try {
  console.log('\n── #168 CONTENT-QUEUE wave 3 · draft + queue the practice guides ──\n');

  // Queue integrity first: an open content_publish ToDo whose entity_id names a content_pages row
  // that no longer exists is a review item whose "open it in the Studio" link goes nowhere. There
  // is no product path that deletes a content page (archive is the model — docs/ARCHIVABLE_CONTRACT.md),
  // so any orphan here was left by a seed re-run, and clearing it is bookkeeping, not data loss.
  const orphans = await sql`
    DELETE FROM tasks WHERE task_type = 'content_publish' AND status = 'open'
      AND entity_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM content_pages cp WHERE cp.id = tasks.entity_id)
    RETURNING id`;
  if (orphans.length) console.log(`  · swept ${orphans.length} orphaned review ToDo(s) pointing at deleted pages`);

  for (const g of GUIDES) {
    // Author canvas-native — the same pipeline the Content Studio uses (markdown → canvas → the
    // HTML projection the public site reads). Since the seed parser learned inline emphasis, the
    // bodies here keep their **bold** rather than being stripped before parsing.
    const canvas = canvasFromDocBody(g.title, g.body);
    const nodes = canvas.sections?.[0]?.groups?.[0]?.nodes ?? [];

    // Clear the prior draft so a re-run replaces rather than stacks — ToDo FIRST, then the page.
    // The prior ToDo names the prior draft row by id; drop the row first and the ToDo is stranded
    // with an id that resolves to nothing, and no later page_key lookup can find it again.
    await sql`DELETE FROM tasks WHERE task_type = 'content_publish' AND status = 'open'
              AND entity_id IN (SELECT id FROM content_pages
                                WHERE page_key = ${g.slug} AND content_type = 'guide')`;
    await sql`DELETE FROM content_pages WHERE page_key = ${g.slug} AND content_type = 'guide' AND status = 'draft'`;

    const draft = await saveDocumentDraft(
      g.slug, 'guide',
      { title: g.title, body: g.body, excerpt: g.excerpt, tags: g.tags, canvas },
      'Drafted practice guide — queued for review (#168 wave 3)',
      USER,
    );

    const html = draft.blocks?.[0]?.body ?? '';
    const clean = !/\*\*|\]\(/.test(html);          // no raw markdown reached the public projection
    const bold = /<strong>/.test(html);            // …and the emphasis actually survived as markup
    A(`${g.slug}: draft v${draft.versionNo}`,
      draft.status === 'draft' && html.length > 1500 && !!draft.metadata?.canvas && clean && bold,
      `${nodes.length} nodes · ${html.length}B html · canvas=${!!draft.metadata?.canvas} · clean=${clean} · bold=${bold}`);

    // Queue it for a human in the Content Studio. The ToDo deep-links by entity id, so it points
    // at the row just written; the prior one was cleared above, before its page row went away.
    const task = await createTask({
      actor: { id: USER.id, email: USER.email, role: 'master_admin', tenantId: null },
      taskType: 'content_publish',
      title: `Review & publish: ${g.title}`,
      description: 'A new guide draft is ready for your review in the Content Studio. Read it, edit if needed, then publish to make it live on the marketing site.',
      assigneeRole: 'rfp_admin',
      tenantId: null,
      entityType: 'content_pages',
      entityId: draft.id,
    });
    A(`  → queued content_publish ToDo`, task.ok, task.ok ? task.data.taskId : `FAILED: ${task.error}`);
  }

  // Read back what a reviewer will actually find.
  const slugs = GUIDES.map((g) => g.slug);
  const [{ n: drafts }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM content_pages
    WHERE content_type='guide' AND status='draft' AND page_key = ANY(${slugs})`;
  const [{ n: queued }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM tasks t
    JOIN content_pages cp ON cp.id = t.entity_id
    WHERE t.task_type='content_publish' AND t.status='open' AND cp.page_key = ANY(${slugs})`;
  const [{ n: totalOpen }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM tasks WHERE task_type='content_publish' AND status='open'`;
  A(`${GUIDES.length} practice guides sitting as drafts`, drafts === GUIDES.length, `drafts=${drafts}`);
  A(`each one has an OPEN ToDo pointing at its own draft row`, queued === GUIDES.length, `queued=${queued}`);
  console.log(`  · the reviewer's content queue now holds ${totalOpen} open item(s)`);

  console.log(`\n${ok ? `✓ ${GUIDES.length} practice guides drafted + queued — nothing is live until a human publishes`
    : '✗ see failures above'}\n`);
} catch (e) {
  console.error('SEED ERROR', e);
  ok = false;
} finally {
  await sql.end();
  process.exit(ok ? 0 : 1);
}
