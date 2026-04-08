'use client';

import { useState, type FormEvent } from 'react';
import { signOut } from 'next-auth/react';

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 12) {
      setError('New password must be at least 12 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        let msg = 'Failed to change password.';
        try {
          const data = (await res.json()) as { error?: string };
          if (data?.error) msg = data.error;
        } catch {
          // fall through with generic message
        }
        setError(msg);
        return;
      }
      // Password change succeeded. The DB now has temp_password=false,
      // but our JWT cookie still has tempPassword=true from the
      // original sign-in — NextAuth issues stateless JWTs and the
      // route handler has no way to update the existing token. If we
      // simply navigate somewhere else, middleware will see the stale
      // tempPassword=true and force-redirect us right back here, and
      // we'll be stuck in a redirect loop with a form that can no
      // longer succeed (because the current password is now the new
      // password and the backend rejects "new matches current").
      //
      // Fix: drop the JWT entirely by signing out, then push to
      // /login?justChanged=1 so the user re-authenticates with the
      // new password and gets a fresh JWT with tempPassword=false.
      // signOut with redirect=false prevents NextAuth from doing its
      // own redirect; we handle navigation ourselves via full reload
      // so the new cookie state is guaranteed to be picked up.
      await signOut({ redirect: false });
      window.location.assign('/login?justChanged=1');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? (
        <div
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}
      <div>
        <label htmlFor="current" className="block text-sm font-medium text-gray-700">
          Current password
        </label>
        <input
          id="current"
          type="password"
          required
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
      <div>
        <label htmlFor="new" className="block text-sm font-medium text-gray-700">
          New password
        </label>
        <input
          id="new"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
      <div>
        <label htmlFor="confirm" className="block text-sm font-medium text-gray-700">
          Confirm new password
        </label>
        <input
          id="confirm"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
      >
        {loading ? 'Saving…' : 'Change password'}
      </button>
    </form>
  );
}
