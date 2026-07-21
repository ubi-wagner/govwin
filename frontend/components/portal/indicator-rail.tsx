'use client';

/**
 * IndicatorRail — the cockpit's right-hand strip of live-count indicators.
 * Each tile opens a right <Drawer> with that domain as sortable cards. The tile
 * set is grant-adaptive (the parent only passes indicators the user may see),
 * so a base drafter sees ToDos/Library/Activity and a BD-granted user (or a
 * descended shadow admin) also sees Opportunities/Buckets.
 */

export interface Indicator {
  key: string;
  icon: string;
  label: string;
  count?: number | null;
}

export function IndicatorRail({
  indicators,
  activeKey,
  onSelect,
}: {
  indicators: Indicator[];
  activeKey: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="w-[92px] shrink-0 flex flex-col gap-2">
      {indicators.map((it) => (
        <button
          key={it.key}
          onClick={() => onSelect(it.key)}
          aria-pressed={activeKey === it.key}
          className={`relative rounded-xl border p-2.5 text-center transition-colors ${
            activeKey === it.key
              ? 'border-indigo-400 bg-indigo-50'
              : 'border-gray-200 bg-white hover:bg-gray-50'
          }`}
        >
          {typeof it.count === 'number' && it.count > 0 && (
            <span className="absolute top-1 right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center">
              {it.count > 99 ? '99+' : it.count}
            </span>
          )}
          <div className="text-xl leading-none" aria-hidden>{it.icon}</div>
          <div className="text-[10px] text-gray-600 mt-1 leading-tight">{it.label}</div>
        </button>
      ))}
    </div>
  );
}
