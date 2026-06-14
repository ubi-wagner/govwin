import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ensurePageSeeded, getPage, type PageVersion } from '@/lib/content-admin';
import { SEED_PAGE_KEYS } from '@/lib/page-content';
import EditorClient from './editor-client';

export const dynamic = 'force-dynamic';

export default async function PageEditorPage({ params }: { params: Promise<{ pageKey: string }> }) {
  const { pageKey } = await params;
  // Only registry pages are editable; bounce junk/deprecated keys back to the list.
  if (!SEED_PAGE_KEYS.includes(pageKey)) redirect('/admin/site');
  let active: PageVersion | null = null;
  let draft: PageVersion | null = null;
  try {
    // Populate the editor from page defaults the first time a page is opened
    // (idempotent; never touches an already-seeded/edited page).
    await ensurePageSeeded(pageKey);
    const page = await getPage(pageKey);
    active = page.active;
    draft = page.draft;
  } catch (e) {
    console.error('[admin/site/[pageKey]] getPage failed:', e);
  }

  return (
    <div className="max-w-5xl">
      <Link href="/admin/site" className="text-sm text-gray-500 hover:text-gray-700">&larr; Site Content</Link>
      <EditorClient pageKey={pageKey} active={active} draft={draft} />
    </div>
  );
}
