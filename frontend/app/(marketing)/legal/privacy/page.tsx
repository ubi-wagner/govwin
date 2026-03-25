import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy | RFP Pipeline',
  description: 'How RFP Pipeline collects, uses, and protects your data.',
}

export default function PrivacyPage() {
  return (
    <article className="prose prose-gray max-w-none prose-headings:font-bold prose-h1:text-3xl prose-h2:text-xl prose-h2:mt-10 prose-h3:text-base prose-p:text-sm prose-li:text-sm prose-p:leading-relaxed">
      <p className="text-xs text-gray-400 mb-2">Version 2026-03-25-v1 &middot; Effective March 25, 2026</p>
      <h1>Privacy Policy</h1>
      <p className="lead text-base text-gray-600">
        This Privacy Policy describes how RFP Pipeline LLC (&quot;Company,&quot; &quot;we,&quot; &quot;us&quot;)
        collects, uses, stores, and protects information when you use the RFP Pipeline platform (&quot;Service&quot;).
      </p>

      <h2>1. Information We Collect</h2>

      <h3>1.1 Account & Profile Data</h3>
      <table>
        <thead>
          <tr><th>Data</th><th>Purpose</th><th>Legal Basis</th></tr>
        </thead>
        <tbody>
          <tr><td>Name, email, role</td><td>Authentication, account management</td><td>Contract performance</td></tr>
          <tr><td>Company name, legal name</td><td>Tenant identification</td><td>Contract performance</td></tr>
          <tr><td>UEI number, CAGE code, SAM registration</td><td>Government contractor verification</td><td>Contract performance</td></tr>
          <tr><td>NAICS codes, keywords, set-aside qualifications</td><td>Opportunity scoring and matching</td><td>Contract performance</td></tr>
          <tr><td>Agency priorities, contract value filters</td><td>Score customization</td><td>Contract performance</td></tr>
          <tr><td>Billing email</td><td>Subscription management</td><td>Contract performance</td></tr>
        </tbody>
      </table>

      <h3>1.2 Usage & Activity Data</h3>
      <table>
        <thead>
          <tr><th>Data</th><th>Purpose</th><th>Legal Basis</th></tr>
        </thead>
        <tbody>
          <tr><td>Login timestamps, IP address, user agent</td><td>Security, audit trail</td><td>Legitimate interest</td></tr>
          <tr><td>Opportunity actions (thumbs up/down, comments, status changes)</td><td>Personalization, analytics</td><td>Legitimate interest</td></tr>
          <tr><td>Pipeline browsing and filtering activity</td><td>Service improvement</td><td>Legitimate interest</td></tr>
          <tr><td>Consent records (acceptance timestamps, versions)</td><td>Legal compliance, audit readiness</td><td>Legal obligation</td></tr>
        </tbody>
      </table>

      <h3>1.3 Uploaded Content</h3>
      <table>
        <thead>
          <tr><th>Data</th><th>Purpose</th><th>Legal Basis</th></tr>
        </thead>
        <tbody>
          <tr><td>Capability statements, cut sheets</td><td>Proposal generation support</td><td>Contract performance</td></tr>
          <tr><td>Past performance records</td><td>Content library, proposal building</td><td>Contract performance</td></tr>
          <tr><td>Personnel resumes</td><td>Key personnel sections</td><td>Contract performance</td></tr>
          <tr><td>General document uploads</td><td>Document management</td><td>Contract performance</td></tr>
        </tbody>
      </table>

      <h3>1.4 Data We Do NOT Collect</h3>
      <ul>
        <li>We do <strong>not</strong> use third-party analytics services (no Google Analytics, Segment, Amplitude, or Hotjar)</li>
        <li>We do <strong>not</strong> use advertising pixels or cross-site tracking cookies</li>
        <li>We do <strong>not</strong> sell, rent, or share your data with data brokers</li>
        <li>We do <strong>not</strong> store payment card numbers (payment processing is handled by Stripe)</li>
      </ul>

      <h2>2. How We Use Your Data</h2>
      <ul>
        <li><strong>Opportunity Scoring:</strong> Your NAICS codes, keywords, set-aside status, and agency priorities are used to score federal opportunities against your profile.</li>
        <li><strong>AI Analysis:</strong> Opportunity descriptions and your profile keywords are sent to our AI provider (Anthropic) for deeper analysis on high-scoring opportunities. See Section 4 for details.</li>
        <li><strong>Notifications:</strong> Email digests and deadline alerts are sent based on your subscription tier and notification preferences.</li>
        <li><strong>Service Operation:</strong> We use activity data to monitor system health, debug issues, and improve the platform.</li>
        <li><strong>Audit & Compliance:</strong> Consent records and audit logs are maintained for legal compliance and regulatory readiness.</li>
      </ul>

      <h2>3. Tenant Data Isolation</h2>
      <p>
        RFP Pipeline is a multi-tenant platform with strict data isolation:
      </p>
      <ul>
        <li>Each organization&apos;s data (scoring profiles, opportunity scores, user actions, uploaded files) is logically isolated and <strong>never visible to other organizations</strong>.</li>
        <li>Underlying opportunity data from government sources (SAM.gov) is shared across tenants, but the scores, AI analysis, and user activity associated with those opportunities are per-tenant.</li>
        <li>All API routes enforce tenant access verification before returning any data.</li>
      </ul>

      <h2>4. Third-Party Data Sharing</h2>

      <h3>4.1 Anthropic (AI Analysis)</h3>
      <p>
        When an opportunity scores above our analysis threshold, we send the opportunity description
        and your profile keywords to Anthropic&apos;s Claude API for deeper analysis. Anthropic&apos;s
        enterprise API terms prohibit them from training on API-submitted data. AI outputs (key requirements,
        competitive risks, RFI questions, scoring adjustments) are stored in our database and associated
        with your tenant account.
      </p>
      <p>
        <strong>What is sent:</strong> Opportunity title, description, agency, NAICS codes, and your tenant&apos;s
        keyword domains. <strong>What is NOT sent:</strong> Your company name, user names, emails, financial
        information, or uploaded documents.
      </p>

      <h3>4.2 Stripe (Payment Processing)</h3>
      <p>
        Payment card data is collected and processed by Stripe. We do not store card numbers on our servers.
        Stripe&apos;s privacy practices are governed by the{' '}
        <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer">Stripe Privacy Policy</a>.
      </p>

      <h3>4.3 Email Delivery</h3>
      <p>
        Email notifications (digests, deadline alerts, onboarding) are delivered via our email service
        provider. Email content (subject lines, body text) passes through the provider&apos;s systems for delivery.
      </p>

      <h3>4.4 Infrastructure</h3>
      <p>
        The Service runs on cloud infrastructure (Railway). Your data is stored on encrypted-at-rest
        PostgreSQL databases and encrypted local file storage. All data transfers use TLS encryption.
      </p>

      <h2>5. Data Retention</h2>
      <table>
        <thead>
          <tr><th>Data Category</th><th>Retention Period</th></tr>
        </thead>
        <tbody>
          <tr><td>Active account data</td><td>Duration of subscription</td></tr>
          <tr><td>Post-termination export window</td><td>30 days after termination</td></tr>
          <tr><td>Uploaded files</td><td>Deleted after export window</td></tr>
          <tr><td>Audit logs</td><td>3 years after account termination</td></tr>
          <tr><td>Consent records</td><td>7 years (regulatory compliance)</td></tr>
          <tr><td>Event logs (system activity)</td><td>1 year rolling retention</td></tr>
        </tbody>
      </table>

      <h2>6. Data Security</h2>
      <ul>
        <li><strong>Encryption at rest:</strong> Database and file storage use encryption at rest</li>
        <li><strong>Encryption in transit:</strong> All connections use TLS 1.2+</li>
        <li><strong>API key storage:</strong> Third-party API keys (SAM.gov, Anthropic) are encrypted with AES-256-GCM</li>
        <li><strong>Password hashing:</strong> User passwords are hashed with bcrypt (cost factor 12)</li>
        <li><strong>Session management:</strong> JWT-based sessions with 30-day expiry</li>
        <li><strong>Access control:</strong> Role-based access (master admin, tenant admin, tenant user) with middleware enforcement</li>
      </ul>

      <h2>7. Cookies & Tracking</h2>
      <p>
        We use only functional cookies required for the Service to operate:
      </p>
      <ul>
        <li><strong>Session cookie:</strong> JWT authentication token (required, first-party only)</li>
        <li><strong>No tracking cookies:</strong> We do not use third-party tracking, advertising, or analytics cookies</li>
        <li><strong>No cross-site tracking:</strong> We do not track your activity outside the RFP Pipeline platform</li>
      </ul>

      <h2>8. Your Rights</h2>
      <p>Depending on your jurisdiction, you may have the right to:</p>
      <ul>
        <li><strong>Access:</strong> Request a copy of the personal data we hold about you</li>
        <li><strong>Correction:</strong> Request correction of inaccurate data</li>
        <li><strong>Deletion:</strong> Request deletion of your personal data (subject to legal retention requirements)</li>
        <li><strong>Export:</strong> Request your data in a portable, machine-readable format</li>
        <li><strong>Objection:</strong> Object to processing based on legitimate interest</li>
      </ul>
      <p>
        Note: Certain data (audit logs, consent records) may be retained beyond a deletion request to
        comply with legal obligations. Tenant Administrators may exercise these rights on behalf of their
        organization&apos;s users.
      </p>
      <p>
        To exercise any of these rights, contact us at{' '}
        <a href="mailto:privacy@rfppipeline.com">privacy@rfppipeline.com</a>.
      </p>

      <h2>9. Children&apos;s Privacy</h2>
      <p>
        The Service is not directed to individuals under 18. We do not knowingly collect personal
        information from minors.
      </p>

      <h2>10. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. When we do, we will update the version date and
        notify active users. Your continued use of the Service after changes take effect constitutes acceptance.
      </p>

      <h2>11. Contact</h2>
      <p>
        Privacy inquiries:{' '}
        <a href="mailto:privacy@rfppipeline.com">privacy@rfppipeline.com</a>
        <br />
        General inquiries:{' '}
        <a href="mailto:eric@rfppipeline.com">eric@rfppipeline.com</a>
      </p>
    </article>
  )
}
