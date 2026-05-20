import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

async function safeCount(query: Promise<{ count: number }[]>): Promise<number> {
  try {
    const [row] = await query;
    return Number(row?.count ?? 0);
  } catch (e) {
    console.error('[admin/crm/social] count query failed:', e);
    return -1;
  }
}

const PLATFORM_STYLES: Record<string, string> = {
  linkedin: 'bg-blue-100 text-blue-700',
  twitter: 'bg-sky-100 text-sky-700',
  facebook: 'bg-indigo-100 text-indigo-700',
  instagram: 'bg-pink-100 text-pink-700',
};

const POST_STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  scheduled: 'bg-yellow-100 text-yellow-700',
  posting: 'bg-blue-100 text-blue-700',
  posted: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

const ACCOUNT_STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  expired: 'bg-yellow-100 text-yellow-700',
  revoked: 'bg-red-100 text-red-700',
  disconnected: 'bg-gray-100 text-gray-500',
};

function formatDate(d: Date | null): string {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface AccountRow {
  id: string;
  platform: string;
  accountName: string;
  platformAccountId: string | null;
  status: string;
  createdAt: Date;
}

interface PostRow {
  id: string;
  postText: string;
  platform: string;
  status: string;
  accountName: string;
  scheduledAt: Date | null;
  postedAt: Date | null;
  createdAt: Date;
}

export default async function SocialPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'master_admin' && role !== 'rfp_admin') redirect('/admin');

  // Stats
  const [postsThisWeek, totalAccounts] = await Promise.all([
    safeCount(sql<{ count: number }[]>`
      SELECT COUNT(*) FROM social_posts WHERE created_at > NOW() - INTERVAL '7 days'
    `),
    safeCount(sql<{ count: number }[]>`
      SELECT COUNT(*) FROM social_accounts
    `),
  ]);

  // Connected accounts
  let accounts: AccountRow[] = [];
  try {
    accounts = await sql<AccountRow[]>`
      SELECT id, platform, account_name, platform_account_id, status, created_at
      FROM social_accounts
      ORDER BY created_at DESC
    `;
  } catch (e) {
    console.error('[admin/crm/social] accounts query failed:', e);
  }

  // Recent/scheduled posts
  let posts: PostRow[] = [];
  try {
    posts = await sql<PostRow[]>`
      SELECT sp.id, sp.post_text, sp.platform, sp.status,
             sa.account_name, sp.scheduled_at, sp.posted_at, sp.created_at
      FROM social_posts sp
      JOIN social_accounts sa ON sa.id = sp.social_account_id
      ORDER BY COALESCE(sp.scheduled_at, sp.created_at) DESC
      LIMIT 30
    `;
  } catch (e) {
    console.error('[admin/crm/social] posts query failed:', e);
  }

  const formatVal = (v: number) => (v === -1 ? 'N/A' : v.toLocaleString());

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Social Media</h1>
        <p className="text-sm text-gray-500 mt-1">Connected accounts and post management</p>
      </header>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        <StatCard label="Posts This Week" value={formatVal(postsThisWeek)} />
        <StatCard label="Connected Accounts" value={formatVal(totalAccounts)} />
        <StatCard label="Total Posts" value={formatVal(posts.length)} />
      </div>

      {/* Connected accounts */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Connected Accounts</h2>
        {accounts.length === 0 ? (
          <p className="text-sm text-gray-400 py-4">No social accounts connected.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Platform</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Account Name</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Platform ID</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Connected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {accounts.map((acct) => (
                  <tr key={acct.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PLATFORM_STYLES[acct.platform] ?? 'bg-gray-100 text-gray-600'}`}>
                        {acct.platform}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 font-medium">
                      {acct.accountName}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 font-mono">
                      {acct.platformAccountId ?? '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${ACCOUNT_STATUS_STYLES[acct.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {acct.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {formatDate(acct.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Social posts */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Recent &amp; Scheduled Posts</h2>
        {posts.length === 0 ? (
          <p className="text-sm text-gray-400 py-4">No social posts found.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Post</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Platform</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Account</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Scheduled</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Posted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {posts.map((post) => (
                  <tr key={post.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700 max-w-[300px] truncate">
                      {post.postText}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PLATFORM_STYLES[post.platform] ?? 'bg-gray-100 text-gray-600'}`}>
                        {post.platform}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {post.accountName}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${POST_STATUS_STYLES[post.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {post.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {formatDate(post.scheduledAt)}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {formatDate(post.postedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <p className="text-xs text-gray-500 uppercase font-medium">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}
