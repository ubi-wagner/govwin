'use client';

import { signOut } from 'next-auth/react';

interface Props {
  className?: string;
  children?: React.ReactNode;
}

export function SignOutButton({ className, children }: Props) {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: '/login' })}
      className={className}
    >
      {children ?? 'Sign out'}
    </button>
  );
}
