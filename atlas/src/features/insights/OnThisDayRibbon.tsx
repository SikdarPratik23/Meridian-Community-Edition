import { useMemo } from 'react';
import { useAtlasStore } from '../../store/atlas';
import type { AnyEvent } from '../../types';

/** Integer day number for a date (local), so consecutive days differ by 1. */
function dayOrdinal(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

/**
 * "On this day" as a slim horizontal ribbon rather than a boxy stat list — a
 * little story of where you were on past versions of today, plus your current
 * streak. Each memory is a chip you can tap to reopen the entry. Renders nothing
 * when there's no streak and no past-year entry for today.
 */
export default function OnThisDayRibbon({ className = '' }: { className?: string }) {
  const events = useAtlasStore((s) => s.events);
  const selectEvent = useAtlasStore((s) => s.selectEvent);

  const memories = useMemo<AnyEvent[]>(() => {
    const now = new Date();
    const m = now.getMonth();
    const d = now.getDate();
    const y = now.getFullYear();
    return events
      .filter((e) => {
        const t = new Date(e.timestamp);
        return t.getMonth() === m && t.getDate() === d && t.getFullYear() < y;
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [events]);

  const streak = useMemo(() => {
    const days = new Set<number>();
    for (const e of events) days.add(dayOrdinal(new Date(e.timestamp)));
    const today = dayOrdinal(new Date());
    let cur = 0;
    let cursor = days.has(today) ? today : days.has(today - 1) ? today - 1 : null;
    while (cursor !== null && days.has(cursor)) { cur++; cursor--; }
    return cur;
  }, [events]);

  if (memories.length === 0 && streak === 0) return null;

  const thisYear = new Date().getFullYear();
  const yearsAgo = (ts: string) => {
    const n = thisYear - new Date(ts).getFullYear();
    return n <= 0 ? 'today' : n === 1 ? '1 year ago' : `${n} years ago`;
  };

  return (
    <div className={`animate-card-in rounded-lg border border-terracotta/30 bg-terracotta/5 px-3 py-2 ${className}`}>
      <div className="flex items-center gap-2">
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-terracotta">
          <span className="animate-floaty">✨</span> On this day
        </span>
        {streak > 0 && (
          <span className="shrink-0 text-[11px] font-semibold text-terracotta" title="Current journaling streak">
            <span className="animate-flame">🔥</span> {streak}-day streak
          </span>
        )}
        <span className="ml-auto shrink-0 text-[10px] text-ink/35">
          {memories.length > 0
            ? `${memories.length} past ${memories.length === 1 ? 'entry' : 'entries'}`
            : 'keep it going'}
        </span>
      </div>

      {memories.length > 0 && (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {memories.map((e) => (
            <button
              key={e.id}
              onClick={() => selectEvent(e)}
              className="group w-40 shrink-0 rounded-md border border-water bg-surface px-2.5 py-1.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-terracotta/60 hover:shadow-md active:scale-[0.99]"
              title={e.title}
            >
              <span className="block text-[10px] font-semibold text-terracotta">
                {yearsAgo(e.timestamp)} · {new Date(e.timestamp).getFullYear()}
              </span>
              <span className="block truncate text-xs font-medium text-ink/80">{e.title}</span>
              {e.location_name && <span className="block truncate text-[10px] text-ink/45">📍 {e.location_name}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
