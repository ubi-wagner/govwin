import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { isRole, type Role } from '@/lib/rbac';
import { listVaultsForCollaborator } from '@/lib/vaults/vaults';

export const dynamic = 'force-dynamic';

/**
 * /vaults — a collaborator's list of the nooks they can reach (P8.9). Server-rendered
 * from listVaultsForCollaborator (their own vault(s) ONLY — the segregation). No create
 * action here: nooks are opened by the owner tenant; a collaborator only joins.
 */
export default async function CollaboratorVaultsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const su = session.user as { id?: string; role?: unknown; email?: string };
  const role: Role | null = isRole(su.role) ? su.role : null;
  if (!role || !su.id) redirect('/login?error=session');

  let vaults: Awaited<ReturnType<typeof listVaultsForCollaborator>> = [];
  try {
    vaults = await listVaultsForCollaborator(su.id, su.email ?? null);
  } catch (e) {
    console.error('[collaborator vaults]', e);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Your collaboration vaults</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        A <strong>nook</strong> is a private, shared workspace between you and a customer. Upload the
        content they need, and download what they share with you. You see only the nook(s) you have
        been invited to — nothing else in the customer&apos;s library.
      </p>

      {vaults.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
          You have no collaboration vaults yet. A customer will invite you into one.
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {vaults.map((v) => (
            <li key={v.id} className="rounded-lg border bg-white p-4 hover:border-gray-300">
              <Link href={`/vaults/${v.id}`} className="block">
                <div className="text-sm font-semibold text-gray-800">{v.ownerName}</div>
                <div className="mt-2 text-xs text-blue-600">Open nook →</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
