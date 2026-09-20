/**
 * The in-page guide for the scout candidate queue.
 *
 * DISTILLED from docs/SCOUT_INTAKE_QUEUE.md — never forked. What belongs here is the decision a
 * person makes at this screen, the way it can go wrong, and what cannot be taken back. Everything
 * else stays in the canonical doc, because two copies of the same prose drift within a fortnight
 * and the copy nobody regenerates is the one people read.
 *
 * Invariants asserted by `__tests__/admin-guides-invariants.test.ts`: this guide must keep saying
 * that release is one-way, that the classifier is an anchor rather than an opinion, and that
 * candidate text is untrusted. Those are the three things a first-time curator can be harmed by
 * not knowing.
 *
 * `<Ctl>` means "press this, ON THIS PAGE" — `verify-guide-controls.mjs` checks every one against
 * this guide's own route. A pointer to another surface's button is prose, not a control; marking
 * one up as `<Ctl>` made the lens report a control that is correctly absent, which is the lens
 * doing its job rather than a defect in the page.
 */
import { GuideCard, Step, P, Ul, Ctl, Code, Careful, Unwritten, Canon } from '@/components/admin/guide';

const R = '/admin/scouts';

export default function ScoutsGuide() {
  return (
    <GuideCard title="How this works — reviewing what the scouts found">
      <P>
        Everything the crawlers and the source-scout turn up lands in one queue, already sorted into
        <strong> new</strong> or <strong>update</strong>. Your job at this screen is to agree or
        disagree with that call, and then send each finding down the right pipe. Nothing here reaches
        a customer — release puts a record in front of another human, never on a customer&rsquo;s board.
      </P>

      <Step id="read" route={R} title="1 · Read the classification before the title">
        <P>
          Each candidate carries a machine call and the reason for it. It is a deterministic matcher
          against the existing opportunity list, not a judgement — same source notice, same
          solicitation number, identical title, then fuzzy title. It scores, it does not opine.
        </P>
        <Ul>
          <li><strong>update</strong> (≥ 0.6) — it believes this is a known solicitation, re-posted or amended</li>
          <li><strong>unknown</strong> (0.4–0.6) — it found a possible match and is explicitly asking you</li>
          <li><strong>new</strong> (&lt; 0.4) — it found nothing close</li>
        </Ul>
        <P>
          The <em>unknown</em> band is the one to slow down on: it is the classifier saying it cannot
          tell, which is the honest answer and not a defect.
        </P>
      </Step>

      <Step id="documents" route={R} title="2 · What the DOCUMENTS said — a second opinion">
        <P>
          The badge is the classification. Under it, on most candidates, is what the attached files
          said about the same question — fetched from the page when the candidate arrived, and
          compared against every document the platform already holds.
        </P>
        <Ul>
          <li><strong>identical file found</strong> — the same bytes. Against a solicitation we
            already carry, this is the strongest evidence there is and the call above has already
            been moved to <em>update</em>. Against another candidate in this queue, nothing moves:
            the two are duplicates of each other, so release one and dismiss the other.</li>
          <li><strong>worth a look</strong> — a close filename and a close size, different bytes.
            This changes nothing on its own and is not meant to: it is the cheapest pair of
            signals on the two most-repeated attributes in government document naming.</li>
          <li><strong>shared attachment</strong> — the same bytes, but that file hangs off many
            opportunities. An umbrella BAA is attached to every topic beneath it, so it cannot say
            which one this is, and it was not used to decide anything.</li>
          <li><strong>no match</strong> — documents were harvested and compared, and none of them
            appears anywhere else.</li>
        </Ul>
        <Careful>
          <strong>&ldquo;not checked&rdquo; is not &ldquo;no match&rdquo;.</strong> A candidate
          whose page could not be read — a portal that refused us, a link that has moved — says so
          in those words. Read it as a question still open, not as an answer.
        </Careful>
      </Step>

      <Step id="decide" route={R} title="3 · The decision — and it is one-way">
        <Ul>
          <li><Ctl>Release as new</Ctl> — stages a fresh opportunity and a curated solicitation in the triage queue</li>
          <li><Ctl>Release as update</Ctl> — logs an amendment against the matched opportunity instead</li>
          <li><Ctl>Dismiss</Ctl> — records the outcome and closes the finding</li>
        </Ul>
        <Careful>
          Release is a compare-and-swap: once a finding is released or dismissed, releasing it again
          is refused. Getting new-vs-update wrong is the expensive mistake — releasing an amendment
          as new forks a solicitation that should have stayed one record, and every customer holding
          the original keeps watching the stale one.
        </Careful>
        <P>
          When the two look plausible, check the solicitation number rather than the title. Agencies
          re-title freely between postings; they renumber far less often.
        </P>
      </Step>

      <Step id="trust" route={R} title="4 · What the text on this screen is, and is not">
        <P>
          Candidate titles, snippets and URLs come from pages nobody here wrote. The product treats
          them as <strong>data</strong>: normalised and compared, never interpreted, never followed as
          an instruction. Read them the same way. A candidate that seems to be telling you to do
          something is a candidate to dismiss.
        </P>
      </Step>

      <Step id="after" route={R} title="5 · Where it goes next">
        <Ul>
          <li><strong>Released as new</strong> → RFP triage queue, where curation happens and where the push to customers is decided</li>
          <li><strong>Released as update</strong> → amendment review, where a human confirms before it fans out to built proposals</li>
        </Ul>
        <P>
          Neither one auto-publishes. If a customer sees something because of a decision made here, a
          second person agreed to it first.
        </P>
        <Unwritten>
          how often the <em>unknown</em> band is actually right. When title and number disagree the
          documents now settle it — see step 2 — but how often that happens, and what you do on the
          candidates where even the files are silent, needs a season of real queues.
        </Unwritten>
      </Step>

      <Step id="stuck" route={R} title="6 · When the queue looks wrong">
        <P>
          An empty queue usually means no source has run, not that nothing was found — run a source
          from <Code>/admin/sources</Code>. <Ctl>Refresh</Ctl> here re-reads the queue without
          re-crawling anything.
        </P>
        <Unwritten>the failure modes that actually show up in a week of real crawling.</Unwritten>
      </Step>

      <Canon doc="docs/SCOUT_INTAKE_QUEUE.md">
        classification bands, the release routing table, and the guardrails.
      </Canon>
    </GuideCard>
  );
}
