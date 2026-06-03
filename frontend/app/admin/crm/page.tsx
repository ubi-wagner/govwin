export const dynamic = 'force-dynamic';

/**
 * CRM landing. The CRM is the future CRM-only system (email, campaigns, drip,
 * social, outbox) that the legacy CMS is being retired into — see ARCHITECTURE_V8.
 * When CMS_PUBLIC_URL is set it links out to the deployed console; otherwise it's
 * a clean "coming soon" placeholder so the nav item always lands somewhere.
 */
export default function AdminCrmPage() {
  const url = process.env.CMS_PUBLIC_URL?.trim();

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-1">CRM</h1>
      <p className="text-sm text-gray-500 mb-6">
        Customer relationship &amp; outreach — email, campaigns, drip, social, and outbox.
      </p>

      {url ? (
        <div className="rounded-lg border bg-white p-6">
          <p className="text-sm text-gray-700 mb-4">
            The CRM console runs as a separate service.
          </p>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
          >
            Open CRM Console &rarr;
          </a>
          <p className="mt-3 text-xs text-gray-400 break-all">{url}</p>
        </div>
      ) : (
        <div className="rounded-lg border bg-white p-6">
          <span className="inline-block text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800 mb-3">
            Coming soon
          </span>
          <p className="text-sm text-gray-700">
            The CRM is the next system on the roadmap — the customer outreach side (email,
            campaigns, drip sequences, social, and outbox) that the legacy CMS is being
            consolidated into. Website content now lives under <strong>Site Content</strong>.
          </p>
          <p className="mt-3 text-xs text-gray-400">
            Set the <code>CMS_PUBLIC_URL</code> environment variable to link this to the deployed
            CRM service once it&apos;s live.
          </p>
        </div>
      )}
    </div>
  );
}
