/**
 * Estimate at completion — three of them, side by side (A5).
 *
 * ── IT SHOWS THE DISAGREEMENT, IT DOES NOT RESOLVE IT ────────────────────────────────────────
 * `forecast.ts` computes one EAC per basis and refuses to blend them, for the same reason
 * `rollup.ts` refuses to blend the measures underneath. This renders that refusal: three figures,
 * each labelled with what it divided by, and a line naming the spread when they diverge.
 *
 * A reader who wants one number will be frustrated by this panel. That is the correct outcome — the
 * number they want does not exist, and inventing it is the failure the whole capability is built to
 * avoid.
 *
 * Server-rendered: no state, no clock, nothing to hydrate.
 */
export interface PanelEstimate {
  basis: string;
  eac: number | null;
  etc: number | null;
  varianceAtCompletion: number | null;
  percentComplete: number | null;
  unavailable: string | null;
}

export interface PanelForecast {
  estimates: PanelEstimate[];
  measuresDisagree: boolean;
  spread: number | null;
  note: string | null;
}

const usd = (n: number | null) =>
  n === null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const BASIS_LABEL: Record<string, string> = {
  cost: 'On cost spent',
  schedule: 'On time elapsed',
  deliverables: 'On items accepted',
};

export function ForecastPanel({ forecast }: { forecast: PanelForecast }) {
  const usable = forecast.estimates.filter((e) => e.eac !== null);

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <header className="border-b border-gray-200 px-4 py-3">
        <h2 className="text-sm font-medium text-gray-900">Where this lands</h2>
        <p className="text-xs text-gray-500">
          Spend to date, projected forward three ways. They are not combined — which one is right
          depends on what the work remaining looks like.
        </p>
      </header>

      {usable.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-500">
          Nothing to project from yet — {forecast.estimates[0]?.unavailable ?? 'no progress recorded'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Basis</th>
                <th className="px-4 py-2 text-right font-medium">At completion</th>
                <th className="px-4 py-2 text-right font-medium">Left to spend</th>
                <th className="px-4 py-2 text-right font-medium">Against baseline</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {forecast.estimates.map((e) => (
                <tr key={e.basis}>
                  <td className="px-4 py-2 text-gray-900">
                    {BASIS_LABEL[e.basis] ?? e.basis}
                    {/* The denominator, beside the number. A figure nobody can check is not a figure. */}
                    {e.percentComplete !== null && (
                      <span className="ml-1 text-xs tabular-nums text-gray-400">({e.percentComplete}%)</span>
                    )}
                  </td>
                  {e.eac === null ? (
                    <td colSpan={3} className="px-4 py-2 text-xs text-gray-400">{e.unavailable}</td>
                  ) : (
                    <>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-900">{usd(e.eac)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-600">{usd(e.etc)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {/* NEGATIVE is an overrun — the same convention as schedule variance, and
                            said in words so the sign is never the only cue. */}
                        {e.varianceAtCompletion === null ? (
                          <span className="text-xs text-gray-400">no baseline</span>
                        ) : e.varianceAtCompletion < 0 ? (
                          <span className="font-medium text-red-700">{usd(-e.varianceAtCompletion)} over</span>
                        ) : (
                          <span className="text-emerald-700">{usd(e.varianceAtCompletion)} under</span>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {forecast.note && (
        <p className="border-t border-gray-200 bg-amber-50/40 px-4 py-2 text-xs text-amber-900">
          {forecast.note}
        </p>
      )}
    </section>
  );
}
