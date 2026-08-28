'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';

/**
 * The two things the AI manager will do, and what it will not (A1 + A2).
 *
 * ── THE PANEL'S JOB IS TO SET THE EXPECTATION BEFORE THE CLICK ───────────────────────────────
 * Both actions are ADVISORY and neither changes the project. That is stated on the buttons rather
 * than in a tooltip somebody discovers afterwards, because "Assess" next to a milestone list reads
 * like it might move something, and a person who believes that will not press it — or worse, will
 * press it expecting it to.
 *
 * ── AND A REFUSED DRAFT SAYS WHAT WAS WRONG ──────────────────────────────────────────────────
 * The narrative is checked against the figures the system computed, and a draft containing an
 * invented number is not offered. When that happens the panel names the number. A person who asked
 * for a draft and got nothing would otherwise just press the button again.
 */
export interface AssistantNarrative {
  status: 'ready' | 'rejected' | 'none' | 'empty';
  paragraphs?: string[];
  invented?: string[];
  note?: string;
  figuresChecked?: number;
}

export function ProjectAssistant({
  basePath, canRequest, narrative,
}: {
  basePath: string;
  canRequest: boolean;
  narrative: AssistantNarrative;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<'health' | 'narrative' | null>(null);

  async function ask(kind: 'health' | 'narrative') {
    setBusy(kind);
    try {
      const path = kind === 'health' ? 'assess-health' : 'draft-narrative';
      const res = await fetch(`${basePath}/${path}`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast(json?.error ?? 'Could not ask for that', 'error'); return; }
      toast(
        kind === 'health'
          ? 'Assessing — nothing on the project will be changed by it'
          : 'Drafting — every figure will be checked before you are offered it',
        'success',
      );
      router.refresh();
    } catch {
      toast('Could not ask for that', 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <header className="border-b border-gray-200 px-4 py-3">
        <h2 className="text-sm font-medium text-gray-900">Ask the project manager</h2>
        <p className="text-xs text-gray-500">
          Both of these read the project and report. Neither moves a date, closes a phase, or adds
          work.
        </p>
      </header>

      {canRequest && (
        <div className="flex flex-wrap gap-2 border-b border-gray-200 px-4 py-3">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void ask('health')}
            className="rounded border border-gray-900 px-2.5 py-1 text-xs text-gray-900 hover:bg-gray-50 disabled:opacity-50"
          >
            {busy === 'health' ? 'Assessing…' : 'Assess milestone health'}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void ask('narrative')}
            className="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {busy === 'narrative' ? 'Drafting…' : 'Draft the status narrative'}
          </button>
        </div>
      )}

      {/* ── THE DRAFTED NARRATIVE, OR WHY THERE IS NONE ──────────────────────────────────── */}
      <div className="px-4 py-3">
        {narrative.status === 'ready' && (narrative.paragraphs?.length ?? 0) > 0 ? (
          <>
            <p className="mb-2 text-xs text-gray-500">
              Drafted narrative — {narrative.figuresChecked ?? 0} figure
              {narrative.figuresChecked === 1 ? '' : 's'} checked against the rows. Copy what is
              useful into the report; nothing has been added to it.
            </p>
            <div className="space-y-2 rounded border border-gray-200 bg-gray-50 p-3">
              {narrative.paragraphs!.map((p, i) => (
                <p key={i} className="text-sm text-gray-800">{p}</p>
              ))}
            </div>
          </>
        ) : narrative.status === 'rejected' ? (
          <p className="rounded border border-amber-300 bg-amber-50/60 p-3 text-xs text-amber-900">
            {/* NAMED. A person who got nothing would otherwise just ask again. */}
            {narrative.note
              ?? `The draft stated ${(narrative.invented ?? []).join(', ')}, which the system did not compute, so it was not offered.`}
          </p>
        ) : (
          <p className="text-sm text-gray-500">
            No drafted narrative yet.
          </p>
        )}
      </div>
    </section>
  );
}
