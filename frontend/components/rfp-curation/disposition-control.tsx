'use client';

/**
 * Build it, or mark where it gets done.
 *
 * Ingest derives part of a solicitation's shape — on a DoD annual BAA that is the Volume 1
 * summaries, Volume 2, Volume 3 and some of Volume 5. The rest is not something a document can hand
 * you: a DSIP cover-sheet webform, a commercialization report the agency pulls from SBIR.gov, a
 * signed DD Form 2345, a training certificate. Each of those has to be BUILT as a mold or MARKED as
 * completed elsewhere, and this is where an rfp_admin says which.
 *
 * Leaving it undecided is not neutral. An undecided item provisions as an authorable section and
 * the drafter fills it with several kilobytes of plausible prose — which is how a buyer opens their
 * build and finds an AI-written "DD Form 2345" where a signed federal form belongs.
 *
 * THE NOTE is what makes "completed elsewhere" usable rather than merely quiet: it rides onto the
 * buyer's compliance checklist, so the row reads "Reps & Certifications — filed in SAM.gov" instead
 * of leaving them to guess. Blank is fine (the default text names the agency portal); clearing it
 * is deliberate.
 *
 * THE OVERRIDE matters most on a volume with NO required items, which the product treats as a
 * portal form by default. That default is usually right and occasionally wrong — the extraction
 * simply failed to itemise a volume that really is written here — so "Authored here" is an explicit
 * answer that is recorded as such, not merely the absence of a mark.
 */
import { useState } from 'react';
import { toast } from '@/lib/toast';

type Grain = 'item' | 'volume';

export function DispositionControl({
  solId, grain, id, dsipOnly, note, onChanged, itemless = false, effectiveElsewhere,
}: {
  solId: string;
  grain: Grain;
  id: string;
  /** true = elsewhere · false = the explicit authored-here override · null = undecided */
  dsipOnly: boolean | null;
  note: string | null;
  onChanged?: (next: { dsipOnly: boolean; note: string | null }) => void;
  /** A volume with no required items — the case the default guesses at, so say so. */
  itemless?: boolean;
  /**
   * What provisioning will ACTUALLY do, from the shared rule (isAuthoredVolume). It can differ
   * from this row's own flag: a volume nobody marked, whose every item IS marked, yields no
   * authoring work at all. Showing "Authored here" there would tell the admin the opposite of
   * what happens at provision — so the caller computes it once and the chip reports it.
   */
  effectiveElsewhere?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(note ?? '');
  const [busy, setBusy] = useState(false);

  // The DEFAULT this control is overriding. An item-less volume is assumed to be a portal form, so
  // its undecided state already behaves as "elsewhere" — showing it as "Authored here" would tell
  // the admin the opposite of what provisioning will do.
  const effective: 'elsewhere' | 'authored' =
    effectiveElsewhere !== undefined
      ? (effectiveElsewhere ? 'elsewhere' : 'authored')
      : dsipOnly === true ? 'elsewhere' : dsipOnly === false ? 'authored' : itemless ? 'elsewhere' : 'authored';
  const decided = dsipOnly !== null;
  // "Every item is marked" is a real answer even though this volume carries no flag of its own —
  // it is derived, not assumed, so it should not wear the dashed "please confirm" ring.
  const derived = dsipOnly === null && effectiveElsewhere === true && !itemless;

  async function set(disposition: 'external' | 'authored', withNote?: string) {
    setBusy(true);
    try {
      const path = grain === 'item'
        ? `/api/admin/rfp-curation/${solId}/items/${id}`
        : `/api/admin/rfp-curation/${solId}/volumes/${id}`;
      const body: { disposition: string; note?: string } = { disposition };
      if (withNote !== undefined) body.note = withNote;
      const res = await fetch(path, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(json?.error ?? 'Could not set the disposition', 'error');
        return;
      }
      toast(disposition === 'external' ? 'Marked completed elsewhere' : 'Marked authored here', 'success');
      onChanged?.({ dsipOnly: disposition === 'external', note: withNote !== undefined ? (withNote || null) : note });
      setOpen(false);
    } catch {
      toast('Could not reach the server', 'error');
    } finally {
      setBusy(false);
    }
  }

  const chip = effective === 'elsewhere'
    ? {
        text: decided ? 'Completed elsewhere' : derived ? 'All items elsewhere' : 'Assumed: portal form',
        cls: 'bg-amber-100 text-amber-800',
      }
    : { text: 'Authored here', cls: 'bg-gray-100 text-gray-600' };

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        disabled={busy}
        title={decided
          ? (note ?? 'No note — the buyer sees the default: completed in the agency submission portal')
          : derived
            ? 'Every required item here is marked completed elsewhere, so this volume yields no authoring work.'
            : itemless
              ? 'No required items, so this is treated as a portal form. Confirm it with a note, or override to "Authored here".'
              : 'Authored in this workspace by default'}
        className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium ${chip.cls} ${decided || derived || effective === 'authored' ? '' : 'ring-1 ring-dashed ring-amber-400'} hover:opacity-80 disabled:opacity-50`}
      >
        {chip.text}{note ? ' ✎' : ''}
      </button>

      {open && (
        <span
          className="absolute z-20 mt-1 w-80 -translate-x-2 translate-y-6 rounded border border-gray-300 bg-white p-3 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="mb-2 text-[11px] leading-snug text-gray-600">
            {itemless && !decided
              ? 'No required items were found under this volume, so it is treated as a form the company completes in the agency portal. Confirm that with a note, or override it.'
              : 'Is this written in the workspace, or obtained, signed or filed somewhere else?'}
          </p>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500">
            Note to the buyer — where it gets done
          </label>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="e.g. Filed in SAM.gov — no document is uploaded here."
            className="mb-2 w-full rounded border border-gray-300 px-2 py-1 text-xs"
          />
          <span className="flex items-center gap-2">
            <button
              type="button" disabled={busy}
              onClick={() => set('external', draft)}
              className="rounded bg-amber-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              Completed elsewhere
            </button>
            <button
              type="button" disabled={busy}
              onClick={() => set('authored', draft)}
              className="rounded border border-gray-300 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Authored here
            </button>
            <button
              type="button" disabled={busy}
              onClick={() => { setDraft(note ?? ''); setOpen(false); }}
              className="ml-auto text-[11px] text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </span>
        </span>
      )}
    </span>
  );
}
