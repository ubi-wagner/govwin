import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import AdminFileManager from '@/components/admin/admin-file-manager';

export default async function AdminStoragePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'master_admin' && role !== 'rfp_admin') {
    redirect('/admin');
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Storage Manager</h1>
        <p className="text-gray-500 mt-1">
          Manage operational files in the rfp-admin storage prefix.
        </p>
      </div>
      <AdminFileManager />
    </div>
  );
}
