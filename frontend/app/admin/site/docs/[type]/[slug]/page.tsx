import Link from 'next/link';
import { getDocument, type PageVersion } from '@/lib/content-admin';
import DocEditorClient from './doc-editor-client';

export const dynamic = 'force-dynamic';

export default async function DocEditorPage({ params }: { params: Promise<{ type: string; slug: string }> }) {
  const { type, slug } = await params;
  const isNew = slug === 'new';
  let active: PageVersion | null = null;
  let draft: PageVersion | null = null;
  if (!isNew) {
    try {
      const doc = await getDocument(slug, type);
      active = doc.active;
      draft = doc.draft;
    } catch (e) {
      console.error('[admin/site/docs/[type]/[slug]] getDocument failed:', e);
    }
  }

  return (
    <div className="max-w-3xl">
      <Link href="/admin/site" className="text-sm text-gray-500 hover:text-gray-700">&larr; Site Content</Link>
      <DocEditorClient type={type} slug={isNew ? '' : slug} isNew={isNew} active={active} draft={draft} />
    </div>
  );
}
