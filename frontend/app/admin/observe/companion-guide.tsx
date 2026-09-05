/**
 * The companion's guide, ON the page where you ask it. Static server component, collapsible via
 * native <details> — no client JS, no clock read during render.
 *
 * ── WHY THIS EXISTS AND THE REPO DOC DOES NOT REPLACE IT ─────────────────────────────────────
 * The manual was written first as `docs/OPS_COMPANION_MANUAL.md`, and both ask boxes were pointed
 * at it by path. That is the same producer/consumer defect this branch keeps finding, one more
 * time: the product cited a file the product cannot open. An admin at 11pm has a browser, not a
 * checkout.
 *
 * ── TWO DOCUMENTS, TWO JOBS — NOT TWO COPIES ─────────────────────────────────────────────────
 * This is the SHORT version: what you need at the moment you are about to ask. The repo manual is
 * the long one — extension notes, the scope-test contract, what to do when the report is wrong,
 * cost and the kill switch — written for whoever maintains it.
 *
 * They will drift; that is what two documents do. What must NOT drift is the posture, so
 * `__tests__/companion-guide-invariants.test.ts` asserts this component still states the four
 * things a person could be harmed by not knowing: it is advisory, it never certifies, it answers
 * with a mechanism rather than a filename, and it names what it cannot see. A guide that quietly
 * becomes a feature list is worse than no guide, because it is read as a promise.
 */

const H = ({ children }: { children: React.ReactNode }) => (
  <h3 className="mt-4 mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">{children}</h3>
);

const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[11px] text-gray-700">{children}</code>
);

export default function CompanionGuide() {
  return (
    <details className="mb-5 rounded-lg border border-gray-200 bg-white">
      <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-gray-900">
        How the companion works — and what it cannot see
      </summary>

      <div className="border-t border-gray-100 px-4 py-3 text-sm leading-relaxed text-gray-700">
        <p className="max-w-3xl">
          It reads what the system <b>actually did</b> in the window above — the events, the work
          items, the mail, the agent calls, the workflows, which tables anything is writing or
          reading — plus the findings counted on this page, and it tells you{' '}
          <b>why each one happens and what to change</b>. It is not a monitor and not a chat box:
          it is the colleague you turn to and ask <i>“that finished, but something feels off.”</i>
        </p>

        <H>Asking well</H>
        <ul className="max-w-3xl list-disc space-y-1 pl-5">
          <li>
            <b>Fill in the “what you were just doing” box.</b> It is optional and it is the most
            useful thing on this page — the gap between what you believe you did and what the
            telemetry shows is where every defect this platform has shipped has lived. It is
            treated as a <b>claim to check</b>, never a description to accept: say you released a
            portal and the window shows no provisioning, and it is instructed to say so.
            <div className="mt-1 text-xs text-gray-500">
              Good: <i>released the Foundation portal and expected the workflow to start</i> ·
              Useless: <i>testing</i>
            </div>
          </li>
          <li>
            <b>Pick the window deliberately.</b> 240 minutes is the maximum it can read. A window
            is <i>now minus N to now</i>, so something still running looks exactly like something
            that crashed — which is why the findings say how long each one has been open.
          </li>
        </ul>

        <H>Reading the answer</H>
        <ul className="max-w-3xl list-disc space-y-1 pl-5">
          <li>
            <b>fixes</b> — the point of the report. Each carries the mechanism, why it happens, the
            change, how confident it is, and the one check that would settle it. Act on it, or hand
            the change to an engineer.
          </li>
          <li><b>unexplained</b> — a finding it could not explain. Honest, not a failure: it is your list to chase.</li>
          <li><b>recency · effectiveness · finish</b> — three verdicts, every time. <Code>no evidence</Code> is a valid answer and means exactly that.</li>
          <li><b>could_not_see</b> — <b>read this one.</b> It is where silence gets mistaken for health.</li>
          <li><b>worth_keeping</b> — a draft note for the shared board. Nothing writes there automatically; you decide, and that is deliberate.</li>
        </ul>
        <p className="mt-2 max-w-3xl text-xs text-gray-500">
          It answers with a <b>mechanism</b> — “the step that waits on{' '}
          <Code>proposal.section_locked</Code>” — never a filename. It has no source tree, and a
          plausible wrong path reads as authoritative and sends you somewhere unrelated.
        </p>

        <H>What it will not do</H>
        <ul className="max-w-3xl list-disc space-y-1 pl-5">
          <li><b>It will not tell you things are fine.</b> An empty window means nothing happened, not that nothing is wrong.</li>
          <li><b>It writes nothing</b> — no table, no gate, no task. It proposes the change; you make it.</li>
          <li><b>It never descends into a tenant.</b> It sees <i>whether</i> something was tenant work, never whose, and never a recipient’s address.</li>
          <li>Every ask is audited as <Code>system:observation.requested</Code>, with your identity and window.</li>
        </ul>

        <H>What it cannot see</H>
        <ul className="max-w-3xl list-disc space-y-1 pl-5 text-gray-600">
          <li>Anything outside the window — a cause 20 minutes before a 5-minute window is invisible.</li>
          <li>The source tree, and the rendered page. Whether a page shows a <Code>NaN</Code> or a button with no name is measured separately, across four actor lanes.</li>
          <li>Any state behind a control that writes — the page probe opens 25 of 1,303 candidate controls, because it refuses to click anything that mutates.</li>
          <li>
            Whether the wording is <i>wrong</i> — only whether it is malformed. Copy that is
            grammatical, finished, and says the wrong thing passes every instrument here.
          </li>
        </ul>

        <p className="mt-4 text-xs text-gray-400">
          Full manual, including cost, the kill switch, what to do when the report is wrong, and how
          to extend it: <Code>docs/OPS_COMPANION_MANUAL.md</Code> in the repository.
        </p>
      </div>
    </details>
  );
}
