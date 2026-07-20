'use client';

/**
 * Deep-link gate — the interstitial a nudge/notification link lands on so the recipient
 * always ends up acting in the RIGHT company, auditably. Two cases:
 *  - "here": they're already signed in to the target company → a quick confirm ("You're
 *     working in X") that lands them on their task/queue on dismiss.
 *  - "switch": they're signed in to a DIFFERENT company → because a session is singular
 *     (no in-session company switch for customers/collaborators), we sign them out and
 *     send them to re-login into the target company, mirroring the shadow-admin notice.
 * See docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';

export function DeepLinkGate(props: {
  mode: 'here' | 'switch';
  toCompany: string;
  fromCompany?: string;
  dest?: string;
  reloginUrl?: string;
  taskDone?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-lg bg-white border border-gray-200 p-8 shadow-sm">
        {props.mode === 'switch' ? (
          <>
            <h1 className="text-xl font-bold text-gray-900">Switching companies</h1>
            <p className="mt-3 text-sm text-gray-600">
              You&apos;re currently signed in to <strong>{props.fromCompany}</strong>, but this link is
              for <strong>{props.toCompany}</strong>. Each company is its own sign-in, so you&apos;ll be
              signed out of {props.fromCompany} and back into {props.toCompany} — then you&apos;ll land
              right where the notification pointed you.
            </p>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                onClick={() => router.push('/portal')}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                Stay in {props.fromCompany}
              </button>
              <button
                disabled={busy}
                onClick={() => { setBusy(true); signOut({ callbackUrl: props.reloginUrl || '/login' }); }}
                className="rounded bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {busy ? 'Signing out…' : `Sign in to ${props.toCompany}`}
              </button>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold text-gray-900">You&apos;re working in {props.toCompany}</h1>
            <p className="mt-3 text-sm text-gray-600">
              {props.taskDone
                ? 'That task is already complete — nothing to do. Here is your current queue.'
                : `You're signed in as ${props.toCompany}. Continue to what the notification pointed you to.`}
            </p>
            <div className="mt-6 flex justify-end">
              <button
                disabled={busy}
                onClick={() => { setBusy(true); router.push(props.dest || `/portal`); }}
                className="rounded bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {props.taskDone ? 'Go to my queue' : 'Continue'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
