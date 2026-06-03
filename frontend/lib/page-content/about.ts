import type { SeedPage } from './types';

/** /about — hero + four pillars + founder note. Accent: hero "Win" = award. */
export const about: SeedPage = {
  pageKey: 'about',
  title: 'About',
  blocks: [
    {
      section: 'hero',
      displayOrder: 0,
      excerpt: 'About RFP Pipeline',
      title: 'Expert + AI + Automation + Collaboration = *Win*.',
      body: 'Most AI tools give you speed without accuracy. Most consultants give you accuracy without scale. We built the thing that does both — and gets better every time you use it.',
      metadata: { accent: 'award' },
    },
    {
      section: 'pillars',
      displayOrder: 1,
      excerpt: 'The Expert',
      title: '25 years in the arena.',
      body: 'Eric Wagner has personally secured hundreds of millions in SBIR, STTR, BAA, and OTA funding. He reviews every application, curates every solicitation, and is available for strategy calls. You always know who curated your pipeline — and why.',
      metadata: {},
    },
    {
      section: 'pillars',
      displayOrder: 2,
      excerpt: 'The AI',
      title: 'Isolated. Trained on you.',
      body: 'Your company gets its own AI team provisioned at signup. Your agents only see your data. They learn from your uploads, your past proposals, and your verified compliance decisions. No cross-contamination. No shared context windows.',
      metadata: {},
    },
    {
      section: 'pillars',
      displayOrder: 3,
      excerpt: 'The Automation',
      title: 'Stage-gated, not free-form.',
      body: 'Proposal development follows a structured pipeline: draft, review, revise, accept. Every stage has compliance checks, deadline tracking, and role-gated access. Your admin controls who sees what at every phase.',
      metadata: {},
    },
    {
      section: 'pillars',
      displayOrder: 4,
      excerpt: 'The Collaboration',
      title: 'Your team. Your rules.',
      body: 'Invite internal team members and external collaborators to specific sections of specific proposals. Control access by role, document, and phase. Revoke instantly. Every edit is audited. Every version is tracked.',
      metadata: {},
    },
    {
      section: 'founder',
      displayOrder: 5,
      excerpt: 'Founder & Architect',
      title: 'Eric Wagner',
      body: 'Built RFP Pipeline to replicate the playbook that generated hundreds of millions in federal R&D funding across 25+ years — with AI doing the mechanical work and the expert handling the judgment.\n\nFormer President of D&S Consultants ($270M revenue, 750 employees). Associate Director at Ohio State’s CDME. CEO of Ubihere. B.S. Computer Science and Executive MBA from The Ohio State University. Phase I through Phase III, across DoD, NSF, DOE, DARPA.',
      metadata: { cta: { href: '/apply', label: 'Apply to Work with Eric' } },
    },
  ],
};
