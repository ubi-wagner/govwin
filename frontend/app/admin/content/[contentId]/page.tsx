import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ contentId: string }>;
}

export default async function ContentEditorPage({ params }: RouteContext) {
  const { contentId } = await params;

  // Content editing is managed in the CMS portal — redirect to preview
  redirect(`/admin/content/${contentId}/preview`);
}
