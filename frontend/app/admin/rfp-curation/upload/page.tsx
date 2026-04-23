import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { UploadForm } from '@/components/rfp-curation/upload-form';

export const metadata = {
  title: 'Upload RFP — Admin',
};

export default async function Page() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') redirect('/admin/dashboard');

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <a
          href="/admin/rfp-curation"
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          &larr; Back to Triage Queue
        </a>
        <h1 className="mt-2 text-2xl font-bold">Upload RFP</h1>
        <p className="mt-1 text-sm text-gray-500">
          Upload one or more documents for a solicitation. The first PDF becomes
          the source document; additional files are stored as attachments
          (amendments, Q&amp;A, templates). The shredder will extract text and
          the AI will pre-analyze compliance — then you curate.
        </p>
      </div>
      <UploadForm />
    </div>
  );
}
