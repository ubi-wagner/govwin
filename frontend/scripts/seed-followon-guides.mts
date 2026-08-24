/** #168 CONTENT-QUEUE — draft + queue the three guides the published library still lacks.
 *
 * The program primers (SBIR/STTR · BAA · OTA · CSO · Grants) now cover WHICH vehicle a company is
 * looking at. What is missing is everything that happens once they decide to respond, and the gaps
 * are not arbitrary — each of these is a place first-time applicants actually lose:
 *
 *   · the COST VOLUME, which is where a technically strong proposal gets kicked back;
 *   · COMPLIANCE mechanics, which is how a proposal gets rejected without being read at all;
 *   · PHASE II, which is the transition the whole Phase I effort exists to earn and which almost
 *     nobody plans for while they are writing Phase I.
 *
 * Authored canvas-native through the real Content Studio pipeline (canvasFromDocBody →
 * saveDocumentDraft) and queued as DRAFTS with a content_publish HITL ToDo. Nothing goes live
 * until a human reviews and publishes it. Idempotent: re-running replaces the draft + re-queues.
 *
 * cd frontend && DATABASE_URL=… node --import tsx scripts/seed-followon-guides.mts
 */
import postgres from 'postgres';
import { canvasFromDocBody } from '@/lib/content-canvas';
import { saveDocumentDraft } from '@/lib/content-admin';
import { createTask } from '@/lib/tasks/tasks';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://govtech:changeme@localhost:5432/govtech_intel', { max: 3 });
const USER = { id: '3667ead2-3b5e-4cc8-97f7-b2ab1cfa907d', email: 'eric@rfppipeline.com' };

interface Guide { slug: string; title: string; excerpt: string; tags: string[]; body: string; }

