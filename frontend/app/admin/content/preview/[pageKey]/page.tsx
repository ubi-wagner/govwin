/**
 * Content Preview Page — Renders draft content using the same layout as public pages.
 * Admin-only route that loads draft_content from site_content table.
 *
 * URL: /admin/content/preview/[pageKey]
 */
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { sql } from '@/lib/db'
import { mergeContent, mergeMetadata } from '@/lib/content'
import { PAGE_DEFAULTS } from '@/lib/content-defaults'
import { Section, SectionHeader, FeatureCard, StatHighlight, CtaSection } from '@/components/page-sections'
import type { ContentPageKey } from '@/types'

const VALID_PAGES = new Set(['home', 'about', 'team', 'tips', 'customers', 'announcements', 'get_started'])

interface PageProps {
  params: Promise<{ pageKey: string }>
}

async function getDraftContent(pageKey: string) {
  try {
    const rows = await sql`
      SELECT draft_content, draft_metadata, draft_updated_at
      FROM site_content
      WHERE page_key = ${pageKey}
    `
    if (rows.length === 0) return null
    return {
      content: rows[0].draftContent as Record<string, unknown>,
      metadata: rows[0].draftMetadata as Record<string, unknown> | null,
      updatedAt: rows[0].draftUpdatedAt as string | null,
    }
  } catch (error) {
    console.error(`[ContentPreview] Failed to load draft for ${pageKey}:`, error)
    return null
  }
}

