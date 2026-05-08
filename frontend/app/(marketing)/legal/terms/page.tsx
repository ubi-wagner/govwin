import { TERMS_TEXT, TERMS_VERSION } from '@/lib/terms';

export const metadata = {
  title: 'Terms of Service — RFP Pipeline',
  description: 'Terms and Conditions for the RFP Pipeline platform.',
};

export default function TermsPage() {
  // Split the terms text into paragraphs for proper formatting
  const paragraphs = TERMS_TEXT.split('\n\n').map(p => p.trim()).filter(Boolean);
  const title = paragraphs[0] ?? 'Terms & Conditions';
  const subtitle = paragraphs[1] ?? '';
  const bodyParagraphs = paragraphs.slice(2);

  return (
    <div>
      <h1 className="font-display text-3xl font-black text-navy-900 leading-tight mb-2">
        Terms of Service
      </h1>
      <p className="text-xs text-navy-400 mb-8">Version: {TERMS_VERSION}</p>

      <div className="bg-white border border-cream-200 rounded-xl p-8 md:p-12">
        <p className="text-lg font-bold text-navy-900 mb-1">{title}</p>
        {subtitle && <p className="text-sm text-navy-600 mb-6 italic">{subtitle}</p>}

        <div className="space-y-4 text-sm text-navy-700 leading-relaxed">
          {bodyParagraphs.map((paragraph, i) => {
            // Check if this is a section header (starts with a number and period)
            const isHeader = /^\d+\.\s/.test(paragraph);
            if (isHeader) {
              return (
                <h2 key={i} className="text-base font-bold text-navy-900 mt-8 first:mt-0">
                  {paragraph}
                </h2>
              );
            }
            // Check if it has sub-items (a), (b), etc.
            if (/^\([a-z]\)/.test(paragraph)) {
              return (
                <p key={i} className="pl-6">
                  {paragraph}
                </p>
              );
            }
            return <p key={i}>{paragraph}</p>;
          })}
        </div>
      </div>
    </div>
  );
}
