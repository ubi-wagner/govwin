/**
 * The in-page guide for the provisioning cockpit — the skeleton, and release two.
 *
 * Distilled from docs/PROVISIONING_WORKSPACE_DESIGN.md and docs/MASTER_MIRROR_OPP_DESIGN.md.
 *
 * ── A NOTE ON WHAT IS AND IS NOT MARKED UP AS A CONTROL ──────────────────────────────────────
 * `<Ctl>` means "press this, on this page", and `verify-guide-controls.mjs` checks every one
 * against the live DOM. This cockpit only renders its controls for a portal in the right state, and
 * the sandbox has none — so the lens reports them UNVERIFIED rather than passing them, which is the
 * honest outcome. Labels here come from `release-panel.tsx`; if one is wrong, the note box is the
 * place to say so and the lens will confirm it the first time a real portal exists.
 */
import { GuideCard, Step, P, Ul, Ctl, Careful, Unwritten, Canon } from '@/components/admin/guide';

const R = '/admin/provisioning/[portalId]';

export default function ProvisioningGuide() {
  return (
    <GuideCard title="How this works — building out the master, and releasing the portal">
      <P>
        A customer has bought. This screen is where the 72-hour promise is kept, and it does two
        different things that happen to sit behind one button: it finishes the <strong>shared
        master</strong>, and it opens <strong>this buyer&rsquo;s private portal</strong>. Keeping
        those apart in your head is most of what makes this page make sense.
      </P>

      <Step id="clock" route={R} title="1 · Read the clock and the buyer first">
        <P>
          The countdown is the SLA on the purchase, not on your day. The buyer, what they bought and
          how long is left are all at the top so that the answer to &ldquo;can this wait until
          tomorrow&rdquo; is on the screen rather than in someone&rsquo;s memory.
        </P>
      </Step>

      <Step id="skeleton" route={R} title="2 · The skeleton — build-out readiness">
        <P>
          The readiness bar is the master solicitation&rsquo;s build-out: compliance filled in,
          <strong> at least one volume</strong>, and <strong>at least one required item</strong>.
          That trio is the minimum from which a real proposal can be instantiated — below it, a
          provisioned build would open empty and the customer would be looking at your unfinished
          work.
        </P>
        <P>
          The authoring workspace is one click away. Finish the skeleton there; this page only
          reports whether it is done.
        </P>
        <Careful>
          The skeleton is on the <strong>shared master</strong>, not on this buyer. Everything you
          add here is inherited by every future build against this solicitation — which is what makes
          it worth doing properly once, and what makes a mistake here wider than one customer.
        </Careful>
      </Step>

      <Step id="release-two" route={R} title="3 · Release two — and it is two acts">
        <P>
          <Ctl>Complete &amp; Release</Ctl> does them in order, and they have different blast radii:
        </P>
        <Ul>
          <li>
            <strong>Completes the build-out</strong> on the master and broadcasts an update to{' '}
            <strong>every tenant&rsquo;s mirror card</strong> — everyone watching this opportunity
            now sees it is ready to build. That is the shared half.
          </li>
          <li>
            <strong>Provisions this buyer&rsquo;s portal</strong> — their private build, unlocked,
            with the compliance matrix and molds instantiated from the master, and their workflow
            started. That is the private half.
          </li>
        </Ul>
        <Careful>
          The broadcast reaches every activated tenant, not only the one who paid. Releasing a
          half-finished master tells the whole customer base that something is ready when it is not —
          and unlike the portal, that message cannot be recalled.
        </Careful>
        <P>
          On release the buyer also gets a required <strong>Workflow Setup</strong> ToDo in their own
          portal. Their plan is theirs to accept; you are not setting it for them.
        </P>
      </Step>

      <Step id="second-buyer" route={R} title="4 · The second buyer is cheap, and that is the design">
        <P>
          Once the master is built out, provisioning the next buyer of the same solicitation
          instantiates from work already done. If you find yourself rebuilding a skeleton per
          customer, something has gone wrong — say so below.
        </P>
        <Unwritten>
          what a realistic first build-out actually takes, end to end, and where the time goes.
        </Unwritten>
      </Step>

      <Canon doc="docs/PROVISIONING_WORKSPACE_DESIGN.md">
        the cockpit&rsquo;s full contract; the two-release model is in docs/MASTER_MIRROR_OPP_DESIGN.md.
      </Canon>
    </GuideCard>
  );
}
