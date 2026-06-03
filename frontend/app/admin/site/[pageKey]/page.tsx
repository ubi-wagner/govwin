import Link from 'next/link';
import { getPage } from '@/lib/content-admin';
import EditorClient from './editor-client';

export const dynamic = 'force-dynamic';

export default async function PageEditorPage({ params }: { params: Promise<{ pageKey: string }> }) {
  const { pageKey } = await params;
  const { active, draft } = await getPage(pageKey);

  return (
    <div className="max-w-5xl">
      <Link href="/admin/site" className="text-sm text-gray-500 hover:text-gray-700">&larr; Site Content</Link>
      <EditorClient pageKey={pageKey} active={active} draft={draft} />
    </div>
  );
}
