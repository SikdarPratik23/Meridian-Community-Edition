import { useMemo } from 'react';
import { useAtlasStore } from '../../store/atlas';
import Presence from '../../components/ui/Presence';
import { useFrozen } from '../../hooks/useFrozen';
import type { AnyEvent } from '../../types';

/**
 * "On this day" — past entries (earlier years) that share today's month + day.
 * Renders nothing when there are none. Used both in the desktop insights rail
 * and on the phone welcome screen.
 */
export default function OnThisDay({ className = '' }: { className?: string }) {
  const events = useAtlasStore((s) => s.events);
  const selectEvent = useAtlasStore((s) => s.selectEvent);

  const nowYear = new Date().getFullYear();
  const items = useMemo<AnyEvent[]>(() => {
    const now = new Date();
    const m = now.getMonth();
    const d = now.getDate();
    return events
      .filter((e) => {
        const t = new Date(e.timestamp);
        return t.getMonth() === m && t.getDate() === d && t.getFullYear() < now.getFullYear();
      })
      .slice(0, 3);
  }, [events]);

  // Freeze the last non-empty snapshot so a Presence exit has memories to fade
  // out with, rather than snapping to an empty list mid-fade.
  const display = useFrozen(items, items.length > 0);

  // "1 year ago" / "3 years ago" — the heart of the nudge.
  const yearsAgo = (ts: string) => {
    const n = nowYear - new Date(ts).getFullYear();
    return n === 1 ? '1 year ago' : `${n} years ago`;
  };

  return (
    <Presence when={items.length > 0} exitMs={200} enterClassName="animate-card-in" exitClassName="mo-fade-out" className={className}>
      <div className="rounded-lg border border-terracotta/40 bg-terracotta/5 p-3">
        <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-terracotta">
          <span className="animate-floaty">✨</span> On this day
        </h3>
        <div className="space-y-1.5">
          {display.map((e) => (
            <button
              key={e.id}
              onClick={() => selectEvent(e)}
              className="block w-full rounded-md border border-water bg-surface px-3 py-2 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-terracotta/60 hover:shadow-md active:scale-[0.99]"
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium">{e.title}</span>
                <span className="shrink-0 text-[10px] font-semibold text-terracotta">{yearsAgo(e.timestamp)}</span>
              </span>
              <span className="block text-xs text-ink/55">
                {new Date(e.timestamp).getFullYear()}
                {e.location_name ? ` · ${e.location_name}` : ''}
              </span>
            </button>
          ))}
        </div>
      </div>
    </Presence>
  );
}
