import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { DocumentListClient } from './document-list-client';

export const dynamic = 'force-dynamic';

export default async function DocumentsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') redirect('/login');

  return (
    <div className="max-w-6xl mx-auto">
      <DocumentListClient />
    </div>
  );
}
