import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import PageBlockEditor from '@/components/admin/page-block-editor';

export const dynamic = 'force-dynamic';

interface RouteContext {
  searchParams: Promise<{ page?: string; section?: string }>;
}

export default async function NewBlockPage({ searchParams }: RouteContext) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    redirect('/');
  }

  const params = await searchParams;
  const defaultPage = params.page ?? '';
  const defaultSection = params.section ?? '';

  return (
    <div className="p-6">
      <PageBlockEditor
        existing={null}
        defaultPage={defaultPage}
        defaultSection={defaultSection}
      />
    </div>
  );
}
