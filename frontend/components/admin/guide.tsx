/**
 * The in-page guide kit — the shared shell for an admin surface's "how this works", and the
 * affordance that lets the person reading it say the guide is wrong.
 *
 * ── WHY A GUIDE THAT CANNOT BE CORRECTED IS WORSE THAN NO GUIDE ──────────────────────────────
 * A guide written before anyone has done the work is a guess about the parts that are judgement.
 * It will be wrong in week one — that is not a failure of care, it is what first contact does. The
 * failure mode is a guide that is wrong and has no way to say so: it gets read once, disbelieved,
 * and then ignored, and the knowledge it was supposed to carry goes back into somebody's head.
 *
 * So every step carries a `<GuideNote>`. It writes to `working_notes` (mig 244) — the same board
 * the companion and a dev session write to — anchored to the route AND the step, with the
 * disposition that decides what happens next:
 *
 *   gap       the guide is wrong or silent   → the fix is to edit the guide
 *   defect    the product is wrong           → promote it out to wherever work is tracked
 *   friction  it works, it should not be     → design debt, worth counting
 *
 * That split matters more than it looks. In a first curation week most notes are `gap`; if they
 * all land in one bucket labelled "bug", the guide never gets fixed and the board stops being read
 * by the second week.
 *
 * ── AND WHY `<Unwritten>` EXISTS ─────────────────────────────────────────────────────────────
 * Some sections cannot honestly be written yet — what the judgement calls feel like, which cases
 * are common, where people actually get stuck. Leaving them out makes the guide look complete when
 * it is not, which is the documentation form of a green test that never ran. `<Unwritten>` renders
 * the gap visibly and invites the note that will fill it. Uncovered is not passing, here too.
 *
 * ── THE POSTURE THIS FILE HOLDS ──────────────────────────────────────────────────────────────
 * Guide bodies are STATIC SERVER components inside a native `<details>` — no client JS, no clock
 * read during render (the eighth occurrence of that class was closed on this branch; a guide is
 * not the place for a ninth). Only the note box is a client component, and it is the only thing
 * that ships JS.
 */
import { GuideNoteBox } from './guide-note';

export const GuideCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
  // `data-guide` marks this subtree so `verify-guide-controls.mjs` can EXCLUDE it: the guide
  // renders the control labels it names, so a check that searched the whole page would always
  // find them and always pass.
  <details data-guide className="mb-6 rounded-lg border border-sky-200 bg-sky-50/40 px-5 py-3">
    <summary className="cursor-pointer text-sm font-semibold text-sky-900">{title}</summary>
    <div className="mt-3 max-w-3xl text-sm leading-relaxed text-gray-700">{children}</div>
  </details>
);

/**
 * One step. `id` is the anchor a note is filed against — it is part of the record, so keep it
 * stable: renaming it orphans every note already written about this step.
 */
export const Step = ({
  id, route, title, children,
}: { id: string; route: string; title: string; children: React.ReactNode }) => (
  <section className="mt-5 border-t border-sky-200/70 pt-4 first:mt-2 first:border-t-0 first:pt-0">
    <h3 className="mb-1.5 text-[13px] font-semibold uppercase tracking-wide text-sky-900">{title}</h3>
    {children}
    <GuideNoteBox anchor={`${route}#${id}`} step={title} />
  </section>
);

export const P = ({ children }: { children: React.ReactNode }) => (
  <p className="my-1.5">{children}</p>
);

export const Ul = ({ children }: { children: React.ReactNode }) => (
  <ul className="my-1.5 list-disc space-y-1 pl-5">{children}</ul>
);

/** A control the person is meant to press. The guide harness checks these exist on the page. */
export const Ctl = ({ children }: { children: React.ReactNode }) => (
  <span
    data-guide-control={typeof children === 'string' ? children : undefined}
    className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[12px] font-medium text-gray-800"
  >
    {children}
  </span>
);

export const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[11px] text-gray-700">{children}</code>
);

/** Something that cannot be undone, or that reaches a customer. Say it before they press it. */
export const Careful = ({ children }: { children: React.ReactNode }) => (
  <p className="my-2 rounded border-l-[3px] border-amber-400 bg-amber-50 py-1.5 pl-3 pr-2 text-[13px] text-amber-900">
    {children}
  </p>
);

/** A section nobody can honestly write yet. Visible, not absent. */
export const Unwritten = ({ children }: { children: React.ReactNode }) => (
  <p className="my-2 rounded border border-dashed border-gray-300 bg-white px-3 py-2 text-[13px] text-gray-500">
    <span className="font-semibold text-gray-600">Not written yet — </span>{children}
    {' '}<span className="text-gray-400">Note it below once you know, and this section gets written from it.</span>
  </p>
);

/** Where the long version lives. The guide distils; it must never fork the canonical doc. */
export const Canon = ({ doc, children }: { doc: string; children?: React.ReactNode }) => (
  <p className="mt-3 text-[12px] text-gray-500">
    Full detail: <Code>{doc}</Code>{children ? <> — {children}</> : null}
  </p>
);
