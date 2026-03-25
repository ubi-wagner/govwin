import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'AI Disclosure | RFP Pipeline',
  description: 'How RFP Pipeline uses artificial intelligence and its limitations.',
}

export default function AiDisclosurePage() {
  return (
    <article className="prose prose-gray max-w-none prose-headings:font-bold prose-h1:text-3xl prose-h2:text-xl prose-h2:mt-10 prose-h3:text-base prose-p:text-sm prose-li:text-sm prose-p:leading-relaxed">
      <p className="text-xs text-gray-400 mb-2">Version 2026-03-25-v1 &middot; Effective March 25, 2026</p>
      <h1>AI & Machine Learning Disclosure</h1>
      <p className="lead text-base text-gray-600">
        RFP Pipeline uses artificial intelligence to enhance opportunity analysis and scoring. This disclosure
        explains what AI does, what data it processes, and its known limitations. We believe in transparency
        about where human judgment is irreplaceable.
      </p>

      <h2>1. How AI Is Used</h2>

      <h3>1.1 Opportunity Scoring</h3>
      <p>
        Every opportunity is scored against your organization&apos;s profile using a deterministic algorithm
        (0&ndash;100 scale) that weighs NAICS code match, keyword relevance, set-aside eligibility, agency
        priorities, opportunity type, and timeline proximity. This scoring is rule-based, not AI-driven.
      </p>

      <h3>1.2 AI-Enhanced Analysis</h3>
      <p>
        Opportunities scoring above our analysis threshold (default: 50) are sent to a large language model
        (currently Anthropic&apos;s Claude) for deeper analysis. The AI generates:
      </p>
      <ul>
        <li><strong>Key Requirements:</strong> Extracted from the solicitation description — major deliverables, compliance needs, evaluation criteria</li>
        <li><strong>Competitive Risk Assessment:</strong> Inferred challenges based on the opportunity structure, set-aside type, and apparent complexity</li>
        <li><strong>RFI/RFP Questions:</strong> Suggested clarification questions based on ambiguities in the solicitation</li>
        <li><strong>Score Adjustment:</strong> A &minus;20 to +20 modifier to the base score, with written rationale explaining the adjustment</li>
      </ul>

      <h3>1.3 What AI Does NOT Do</h3>
      <ul>
        <li>AI does <strong>not</strong> submit bids, proposals, or any communications on your behalf</li>
        <li>AI does <strong>not</strong> make bid/no-bid decisions — it provides analysis for your team to evaluate</li>
        <li>AI does <strong>not</strong> access non-public information (e.g., incumbent contract performance, internal agency deliberations)</li>
        <li>AI does <strong>not</strong> write complete proposals — it assists with analysis only</li>
        <li>AI does <strong>not</strong> have memory across different opportunities or sessions</li>
      </ul>

      <h2>2. Data Sent to AI Provider</h2>

      <h3>2.1 What IS Sent</h3>
      <ul>
        <li>Opportunity title and description (from SAM.gov public data)</li>
        <li>Agency name and code</li>
        <li>NAICS codes and set-aside type</li>
        <li>Your organization&apos;s keyword domains (industry keywords used for scoring)</li>
      </ul>

      <h3>2.2 What Is NOT Sent</h3>
      <ul>
        <li>Your company name, legal name, or identifying information</li>
        <li>User names, email addresses, or contact information</li>
        <li>Financial data (contract values, billing, revenue)</li>
        <li>Uploaded documents (capability statements, resumes, past performance)</li>
        <li>Your bid/no-bid decisions or internal notes on opportunities</li>
        <li>Data from other tenants</li>
      </ul>

      <h3>2.3 Provider Data Handling</h3>
      <p>
        Our AI provider (Anthropic) operates under enterprise API terms that prohibit training on
        API-submitted data. Data sent via API calls is processed for the request and not retained for
        model training or improvement. AI outputs are stored in our database, associated with your
        tenant account, and subject to our standard data retention policies.
      </p>

      <h2>3. Known Limitations</h2>
      <p className="font-semibold text-amber-800 bg-amber-50 rounded-lg p-4 border border-amber-200">
        AI-generated analysis is supplementary. It should never be the sole basis for business decisions.
      </p>

      <h3>3.1 Accuracy</h3>
      <ul>
        <li><strong>Hallucinations:</strong> AI may generate requirements, risks, or questions that are not actually present in the solicitation text. Always verify against the original document.</li>
        <li><strong>Competitive analysis is inference:</strong> The AI does not have access to actual competitor information, win rates, or incumbent data. &quot;Competitive risks&quot; are educated guesses based on opportunity structure.</li>
        <li><strong>Score adjustments are estimates:</strong> The &plusmn;20 modifier reflects the AI&apos;s assessment of opportunity fit beyond what rule-based scoring captures. It is not a guarantee of competitive position.</li>
      </ul>

      <h3>3.2 Timeliness</h3>
      <ul>
        <li>AI analysis is generated at scoring time and is not automatically updated if the solicitation is amended.</li>
        <li>The AI model has a knowledge cutoff date and may not be aware of very recent regulatory changes, agency reorganizations, or policy shifts.</li>
      </ul>

      <h3>3.3 Context</h3>
      <ul>
        <li>The AI sees only the solicitation description and your keyword profile. It does not know your organization&apos;s full capabilities, teaming arrangements, or strategic priorities.</li>
        <li>The AI cannot assess factors like your incumbent advantage, existing relationships, or geographic proximity to the place of performance.</li>
      </ul>

      <h2>4. Human Oversight</h2>
      <p>
        We strongly recommend that all AI-generated content be reviewed by a qualified capture manager
        or business development professional before being used in decision-making. The platform&apos;s
        thumbs-up/thumbs-down feedback mechanism helps you track which AI assessments your team agreed
        or disagreed with, building an institutional record of AI reliability for your specific use case.
      </p>

      <h2>5. Changes to AI Usage</h2>
      <p>
        If we make material changes to how AI is used (e.g., switching providers, expanding what data is
        sent, or introducing new AI-powered features), we will update this disclosure, increment the version,
        and notify active users before the changes take effect.
      </p>

      <h2>6. Contact</h2>
      <p>
        Questions about our AI usage? Contact us at{' '}
        <a href="mailto:eric@rfppipeline.com">eric@rfppipeline.com</a>.
      </p>
    </article>
  )
}
