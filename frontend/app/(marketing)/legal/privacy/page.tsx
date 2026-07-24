export const metadata = {
  title: 'Privacy Policy — RFP Pipeline',
  description: 'How RFP Pipeline collects, uses, and protects your data.',
};

export default function PrivacyPage() {
  return (
    <div>
      <h1 className="font-display text-3xl font-black text-navy-900 leading-tight mb-2">
        Privacy Policy
      </h1>
      <p className="text-xs text-navy-400 mb-8">Last updated: May 2026</p>

      <div className="bg-white border border-cream-200 rounded-xl p-8 md:p-12 space-y-8 text-sm text-navy-700 leading-relaxed">
          <div>
            <h2 className="text-base font-bold text-navy-900 mb-3">1. Information We Collect</h2>
            <p className="mb-3">We collect information you provide directly when you:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Create an account (name, email, company name, role)</li>
              <li>Submit an application (company details, NAICS codes, technology summary, SAM/UEI identifiers)</li>
              <li>Upload documents to the content library or proposal workspace</li>
              <li>Interact with the platform (proposal content, comments, collaboration activity)</li>
              <li>Make a purchase (billing details processed by Stripe; we do not store credit card numbers)</li>
            </ul>
            <p className="mt-3">We automatically collect:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Log data (IP address, browser type, pages visited, timestamps)</li>
              <li>Usage data (features used, proposal stages visited, search queries within the platform)</li>
              <li>Session data (authentication tokens, last login timestamps)</li>
            </ul>
          </div>

          <div>
            <h2 className="text-base font-bold text-navy-900 mb-3">2. How We Use Your Information</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>To provide, maintain, and improve the RFP Pipeline platform</li>
              <li>To process your proposals using AI-assisted drafting (within your isolated tenant environment)</li>
              <li>To match opportunities to your company profile</li>
              <li>To process payments and manage subscriptions</li>
              <li>To communicate with you about your account, platform updates, and support requests</li>
              <li>To detect and prevent fraud, abuse, and security incidents</li>
            </ul>
          </div>

          <div>
            <h2 className="text-base font-bold text-navy-900 mb-3">3. Data Isolation & AI Processing</h2>
            <p>
              Your company data is processed within an isolated tenant environment. AI agents provisioned
              for your workspace only access your data — never data from other tenants. AI-generated
              content is produced solely for your use and is not shared across customers.
            </p>
            <p className="mt-3">
              De-identified, aggregated usage metrics (e.g., total proposals processed, average completion
              times) may be used to improve the platform. No individual customer data is identifiable
              in these aggregations.
            </p>
          </div>

          <div>
            <h2 className="text-base font-bold text-navy-900 mb-3">4. Data Sharing & Expert Access</h2>
            <p>We do not sell your personal information. We may share or grant access to data as follows:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li><strong>Service providers:</strong> Stripe (payments), Railway (infrastructure), AWS (storage), Anthropic (AI processing) — each bound by data processing agreements</li>
              <li><strong>Your collaborators:</strong> When you invite team members or partners, they can see the content you grant them access to</li>
              <li><strong>RFP-Pipeline expert staff (shadow access):</strong> By default, our expert staff are granted oversight access to your proposal portals to curate, review, release, and support your build (&ldquo;RFP-Pipeline Oversight&rdquo;). This is enabled automatically for each portal and is how we provide expert curation. You can decline it per portal in that portal&apos;s guardrail settings; opting out means we no longer access or review that portal — see the Terms for the full effects.</li>
              <li><strong>Legal requirements:</strong> When required by law, court order, or governmental authority</li>
            </ul>
          </div>

          <div>
            <h2 className="text-base font-bold text-navy-900 mb-3">5. Cookies & Tracking</h2>
            <p>
              We use essential cookies for authentication and session management. We do not use
              third-party advertising cookies or cross-site tracking. Analytics are collected
              server-side using our event system, not through third-party tracking scripts.
            </p>
          </div>

          <div>
            <h2 className="text-base font-bold text-navy-900 mb-3">6. Data Security</h2>
            <p>
              We implement industry-standard security measures including encryption at rest and in
              transit, role-based access controls, tenant isolation at the database level, and
              regular security audits. All data is stored in the United States.
            </p>
          </div>

          <div>
            <h2 className="text-base font-bold text-navy-900 mb-3">7. Data Retention</h2>
            <p>
              Your data is retained for the duration of your active subscription. Upon cancellation,
              your workspace enters a 30-day read-only period during which you may export your data.
              After this period, your data may be permanently deleted. Event logs and audit trails
              are retained for 12 months after account closure.
            </p>
          </div>

          <div>
            <h2 className="text-base font-bold text-navy-900 mb-3">8. Your Rights</h2>
            <p>You have the right to:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li>Access the personal data we hold about you</li>
              <li>Request correction of inaccurate data</li>
              <li>Request deletion of your data (subject to legal retention requirements)</li>
              <li>Export your data during the read-only period after cancellation</li>
              <li>Withdraw consent for optional data processing</li>
            </ul>
          </div>

          <div>
            <h2 className="text-base font-bold text-navy-900 mb-3">9. Children</h2>
            <p>
              RFP Pipeline is not directed at individuals under 18 years of age. We do not
              knowingly collect personal information from children.
            </p>
          </div>

          <div>
            <h2 className="text-base font-bold text-navy-900 mb-3">10. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. Material changes will be
              communicated via email at least 30 days before taking effect. Continued use of
              the platform after the effective date constitutes acceptance.
            </p>
          </div>

          <div>
            <h2 className="text-base font-bold text-navy-900 mb-3">11. Contact</h2>
            <p>
              For privacy-related inquiries, contact us at{' '}
              <a href="mailto:eric@rfppipeline.com" className="text-brand-600 hover:underline">
                eric@rfppipeline.com
              </a>.
            </p>
          </div>
      </div>
    </div>
  );
}
