import Link from 'next/link';

export const metadata = {
  title: 'Resources — RFP Pipeline',
  description: 'Blog, guides, federal R&D funding insights, and links to your RFP portals.',
};

export default function ResourcesPage() {
  return (
    <>
      <section className="bg-cream-50">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-6">Resources</p>
          <h1 className="font-display text-4xl md:text-5xl font-black text-navy-900">
            Insights, guides, and your <span className="font-prose italic text-brand-500">portals</span>.
          </h1>
          <p className="mt-4 text-lg text-navy-600">
            Federal R&amp;D funding intelligence. Updated as we curate.
          </p>
        </div>
      </section>

      {/* Programs grid — dynamic CMS container */}
      <section className="bg-white border-t border-cream-200">
        <div className="max-w-6xl mx-auto px-6 py-16">
          <h2 className="font-display text-2xl font-bold text-navy-900 mb-8">Programs We Cover</h2>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
            {[
              { name: 'SBIR', desc: 'Small Business Innovation Research — Phase I through Phase III across all DoD branches, NSF, DOE, NIH, and more.' },
              { name: 'STTR', desc: 'Small Business Technology Transfer — requires a research institution partner. Same agencies, different collaboration model.' },
              { name: 'BAA', desc: 'Broad Agency Announcements — open-ended R&D solicitations from DARPA, AFRL, Army Research Lab, and others.' },
              { name: 'OTA', desc: 'Other Transaction Authority — non-FAR contracting for prototype development. Faster timelines, different compliance.' },
              { name: 'CSO', desc: 'Commercial Solutions Openings — typically Air Force (AFWERX). Slide-deck format, short-form proposals.' },
              { name: 'Grants / NOFO', desc: 'Grants.gov Notices of Funding Opportunity — NSF, DOE, NIH. CFDA-based, different compliance structure.' },
            ].map((prog) => (
              <div key={prog.name} className="p-5 bg-cream-50 border border-cream-200 rounded-lg">
                <h3 className="font-display font-bold text-navy-900">{prog.name}</h3>
                <p className="mt-2 text-sm text-navy-600 leading-relaxed">{prog.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Blog / Insights — CMS dynamic container */}
      <section className="bg-cream-50 border-t border-cream-200">
        <div className="max-w-6xl mx-auto px-6 py-16">
          <div className="flex items-center justify-between mb-8">
            <h2 className="font-display text-2xl font-bold text-navy-900">Latest Insights</h2>
            <span className="text-xs text-navy-400 uppercase tracking-wider">CMS-powered &middot; Coming soon</span>
          </div>
          {/* CMS content container — each card will be rendered from a CMS entry */}
          <div className="grid md:grid-cols-3 gap-6" id="cms-blog-grid">
            {[
              {
                date: 'Jun 2026',
                title: 'DoD SBIR 26.1: What changed from 25.2',
                preview: 'Topic analysis, compliance shifts, and what your team should know before the next cycle opens.',
                tag: 'Analysis',
              },
              {
                date: 'Jun 2026',
                title: 'STTR vs. SBIR: choosing the right vehicle',
                preview: 'When to partner with a research institution and when to go it alone. Decision framework for small businesses.',
                tag: 'Guide',
              },
              {
                date: 'May 2026',
                title: 'Compliance matrix deep-dive: page limits that kill proposals',
                preview: 'The #1 compliance failure is exceeding page limits. Here\'s how the smart shops avoid it.',
                tag: 'Compliance',
              },
            ].map((post) => (
              <article key={post.title} className="bg-white border border-cream-200 rounded-lg overflow-hidden hover:shadow-sm transition-shadow">
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-xs text-brand-500 font-semibold uppercase tracking-wider">{post.tag}</span>
                    <span className="text-xs text-navy-400">{post.date}</span>
                  </div>
                  <h3 className="font-display font-bold text-navy-900">{post.title}</h3>
                  <p className="mt-2 text-sm text-navy-600 leading-relaxed">{post.preview}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Subscriber portal links — CMS dynamic container */}
      <section className="bg-white border-t border-cream-200">
        <div className="max-w-6xl mx-auto px-6 py-16">
          <h2 className="font-display text-2xl font-bold text-navy-900 mb-3">Subscriber Portals</h2>
          <p className="text-sm text-navy-500 mb-8">Logged-in subscribers access their portals via the dashboard.</p>
          <div className="grid md:grid-cols-2 gap-6" id="cms-portal-links">
            <div className="p-6 border border-cream-200 rounded-lg bg-cream-50">
              <h3 className="font-display font-bold text-navy-900">Spotlight Dashboard</h3>
              <p className="mt-2 text-sm text-navy-600">Your ranked opportunity feed, deadline reminders, and pinned topics.</p>
              <Link href="/login" className="mt-4 inline-flex text-sm text-brand-500 hover:text-brand-700 font-medium">
                Login to access &rarr;
              </Link>
            </div>
            <div className="p-6 border border-cream-200 rounded-lg bg-cream-50">
              <h3 className="font-display font-bold text-navy-900">Proposal Portals</h3>
              <p className="mt-2 text-sm text-navy-600">Your purchased proposal workspaces — drafts, collaborators, and submission packages.</p>
              <Link href="/login" className="mt-4 inline-flex text-sm text-brand-500 hover:text-brand-700 font-medium">
                Login to access &rarr;
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-navy-900">
        <div className="max-w-4xl mx-auto px-6 py-16 text-center">
          <h2 className="font-display text-2xl font-bold text-white">
            Ready to build your federal R&amp;D pipeline?
          </h2>
          <Link href="/apply" className="inline-flex mt-6 px-8 py-4 bg-brand-500 hover:bg-brand-600 text-white font-bold rounded-lg transition-colors">
            Apply Now
          </Link>
        </div>
      </section>
    </>
  );
}
