import { useRef, useState } from 'react';
import { useSettings } from '../../store/settings';
import { reconcileOrder, WELCOME_CARD_META, type WelcomeCardId } from '../welcome/cards';

/**
 * Reorder + show/hide the welcome-screen cards. Order and hidden-set live in the
 * settings store (`welcomeCardOrder` / `welcomeCardHidden`) and persist per
 * device; the welcome screen renders straight from them.
 *
 * Two ways to reorder, because this is used mostly on a phone:
 *   • Drag the ≡ handle — pointer-based (works with touch AND mouse), swapping
 *     with a neighbour as you cross its midpoint. `touch-action: none` on the
 *     handle stops the page scrolling mid-drag.
 *   • ▲ / ▼ buttons — a guaranteed, accessible fallback that never depends on a
 *     drag gesture landing right.
 * The 👁 toggle hides/shows a card without losing its place in the order.
 */
export default function WelcomeCardsSettings() {
  const order = useSettings((s) => s.welcomeCardOrder);
  const hidden = useSettings((s) => s.welcomeCardHidden);
  const update = useSettings((s) => s.update);

  const full = reconcileOrder(order);
  const hiddenSet = new Set(hidden);

  // A working copy exists only during a drag; otherwise we render `full`.
  const [working, setWorking] = useState<WelcomeCardId[] | null>(null);
  const [dragId, setDragId] = useState<WelcomeCardId | null>(null);
  const rowRefs = useRef<Map<WelcomeCardId, HTMLElement>>(new Map());
  const shown = working ?? full;

  const move = (id: WelcomeCardId, dir: -1 | 1) => {
    const i = full.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= full.length) return;
    const next = [...full];
    [next[i], next[j]] = [next[j], next[i]];
    update('welcomeCardOrder', next);
  };

  const toggleHidden = (id: WelcomeCardId) => {
    const set = new Set(hiddenSet);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    update('welcomeCardHidden', [...set]);
  };

  const onDown = (id: WelcomeCardId) => (e: React.PointerEvent) => {
    e.preventDefault();
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    setWorking([...full]);
    setDragId(id);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragId || !working) return;
    const idx = working.indexOf(dragId);
    const y = e.clientY;
    const prev = idx > 0 ? working[idx - 1] : null;
    const next = idx < working.length - 1 ? working[idx + 1] : null;
    // Swap up when the pointer rises past the previous row's midpoint…
    if (prev) {
      const r = rowRefs.current.get(prev)?.getBoundingClientRect();
      if (r && y < r.top + r.height / 2) {
        const w = [...working];
        [w[idx - 1], w[idx]] = [w[idx], w[idx - 1]];
        setWorking(w);
        return;
      }
    }
    // …and down when it drops past the next row's midpoint.
    if (next) {
      const r = rowRefs.current.get(next)?.getBoundingClientRect();
      if (r && y > r.top + r.height / 2) {
        const w = [...working];
        [w[idx + 1], w[idx]] = [w[idx], w[idx + 1]];
        setWorking(w);
      }
    }
  };
  const onUp = (e: React.PointerEvent) => {
    if (working) update('welcomeCardOrder', working);
    setWorking(null);
    setDragId(null);
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  return (
    <div className="space-y-2">
      <ul className="space-y-1.5 select-none">
        {shown.map((id, i) => {
          const meta = WELCOME_CARD_META[id];
          const isHidden = hiddenSet.has(id);
          const dragging = dragId === id;
          return (
            <li
              key={id}
              ref={(el) => {
                if (el) rowRefs.current.set(id, el);
                else rowRefs.current.delete(id);
              }}
              className={`flex items-center gap-1.5 rounded border bg-surface px-2 py-1.5 transition-shadow ${
                dragging ? 'border-terracotta/60 shadow-md' : 'border-water'
              } ${isHidden ? 'opacity-45' : ''}`}
            >
              <button
                type="button"
                onPointerDown={onDown(id)}
                onPointerMove={onMove}
                onPointerUp={onUp}
                className="cursor-grab touch-none px-1 text-ink/40 hover:text-ink active:cursor-grabbing"
                title="Drag to reorder"
                aria-label={`Drag ${meta.label} to reorder`}
              >
                ≡
              </button>
              <span className="min-w-0 flex-1 truncate text-sm text-ink/80" title={meta.hint}>
                {meta.label}
                {meta.online && <span className="ml-1 text-[10px] text-ink/35">· online</span>}
              </span>
              <button
                type="button"
                onClick={() => move(id, -1)}
                disabled={i === 0}
                className="px-1 text-ink/40 hover:text-ink disabled:opacity-25"
                title="Move up"
                aria-label={`Move ${meta.label} up`}
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => move(id, 1)}
                disabled={i === shown.length - 1}
                className="px-1 text-ink/40 hover:text-ink disabled:opacity-25"
                title="Move down"
                aria-label={`Move ${meta.label} down`}
              >
                ▼
              </button>
              <button
                type="button"
                onClick={() => toggleHidden(id)}
                className="px-1 text-sm leading-none"
                title={isHidden ? 'Show this card' : 'Hide this card'}
                aria-label={isHidden ? `Show ${meta.label}` : `Hide ${meta.label}`}
                aria-pressed={!isHidden}
              >
                {isHidden ? '🚫' : '👁'}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
