import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SECTION_PROMPTS: Record<string, string> = {
  hero: 'Write a compelling hero section. Return JSON with: title (headline, 8-12 words), excerpt (subtitle, 1 sentence), body (supporting paragraph, 2-3 sentences), and metadata with cta_text, cta_href, cta_secondary_text, cta_secondary_href.',
  stats: 'Write a statistics/metrics block. Return JSON with: title (section heading), body (context sentence), and metadata with value (the number/stat), label (what it measures), suffix (unit like "+" or "%").',
  pricing: 'Write a pricing section block. Return JSON with: title (plan name), excerpt (tagline), body (plan description), and metadata with price, period (e.g. "/month"), features (array of feature strings).',
  features: 'Write a feature highlight block. Return JSON with: title (feature name), body (feature description, 2-3 sentences), and metadata with icon (emoji or icon name), items (array of bullet points if applicable).',
  cta: 'Write a call-to-action section. Return JSON with: title (CTA heading), body (supporting copy, 1-2 sentences), and metadata with cta_text (button label), cta_href (URL path like "/apply"), note (optional fine print).',
  'how-it-works': 'Write a process/how-it-works step. Return JSON with: title (step name), body (step description), and metadata with step_number, detail_points (array of detail strings).',
  testimonials: 'Write a customer testimonial block. Return JSON with: title (customer name and title), body (the testimonial quote), excerpt (company name).',
  faq: 'Write an FAQ item. Return JSON with: title (the question), body (the answer, 2-4 sentences).',
};

