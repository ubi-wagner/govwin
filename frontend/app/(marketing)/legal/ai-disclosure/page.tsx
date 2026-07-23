export const metadata = {
  title: 'AI Disclosure — RFP Pipeline',
  description: 'How RFP Pipeline uses artificial intelligence in its platform and services.',
};

export default function AiDisclosurePage() {
  return (
    <div>
      <h1 className="font-display text-3xl font-black text-navy-900 leading-tight mb-2">
        AI Usage Disclosure
      </h1>
      <p className="text-xs text-navy-400 mb-8">Last updated: May 2026</p>

      <div className="bg-white border border-cream-200 rounded-xl p-8 md:p-12 space-y-8 text-sm text-navy-700 leading-relaxed">
          <div>
            <h2 className="text-base font-bold text-navy-900 mb-3">1. Overview</h2>
            <p>
              RFP Pipeline uses artificial intelligence (AI) as a core component of its platform.
              This disclosure explains what AI models we use, how they process your data, and
              what safeguards are in place. We believe transparency about AI usage is essential,
              especially in the context of federal proposal preparation.
            </p>
          </div>

          <div>
            <h2 className="text-base font-bold text-navy-900 mb-3">2. AI Models Used</h2>
            <p>RFP Pipeline currently uses the following AI models:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li><strong>Anthropic Claude:</strong> Used for proposal section drafting, content analysis, compliance extraction, opportunity classification, and source change detection</li>
              <li><strong>OpenAI Embeddings:</strong> Used for semantic search within the content library to find relevant past content atoms</li>
            </ul>
            <p className="mt-3">
              We may update the specific models used as improved versions become available. The
              fundamental architecture (isolated tenants, human-in-the-loop review, structured
              outputs) remains consistent regardless of the underlying model.
            </p>
          </div>

          <div>
            <h2 className="text-base font-bold text-navy-900 mb-3">3. How AI Is Used</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Proposal Drafting:</strong> AI generates draft text for proposal sections based
                on your content library, the solicitation requirements, and the compliance matrix. All
                drafts require human review and acceptance.
              </li>
              <li>
                <strong>Compliance Extraction:</strong> AI reads solicitation documents to extract
                requirements, page limits, formatting rules, and evaluation criteria. Results are
                verified by our expert curator.
              </li>
              <li>
                <strong>Opportunity Scoring:</strong> AI assists in scoring opportunities against
                your company profile. Scores are calibrated by our expert curator and adjusted
                based on your feedback.
              </li>
              <li>
                <strong>Source Monitoring:</strong> AI classifies changes detected on federal
                procurement websites to determine if they represent new opportunities, amendments,
                or routine updates.
              </li>
              <li>
                <strong>Content Library Search:</strong> AI-generated embeddings enable semantic
                search to find relevant past content for new proposal sections.
              </li>
            </ul>
          </div>

          <div>
            <h2 className="text-base font-bold text-navy-900 mb-3">4. Data Isolation</h2>
            <p>
              Each tenant receives isolated AI agent instances. Your data is never mixed with
              another tenant&apos;s data in AI context windows. AI agents provisioned for your
              workspace can only access: your content library, your proposal sections, your
              tenant profile, and the public solicitation data relevant to your proposals.
            </p>
          </div>

          <div>
            <h2 className="text-base font-bold text-navy-900 mb-3">5. Data Handling by AI Providers</h2>
            <p>
              Our AI providers (Anthropic, OpenAI) process your data solely to generate responses
              to our API requests. Per our agreements with these providers:
            </p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li>Your data is not used to train their AI models</li>
              <li>Your data is not retained beyond the API request lifecycle (typically seconds)</li>
              <li>Your data is transmitted over encrypted connections</li>
              <li>Your data is processed in the United States</li>
            </ul>
          </div>

          <div>
            <h2 className="text-base font-bold text-navy-900 mb-3">6. Human-in-the-Loop</h2>
            <p>
              AI never submits content on your behalf. Every AI-generated output is presented as
              a draft that requires explicit human review and acceptance. The platform clearly
              marks AI-generated content with confidence scores and provenance tracking. You are
              solely responsible for reviewing, editing, and accepting any AI-generated content
              before including it in a proposal submission.
            </p>
          </div>

          <div>
            <h2 className="text-base font-bold text-navy-900 mb-3">7. Limitations</h2>
            <p>AI-generated content may:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li>Contain inaccuracies or fabricated information (commonly called &quot;hallucinations&quot;)</li>
              <li>Produce text that does not accurately reflect your company&apos;s capabilities</li>
              <li>Miss nuances in solicitation requirements</li>
              <li>Generate content that requires significant revision</li>
            </ul>
            <p className="mt-3">
              This is why human review is mandatory. The AI is a drafting assistant, not a
              proposal writer. RFP-Pipeline expert curation and consultation are advisory as well —
              our people can make mistakes too. Your expertise and judgment are the final quality
              gate, and final review before submission is always your responsibility.
            </p>
          </div>

          <div>
            <h2 className="text-base font-bold text-navy-900 mb-3">8. Federal Compliance</h2>
            <p>
              Some federal agencies require or may require disclosure of AI assistance in
              proposal preparation. It is your responsibility to comply with any such
              requirements. RFP Pipeline can provide documentation of which sections received
              AI assistance upon request.
            </p>
          </div>

          <div>
            <h2 className="text-base font-bold text-navy-900 mb-3">9. Questions</h2>
            <p>
              For questions about our AI usage, contact{' '}
              <a href="mailto:eric@rfppipeline.com" className="text-brand-600 hover:underline">
                eric@rfppipeline.com
              </a>.
            </p>
          </div>
      </div>
    </div>
  );
}
