/**
 * The in-page guide for spotlight buckets — the control that RANKS a customer's opportunity list.
 *
 * DISTILLED from docs/RANKING_SPINE.md — never forked. What belongs here is the one thing a person
 * has to understand before authoring a bucket: this is not a filter. It does not hide anything. It
 * reorders everything, including opportunities that have not arrived yet.
 *
 * Bound with `guideFor('tenant')` — no note box, because `/api/admin/notes` requires `rfp_admin`
 * and would answer 403 to every customer who used it.
 *
 * Every `<Ctl>` below was read off `components/portal/spotlight-buckets.tsx` rather than assumed.
 * The first draft of the sibling cards guide named a control called "Start a build" that has never
 * existed on that page — `verify-guide-controls.mjs` exists because that is an easy mistake and an
 * expensive one: a guide naming a button nobody can find reads as a broken product.
 */
import { guideFor } from '@/components/admin/guide';

const { GuideCard, Step, P, Ul, Ctl, Careful, Unwritten, Canon } = guideFor('tenant');

const R = '/portal/[tenantSlug]/buckets';

export default function BucketsGuide() {
  return (
    <GuideCard title="How this works — buckets are how you rank, not how you filter">
      <P>
        A bucket is a description of work you want. Every opportunity in your list is scored
        against every bucket you have, and the list is ordered by those scores. Buckets{' '}
        <strong>never hide anything</strong> — an opportunity that matches none of them still
        appears, at the bottom. That is deliberate: a filter you forgot you set is how a company
        misses the thing it should have bid.
      </P>

      <Step id="empty" route={R} title="1 · You start with none, and that is on purpose">
        <P>
          Nobody seeds buckets for you. A default bucket would rank your list according to
          somebody else&rsquo;s guess about your business, and — worse — it would look like a
          considered answer. The list is in arrival order until the first bucket exists.
        </P>
      </Step>

      <Step id="write" route={R} title="2 · Writing one">
        <P>
          Give it a name and the criteria that describe the work. <Ctl>Create</Ctl> saves it and
          rescores your whole list immediately; <Ctl>Cancel</Ctl> abandons the draft. Editing an
          existing one replaces its criteria and rescores the same way — <Ctl>Save changes</Ctl>.
        </P>
        <P>
          Write for the solicitation&rsquo;s words, not your own. Scoring reads the text agencies
          publish, so the phrase a programme officer would use beats the phrase your team uses
          internally. A bucket of internal shorthand scores nothing and looks broken.
        </P>
        <Unwritten>
          which criteria earn their place and which add noise — that needs a few months of your own
          results, and nobody should write it for you from a fixture.
        </Unwritten>
      </Step>

      <Step id="score" route={R} title="3 · What the score is made of">
        <Ul>
          <li><strong>Keyword fit</strong> — the bucket&rsquo;s terms against the opportunity&rsquo;s own text</li>
          <li><strong>How close the close date is</strong> — an opportunity closing in nine days ranks above the same one closing in nine months</li>
          <li><strong>Your documents</strong> — a pass over the copy of the solicitation held in your workspace, weighted below keyword fit</li>
        </Ul>
        <P>
          Every factor <strong>abstains when it has nothing to measure</strong>. If a solicitation
          never stated a close date, that factor scores nothing at all rather than scoring zero —
          so a card is never pushed down for something the agency simply did not publish. A
          criterion shown at a confident percentage against a feed where no opportunity carries
          that field would be worse than no number.
        </P>
      </Step>

      <Step id="cap" route={R} title="4 · The cap, and why more buckets is not better">
        <P>
          There is a ceiling on how many buckets you can hold, shown on this page and set by your
          RFP administrator. It is an authoring budget, not a licence tier.
        </P>
        <P>
          The reason to stay well under it is not the limit: every bucket you add is another lens
          the same list is sorted through, and past a handful they stop disagreeing with each other
          usefully. Two sharp buckets rank better than nine vague ones.
        </P>
      </Step>

      <Step id="delete" route={R} title="5 · Removing one">
        <P>
          The delete control on a bucket takes it out of your ranking and rescores the list without
          it.
        </P>
        <Careful>
          Removing a bucket does not remove any opportunity — the list keeps every card and simply
          reorders. What you lose is the lens, and with it the reason the list was in the order you
          had got used to.
        </Careful>
      </Step>

      <Step id="see" route={R} title="6 · Seeing the effect">
        <P>
          <Ctl>Rank →</Ctl> takes you to your opportunity list in the new order. That is the only
          place the effect of a bucket is visible: this page holds the lenses, that page is what
          they do.
        </P>
      </Step>

      <Canon doc="docs/RANKING_SPINE.md">
        the scoring factors, the abstain rule, the cap, and what a new bucket rescores.
      </Canon>
    </GuideCard>
  );
}