const SYSTEM_PROMPT = `You are a content writer for RFP Pipeline (also called SBIR Engine / GovWin), a SaaS platform that helps small businesses discover, score, and build proposals for federal R&D opportunities (SBIR, STTR, BAA, OTA).

Write clear, professional marketing copy. Be specific about value propositions. No fluff. Target audience: small defense/tech companies pursuing government contracts.

ALWAYS return valid JSON only — no markdown fences, no explanation text.`;

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const sessionUser = session.user as { id?: string; role?: string; email?: string };
    const role = sessionUser.role;
    if (role !== 'rfp_admin' && role !== 'master_admin') {
      return NextResponse.json({ error: 'Admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }
    const userId = sessionUser.id;
    if (!userId) {
      return NextResponse.json({ error: 'Missing user id', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, { status: 400 });
    }

    const action = body.action as string;

    if (action === 'generate') {
      return handleGenerate(body, userId, sessionUser.email ?? '');
    } else if (action === 'revise') {
      return handleRevise(body, userId, sessionUser.email ?? '');
    } else if (action === 'from_url') {
      return handleFromUrl(body, userId, sessionUser.email ?? '');
    } else {
      return NextResponse.json({ error: 'Unknown action. Use: generate, revise, from_url', code: 'VALIDATION_ERROR' }, { status: 422 });
    }
  } catch (err) {
    console.error('[api/admin/content/ai] error:', err);
    return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
  }
}

async function callClaude(systemPrompt: string, userPrompt: string): Promise<Record<string, unknown>> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('');

  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(cleaned);
}

async function handleGenerate(body: Record<string, unknown>, userId: string, email: string) {
  const page = body.page as string;
  const section = body.section as string;
  const instructions = (body.instructions as string) || '';
  const existingTitle = (body.existingTitle as string) || '';

  if (!page || !section) {
    return NextResponse.json({ error: 'page and section are required', code: 'VALIDATION_ERROR' }, { status: 422 });
  }

  const sectionType = section.replace(/-\d+$/, '');
  const sectionPrompt = SECTION_PROMPTS[sectionType] || 'Write a marketing content block. Return JSON with: title, body, excerpt, and metadata (object with any relevant fields).';

  const userPrompt = [
    `Page: ${page}`,
    `Section: ${section}`,
    existingTitle ? `Current heading: "${existingTitle}"` : null,
    instructions ? `Additional instructions: ${instructions}` : null,
    '',
    sectionPrompt,
  ].filter(Boolean).join('\n');

  try {
    await emitEventSingle({
      namespace: 'system',
      type: 'content.ai_generation_started',
      actor: userActor(userId),
      payload: { page, section, action: 'generate' },
    });
  } catch { /* non-critical */ }

  try {
    const result = await callClaude(SYSTEM_PROMPT, userPrompt);

    try {
      await emitEventSingle({
        namespace: 'system',
        type: 'content.ai_generation_completed',
        actor: userActor(userId),
        payload: { page, section, action: 'generate', hasTitle: !!result.title, hasBody: !!result.body },
      });
    } catch { /* non-critical */ }

    return NextResponse.json({
      data: {
        title: result.title || '',
        body: result.body || '',
        excerpt: result.excerpt || '',
        metadata: result.metadata || {},
        tags: result.tags || [],
      },
    });
  } catch (err) {
    console.error('[content/ai] Claude generation failed:', err);

    try {
      await emitEventSingle({
        namespace: 'system',
        type: 'content.ai_generation_failed',
        actor: userActor(userId),
        payload: { page, section, action: 'generate', error: String(err) },
      });
    } catch { /* non-critical */ }

    return NextResponse.json({ error: 'AI generation failed', code: 'AI_ERROR' }, { status: 502 });
  }
}

async function handleRevise(body: Record<string, unknown>, userId: string, email: string) {
  const title = body.title as string;
  const currentBody = body.body as string;
  const excerpt = body.excerpt as string;
  const instructions = (body.instructions as string) || 'Make it more compelling and concise.';
  const section = (body.section as string) || 'unknown';
  const page = (body.page as string) || 'unknown';

  if (!title && !currentBody) {
    return NextResponse.json({ error: 'title or body required for revision', code: 'VALIDATION_ERROR' }, { status: 422 });
  }

  const userPrompt = [
    'Revise the following marketing content. Keep the same structure and intent but improve clarity, impact, and persuasion.',
    '',
    `Instructions: ${instructions}`,
    '',
    title ? `Current title: "${title}"` : null,
    excerpt ? `Current excerpt: "${excerpt}"` : null,
    currentBody ? `Current body:\n${currentBody}` : null,
    '',
    'Return JSON with: title, body, excerpt (all revised versions). Keep metadata unchanged.',
  ].filter(Boolean).join('\n');

  try {
    await emitEventSingle({
      namespace: 'system',
      type: 'content.ai_generation_started',
      actor: userActor(userId),
      payload: { page, section, action: 'revise' },
    });
  } catch { /* non-critical */ }

  try {
    const result = await callClaude(SYSTEM_PROMPT, userPrompt);

    try {
      await emitEventSingle({
        namespace: 'system',
        type: 'content.ai_generation_completed',
        actor: userActor(userId),
        payload: { page, section, action: 'revise' },
      });
    } catch { /* non-critical */ }

    return NextResponse.json({
      data: {
        title: result.title || title || '',
        body: result.body || currentBody || '',
        excerpt: result.excerpt || excerpt || '',
      },
    });
  } catch (err) {
    console.error('[content/ai] Claude revision failed:', err);
    return NextResponse.json({ error: 'AI revision failed', code: 'AI_ERROR' }, { status: 502 });
  }
}

async function handleFromUrl(body: Record<string, unknown>, userId: string, email: string) {
  const url = body.url as string;
  const section = (body.section as string) || 'unknown';
  const page = (body.page as string) || 'unknown';
  const instructions = (body.instructions as string) || '';

  if (!url) {
    return NextResponse.json({ error: 'url is required', code: 'VALIDATION_ERROR' }, { status: 422 });
  }

  let pageText = '';
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const html = await res.text();
    pageText = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 8000);
  } catch (err) {
    return NextResponse.json({ error: `Failed to fetch URL: ${String(err)}`, code: 'FETCH_ERROR' }, { status: 502 });
  }

  const sectionType = section.replace(/-\d+$/, '');
  const sectionPrompt = SECTION_PROMPTS[sectionType] || 'Write a marketing content block. Return JSON with: title, body, excerpt, and metadata.';

  const userPrompt = [
    `Analyze the following web page content and create a marketing content block inspired by its messaging, but written for RFP Pipeline / SBIR Engine.`,
    instructions ? `Additional instructions: ${instructions}` : null,
    '',
    `Target page: ${page}, section: ${section}`,
    sectionPrompt,
    '',
    `Source page content:\n${pageText}`,
  ].filter(Boolean).join('\n');

  try {
    await emitEventSingle({
      namespace: 'system',
      type: 'content.ai_generation_started',
      actor: userActor(userId),
      payload: { page, section, action: 'from_url', sourceUrl: url },
    });
  } catch { /* non-critical */ }

  try {
    const result = await callClaude(SYSTEM_PROMPT, userPrompt);

    try {
      await emitEventSingle({
        namespace: 'system',
        type: 'content.ai_generation_completed',
        actor: userActor(userId),
        payload: { page, section, action: 'from_url', sourceUrl: url },
      });
    } catch { /* non-critical */ }

    return NextResponse.json({
      data: {
        title: result.title || '',
        body: result.body || '',
        excerpt: result.excerpt || '',
        metadata: result.metadata || {},
      },
    });
  } catch (err) {
    console.error('[content/ai] Claude from-URL generation failed:', err);
    return NextResponse.json({ error: 'AI generation from URL failed', code: 'AI_ERROR' }, { status: 502 });
  }
}
