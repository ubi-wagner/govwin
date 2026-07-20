'use client';

import { signOut } from 'next-auth/react';

interface Props {
  className?: string;
  children?: React.ReactNode;
}

/**
 * SignOutButton — clears the NextAuth session. The active-membership pin lives in
 * the JWT (singular-session enforcement), so signing out drops it too: a fresh login
 * starts unpinned and can pick a different company. See
 * docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md.
 */
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
