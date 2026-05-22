-- Migration 042: Seed blog posts and Latest Insights page block
-- Provides initial content for the blog listing page and the
-- "Latest Insights" section on the landing page.

-- ── Blog Posts ────────────────────────────────────────────────────────

INSERT INTO cms_content (slug, title, body, excerpt, content_type, author, tags, status, published, published_at, featured_image, display_order, metadata) VALUES
('sbir-proposal-ai-guide',
 'How AI is Changing the SBIR Proposal Game',
 '<h2>The New Era of Proposal Writing</h2><p>Small businesses pursuing SBIR contracts face a daunting challenge: crafting competitive proposals that meet rigorous technical and compliance requirements, often with limited staff and tight deadlines.</p><p>AI-powered tools are leveling the playing field. From automated compliance checking to intelligent content reuse, the latest generation of proposal management platforms helps small teams compete with large defense contractors.</p><h3>Key Areas Where AI Helps</h3><ul><li><strong>Opportunity Discovery</strong> — AI scores thousands of solicitations against your company profile, surfacing the best matches</li><li><strong>Compliance Mapping</strong> — Automated extraction of requirements ensures nothing falls through the cracks</li><li><strong>Content Reuse</strong> — Smart library systems find and adapt your best past performance narratives</li><li><strong>Section Drafting</strong> — AI generates first drafts that your team refines, cutting writing time by 60%</li></ul><p>The result: more proposals submitted, higher win rates, and teams that spend time on strategy instead of formatting.</p>',
 'AI-powered tools are leveling the playing field for small businesses pursuing SBIR contracts.',
 'blog_post', 'Eric Wagner', ARRAY['ai','sbir','proposals','guide'], 'published', true, NOW() - INTERVAL '3 days',
 NULL, 0, '{"meta_title": "How AI is Changing SBIR Proposals", "meta_description": "Learn how AI tools help small businesses write better SBIR proposals faster."}'::jsonb),

('understanding-sbir-sttr-programs',
 'SBIR vs STTR: Understanding the Programs That Fund Innovation',
 '<h2>Two Programs, One Mission</h2><p>The Small Business Innovation Research (SBIR) and Small Business Technology Transfer (STTR) programs represent over $4 billion in annual federal R&D funding for small businesses. But understanding which program fits your company can be confusing.</p><h3>SBIR — Go It Alone</h3><p>SBIR is designed for small businesses (under 500 employees) to conduct federal R&D. The key: your company does the primary research. Phase I awards typically range from $50K-$275K for 6-12 months of feasibility research. Phase II awards range from $500K-$1.7M for full development.</p><h3>STTR — Partner With Research</h3><p>STTR requires a formal partnership with a nonprofit research institution (university, FFRDC, etc.). The research partner must perform at least 30% of the work. This is ideal if your innovation builds on academic research or you need specialized lab capabilities.</p><h3>Which Should You Pursue?</h3><p>If you have in-house R&D capabilities, start with SBIR. If your technology emerged from university research or you need academic partnerships, STTR is your path. Many companies pursue both.</p>',
 'Over $4 billion in annual federal R&D funding is available through SBIR and STTR. Here is how to choose the right program.',
 'blog_post', 'Eric Wagner', ARRAY['sbir','sttr','funding','programs'], 'published', true, NOW() - INTERVAL '7 days',
 NULL, 1, '{"meta_title": "SBIR vs STTR Programs Explained", "meta_description": "Understand the differences between SBIR and STTR programs and which is right for your small business."}'::jsonb),

('winning-proposal-strategies-2026',
 '5 Strategies That Win SBIR Proposals in 2026',
 '<h2>What Evaluators Actually Look For</h2><p>After analyzing hundreds of successful SBIR proposals, clear patterns emerge. The winners don''t just have great technology — they present it in ways that align with how evaluators score.</p><h3>1. Lead With the Problem, Not Your Solution</h3><p>Evaluators need to understand why your work matters before they care how it works. Spend your first paragraph on the operational gap, not your patent portfolio.</p><h3>2. Quantify Everything</h3><p>Replace "significant improvement" with "3.2x throughput increase measured against the MIL-STD-881 baseline." Numbers build credibility.</p><h3>3. Show You Understand the Transition Path</h3><p>Phase III commercialization is what turns R&D into reality. Name specific programs of record, acquisition offices, and transition partners.</p><h3>4. Staff the Right Team</h3><p>Key personnel with relevant domain experience and past performance on similar contracts dramatically improve scores. If you lack expertise, partner strategically.</p><h3>5. Match the Evaluation Criteria Exactly</h3><p>Structure your proposal to mirror the evaluation criteria in the solicitation. Make it easy for evaluators to find what they''re scoring.</p>',
 'After analyzing hundreds of successful proposals, these 5 patterns consistently separate winners from the pack.',
 'blog_post', 'Eric Wagner', ARRAY['proposals','strategy','sbir','winning'], 'published', true, NOW() - INTERVAL '1 day',
 NULL, 2, '{"meta_title": "5 Winning SBIR Proposal Strategies", "meta_description": "Proven strategies that consistently win SBIR proposals based on analysis of hundreds of successful submissions."}'::jsonb)

ON CONFLICT (slug) DO NOTHING;
