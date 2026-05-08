/**
 * POST /api/admin/content/generate
 *
 * Auto-generate content metadata from a URL.
 * Fetches the URL, extracts title/description/og:image,
 * and optionally uses Claude to generate a summary and tags.
 *
 * Body: { url: string, contentType?: string }
 * Returns: { data: { title, excerpt, tags, suggestedSlug, imageUrl } }
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function extractMeta(html: string): { title: string; description: string; ogImage: string | null } {
  let title = '';
  let description = '';
  let ogImage: string | null = null;

  // Extract <title>
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    title = titleMatch[1].replace(/\s+/g, ' ').trim();
  }

  // Extract meta description
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  if (descMatch) {
    description = descMatch[1].trim();
  }

  // Extract og:image
  const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:image["']/i);
  if (ogMatch) {
    ogImage = ogMatch[1].trim();
  }

  return { title, description, ogImage };
}

function extractText(html: string): string {
  // Strip scripts and styles
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  // Strip HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== 'rfp_admin' && role !== 'master_admin') {
      return NextResponse.json({ error: 'Admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!url) {
      return NextResponse.json({ error: 'Missing required field: url', code: 'VALIDATION_ERROR' }, { status: 422 });
    }

    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('Invalid protocol');
      }
    } catch {
      return NextResponse.json({ error: 'Invalid URL', code: 'VALIDATION_ERROR' }, { status: 422 });
    }

    // Fetch the page
    let html: string;
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'RFPPipeline-CMS/1.0',
          'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) {
        return NextResponse.json(
          { error: `Failed to fetch URL: ${resp.status} ${resp.statusText}`, code: 'FETCH_ERROR' },
          { status: 422 },
        );
      }
      html = await resp.text();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      return NextResponse.json(
        { error: `Failed to fetch URL: ${message}`, code: 'FETCH_ERROR' },
        { status: 422 },
      );
    }

    const meta = extractMeta(html);
    const pageText = extractText(html).slice(0, 5000);

    let title = meta.title;
    let excerpt = meta.description;
    let tags: string[] = [];
    let imageUrl = meta.ogImage;

    // If Claude API key is available, generate smarter metadata
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey && pageText.length > 100) {
      try {
        const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 500,
            messages: [{
              role: 'user',
              content: `Summarize this page for a government contracting resource directory. The page URL is: ${url}\n\nPage text:\n${pageText}\n\nReturn JSON only (no markdown) with these fields:\n- title: concise title (max 80 chars)\n- excerpt: 2 sentence summary for a card preview\n- tags: array of 3-5 relevant lowercase tags like "sbir", "proposal-writing", "compliance", "phase-1", "dod"\n- category: one of "resource", "guide", "blog_post"`,
            }],
          }),
          signal: AbortSignal.timeout(15_000),
        });

        if (claudeResp.ok) {
          const claudeData = await claudeResp.json();
          const textContent = claudeData.content?.[0]?.text ?? '';
          try {
            const parsed = JSON.parse(textContent);
            if (parsed.title) title = parsed.title;
            if (parsed.excerpt) excerpt = parsed.excerpt;
            if (Array.isArray(parsed.tags)) tags = parsed.tags;
          } catch {
            // Claude response wasn't valid JSON — use extracted meta
          }
        }
      } catch {
        // Claude call failed — use extracted meta
      }
    }

    const suggestedSlug = slugify(title || parsedUrl.hostname);

    return NextResponse.json({
      data: {
        title: title || parsedUrl.hostname,
        excerpt: excerpt || '',
        tags,
        suggestedSlug,
        imageUrl: imageUrl || null,
      },
    });
  } catch (e) {
    console.error('[api/admin/content/generate] error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
