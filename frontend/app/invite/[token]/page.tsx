'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';

interface InviteInfo {
  inviterName: string | null;
  inviterEmail: string | null;
  proposalTitle: string | null;
  companyName: string | null;
  email: string;
  alreadyAccepted: boolean;
}

export default function AcceptInvitePage() {
  const router = useRouter();
  const params = useParams();
  const token = params.token as string;

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);

  // Fetch invite details on mount
  useEffect(() => {
    async function fetchInviteInfo() {
      try {
        const res = await fetch(`/api/invite?token=${encodeURIComponent(token)}`);
        if (res.ok) {
          const json = await res.json();
          setInviteInfo(json.data ?? null);
        }
      } catch {
        // Non-critical — form still works without invite details
      } finally {
        setLoadingInfo(false);
      }
    }
    fetchInviteInfo();
  }, [token]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (submitting) return;

      setError(null);

      if (password.length < 12) {
        setError('Password must be at least 12 characters');
        return;
      }

      if (password !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }

      setSubmitting(true);

      try {
        const res = await fetch('/api/invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, password }),
        });
        const json = await res.json();

        if (!res.ok) {
          setError(json.error || 'Failed to accept invite');
          return;
        }

        setSuccess(true);

        // Redirect to the proposal workspace after a short delay
        if (json.data?.redirectTo) {
          setTimeout(() => router.push(json.data.redirectTo), 2000);
        } else {
          setTimeout(() => router.push('/login'), 2000);
        }
      } catch {
        setError('Network error');
      } finally {
        setSubmitting(false);
      }
    },
    [token, password, confirmPassword, submitting, router],
  );

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-xl mb-4">
            &#10003;
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Invite Accepted</h1>
          <p className="text-sm text-gray-500">
            Your account has been set up. Redirecting to the proposal workspace...
          </p>
        </div>
      </div>
    );
  }

  if (inviteInfo?.alreadyAccepted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Invite Already Accepted</h1>
          <p className="text-sm text-gray-500 mb-4">
            This invitation has already been accepted. You can sign in to access the workspace.
          </p>
          <a
            href="/login"
            className="inline-block px-4 py-2 text-sm font-semibold bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            Go to Login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-gray-200 p-8">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Accept Invitation</h1>
          {loadingInfo ? (
            <p className="text-sm text-gray-400">Loading invitation details...</p>
          ) : inviteInfo ? (
            <div className="space-y-1">
              {inviteInfo.inviterName && (
                <p className="text-sm text-gray-600">
                  <span className="font-medium">{inviteInfo.inviterName}</span>
                  {inviteInfo.inviterEmail && (
                    <span className="text-gray-400"> ({inviteInfo.inviterEmail})</span>
                  )}
                  {' '}invited you to collaborate
                </p>
              )}
              {inviteInfo.proposalTitle && (
                <p className="text-sm text-gray-600">
                  Proposal: <span className="font-medium">{inviteInfo.proposalTitle}</span>
                </p>
              )}
              {inviteInfo.companyName && (
                <p className="text-sm text-gray-600">
                  Company: <span className="font-medium">{inviteInfo.companyName}</span>
                </p>
              )}
              <p className="text-xs text-gray-400 mt-2">
                Your email: {inviteInfo.email}
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              Set your password to access the proposal workspace.
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 12 characters"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-blue-400"
              required
              minLength={12}
            />
          </div>

          <div>
            <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 mb-1">
              Confirm Password
            </label>
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-blue-400"
              required
              minLength={12}
            />
          </div>

          {error && (
            <div className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Setting up...' : 'Set Password & Accept'}
          </button>
        </form>
      </div>
    </div>
  );
}
