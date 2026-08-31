/**
 * Contract traceability — every line item, and what satisfies it (A3).
 *
 * ── ORGANISED BY CLIN, BECAUSE THAT IS WHAT IS ASKED ─────────────────────────────────────────
 * A program review does not ask "is this healthy". It asks *show me every line item and what
 * satisfies it*, so that is the shape: one block per CLIN, its milestones, its deliverables.
 *
 * ── A GAP NAMES ITS SUBJECT ──────────────────────────────────────────────────────────────────
 * "CLIN 0002 has no deliverable" is a thing to do. "3 gaps" is a number somebody has to go and
 * investigate. And a gap is rendered in plain grey, not alarm red: an early project legitimately has
 * unlinked CLINs, and an amber banner three weeks into a five-year contract teaches people to
 * ignore the panel.
 *
 * Server-rendered.
 */
export interface MapClin {
  clinId: string;
  clinNumber: string;
  title: string;
  milestones: Array<{ id: string; code: string | null; title: string; status: string }>;
  deliverables: Array<{ id: string; title: string; direct: boolean; accepted: boolean; sent: boolean }>;
}

export interface MapGap { kind: string; subject: string; detail: string }

export function TraceabilityMap({
  clins, unassignedMilestones, gaps,
}: {
  clins: MapClin[];
  unassignedMilestones: Array<{ id: string; code: string | null; title: string }>;
  gaps: MapGap[];
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <header className="border-b border-gray-200 px-4 py-3">
        <h2 className="text-sm font-medium text-gray-900">What satisfies each line item</h2>
        <p className="text-xs text-gray-500">
          Every CLIN, the phases doing its work, and the deliverables that answer it.
        </p>
      </header>

      {clins.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-500">No CLINs entered yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {clins.map((c) => (
            <li key={c.clinId} className="space-y-1.5 px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-sm font-medium text-gray-900">CLIN {c.clinNumber}</span>
                <span className="text-sm text-gray-700">{c.title}</span>
              </div>

              {c.milestones.length > 0 ? (
                <p className="text-xs text-gray-600">
                  <span className="text-gray-500">Phases: </span>
                  {c.milestones.map((m) => (m.code ? `${m.code} ${m.title}` : m.title)).join(' · ')}
                </p>
              ) : (
                <p className="text-xs text-gray-400">No phase sits under this line item.</p>
              )}

              {c.deliverables.length > 0 ? (
                <ul className="space-y-0.5 border-l-2 border-gray-200 pl-3">
                  {c.deliverables.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                      <span className="text-gray-900">{d.title}</span>
                      {/* TAGGED versus INHERITED — different statements to an auditor (mig 228). */}
                      <span className="text-[11px] text-gray-400">
                        {d.direct ? 'tagged to this CLIN' : 'via its milestone'}
                      </span>
                      <span className={`text-[11px] ${d.sent ? 'text-emerald-700' : d.accepted ? 'text-gray-500' : 'text-amber-800'}`}>
                        {d.sent ? 'sent' : d.accepted ? 'accepted, not sent' : 'not accepted'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-gray-400">No deliverable answers this line item.</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {unassignedMilestones.length > 0 && (
        <div className="border-t border-gray-200 px-4 py-3">
          <p className="text-xs font-medium text-gray-700">Work under no line item</p>
          <p className="text-xs text-gray-600">
            {unassignedMilestones.map((m) => (m.code ? `${m.code} ${m.title}` : m.title)).join(' · ')}
          </p>
        </div>
      )}

      {gaps.length > 0 && (
        <div className="border-t border-gray-200 bg-gray-50 px-4 py-3">
          <p className="mb-1 text-xs font-medium text-gray-700">
            {gaps.length} thing{gaps.length === 1 ? '' : 's'} not yet linked
          </p>
          <ul className="space-y-0.5">
            {gaps.map((g, i) => (
              <li key={`${g.kind}-${i}`} className="text-xs text-gray-600">
                <span className="font-medium text-gray-800">{g.subject}</span> — {g.detail}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
