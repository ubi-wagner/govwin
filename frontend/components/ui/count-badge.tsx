/**
 * CountBadge — the small "unread email" count pill, extracted from IndicatorRail
 * (components/portal/indicator-rail.tsx) so it can badge Command Center tab labels.
 * Pure + server-safe (no client hooks); renders nothing when n <= 0; caps at 99+.
 */
export function CountBadge({ n, tone = 'default' }: { n: number; tone?: 'action' | 'shadow' | 'default' }) {
  if (!n || n <= 0) return null;
  const bg = tone === 'action' ? 'bg-amber-500' : tone === 'shadow' ? 'bg-violet-600' : 'bg-gray-400';
  return (
    <span
      className={`ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full ${bg} text-white text-[10px] font-bold`}
      aria-label={`${n} pending`}
    >
      {n > 99 ? '99+' : n}
    </span>
  );
}
