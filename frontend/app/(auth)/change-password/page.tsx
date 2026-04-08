import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ChangePasswordForm } from '@/components/auth/change-password-form';

export default async function ChangePasswordPage() {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }
  const tempPassword =
    (session.user as { tempPassword?: boolean }).tempPassword === true;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white border border-gray-200 rounded-lg shadow-sm p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Change password</h1>
        <p className="text-sm text-gray-500 mb-6">
          {tempPassword
            ? 'You must set a new password before continuing.'
            : 'Choose a new password for your account.'}
        </p>
        <ChangePasswordForm />
      </div>
    </div>
  );
}
