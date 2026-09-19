/**
 * The in-page guide for a customer's opportunity list — the MIRROR half of the OPP spine.
 *
 * THE FIRST GUIDE ON A CUSTOMER SURFACE. Every guide before this one was written for `/admin`,
 * and `catalog-guides.mjs` walked `app/admin` only, so the 38 portal surfaces were not counted as
 * uncovered — they were absent from the coverage document entirely.
 *
 * DISTILLED from docs/MASTER_MIRROR_OPP_DESIGN.md and docs/RANKING_SPINE.md — never forked. What
 * belongs here is the decision a person makes AT THIS SCREEN and the thing about it that surprises
 * people, which on this page is the same thing twice: the list is yours, and the ranking is
 * something you author rather than something done to you.
 *
 * ── WHAT THIS GUIDE MUST NOT DO ────────────────────────────────────────────────────────────────
 * It is bound with `guideFor('tenant')`, which drops the note box. `/api/admin/notes` requires
 * `rfp_admin` and answers 403 to a tenant_admin, so an admin-lane guide rendered here would put a
 * form in front of a customer that refuses every submission — under a line telling them to use it.
 */
import { guideFor } from '@/components/admin/guide';

const { GuideCard, Step, P, Ul, Ctl, Careful, Canon } = guideFor('tenant');

const R = '/portal/[tenantSlug]/cards';

export default function CardsGuide() {
  return (
    <GuideCard title="How this works — your opportunity list, and why it is in this order">
      <P>
        This is <strong>your</strong> copy of every opportunity we carry. It is not a shared board
        you are looking at from outside: each card was written into your workspace when the
        opportunity was released, with your company&rsquo;s own copy of the solicitation behind it.
        Nothing you do here is visible to another company, and nothing another company does changes
        what you see.
      </P>

      <Step id="order" route={R} title="1 · The order is yours, and it is computed">
        <P>
          Cards are ranked by <strong>your spotlight buckets</strong> — the lenses you author on the
          Buckets page. A bucket is a description of work you want; the score is how well a card
          matches it. Change a bucket and this list reorders. Nobody outside your company can
          change that order.
        </P>
        <P>
          The score is arithmetic, not an opinion: keyword fit, how close the close date is, and a
          pass over your own uploaded documents. Each factor <strong>abstains when it has nothing
          to measure</strong> rather than scoring zero — a card is never pushed down for a fact the
          solicitation simply never stated.
        </P>
      </Step>

      <Step id="rate" route={R} title="2 · Rate a card — 👍 / 👎">
        <P>
          Rating is the fastest way to tell the list what you actually want. It records your
          judgement against that card; it does not hide anything from your colleagues and it does
          not remove the card.
        </P>
        <P>
          A rating is about <em>this opportunity</em>. If you find yourself rating the same way over
          and over for the same reason, that reason belongs in a bucket — that is the control that
          changes the ranking for everything, including opportunities that have not arrived yet.
        </P>
      </Step>

      <Step id="arrive" route={R} title="3 · Where new cards come from, and when">
        <P>
          Opportunities reach this list one way: an RFP administrator releases one, and it is
          written to every company&rsquo;s list at that moment. Releases are not on a schedule, so a
          quiet day is a quiet day upstream and not a fault here.
        </P>
        <Ul>
          <li>A new card is <strong>scored on arrival</strong>, against the buckets you have today</li>
          <li>An <strong>updated</strong> card — an amendment, a corrected close date — replaces what it says and keeps its place in your history</li>
          <li>A card is <strong>never deleted</strong> from your list by anyone upstream</li>
        </Ul>
      </Step>

      <Step id="buy" route={R} title="4 · Turning a card into a proposal">
        <P>
          <Ctl>Purchase</Ctl> is a request, not a switch. It opens a proposal portal for that
          opportunity, and an RFP administrator sets it up for you — the compliance matrix, the
          volumes and the required items come from the solicitation itself rather than from a blank
          template. <Ctl>Build →</Ctl> beside it does not buy anything; it takes you to the portal
          for an opportunity you have already started.
        </P>
        <Careful>
          Purchasing commits this opportunity to a 72-hour set-up window on our side. Buy the one
          you mean: it is far cheaper to rate and wait than to open a portal you will not use.
        </Careful>
      </Step>

      <Step id="who" route={R} title="5 · Who can see this page, and who can buy">
        <P>
          Two different gates, and mixing them up is the usual confusion. Reaching the page needs a
          company administrator <em>or</em> a <strong>bucket designee</strong> they have delegated
          to; everyone else lands on Proposals instead, which is the gate working rather than an
          error.
        </P>
        <P>
          <strong>Buying is narrower still.</strong> A designee can rate, author buckets and
          reorder this entire list — and cannot purchase. Where the buttons above would be, they
          see a note saying to ask their administrator. That is deliberate: choosing what to pursue
          and committing the company&rsquo;s money are different decisions.
        </P>
      </Step>

      <Canon doc="docs/MASTER_MIRROR_OPP_DESIGN.md">
        how the master list becomes your list, what a release does, and what an update replaces.
      </Canon>
    </GuideCard>
  );
}
