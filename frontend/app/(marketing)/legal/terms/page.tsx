import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Service | RFP Pipeline',
  description: 'Terms and conditions governing your use of RFP Pipeline.',
}

export default function TermsPage() {
  return (
    <article className="prose prose-gray max-w-none prose-headings:font-bold prose-h1:text-3xl prose-h2:text-xl prose-h2:mt-10 prose-h3:text-base prose-p:text-sm prose-li:text-sm prose-p:leading-relaxed">
      <p className="text-xs text-gray-400 mb-2">Version 2026-03-25-v1 &middot; Effective March 25, 2026</p>
      <h1>Terms of Service</h1>
      <p className="lead text-base text-gray-600">
        These Terms of Service (&quot;Terms&quot;) govern your access to and use of the RFP Pipeline platform
        (&quot;Service&quot;) operated by RFP Pipeline LLC (&quot;Company,&quot; &quot;we,&quot; &quot;us&quot;).
        By registering an account or using the Service, you agree to be bound by these Terms.
      </p>

      <h2>1. Account Registration & Authority</h2>
      <p>
        By creating an account, you represent and warrant that:
      </p>
      <ul>
        <li>
          <strong>You are authorized</strong> to act on behalf of the organization (&quot;Customer&quot;) for which you are registering. You are entering into these Terms on behalf of that organization, and these Terms bind the organization.
        </li>
        <li>
          As the registering user, you become the <strong>Account Administrator</strong> and are responsible for all activity under your organization&apos;s account, including the actions and compliance of any additional users you invite.
        </li>
        <li>
          You are at least 18 years of age and have the legal capacity to enter into a binding agreement.
        </li>
        <li>
          All registration information you provide is accurate, current, and complete. You will promptly update it if it changes.
        </li>
      </ul>

      <h2>2. Service Description</h2>
      <p>
        RFP Pipeline is a government opportunity intelligence platform that aggregates publicly available
        federal contracting data, scores opportunities against your organizational profile, and provides
        AI-assisted analysis. The Service includes four product tiers (Finder, Reminder, Binder, Grinder),
        each offering progressively richer capabilities.
      </p>
      <h3>2.1 Data Sources</h3>
      <p>
        Opportunity data is sourced from public government systems including SAM.gov, and potentially
        Grants.gov, SBIR.gov, and USASpending. We aggregate and analyze this data but are not the
        authoritative source. Data may be delayed, incomplete, or contain errors originating from the
        source systems. Always verify critical information (close dates, set-aside types, award status)
        directly with the contracting agency.
      </p>
      <h3>2.2 AI-Powered Analysis</h3>
      <p>
        The Service uses artificial intelligence (including large language models) to score opportunities,
        extract key requirements, assess competitive risks, and generate analytical content. AI outputs
        are <strong>informational only</strong> and should not be the sole basis for bid/no-bid decisions,
        proposal content, or any business commitment. See our <a href="/legal/ai-disclosure">AI Disclosure</a> for
        details on how AI is used and its limitations.
      </p>

      <h2>3. Subscription & Billing</h2>
      <ul>
        <li><strong>Plans:</strong> Starter, Professional, and Enterprise tiers with published feature limits (user seats, scored opportunities per month, NAICS profiles).</li>
        <li><strong>Trial:</strong> New accounts receive a 14-day free trial with no credit card required. At trial expiration, access is suspended until a paid plan is selected.</li>
        <li><strong>Billing:</strong> Monthly or annual billing. Annual plans receive a 20% discount. Charges are non-refundable except as required by law.</li>
        <li><strong>Upgrades:</strong> Take effect immediately. <strong>Downgrades:</strong> Take effect at the end of the current billing period.</li>
        <li><strong>Overages:</strong> If usage exceeds plan limits, we may restrict functionality until the account is upgraded. We will not charge overage fees without prior notice.</li>
      </ul>

      <h2>4. User Responsibilities</h2>
      <h3>4.1 Administrator Accountability</h3>
      <p>
        The Account Administrator is responsible for:
      </p>
      <ul>
        <li>Ensuring all users added to the account comply with these Terms</li>
        <li>Managing user access and permissions appropriately</li>
        <li>Removing access for users who leave the organization or no longer require it</li>
        <li>The accuracy of the organization&apos;s scoring profile (NAICS codes, set-aside qualifications, agency priorities)</li>
      </ul>
      <h3>4.2 Acceptable Use</h3>
      <p>
        You agree not to use the Service to:
      </p>
      <ul>
        <li>Misrepresent your organization&apos;s qualifications, including small business status, SDVOSB, WOSB, HUBZone, or 8(a) certifications</li>
        <li>Coordinate with competitors on pricing, teaming, or bid strategies in violation of antitrust laws or FAR/DFARS regulations</li>
        <li>Scrape, bulk-download, or redistribute scored or analyzed opportunity data</li>
        <li>Access the platform via automated means except through our published API (Enterprise tier)</li>
        <li>Share account credentials across organizations or with unauthorized individuals</li>
        <li>Submit fraudulent bids or proposals using content generated by the Service</li>
      </ul>
      <p>See our full <a href="/legal/acceptable-use">Acceptable Use Policy</a> for additional details.</p>

      <h2>5. Intellectual Property</h2>
      <ul>
        <li><strong>Your Data:</strong> You retain ownership of all data you upload (capability statements, past performance, personnel resumes, proposal content). We claim no ownership over your content.</li>
        <li><strong>Our Analysis:</strong> Scored opportunity data, AI-generated analysis, and platform-generated reports are licensed to you for use during your active subscription. You may use outputs in your proposals and business decisions but may not resell or redistribute them as a standalone product.</li>
        <li><strong>Government Data:</strong> Underlying opportunity data from SAM.gov and other government sources is public domain. Our value-add (scoring algorithms, AI analysis, aggregation) is proprietary.</li>
      </ul>

      <h2>6. Data Handling & Privacy</h2>
      <p>
        Your use of the Service is also governed by our <a href="/legal/privacy">Privacy Policy</a>, which
        describes what data we collect, how it is used, and your rights regarding that data. By accepting
        these Terms, you also acknowledge and accept the Privacy Policy.
      </p>

      <h2>7. Disclaimers</h2>
      <ul>
        <li>The Service is provided &quot;as is&quot; and &quot;as available.&quot; We make no warranties, express or implied, regarding accuracy, completeness, or fitness for a particular purpose.</li>
        <li>We are <strong>not responsible for missed opportunities</strong> due to data latency from government sources, scoring algorithm behavior, notification delivery failures, or service interruptions.</li>
        <li>AI-generated content may contain errors, hallucinations, or outdated information. You are responsible for reviewing and validating all outputs before reliance.</li>
        <li>Use of the Service does not create an Organizational Conflict of Interest (OCI). However, you are responsible for your own OCI compliance obligations.</li>
      </ul>

      <h2>8. Limitation of Liability</h2>
      <p>
        To the maximum extent permitted by law, our total liability for any claims arising from or related
        to the Service shall not exceed the amount you paid us in the 12 months preceding the claim.
        We shall not be liable for indirect, incidental, special, consequential, or punitive damages,
        including lost profits, lost bids, or lost business opportunities.
      </p>

      <h2>9. Termination</h2>
      <ul>
        <li>Either party may terminate with 30 days written notice.</li>
        <li>We may terminate immediately for material breach, including misrepresentation of qualifications or violation of the Acceptable Use Policy.</li>
        <li>Upon termination, you have 30 days to export your data (uploaded files, profile data, action history). After this period, your data will be deleted per our retention policy.</li>
        <li>Certain data (audit logs, consent records) may be retained for up to 3 years after termination for legal compliance purposes.</li>
      </ul>

      <h2>10. Governing Law & Disputes</h2>
      <p>
        These Terms are governed by the laws of the State of Ohio. Any disputes shall be resolved in the
        state or federal courts located in Montgomery County, Ohio. You agree to attempt good-faith
        resolution before initiating legal proceedings.
      </p>

      <h2>11. Changes to Terms</h2>
      <p>
        We may update these Terms from time to time. When we do, we will update the version date at the
        top of this page and notify active users via email and in-app notification. Continued use of the
        Service after the effective date of updated Terms constitutes acceptance. If you do not agree to
        updated Terms, you may terminate your account.
      </p>

      <h2>12. Contact</h2>
      <p>
        Questions about these Terms? Contact us at{' '}
        <a href="mailto:legal@rfppipeline.com">legal@rfppipeline.com</a> or{' '}
        <a href="mailto:eric@rfppipeline.com">eric@rfppipeline.com</a>.
      </p>
    </article>
  )
}
