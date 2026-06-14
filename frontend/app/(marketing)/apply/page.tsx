import { ApplicationForm } from '@/components/marketing/application-form';
import { getPageBlocks, buildLookup, single } from '@/lib/cms';
import { CustomSections } from '@/components/marketing/custom-sections';

export const revalidate = 60;

export const metadata = {
  title: 'Apply for Founding Cohort — RFP Pipeline',
  description:
    'Apply to join the RFP Pipeline founding cohort. Limited to 20 small businesses pursuing SBIR, STTR, BAA, or OTA funding. Eric personally reviews every application within 72 hours.',
};

export default async function Page({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams
  const isPreview = params?._preview === '1'
  const blocks = await getPageBlocks('apply', isPreview);
  const lookup = buildLookup(blocks, 'apply');
  const hero = single(lookup['hero']);

  return (
    <>
      <section className="bg-gradient-to-b from-navy-900 to-navy-800 border-b">
        <div className="max-w-4xl mx-auto px-6 py-20 md:py-28">
          <p className="text-sm font-semibold text-brand-400 uppercase tracking-wider mb-3">
            {hero?.excerpt ?? 'Founding Cohort Application'}
          </p>
          <h1 className="font-display text-4xl md:text-5xl font-bold text-white leading-tight">
            {hero?.title ?? 'Apply to join the founding cohort'}
          </h1>
          <p className="mt-6 text-lg text-gray-300 leading-relaxed">
            {hero?.body ?? 'We\'re accepting 20 small businesses into our initial cohort. The application itself is the qualifier — serious applicants pursuing SBIR, STTR, BAA, OTA, or similar federal R&D funding will be reviewed by Eric within 72 hours.'}
          </p>
          <div className="mt-6 p-4 bg-navy-800/50 border border-navy-600 rounded-lg">
            <p className="text-sm text-gray-300">
              <strong className="text-white">{(hero?.metadata as { before_you_apply_label?: string })?.before_you_apply_label ?? 'Before you apply:'}</strong>{(hero?.metadata as { before_you_apply?: string })?.before_you_apply ?? ' This is a paid service ($299/month after acceptance). There is no free trial. If accepted, you’ll be invited to onboard, register your admin, upload foundational company documents, and activate your subscription via Stripe.'}
            </p>
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="max-w-3xl mx-auto px-6 py-16 md:py-20">
          <ApplicationForm />
        </div>
      </section>

      <CustomSections pageKey="apply" blocks={blocks} />
    </>
  );
}
