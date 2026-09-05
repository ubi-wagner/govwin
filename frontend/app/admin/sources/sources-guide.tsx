/**
 * The in-page guide for source profiles — where findings come from in the first place.
 *
 * Distilled, not forked. This screen is upstream of everything else in the discovery arc: a source
 * that is not configured produces an empty scout queue, and an empty queue is indistinguishable
 * from "nothing was posted this week" unless you know to look here.
 */
import { GuideCard, Step, P, Ul, Ctl, Code, Careful, Unwritten, Canon } from '@/components/admin/guide';

const R = '/admin/sources';

export default function SourcesGuide() {
  return (
    <GuideCard title="How this works — the sources the scouts read">
      <P>
        A source is a place worth watching: an agency page, a program listing, a feed. The crawler
        visits on a schedule, diffs what it sees against last time, and turns the differences into
        candidates for the scout queue. Nothing here decides anything about a customer — it decides
        what the product gets to look at.
      </P>

      <Step id="add" route={R} title="1 · Adding a source">
        <P>
          Give it a URL and a purpose. The purpose is not decoration: it is what the scout uses to
          decide whether a page on that site is worth extracting at all, so a vague purpose produces
          a noisy queue and a narrow one produces an empty one.
        </P>
        <Unwritten>
          what a good purpose actually reads like for an agency page versus a program listing —
          worth writing down the first two that work.
        </Unwritten>
      </Step>

      <Step id="schedule" route={R} title="2 · Schedule, and the honest default">
        <P>
          A source can crawl on a cadence or be <Ctl>Manual only</Ctl>. Manual is the right default
          for a site you are still learning: an automatic crawl on a source you have not read yet
          fills the queue with things you then have to dismiss one at a time.
        </P>
        <P>
          <Ctl>Scout Now</Ctl> runs it once, immediately, without changing the schedule. That is the
          button to use while you are getting a source right.
        </P>
      </Step>

      <Step id="diffs" route={R} title="3 · Reading the changes">
        <P>
          Each crawl records what moved. A change is not a finding — it is a page that differs from
          last week, which is often a rotated banner or a date stamp. The candidates that reach the
          scout queue are the subset the extractor thought were opportunities.
        </P>
        <Careful>
          If a source shows changes every single run and never produces candidates, it is costing
          crawl budget and producing nothing. That is worth a note rather than a shrug — it usually
          means the purpose is wrong, not that the site is quiet.
        </Careful>
      </Step>

      <Step id="upload" route={R} title="4 · When there is no page to crawl">
        <P>
          Plenty of solicitations arrive as a PDF in an email. <Ctl>Upload PDFs</Ctl> puts those on
          the same path rather than a side channel, so they get the same extraction and the same
          review. Prefer it over hand-staging at <Code>/admin/intake</Code> when you have the
          document, because the text ends up where the curation tools can read it.
        </P>
      </Step>

      <Step id="backoff" route={R} title="5 · When a site asks you to slow down">
        <P>
          Sources are crawled politely and a site that signals back-off is honoured. If a source has
          gone quiet, check whether it is being throttled before assuming it has stopped posting.
        </P>
        <Unwritten>which sources actually throttle, and what the recovery looks like.</Unwritten>
      </Step>

      <Canon doc="docs/SCOUT_INTAKE_QUEUE.md">the producers feeding the queue this page fills.</Canon>
    </GuideCard>
  );
}