const GUIDES: Guide[] = [
  {
    slug: 'sbir-cost-volume-guide',
    title: 'The Cost Volume: Where Good Proposals Get Kicked Back',
    excerpt: 'Direct labor, fringe, overhead, G&A, fee — what each rate is, how the numbers have to tie out, and the mistakes that cost a technically strong proposal its award.',
    tags: ['cost-volume', 'budget', 'SBIR', 'compliance'],
    body: `# The Cost Volume

Most first-time applicants spend ninety percent of their effort on the technical volume and assemble the cost volume the night before. That is backwards in one specific way: the technical volume is *scored*, but the cost volume is **checked**. A weak technical volume loses on points. A cost volume that does not add up gets returned, and a returned proposal is not a low score — it is no score.

## What a contracting officer is actually looking at

They are not judging whether your price is good. They are checking three things:

1. **Does it add up?** Every subtotal, every rate applied to the right base, the total on the summary page equal to the sum of the detail pages.
2. **Is it allowable?** Costs the government will pay for under FAR Part 31 — and not the ones it won't.
3. **Is it supported?** A number with no basis behind it is a number the officer has to question, and questions cost weeks.

## The five layers, in the order they stack

The words below get used loosely in conversation and precisely in an audit. This is the precise version.

- **Direct labor** — hours × the actual hourly rate of the people doing the work. Not a blended "engineer rate" you invented; the rate you really pay.
- **Fringe benefits** — the employer's share of payroll taxes, health insurance, paid leave, retirement. Applied *to direct labor*.
- **Overhead** — the cost of having an engineering operation at all: facilities, equipment depreciation, engineering management. Applied to labor plus fringe.
- **G&A (general and administrative)** — running the company: accounting, legal, executive time, business development. Applied to nearly everything above it, and usually to materials and subcontracts too.
- **Fee** — profit. On a Phase I, agencies typically expect something in the range of 7%, applied last.

The order matters because each layer applies to a *base* that includes the layers under it. Change one direct labor hour and every number below it moves. That is why a cost volume assembled by hand in a spreadsheet the night before is fragile: one late change to the staffing plan silently breaks four subtotals.

## Where the money actually goes

A useful sanity check before you submit: a Phase I where direct labor is a small fraction of the total is a proposal that will draw questions. The government is buying research effort. If most of your budget is materials, subcontracts, or travel, be ready to explain why — and put that explanation in the budget narrative rather than making the officer ask.

## The rules that are not negotiable

- **Subcontract limits.** SBIR Phase I generally requires that at least **two thirds** of the work be performed by the small business. STTR splits differently: at least **40%** by the small business and at least **30%** by the research institution. Blow through the limit and you are ineligible, however good the science is.
- **The ceiling is a ceiling.** If the solicitation says a Phase I may not exceed a stated amount, that is the total including fee — not the amount before fee.
- **Cost sharing.** SBIR does not require it, and volunteering it rarely helps. Read the solicitation before you offer anything.

## The five mistakes that cost awards

1. **The total on the summary does not match the detail.** Almost always a stale number left behind by an edit. This is the single most common reason a cost volume comes back.
2. **A rate applied to the wrong base.** G&A on top of fee, or overhead applied to materials when your disclosed rate structure does not do that.
3. **Labor categories that do not exist in the technical volume.** If the cost volume budgets a "Senior Optics Engineer" for 400 hours, the technical volume's staffing section had better name one.
4. **Unsupported "other direct costs".** A line called Miscellaneous is an invitation to a question.
5. **A work split that violates the subcontract limit** — usually by accident, when a university partner's scope grows during writing and nobody re-checks the percentage.

## How this platform helps

The cost volume here is **computed, not typed**. You enter the staffing plan and the rates once; the burden engine applies each layer to its correct base and produces the totals, so the arithmetic cannot drift when you change an assumption. The result is then rendered into the **form the solicitation actually requires** — a DoD/DoW burden waterfall, an NSF/DOE SF-424A, or a state EDA budget form — rather than a generic table you would have to transcribe.

The work split is calculated from the same plan, so the two-thirds rule is checked as you build rather than discovered at submission. And because the numbers flow from one model, editing a cell updates the roll-up and the export together.

**Two things it does not do for you.** It cannot invent your indirect rates — those come from your accounting system, and if you have a negotiated rate agreement you must use it. And it cannot tell you whether a cost is allowable under your particular award; that is a conversation with your accountant, and it is worth having before the first Phase I, not after the first audit.`,
  },
  {
    slug: 'proposal-compliance-basics',
    title: 'Rejected Without Being Read: The Compliance Rules That Do the Damage',
    excerpt: 'Page limits, fonts, margins, file formats and deadlines — the mechanical rules that get proposals removed before an evaluator ever sees them, and how to check yourself.',
    tags: ['compliance', 'page-limits', 'submission', 'getting-started'],
    body: `# Rejected Without Being Read

There are two ways to lose a competition. One is to be outscored, which is a fair fight and tells you something. The other is to be removed before scoring, which teaches you nothing and is entirely avoidable.

The second kind is more common than most first-time applicants expect, and none of it is about the quality of your idea.

## The page limit is not a guideline

Read the sentence in the solicitation carefully, because agencies word it deliberately:

> *Pages in excess of the stated limit will not be evaluated and will be removed from the proposal prior to evaluation.*

That is not a threat about a penalty. It is a description of a procedure. Page eleven of a ten-page volume is *deleted*, and if your conclusion — or your work plan, or your cost summary — was on it, the evaluator reads a proposal that simply stops.

Three things about page limits catch people out:

- **What counts.** Usually everything: figures, tables, references, appendices. Sometimes the cover sheet and the table of contents are excluded. The solicitation says which, and the two are not interchangeable.
- **Where the limit lives.** The number is often not in the main announcement at all. A DoD BAA will frequently defer it to the *Component-specific instructions* — a separate document, sometimes attached separately. A page limit you cannot find is not a page limit that does not exist.
- **The rendered count is the real count.** Your word processor's page count and the PDF the agency receives are not always the same document. Check the PDF.

## The formatting rules that are actually enforced

- **Font size and family.** A minimum point size, often 10 or 11, sometimes with a named family. This applies to figure labels and table cells too — shrinking a table to fit is the classic way to fail a rule you thought you had met.
- **Margins.** Typically not less than one inch on all sides. Headers and footers usually sit inside that margin; check whether yours do.
- **Paper size.** 8.5 × 11 in the US. A document laid out on A4 will reflow when it is printed, and your page count will change.
- **File format and naming.** Some portals reject a file whose name has a space or a special character in it. Some require PDF/A. Some cap the file size.

## The deadline is a timestamp, not a day

Submission deadlines are stated to the minute and in a specific time zone — often Eastern, sometimes the agency's local time. Portals close on that timestamp. A proposal uploading at the moment of the cutoff is a proposal that did not arrive.

The practical rule that experienced teams follow: **submit a complete, compliant version at least a day early**, then replace it if you improve it. Most portals let you overwrite a submission until the deadline. What you cannot do is start uploading at the deadline and hope.

## Registrations expire

Federal submission requires an active **SAM.gov** registration, and for SBIR/STTR an SBC number from **SBIR.gov**. SAM registration must be renewed annually, and renewal is not instant — it can take days or weeks if anything needs validating. A lapsed registration discovered in the final week is how a good proposal misses a cycle entirely.

Check the expiry date the day you decide to bid, not the week you submit.

## How to check yourself

Before you submit, walk the solicitation's instructions section line by line and mark each rule against your actual file. Not your intent — your file. The four questions worth asking out loud:

1. What does the PDF's page count say, on the volume as it will be received?
2. Does every rule in the instructions have a place I can point to where I meet it?
3. Is every required item present, including the ones with no page count — letters, forms, certifications?
4. Is the submission portal open, and is my registration current *today*?

## How this platform helps

The compliance rules for a solicitation are read into a **matrix** during ingest, and each value carries its provenance: read from the source with a citation, or flagged as an unverified default. A page limit the solicitation defers elsewhere is shown as *set elsewhere* with the citation — never as a made-up number, which is the one thing worse than not knowing.

Page limits are then enforced against the **rendered** document rather than an estimate: the export is laid out by a real browser and counted, so what is checked is the file you would submit. Font, margin and per-section limits are checked in the same pass, and a volume over its cap is refused at the export gate rather than discovered by an evaluator.

None of that replaces reading the solicitation. It means the reading has somewhere to land.`,
  },
  {
    slug: 'sbir-phase-two-transition',
    title: 'Planning Phase II While You Write Phase I',
    excerpt: 'Phase II is won by the decisions you make in Phase I — the data you collect, the partners you line up, and the commercialization story you start building on day one.',
    tags: ['Phase II', 'commercialization', 'SBIR', 'strategy'],
    body: `# Planning Phase II While You Write Phase I

A Phase I award is roughly six months and a modest amount of money. A Phase II is typically two years and an order of magnitude more. Almost every company that wins one describes the same thing afterwards: **Phase II was decided during Phase I**, and mostly by choices that seemed minor at the time.

This is what those choices are.

## What Phase II is actually judged on

Phase I asks whether the idea is feasible. Phase II asks a harder pair of questions: *did you show it*, and *will anyone use it*. The second one is where technically excellent teams lose.

Reviewers are looking for three things you can only have if you planned for them:

- **Evidence, not assertion.** A Phase I final report that says the approach "showed promise" is weaker than one with a measured number against a stated baseline — even a modest number.
- **A named transition path.** Who takes this next? A program office, a prime contractor, a commercial buyer. "The DoD" is not an answer; a program is.
- **Something outside your own building.** A letter of support, a CRADA, a pilot, a purchase intent. Interest that costs someone else something is worth more than interest that does not.

## The four decisions to make in month one

**1. Define the metric you will report before you start measuring.**
Write down, in the Phase I proposal, the specific number that will constitute success and the baseline you are comparing it against. Teams that do this have a clean result to report. Teams that do not end up describing what they built rather than what they proved.

**2. Find the transition customer while the work is easy to describe.**
The best time to talk to a program office is when you have a funded effort and no results yet — you are interesting and you are not asking for anything. Six months later you are asking them to sponsor a Phase II on a deadline. Start those conversations in month one.

**3. Line up the letters early.**
A letter of support takes an organization weeks to produce and ten minutes to promise. Ask in month two for a letter you need in month six. And ask for specificity: a letter that names the capability and says what the organization would do with it carries weight; a form letter does not.

**4. Keep the commercialization story growing from day one.**
Phase II asks for a commercialization plan, and it is scored. Written at the end, it reads like a projection. Built through the effort — market conversations logged, pricing tested, a competitor mapped, a partner engaged — it reads like a plan, because it is one.

## Direct to Phase II

Some agencies allow a **Direct to Phase II (D2P2)** submission: you skip Phase I entirely by demonstrating that you have already done equivalent feasibility work with your own or other funding. It is a genuine route, and it is more demanding than it sounds — you must document the prior work in enough detail that a reviewer can conclude the Phase I question is already answered.

D2P2 is worth considering if you have relevant internal R&D, a prior contract, or academic work you can point to. It is not a shortcut for a project that has not been de-risked; it is a way to get credit for de-risking you already did.

## The gap between the phases

Phase I ends and Phase II funding does not begin immediately. The interval is usually months, and it is where small companies lose the team they just assembled.

Two things help. Some agencies and states run **bridge or matching programs** specifically to cover it — worth researching *before* Phase I ends rather than during the gap. And the transition customer you found in month one is the person most likely to help accelerate the process, because they want the capability.

## How this platform helps

Your Phase I proposal, its final report, and the material you generated along the way stay in your library and remain reusable — so the Phase II technical volume starts from what you actually wrote and proved, not from a blank page. Past-performance narratives, staffing plans, letters of support and figures are all retrievable into the new build, with their provenance intact.

The opportunity spine also tracks the Phase II window against the same opportunity, so the follow-on shows up on your board rather than in your memory.

What it will not do is have the conversations for you. The transition customer, the letters, and the pilot are yours to go and get — and month one is when to start.`,
  },
];

