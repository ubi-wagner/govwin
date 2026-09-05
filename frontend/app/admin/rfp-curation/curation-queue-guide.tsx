/**
 * The in-page guide for the RFP triage queue — the front door of curation.
 *
 * Distilled from docs/SCOUT_INTAKE_QUEUE.md and docs/RFP_ADMIN_OPERATIONS_GUIDE.md. This screen is
 * a work queue, not a decision surface: the decisions happen inside a solicitation. What belongs
 * here is how the queue behaves between people, which is the part that goes wrong when two admins
 * curate at once.
 */
import { GuideCard, Step, P, Ul, Ctl, Careful, Unwritten, Canon } from '@/components/admin/guide';

const R = '/admin/rfp-curation';

export default function CurationQueueGuide() {
  return (
    <GuideCard title="How this works — the triage queue">
      <P>
        Everything staged — by a scout release, by hand at Intake, or by an upload — lands here as a
        curated solicitation with status <strong>new</strong>. Nothing on this screen reaches a
        customer. Curation happens inside a solicitation; this is how you pick one up and put it
        down.
      </P>

      <Step id="claim" route={R} title="1 · Claim before you start">
        <P>
          <Ctl>Claim</Ctl> puts your name on it. It is not a lock in the strict sense — it is how the
          next person knows not to start the same document. Curating a full BAA is hours of work, and
          two people doing it in parallel is the most expensive way to discover that.
        </P>
        <Unwritten>
          what actually happens when two of you are curating at once — worth writing down the first
          time it comes up.
        </Unwritten>
      </Step>

      <Step id="work" route={R} title="2 · Work it, then mark it">
        <Ul>
          <li><Ctl>Approve / Done</Ctl> — curation is finished for this record</li>
          <li><Ctl>Dismiss</Ctl> — it should not be curated at all: out of scope, a duplicate, or not real</li>
          <li><Ctl>Refresh</Ctl> — re-reads the queue; it does not re-crawl or re-stage anything</li>
        </Ul>
        <Careful>
          Marking a solicitation done is <em>not</em> what makes it visible to customers. That is
          <strong> Push</strong>, inside the solicitation, and it is a separate deliberate act. A
          record can be perfectly curated and reach nobody — which is the safe default, not a bug.
        </Careful>
      </Step>

      <Step id="scope" route={R} title="3 · Dismissing is a judgement, and it is recorded">
        <P>
          Dismissal is how the queue stays readable, and it carries your name. If you are dismissing
          a whole class of thing repeatedly, that is a signal about the source that produced them —
          worth a note rather than a hundred dismissals.
        </P>
      </Step>

      <Canon doc="docs/RFP_ADMIN_OPERATIONS_GUIDE.md">the operator&rsquo;s full pass.</Canon>
    </GuideCard>
  );
}
