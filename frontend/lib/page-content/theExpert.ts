import type { SeedPage } from './types';

/**
 * /the-expert — Eric Wagner bio. Hero + "Why I built this" intro + Credentials
 * grid + Career History timeline + Education + Recognition + closing CTA.
 * No accent spans on this page (all headings render as plain text).
 *
 * Header-style blocks map: excerpt = SectionHeader eyebrow, title = heading,
 * body = subtitle. The intro block additionally carries its paragraphs in body
 * (joined by `\n\n`; the page applies the original per-paragraph styling by index).
 */
export const theExpert: SeedPage = {
  pageKey: 'the-expert',
  title: 'The Expert',
  blocks: [
    {
      section: 'hero',
      displayOrder: 0,
      excerpt: 'Your Expert',
      title: 'Eric Wagner',
      body: 'Founder and CEO of RFP Pipeline. 25+ years in technology commercialization. Hundreds of millions in SBIR, STTR, BAA, and OTA funding secured. Former president of a $270M aerospace & defense company. Ohio State commercialization veteran who launched 22+ startups.',
      metadata: {},
    },
    {
      section: 'intro',
      displayOrder: 1,
      excerpt: 'About',
      title: 'Why I built this',
      body:
        'I’ve spent the last two and a half decades helping technology companies commercialize innovative work through federal R&D funding. From running a 750-employee aerospace & defense commercialization company, to leading Ohio State’s efforts launching 22+ university startups, to directly managing pursuit and capture for small businesses, one pattern became impossible to ignore:' +
        '\n\n' +
        'Small businesses with genuinely innovative technology routinely lose federal R&D funding to bigger shops with dedicated BD departments — not because their technology is weaker, but because they can’t dedicate the time to the BD work.' +
        '\n\n' +
        'They miss the right opportunities. They misread compliance requirements. They run out of time to write a competitive proposal. And every other tool in the market either drowns them in undifferentiated listings or hands them a generic LLM that confidently produces non-compliant drafts.' +
        '\n\n' +
        'I built RFP Pipeline to solve that problem the way I’ve been solving it manually for 25 years — except now with AI doing the mechanical work (ingestion, pre-extraction, drafting against a verified library) while I handle the high-judgment work (curation, strategy, pursuit calls). The result is my commercialization playbook, delivered as software, but without removing the human expertise that makes it actually work.' +
        '\n\n' +
        'Our initial cohort is small by design. I want to be hands-on with every customer for the first year and prove the value compounds the way I’ve designed it to. If you’re a small business pursuing SBIR, STTR, BAA, OTA, or similar federal R&D funding, I’d like to help.' +
        '\n\n' +
        '— Eric Wagner',
      metadata: {},
    },
    {
      section: 'credentials-header',
      displayOrder: 2,
      excerpt: 'Credentials',
      title: '25+ years of proven commercialization',
      body: 'The track record behind every RFP Pipeline curation decision.',
      metadata: {},
    },
    {
      section: 'credentials',
      displayOrder: 3,
      title: 'Funding Secured',
      body: 'Personally secured hundreds of millions of dollars in SBIR, STTR, OTA, BAA, and related federal R&D funding across two decades — both for companies Eric led and for small businesses he advised. Phase I through Phase III, across DoD, NSF, DOE, DARPA, and more.',
      metadata: {},
    },
    {
      section: 'credentials',
      displayOrder: 4,
      title: 'Operations Scale',
      body: 'Former President of D&S Consultants (DSCI), an aerospace and defense commercialization company. Grew the company from 400 to 750+ employees at 70% CAGR, with 15 worldwide office locations and over $270M in annual revenue at time of departure.',
      metadata: {},
    },
    {
      section: 'credentials',
      displayOrder: 5,
      title: 'Startup Launch Track Record',
      body: 'Oversaw the successful launch of 22+ startups through The Ohio State University\'s commercialization office. Co-founded Converge Technologies (commercialization services) and served as Co-Fund Manager at Ohio Gateway Tech Fund (pre-seed venture).',
      metadata: {},
    },
    {
      section: 'credentials',
      displayOrder: 6,
      title: 'Executive Leadership',
      body: 'Chief Executive Officer at Ubihere (2023-2026), Chief Strategy Officer at Lighthouse Avionics and Converge Technologies, Associate Director at Ohio State\'s Center for Design and Manufacturing Excellence. Active startup investor via OTAF and individually.',
      metadata: {},
    },
    {
      section: 'timeline-header',
      displayOrder: 7,
      excerpt: 'Career History',
      title: 'From software engineer to CEO to founder',
      body: 'Every step has been about turning innovative technology into commercial outcomes, often through federal funding.',
      metadata: {},
    },
    {
      section: 'timeline',
      displayOrder: 8,
      title: 'Founder & CEO',
      excerpt: 'RFP Pipeline',
      body: 'Founded to help small businesses identify, engage, and win non-dilutive federal R&D funding. The company combines the proven commercialization playbook with custom AI agents trained per-customer and curated by human experts.',
      metadata: { period: '2026 – Present' },
    },
    {
      section: 'timeline',
      displayOrder: 9,
      title: 'Chief Executive Officer',
      excerpt: 'Ubihere',
      body: 'Led the geospatial AI company toward commercialization of patented positioning analytics for asset tracking and vision-based business intelligence. Built the engineering and support teams that realized founder Dr. Alper Yilmaz\'s vision.',
      metadata: { period: '2023 – 2026' },
    },
    {
      section: 'timeline',
      displayOrder: 10,
      title: 'Co-Fund Manager',
      excerpt: 'Ohio Gateway Tech Fund',
      body: 'Led pre-seed investments in Ohio-based technology startups. Established partnership with Ohio Third Frontier\'s Pre-Seed Fund Capitalization Program. Direct role in due diligence and portfolio growth.',
      metadata: { period: '2023 – 2024' },
    },
    {
      section: 'timeline',
      displayOrder: 11,
      title: 'VP, Government Programs',
      excerpt: 'Ubihere',
      body: 'Drove federal program capture for the geospatial analytics company, securing R&D funding that fueled the core patented technology platform.',
      metadata: { period: '2019 – 2023' },
    },
    {
      section: 'timeline',
      displayOrder: 12,
      title: 'Associate Director, CDME',
      excerpt: 'The Ohio State University',
      body: 'Built a statewide support system for manufacturing-ecosystem technology commercialization. Led development of new programs including the Manufacturing Extension Partnership (MEP) and student experiential entrepreneurship (E3) programs.',
      metadata: { period: '2015 – 2018' },
    },
    {
      section: 'timeline',
      displayOrder: 13,
      title: 'Senior Business Analyst',
      excerpt: 'OSU Technology Commercialization Office',
      body: 'Evaluated university technologies and determined the best commercialization path — licensing, partnership, joint venture, or new startup. Oversaw the successful launch of 22+ companies founded on licensed OSU IP.',
      metadata: { period: '2013 – 2015' },
    },
    {
      section: 'timeline',
      displayOrder: 14,
      title: 'President / Chief Strategy Officer',
      excerpt: 'D&S Consultants (DSCI)',
      body: 'Led strategic vision, acquisitions, and organic growth for the aerospace & defense commercialization company. Grew from 400 to 750+ employees with 70% CAGR and $270M+ in annual revenue. 15 global offices.',
      metadata: { period: '2009 – 2012' },
    },
    {
      section: 'timeline',
      displayOrder: 15,
      title: 'SVP & Director / COO',
      excerpt: 'D&S Consultants',
      body: 'Established a new operating division that grew from 14 to 110+ revenue-generating employees via organic growth alone. Launched the company\'s first commercial software product (awarded a patent). Assisted in two synergistic acquisitions.',
      metadata: { period: '2003 – 2009' },
    },
    {
      section: 'timeline',
      displayOrder: 16,
      title: 'Senior Program Manager',
      excerpt: 'D&S Consultants',
      body: 'Technically managed custom software development for federal customers. Grew to 14 employees across 4 programs and established the company\'s overseas presence in Germany (now 30% of company revenue).',
      metadata: { period: '2000 – 2003' },
    },
    {
      section: 'timeline',
      displayOrder: 17,
      title: 'Research Analyst / Program Lead',
      excerpt: 'Southwest Research Institute (SWRI)',
      body: 'Technical lead on a $1.5M/year development effort requiring detailed requirements gathering and analysis. Grew from software developer into program lead. Received multiple customer satisfaction and product awards.',
      metadata: { period: '1998 – 2000' },
    },
    {
      section: 'education-header',
      displayOrder: 18,
      excerpt: 'Education',
      title: 'The Ohio State University',
      metadata: {},
    },
    {
      section: 'education',
      displayOrder: 19,
      title: 'Executive MBA',
      body: 'Business Administration, Management and Operations · 2008 – 2009',
      metadata: {},
    },
    {
      section: 'education',
      displayOrder: 20,
      title: 'B.S., Computer Science',
      body: 'The Ohio State University · 1995 – 1998',
      metadata: {},
    },
    {
      section: 'recognition-header',
      displayOrder: 21,
      excerpt: 'Recognition',
      title: 'A recognized lean-launch and commercialization development professional',
      metadata: {},
    },
    {
      section: 'recognition',
      displayOrder: 22,
      body: 'Adjunct instructor (3 years) for I-Corps@Ohio — training scientists and engineers in lean startup methods',
      metadata: {},
    },
    {
      section: 'recognition',
      displayOrder: 23,
      body: 'Trustee at Clintonville-Beechwold Community Resources Center (2012–2013), on the finance committee during their successful capital campaign',
      metadata: {},
    },
    {
      section: 'recognition',
      displayOrder: 24,
      body: 'Awarded patent for early commercial software launch at DSCI',
      metadata: {},
    },
    {
      section: 'recognition',
      displayOrder: 25,
      body: 'Employee of the Year (DSCI)',
      metadata: {},
    },
    {
      section: 'recognition',
      displayOrder: 26,
      body: 'Active startup investor — OTAF and individual investments in early-stage tech companies',
      metadata: {},
    },
    {
      section: 'cta',
      displayOrder: 27,
      excerpt: 'Ready to work together?',
      title: 'I\'m taking 20 founding members. Apply if you\'re serious.',
      body: 'If you\'re commercializing innovative technology and want non-dilutive federal R&D funding, let\'s talk.',
      metadata: { cta: { label: 'Apply Now', href: '/apply' } },
    },
  ],
};
