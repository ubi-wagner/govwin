import { TERMS_TEXT, TERMS_VERSION } from '@/lib/terms';

export const metadata = {
  title: 'Terms of Service — RFP Pipeline',
  description: 'Terms and Conditions for the RFP Pipeline platform.',
};

export default function TermsPage() {
  // Split the terms text into blocks. Block 0 is the preamble (name + cohort +
  // effective date); its first line is the title, the rest the subtitle. Every
  // remaining block is a numbered section, rendered line-aware below.
  const paragraphs = TERMS_TEXT.split('\n\n').map(p => p.trim()).filter(Boolean);
  const preambleLines = (paragraphs[0] ?? 'Terms & Conditions').split('\n').map(l => l.trim()).filter(Boolean);
  const title = preambleLines[0];
  const subtitleLines = preambleLines.slice(1);
  const bodyParagraphs = paragraphs.slice(1);

  return (
    <div>
      <h1 className="font-display text-3xl font-black text-navy-900 leading-tight mb-2">
        Terms of Service
      </h1>
      <p className="text-xs text-navy-400 mb-8">Version: {TERMS_VERSION}</p>

      <div className="bg-white border border-cream-200 rounded-xl p-8 md:p-12">
        <p className="text-lg font-bold text-navy-900 mb-1">{title}</p>
        {subtitleLines.length > 0 && (
          <p className="text-sm text-navy-600 mb-6 italic">{subtitleLines.join(' · ')}</p>
        )}

        <div className="space-y-4 text-sm text-navy-700 leading-relaxed">
          {bodyParagraphs.flatMap((paragraph, i) =>
            // Each section is one block: a numbered header line ("1. …") followed by
            // body lines, some of which are sub-items ("(a) …"). Render line-aware so the
            // header is a heading and the body reads as paragraphs regardless of spacing.
            paragraph.split('\n').map(l => l.trim()).filter(Boolean).map((line, j) => {
              const key = `${i}-${j}`;
              if (/^\d+\.\s/.test(line)) {
                return (
                  <h2 key={key} className="text-base font-bold text-navy-900 mt-8 first:mt-0">
                    {line}
                  </h2>
                );
              }
              if (/^\([a-z]\)/.test(line)) {
                return <p key={key} className="pl-6">{line}</p>;
              }
              return <p key={key}>{line}</p>;
            })
          )}
        </div>
      </div>
    </div>
  );
}