let ok = true;
const A = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ` — ${x}` : ''}`); ok = ok && c; };

try {
  console.log('\n── #168 CONTENT-QUEUE · follow-on guides (cost volume · compliance · Phase II) ──\n');

  // Sweep ORPHANS first: a content_publish ToDo whose entity_id names a content_pages row that no
  // longer exists. Earlier runs of this script left three behind (the delete below used to match
  // on the id it had just created), and an orphan is not a harmless stray row — it is an item in
  // a human's review queue whose "open it in the Studio" link resolves to nothing.
  const orphans = await sql`
    DELETE FROM tasks WHERE task_type = 'content_publish' AND status = 'open'
      AND entity_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM content_pages cp WHERE cp.id = tasks.entity_id)
    RETURNING id`;
  if (orphans.length) console.log(`  · swept ${orphans.length} orphaned review ToDo(s) pointing at deleted pages`);

  for (const g of GUIDES) {
    // Canvas-native: the CanvasDocument is the source of truth; the public HTML body is projected
    // from it on save (docs/CONTENT_STUDIO_DESIGN.md). This used to strip `**` before parsing,
    // because the seed parser copied the markers through literally; it now reads them as
    // inline_formats, so the emphasis these bodies were written with actually survives to the page.
    const canvas = canvasFromDocBody(g.title, g.body);
    const nodeCount = (canvas.sections?.[0]?.groups?.[0]?.nodes ?? []).length;

    // Re-runs replace rather than stack — and the ORDER here is the whole point. The prior run's
    // ToDo names the prior run's draft row by id, so it has to be deleted WHILE that row still
    // exists. Dropping the page first orphans the ToDo, and no page_key lookup afterwards can find
    // it again: the id it holds no longer resolves to anything. Page-first is exactly how three
    // dead items accumulated in the review queue.
    await sql`DELETE FROM tasks WHERE task_type = 'content_publish' AND status = 'open'
              AND entity_id IN (SELECT id FROM content_pages
                                WHERE page_key = ${g.slug} AND content_type = 'guide')`;
    await sql`DELETE FROM content_pages WHERE page_key = ${g.slug} AND content_type = 'guide' AND status = 'draft'`;

    const draft = await saveDocumentDraft(
      g.slug, 'guide',
      { title: g.title, body: g.body, excerpt: g.excerpt, tags: g.tags, canvas },
      'Drafted follow-on guide — queued for review (#168)',
      USER,
    );
    const bodyLen = (draft.blocks?.[0]?.body ?? '').length;
    A(`${g.slug}: draft v${draft.versionNo} (${nodeCount} nodes, ${bodyLen}B html, canvas=${!!draft.metadata?.canvas})`,
      draft.status === 'draft' && bodyLen > 200 && !!draft.metadata?.canvas);

    const task = await createTask({
      actor: { id: USER.id, email: USER.email, role: 'master_admin', tenantId: null },
      taskType: 'content_publish',
      title: `Review & publish: ${g.title}`,
      description: 'A follow-on guide draft is ready for your review in the Content Studio. Read it, edit if needed, then publish to make it live on the marketing site.',
      assigneeRole: 'rfp_admin',
      tenantId: null,
      entityType: 'content_pages',
      entityId: draft.id,
    });
    A(`  → queued content_publish ToDo ${task.ok ? task.data.taskId : '(FAILED: ' + task.error + ')'}`, task.ok);
  }

  // Read back: drafts exist, nothing went live, every draft has a review ToDo waiting.
  const slugs = GUIDES.map((g) => g.slug);
  const [d] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM content_pages WHERE content_type='guide' AND status='draft' AND page_key = ANY(${slugs})`;
  const [live] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM content_pages WHERE content_type='guide' AND status='active' AND page_key = ANY(${slugs})`;
  const [t] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM tasks WHERE task_type='content_publish' AND status='open'`;
  A(`${GUIDES.length} follow-on drafts staged`, d.n === GUIDES.length, `drafts=${d.n}`);
  A('NOTHING went live — a human publishes, not this script', live.n === 0, `active=${live.n}`);
  A('content_publish ToDos open', t.n >= GUIDES.length, `open=${t.n}`);

  console.log(`\n${ok ? '✅ ALL PASS — 3 follow-on guides drafted + queued for review' : '❌ FAILURES ABOVE'}\n`);
} catch (e) {
  console.error('SEED ERROR', e);
  ok = false;
} finally {
  await sql.end();
  process.exit(ok ? 0 : 1);
}
