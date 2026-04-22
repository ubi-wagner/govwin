import { ApplicationForm } from '@/components/marketing/application-form';

export const metadata = {
  title: 'Apply for Founding Cohort — RFP Pipeline',
  description:
    'Apply to join the RFP Pipeline founding cohort. Limited to 20 small businesses pursuing SBIR, STTR, BAA, or OTA funding. Eric personally reviews every application within 72 hours.',
};

export default function Page() {
  return (
    <>
      <section className="bg-gradient-to-b from-navy-900 to-navy-800 border-b">
        <div className="max-w-4xl mx-auto px-6 py-20 md:py-28">
          <p className="text-sm font-semibold text-brand-400 uppercase tracking-wider mb-3">
            Founding Cohort Application
          </p>
          <h1 className="font-display text-4xl md:text-5xl font-bold text-white leading-tight">
            Apply to join the founding cohort
          </h1>
          <p className="mt-6 text-lg text-gray-300 leading-relaxed">
            We&rsquo;re accepting 20 small businesses into our initial cohort. The application
            itself is the qualifier &mdash; serious applicants pursuing SBIR, STTR, BAA, OTA,
            or similar federal R&amp;D funding will be reviewed by Eric within 72 hours.
          </p>
          <div className="mt-6 p-4 bg-navy-800/50 border border-navy-600 rounded-lg">
            <p className="text-sm text-gray-300">
              <strong className="text-white">Before you apply:</strong> This is a paid service
              ($299/month after acceptance). There is no free trial. If accepted, you&rsquo;ll
              be invited to onboard, register your admin, upload foundational company
              documents, and activate your subscription via Stripe.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="max-w-3xl mx-auto px-6 py-16 md:py-20">
          <ApplicationForm />
        </div>
      </section>
    </>
  );
}