export default async function ContentPreviewPage({ params }: PageProps) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== 'master_admin') {
    redirect('/login')
  }

  const { pageKey } = await params
  if (!VALID_PAGES.has(pageKey)) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-20 text-center">
        <h1 className="text-2xl font-bold text-gray-900">Page Not Found</h1>
        <p className="mt-2 text-gray-500">No preview available for page key: {pageKey}</p>
        <Link href="/admin/content" className="mt-4 inline-block text-sm text-brand-600 hover:underline">
          Back to Content Manager
        </Link>
      </div>
    )
  }

  const draft = await getDraftContent(pageKey)
  const defaults = PAGE_DEFAULTS[pageKey as ContentPageKey]

  // Merge draft content over static defaults (same as public pages do with published)
  const content = mergeContent(draft?.content ?? null, defaults?.content ?? {})
  const metadata = draft?.metadata ?? defaults?.metadata ?? {}

  return (
    <>
      {/* Preview banner */}
      <div className="sticky top-0 z-50 flex items-center justify-between border-b border-amber-200 bg-amber-50 px-6 py-2">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800 ring-1 ring-amber-300">
            PREVIEW
          </span>
          <span className="text-sm text-amber-700">
            Viewing draft of <strong>/{pageKey.replace('_', '-')}</strong>
            {draft?.updatedAt && (
              <> — last saved {new Date(draft.updatedAt).toLocaleString()}</>
            )}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/${pageKey === 'home' ? '' : pageKey.replace('_', '-')}`}
            className="text-xs font-medium text-amber-700 hover:text-amber-900 underline"
          >
            View Live
          </Link>
          <Link
            href="/admin/content"
            className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-bold text-white hover:bg-amber-700 transition-colors"
          >
            Back to Editor
          </Link>
        </div>
      </div>

      {/* Render page-specific preview */}
      <PreviewRenderer pageKey={pageKey as ContentPageKey} content={content} metadata={metadata} />
    </>
  )
}

function PreviewRenderer({ pageKey, content, metadata }: { pageKey: ContentPageKey; content: any; metadata: any }) {
  switch (pageKey) {
    case 'home':
      return <HomePreview content={content} />
    case 'about':
      return <AboutPreview content={content} />
    case 'team':
      return <TeamPreview content={content} />
    case 'tips':
      return <TipsPreview content={content} />
    case 'customers':
      return <CustomersPreview content={content} />
    case 'announcements':
      return <AnnouncementsPreview content={content} />
    case 'get_started':
      return <GetStartedPreview content={content} />
    default:
      return <GenericPreview content={content} />
  }
}

/* ── Page-specific preview renderers ────────────────────────────── */

function HomePreview({ content }: { content: any }) {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-white px-4 pb-20 pt-16 sm:px-6 sm:pb-28 sm:pt-24 lg:px-8">
        <div className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-hero-mesh" />
        </div>
        <div className="mx-auto max-w-5xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-4 py-1.5 text-xs font-bold text-brand-700 ring-1 ring-brand-600/10">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500" />
            {content.hero?.trustBadge ?? ''}
          </div>
          <h1 className="mt-8 text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
            {content.hero?.title ?? 'Untitled'}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-gray-600 sm:text-xl">
            {content.hero?.description ?? ''}
          </p>
        </div>
      </section>

      {/* Stats */}
      {content.stats?.length > 0 && (
        <section className="border-y border-gray-100 bg-white px-4 py-14 sm:px-6 lg:px-8">
          <div className="mx-auto grid max-w-5xl grid-cols-2 gap-8 sm:grid-cols-4">
            {content.stats.map((stat: any) => (
              <StatHighlight key={stat.label} value={stat.value} label={stat.label} description={stat.description} />
            ))}
          </div>
        </section>
      )}

      {/* Partners */}
      {content.partners?.length > 0 && (
        <section className="bg-white px-4 py-12 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-5xl">
            <p className="text-center text-xs font-bold uppercase tracking-widest text-gray-400">
              Trusted by innovative companies
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-12 gap-y-4">
              {content.partners.map((name: string) => (
                <span key={name} className="text-sm font-semibold text-gray-300">{name}</span>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Features */}
      {content.features?.length > 0 && (
        <Section className="bg-surface-50">
          <SectionHeader eyebrow="Platform Capabilities" title="Everything you need to win government contracts" />
          <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {content.features.map((feat: any) => (
              <FeatureCard key={feat.title} icon={<DefaultIcon />} title={feat.title} description={feat.description} />
            ))}
          </div>
        </Section>
      )}

      {/* How It Works */}
      {content.howItWorks?.length > 0 && (
        <Section className="bg-white">
          <SectionHeader eyebrow="How It Works" title="From search to submission in three steps" />
          <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
            {content.howItWorks.map((item: any) => (
              <div key={item.step} className="group relative overflow-hidden rounded-2xl border border-gray-200/80 bg-white p-7 shadow-card">
                <span className="absolute -right-2 -top-4 text-8xl font-black text-gray-50">{item.step}</span>
                <div className="relative">
                  <h3 className="mt-5 text-lg font-bold text-gray-900">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-gray-500">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Testimonial */}
      {content.testimonial?.quote && (
        <section className="bg-surface-50 px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
          <div className="mx-auto max-w-4xl text-center">
            <blockquote className="text-xl font-medium leading-relaxed text-gray-900 sm:text-2xl">
              &ldquo;{content.testimonial.quote}&rdquo;
            </blockquote>
            <div className="mt-6">
              <p className="text-sm font-bold text-gray-900">{content.testimonial.company}</p>
              <p className="text-sm text-gray-500">{content.testimonial.result}</p>
            </div>
          </div>
        </section>
      )}

      {/* CTA */}
      {content.cta && (
        <CtaSection
          title={content.cta.title ?? ''}
          description={content.cta.description ?? ''}
          primaryLabel={content.cta.primaryLabel ?? 'Get Started'}
          primaryHref={content.cta.primaryHref ?? '/get-started'}
          secondaryLabel={content.cta.secondaryLabel}
          secondaryHref={content.cta.secondaryHref}
        />
      )}
    </>
  )
}

function AboutPreview({ content }: { content: any }) {
  return (
    <>
      <section className="bg-white px-4 pb-20 pt-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          {content.hero?.eyebrow && (
            <span className="badge-brand">{content.hero.eyebrow}</span>
          )}
          <h1 className="mt-4 text-4xl font-extrabold text-gray-900 sm:text-5xl">{content.hero?.title ?? 'About'}</h1>
          <p className="mt-4 text-lg text-gray-600">{content.hero?.description ?? ''}</p>
        </div>
      </section>

      {content.mission && (
        <Section className="bg-surface-50">
          <div className="mx-auto max-w-3xl prose prose-gray">
            {Array.isArray(content.mission) ? (
              content.mission.map((p: string, i: number) => <p key={i}>{p}</p>)
            ) : typeof content.mission === 'object' ? (
              <p>{content.mission.text ?? JSON.stringify(content.mission)}</p>
            ) : (
              <p>{String(content.mission)}</p>
            )}
          </div>
        </Section>
      )}

      {content.features?.length > 0 && (
        <Section className="bg-white">
          <SectionHeader eyebrow="Capabilities" title="What We Do" />
          <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2">
            {content.features.map((f: any) => (
              <FeatureCard key={f.title} icon={<DefaultIcon />} title={f.title} description={f.description} />
            ))}
          </div>
        </Section>
      )}
    </>
  )
}

function TeamPreview({ content }: { content: any }) {
  return (
    <>
      <section className="bg-white px-4 pb-16 pt-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="text-4xl font-extrabold text-gray-900 sm:text-5xl">{content.hero?.title ?? 'Our Team'}</h1>
          <p className="mt-4 text-lg text-gray-600">{content.hero?.description ?? ''}</p>
        </div>
      </section>

      {content.members?.length > 0 && (
        <Section className="bg-surface-50">
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {content.members.map((m: any, i: number) => (
              <div key={i} className="card text-center">
                <div className="h-20 w-20 mx-auto rounded-full bg-brand-100 flex items-center justify-center text-2xl font-bold text-brand-700">
                  {(m.name ?? '?')[0]}
                </div>
                <h3 className="mt-4 text-sm font-bold text-gray-900">{m.name}</h3>
                {m.title && <p className="text-xs text-gray-500">{m.title}</p>}
                {m.bio && <p className="mt-2 text-xs text-gray-600">{m.bio}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {content.stats?.length > 0 && (
        <section className="border-t border-gray-100 bg-white px-4 py-14 sm:px-6 lg:px-8">
          <div className="mx-auto grid max-w-5xl grid-cols-2 gap-8 sm:grid-cols-4">
            {content.stats.map((s: any) => (
              <StatHighlight key={s.label} value={s.value} label={s.label} description={s.description} />
            ))}
          </div>
        </section>
      )}
    </>
  )
}

function TipsPreview({ content }: { content: any }) {
  return (
    <>
      <section className="bg-white px-4 pb-16 pt-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="text-4xl font-extrabold text-gray-900 sm:text-5xl">{content.hero?.title ?? 'Tips & Resources'}</h1>
          <p className="mt-4 text-lg text-gray-600">{content.hero?.description ?? ''}</p>
        </div>
      </section>

      {content.tips?.length > 0 && (
        <Section className="bg-surface-50">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {content.tips.map((tip: any, i: number) => (
              <div key={i} className="card">
                <h3 className="text-sm font-bold text-gray-900">{tip.title ?? `Tip ${i + 1}`}</h3>
                <p className="mt-2 text-xs text-gray-600">{tip.description ?? tip.content ?? ''}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {content.tools?.length > 0 && (
        <Section className="bg-white">
          <SectionHeader eyebrow="Resources" title="Free Tools" />
          <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2">
            {content.tools.map((tool: any, i: number) => (
              <div key={i} className="card">
                <h3 className="text-sm font-bold text-gray-900">{tool.title}</h3>
                <p className="mt-1 text-xs text-gray-600">{tool.description ?? ''}</p>
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  )
}

function CustomersPreview({ content }: { content: any }) {
  return (
    <>
      <section className="bg-white px-4 pb-16 pt-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="text-4xl font-extrabold text-gray-900 sm:text-5xl">{content.hero?.title ?? 'Our Customers'}</h1>
          <p className="mt-4 text-lg text-gray-600">{content.hero?.description ?? ''}</p>
        </div>
      </section>

      {content.stats?.length > 0 && (
        <section className="border-y border-gray-100 bg-white px-4 py-14 sm:px-6 lg:px-8">
          <div className="mx-auto grid max-w-5xl grid-cols-2 gap-8 sm:grid-cols-4">
            {content.stats.map((s: any) => (
              <StatHighlight key={s.label} value={s.value} label={s.label} description={s.description} />
            ))}
          </div>
        </section>
      )}

      {content.stories?.length > 0 && (
        <Section className="bg-surface-50">
          <SectionHeader eyebrow="Success Stories" title="Real Results from Real Customers" />
          <div className="mt-10 space-y-6">
            {content.stories.map((story: any, i: number) => (
              <div key={i} className="card">
                <h3 className="text-sm font-bold text-gray-900">{story.company ?? story.title}</h3>
                <p className="mt-2 text-sm text-gray-600">{story.description ?? story.quote ?? ''}</p>
                {story.result && <p className="mt-1 text-xs font-semibold text-brand-600">{story.result}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {content.clientTypes?.length > 0 && (
        <Section className="bg-white">
          <SectionHeader eyebrow="Who We Serve" title="Built for businesses like yours" />
          <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {content.clientTypes.map((ct: any, i: number) => (
              <FeatureCard key={i} icon={<DefaultIcon />} title={ct.title ?? ct.name} description={ct.description ?? ''} />
            ))}
          </div>
        </Section>
      )}
    </>
  )
}

function AnnouncementsPreview({ content }: { content: any }) {
  return (
    <>
      <section className="bg-white px-4 pb-16 pt-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="text-4xl font-extrabold text-gray-900 sm:text-5xl">{content.hero?.title ?? 'Announcements'}</h1>
          <p className="mt-4 text-lg text-gray-600">{content.hero?.description ?? ''}</p>
        </div>
      </section>

      {content.items?.length > 0 && (
        <Section className="bg-surface-50">
          <div className="space-y-6">
            {content.items.map((item: any, i: number) => (
              <div key={i} className="card">
                <div className="flex items-center gap-3">
                  {item.date && <span className="text-xs text-gray-400">{item.date}</span>}
                  {item.badge && <span className="badge-brand">{item.badge}</span>}
                </div>
                <h3 className="mt-2 text-sm font-bold text-gray-900">{item.title}</h3>
                <p className="mt-1 text-sm text-gray-600">{item.description ?? item.content ?? ''}</p>
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  )
}

function GetStartedPreview({ content }: { content: any }) {
  return (
    <>
      <section className="bg-white px-4 pb-16 pt-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          {content.hero?.eyebrow && (
            <span className="badge-brand">{content.hero.eyebrow}</span>
          )}
          <h1 className="mt-4 text-4xl font-extrabold text-gray-900 sm:text-5xl">{content.hero?.title ?? 'Get Started'}</h1>
          <p className="mt-4 text-lg text-gray-600">{content.hero?.description ?? ''}</p>
        </div>
      </section>

      {content.tiers?.length > 0 && (
        <Section className="bg-surface-50">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {content.tiers.map((tier: any, i: number) => (
              <div key={i} className={`card text-center ${tier.popular ? 'ring-2 ring-brand-500' : ''}`}>
                {tier.popular && <span className="badge-brand mb-2">Most Popular</span>}
                <h3 className="text-lg font-bold text-gray-900">{tier.name}</h3>
                <p className="mt-2 text-3xl font-extrabold text-gray-900">{tier.price}</p>
                <p className="text-xs text-gray-500">{tier.period}</p>
                {tier.features?.length > 0 && (
                  <ul className="mt-4 space-y-2 text-left text-xs text-gray-600">
                    {tier.features.map((f: string, fi: number) => (
                      <li key={fi} className="flex items-start gap-2">
                        <span className="text-brand-500 mt-0.5">&#10003;</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {content.faqs?.length > 0 && (
        <Section className="bg-white">
          <SectionHeader eyebrow="FAQs" title="Frequently Asked Questions" />
          <div className="mt-10 mx-auto max-w-3xl space-y-4">
            {content.faqs.map((faq: any, i: number) => (
              <div key={i} className="card">
                <h3 className="text-sm font-bold text-gray-900">{faq.q ?? faq.question}</h3>
                <p className="mt-2 text-sm text-gray-600">{faq.a ?? faq.answer}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {content.contactCta && (
        <section className="bg-surface-50 px-4 py-16 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-2xl font-bold text-gray-900">{content.contactCta.title ?? 'Need more?'}</h2>
            <p className="mt-2 text-gray-600">{content.contactCta.description ?? ''}</p>
            {content.contactCta.email && (
              <p className="mt-4 text-brand-600 font-semibold">{content.contactCta.email}</p>
            )}
          </div>
        </section>
      )}
    </>
  )
}

function GenericPreview({ content }: { content: any }) {
  return (
    <Section className="bg-white">
      <div className="mx-auto max-w-3xl">
        <pre className="rounded-xl bg-gray-50 p-6 text-xs text-gray-700 overflow-auto">
          {JSON.stringify(content, null, 2)}
        </pre>
      </div>
    </Section>
  )
}

function DefaultIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
    </svg>
  )
}
