/**
 * The in-page guide for the curation workspace — the longest step in the arc, and the one that
 * ends with a customer seeing something.
 *
 * Distilled from docs/INGEST_PROVENANCE.md, docs/SCOUT_INTAKE_QUEUE.md and
 * docs/MASTER_MIRROR_OPP_DESIGN.md. It covers ingest → assist → provenance → topics → compliance →
 * amend → **Release 1 (Push)**, because that is one sitting of work and splitting it across guides
 * would hide the only thing on this screen that cannot be undone.
 *
 * The invariants test requires this guide to keep saying that Push is forward-only and fans to
 * every tenant, that a default is never dressed as a reading, and that confirming an amendment
 * reaches every built proposal.
 */
import { GuideCard, Step, P, Ul, Ctl, Code, Careful, Unwritten, Canon } from '@/components/admin/guide';

const R = '/admin/rfp-curation/[solId]';

export default function CurationGuide() {
  return (
    <GuideCard title="How this works — curating a solicitation, and releasing it">
      <P>
        This is where a document becomes a record the product can reason about: what it requires,
        how it is structured, and what a customer would need to build. It ends with{' '}
        <Ctl>Push</Ctl>, which is the first of the two releases and the only irreversible act on this
        screen.
      </P>
      <P>
        The path is the same whether this is an SBIR topic list, a TVSF round, a BAA or an OTA. What
        changes is what curation <em>produces</em> — how many topics, which volumes — not the order
        of the work.
      </P>

      <Step id="text" route={R} title="1 · Text first — nothing works without it">
        <P>
          Upload the document under <Ctl>Documents</Ctl>. Extraction runs asynchronously; until it
          finishes there is no text for anything else to read.
        </P>
        <P>
          <Ctl>✨ Ingest Assist</Ctl> will <strong>refuse</strong> to run before then —
          <Code>409 SOURCE_TEXT_NOT_READY</Code> — rather than writing a skeleton of defaults that
          would read like an extraction. <Ctl>🔍 Shred audit</Ctl> tells you what the extractor
          actually got, which is the first thing to check when Assist produces something odd.
        </P>
        <Careful>
          There is an explicit opt-in for a blank skeleton with no document. It marks every value
          unverified, which is the honest trade — but take it on purpose, not by clicking past a
          refusal.
        </Careful>
      </Step>

      <Step id="assist" route={R} title="2 · Assist proposes; you decide">
        <P>
          Assist merges three layers per field — a deterministic reader that cites the sentence, then
          the model, then a system default — and stamps which one won. <Ctl>🩺 Assess readiness</Ctl>{' '}
          tells you where the record stands before you spend time in it.
        </P>
        <P>Every value carries where it came from, and the badges are the whole point:</P>
        <Ul>
          <li><strong>Highlighted / Verified</strong> — a person confirmed it against the document</li>
          <li><strong>Read from source</strong> — lifted deterministically, sentence cited</li>
          <li><strong>AI</strong> — the model&rsquo;s reading, unanchored</li>
          <li><strong>Default — unverified</strong> — not read from this solicitation at all</li>
          <li><strong>Set elsewhere</strong> — the document says the rule lives somewhere else, and that absence <em>is</em> the answer</li>
        </Ul>
        <Careful>
          A stronger source may overwrite a weaker one silently. The reverse must never happen — if
          re-running Assist ever turns something you verified back into a default, that is a defect,
          and the note box below is the right place for it.
        </Careful>
      </Step>

      <Step id="structure" route={R} title="3 · Topics and compliance — the shape a build inherits">
        <P>
          <Ctl>Extract Topics</Ctl> segments an umbrella solicitation into its topics; each becomes
          its own card and its own possible build. A real BAA can be dozens. <Ctl>Compliance</Ctl> is
          where the volumes, required items and their limits live — this is the skeleton every
          provisioned proposal is instantiated from, so an error here is inherited by every build
          made against it.
        </P>
        <P>
          <Ctl>Customer Interest</Ctl> shows who is already watching this record — useful before you
          push, and the only cross-tenant read on this screen.
        </P>
        <Unwritten>
          how you decide topic granularity on an umbrella that does not segment cleanly.
        </Unwritten>
      </Step>

      <Step id="amend" route={R} title="4 · Amendments — the update path, not a re-ingest">
        <P>
          When an agency re-posts or amends, it belongs on the existing record:{' '}
          <Ctl>+ Log amendment</Ctl>, not a second solicitation. A scout release can log one for you;
          this is the manual door.
        </P>
        <Careful>
          Logging is detection. <strong>Confirming</strong> an amendment fans it out to every built
          proposal against this solicitation and asks each tenant to acknowledge. That reaches
          customers who are mid-build, so confirm when you know what changed — not to clear a badge.
        </Careful>
      </Step>

      <Step id="release-one" route={R} title="5 · Release one — Push, and it is forward-only">
        <P>
          <Ctl>Push</Ctl> fans this record onto the bridge and creates a card for{' '}
          <strong>every activated tenant</strong> — the umbrella and all its topics. That is
          discovery: customers can now see it, rank it, and pin it.
        </P>
        <Careful>
          The bridge is <strong>one-way</strong>. There is no un-push. A correction after a push
          reaches customers as an update to something they have already seen, and a record pushed
          before its compliance is right is a skeleton every later build inherits. Read the readiness
          before you press it, not after.
        </Careful>
        <P>
          Push is <em>not</em> the proposal-portal release. That is the second one, and it happens in
          provisioning after a customer buys. A pushed record with no build-out is exactly right at
          this stage.
        </P>
      </Step>

      <Step id="after" route={R} title="6 · What happens without you">
        <P>
          Pushed cards are auto-scored into each tenant&rsquo;s buckets on arrival, and the hot
          closing-soon nudge is driven from the solicitation&rsquo;s own dates. Nothing else moves
          until a customer acts or an admin provisions.
        </P>
        <Unwritten>the failure modes that show up on a real BAA — worth capturing on the first one.</Unwritten>
      </Step>

      <Canon doc="docs/INGEST_PROVENANCE.md">
        the three layers, the trust order and the shred gate; the release model is in
        docs/MASTER_MIRROR_OPP_DESIGN.md.
      </Canon>
    </GuideCard>
  );
}
