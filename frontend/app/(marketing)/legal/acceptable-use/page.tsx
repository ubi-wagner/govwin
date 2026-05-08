export const metadata = {
  title: 'Acceptable Use Policy — RFP Pipeline',
  description: 'Acceptable Use Policy for the RFP Pipeline platform.',
};

export default function AcceptableUsePage() {
  return (
    <div>
      <h1 className="font-display text-3xl font-black text-navy-900 leading-tight mb-2">
        Acceptable Use Policy
      </h1>
      <p className="text-xs text-navy-400 mb-8">Last updated: May 2026</p>

      <div className="bg-white border border-cream-200 rounded-xl p-8 md:p-12 space-y-8 text-sm text-navy-700 leading-relaxed">
          <div>
            <h2 className="text-base font-bold text-navy-900 mb-3">1. Purpose</h2>
            <p>
              This Acceptable Use Policy (&quot;AUP&quot;) defines the permitted and prohibited uses of the
              RFP Pipeline platform. All users — administrators, team members, and external
              collaborators — are bound by this policy. Violation may result in account suspension
              or termination.
            </p>
          </div>

          <div>
            <h2 className="text-base font-bold text-navy-900 mb-3">2. Permitted Use</h2>
            <p>RFP Pipeline is designed for:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li>Discovering and tracking federal R&D funding opportunities (SBIR, STTR, BAA, OTA, CSO, NOFO)</li>
              <li>Developing and managing proposals for federal solicitations</li>
              <li>Storing and organizing company documents, past performance narratives, and reusable content</li>
              <li>Collaborating with team members and partners on proposal development</li>
              <li>Using AI-assisted drafting tools to accelerate proposal writing</li>
            </ul>
          </div>

          <div>
            <h2 className="text-base font-bold text-navy-900 mb-3">3. Prohibited Use</h2>
            <p>You may not use the platform to:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li>Submit false, misleading, or fraudulent information in applications or proposals</li>
              <li>Misrepresent AI-generated content as solely human-authored in contexts where disclosure is required</li>
              <li>Upload content that infringes third-party intellectual property rights</li>
              <li>Upload classified, export-controlled (ITAR/EAR), or restricted government data</li>
              <li>Attempt to access another tenant&apos;s data, workspace, or user accounts</li>
              <li>Reverse-engineer, scrape, or extract data from the platform beyond your authorized scope</li>
              <li>Use the platform for any purpose unrelated to federal contracting and proposal development</li>
              <li>Share account credentials with unauthorized individuals</li>
              <li>Use automated tools (bots, scripts) to interact with the platform without written authorization</li>
              <li>Transmit malware, viruses, or other harmful code</li>
              <li>Interfere with the platform&apos;s operation or other users&apos; access</li>
            </ul>
          </div>

          <div>
            <h2 className="text-base font-bold text-navy-900 mb-3">4. Content Standards</h2>
            <p>All content uploaded to the platform must:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li>Be content you have the right to use and share within the platform</li>
              <li>Not contain classified or export-controlled information</li>
              <li>Not contain personally identifiable information (PII) beyond what is necessary for proposal development</li>
              <li>Comply with all applicable federal, state, and local laws</li>
            </ul>
          </div>

          <div>
            <h2 className="text-base font-bold text-navy-900 mb-3">5. AI Usage Requirements</h2>
            <p>When using AI-assisted features:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li>You must review all AI-generated content before inclusion in any proposal</li>
              <li>You are solely responsible for the accuracy and truthfulness of all submitted content, including AI-drafted sections</li>
              <li>You must comply with any federal agency requirements regarding disclosure of AI assistance in proposal preparation</li>
              <li>You must not attempt to manipulate AI outputs to generate false claims, fabricated citations, or misleading information</li>
            </ul>
          </div>

          <div>
            <h2 className="text-base font-bold text-navy-900 mb-3">6. Account Responsibility</h2>
            <p>
              Tenant administrators are responsible for all users they invite to their workspace.
              This includes ensuring team members and external collaborators understand and comply
              with this AUP. Access permissions should be set to the minimum necessary for each
              user&apos;s role.
            </p>
          </div>

          <div>
            <h2 className="text-base font-bold text-navy-900 mb-3">7. Enforcement</h2>
            <p>
              Violations of this AUP may result in warning, temporary suspension, or permanent
              termination of your account, at RFP Pipeline&apos;s sole discretion. We will make
              reasonable efforts to notify you before taking enforcement action, except in cases
              involving security threats, legal requirements, or egregious violations.
            </p>
          </div>

          <div>
            <h2 className="text-base font-bold text-navy-900 mb-3">8. Reporting</h2>
            <p>
              To report a violation of this policy, contact{' '}
              <a href="mailto:eric@rfppipeline.com" className="text-brand-600 hover:underline">
                eric@rfppipeline.com
              </a>.
            </p>
          </div>
      </div>
    </div>
  );
}
