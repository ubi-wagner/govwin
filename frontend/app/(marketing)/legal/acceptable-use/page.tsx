import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Acceptable Use Policy | RFP Pipeline',
  description: 'Rules governing acceptable use of the RFP Pipeline platform.',
}

export default function AcceptableUsePage() {
  return (
    <article className="prose prose-gray max-w-none prose-headings:font-bold prose-h1:text-3xl prose-h2:text-xl prose-h2:mt-10 prose-h3:text-base prose-p:text-sm prose-li:text-sm prose-p:leading-relaxed">
      <p className="text-xs text-gray-400 mb-2">Version 2026-03-25-v1 &middot; Effective March 25, 2026</p>
      <h1>Acceptable Use Policy</h1>
      <p className="lead text-base text-gray-600">
        This Acceptable Use Policy (&quot;AUP&quot;) supplements our Terms of Service and outlines prohibited
        activities when using the RFP Pipeline platform. Violation of this AUP may result in immediate
        account suspension or termination.
      </p>

      <h2>1. Government Contracting Integrity</h2>
      <p>
        The federal procurement process depends on integrity. You must not use the Service to:
      </p>
      <ul>
        <li>
          <strong>Misrepresent qualifications:</strong> Falsely claim small business status, SDVOSB, WOSB,
          HUBZone, 8(a), or other set-aside eligibility in your scoring profile or any generated content.
          Misrepresentation of set-aside status is a federal offense under the False Claims Act.
        </li>
        <li>
          <strong>Facilitate bid rigging:</strong> Use competitive risk analysis, opportunity intelligence, or any
          platform data to coordinate pricing, teaming arrangements, or bid strategies with competitors in
          violation of antitrust laws.
        </li>
        <li>
          <strong>Submit fraudulent proposals:</strong> Use AI-generated content to create proposals that
          misrepresent your organization&apos;s capabilities, past performance, or personnel qualifications.
        </li>
        <li>
          <strong>Circumvent procurement rules:</strong> Use the Service in any manner that violates the
          Federal Acquisition Regulation (FAR), Defense Federal Acquisition Regulation Supplement (DFARS),
          or agency-specific acquisition supplements.
        </li>
      </ul>

      <h2>2. Data & Access Restrictions</h2>
      <ul>
        <li>
          <strong>No scraping or bulk extraction:</strong> Do not use automated tools, scripts, or bots to
          extract, download, or copy data from the platform, except through our published API (Enterprise tier only).
        </li>
        <li>
          <strong>No redistribution:</strong> Do not resell, redistribute, or publish scored opportunity data,
          AI-generated analysis, or any proprietary platform output as a standalone data product or service.
        </li>
        <li>
          <strong>No credential sharing:</strong> Do not share login credentials across organizations. Each user
          must have their own account. Account Administrators are responsible for provisioning and deprovisioning
          user access.
        </li>
        <li>
          <strong>No unauthorized access:</strong> Do not attempt to access data belonging to other tenants,
          bypass role-based access controls, or exploit vulnerabilities in the platform.
        </li>
      </ul>

      <h2>3. AI-Generated Content</h2>
      <ul>
        <li>
          You are responsible for reviewing and validating all AI-generated content before using it in
          proposals, capability statements, or official communications.
        </li>
        <li>
          Do not represent AI-generated analysis as your own independent market research or competitive
          intelligence without proper review and validation.
        </li>
        <li>
          Do not use the AI features to generate content that is intentionally misleading, discriminatory,
          or harmful.
        </li>
      </ul>

      <h2>4. System Integrity</h2>
      <ul>
        <li>Do not attempt to reverse engineer, decompile, or extract our scoring algorithms or AI prompts.</li>
        <li>Do not interfere with the Service&apos;s operation, including overloading systems, deploying malware, or conducting denial-of-service activities.</li>
        <li>Do not attempt to circumvent rate limits, usage caps, or subscription tier restrictions.</li>
        <li>Report any security vulnerabilities to <a href="mailto:security@rfppipeline.com">security@rfppipeline.com</a> rather than exploiting them.</li>
      </ul>

      <h2>5. Export Controls</h2>
      <p>
        Some federal opportunities may relate to programs subject to the International Traffic in Arms
        Regulations (ITAR) or Export Administration Regulations (EAR). The Service does not filter or flag
        export-controlled content. You are responsible for ensuring your use of opportunity data complies
        with applicable export control laws.
      </p>

      <h2>6. Enforcement</h2>
      <p>
        Violations of this AUP may result in:
      </p>
      <ul>
        <li>Warning and request for corrective action</li>
        <li>Temporary suspension of account access</li>
        <li>Immediate termination without refund for serious or repeated violations</li>
        <li>Reporting to relevant authorities for suspected illegal activity (e.g., False Claims Act violations, bid rigging)</li>
      </ul>
      <p>
        If you believe a violation has occurred, or have questions about whether a particular use is acceptable,
        contact us at <a href="mailto:legal@rfppipeline.com">legal@rfppipeline.com</a>.
      </p>
    </article>
  )
}
