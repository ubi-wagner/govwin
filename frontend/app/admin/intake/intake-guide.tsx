/**
 * The in-page guide for hand-staging an opportunity.
 *
 * Distilled from docs/SCOUT_INTAKE_QUEUE.md and docs/INGEST_PROVENANCE.md. This screen is the
 * manual door into the same pipeline the scouts feed — and the provenance rule that governs
 * everything downstream starts being true, or not true, right here.
 *
 * The invariant test requires this guide to keep stating the one that matters most: a value the
 * product did not read from the solicitation must never look like one it did.
 */
import { GuideCard, Step, P, Ul, Ctl, Code, Careful, Unwritten, Canon } from '@/components/admin/guide';

const R = '/admin/intake';

export default function IntakeGuide() {
  return (
    <GuideCard title="How this works — staging an opportunity by hand">
      <P>
        This is the manual door into the same pipeline the scouts feed. Use it when you have a
        solicitation nobody crawled: a PDF from an email, a link somebody sent you, a program you
        already know about. What you stage here lands in the triage queue exactly as a released
        scout finding does — it is not a shortcut past curation.
      </P>

      <Step id="check" route={R} title="1 · Check it is not already here">
        <P>
          The scout queue de-duplicates against the master list automatically; this form does not do
          that thinking for you. Staging a solicitation that already exists creates a second record,
          and from then on half your customers watch one and half watch the other.
        </P>
        <Careful>
          If it might be an amendment to something already in the system, it belongs in the
          amendment path, not here. Two records for one solicitation is the expensive mistake in
          this whole arc, and it is much cheaper to check than to unpick.
        </Careful>
      </Step>

      <Step id="minimum" route={R} title="2 · What to type, and what not to">
        <P>
          Type what the document actually says — the number, the agency, the title, the link. Leave
          anything you are unsure of empty.
        </P>
        <Careful>
          An empty field is a fact the product can carry honestly. A guessed one becomes a value a
          customer reads as read-from-the-source, and there is no badge for &ldquo;the person staging
          it thought this was probably right&rdquo;. Blank beats plausible, every time.
        </Careful>
        <P>
          <Ctl>Stage into review queue</Ctl> creates the opportunity inactive and the curated
          solicitation as <Code>new</Code>. Nothing is visible to a customer until curation is done
          and someone pushes it.
        </P>
      </Step>

      <Step id="document" route={R} title="3 · Get the document in early">
        <P>
          Curation, Ingest Assist and the compliance matrix all read the extracted text of the
          document. Until it is uploaded and shredded, Assist will refuse to run — it answers
          <Code>409 SOURCE_TEXT_NOT_READY</Code> rather than writing a skeleton of defaults that
          would read like an extraction.
        </P>
        <P>
          That refusal is the feature. There is an explicit opt-in for a blank skeleton, and it marks
          every value unverified, which is the correct trade — but it is a decision to make on
          purpose, not a thing to click past.
        </P>
      </Step>

      <Step id="provenance" route={R} title="4 · The rule everything downstream depends on">
        <P>
          Every value on a solicitation carries where it came from, and the badges are not
          decoration:
        </P>
        <Ul>
          <li><strong>Highlighted / Verified</strong> — a person confirmed it against the document</li>
          <li><strong>Read from source</strong> — lifted deterministically, with the sentence cited</li>
          <li><strong>AI</strong> — a model&rsquo;s reading, unanchored</li>
          <li><strong>Default — unverified</strong> — not read from this solicitation at all</li>
          <li><strong>Set elsewhere</strong> — the document says the rule lives somewhere else, and that absence is the answer</li>
        </Ul>
        <P>
          A stronger source may quietly overwrite a weaker one. The reverse must never happen: if a
          re-run of Assist ever turns something you verified back into a default, that is a defect
          and worth noting here rather than correcting silently.
        </P>
      </Step>

      <Step id="after" route={R} title="5 · What happens next">
        <P>
          It appears in the RFP triage queue. Curation is where the compliance matrix, the topics and
          the highlighted sections get built, and the push to customers is a separate, deliberate act
          after that.
        </P>
        <Unwritten>
          how long the shred usually takes on a large BAA, and what you do while you wait.
        </Unwritten>
      </Step>

      <Canon doc="docs/INGEST_PROVENANCE.md">
        the three layers, the trust order, the shred gate and the invariants.
      </Canon>
    </GuideCard>
  );
}
