import { useEffect, useState } from 'react';
import { useAtlasStore } from '../../store/atlas';
import { useSettings } from '../../store/settings';
import { pickFresh } from '../../utils/pickFresh';
import { PROMPTS } from './prompts';
import { nearbyPlacesOfInterest, placeSummary, type NearbyInfo, type NearbyPlace } from './locationInfo';
import { SkeletonBlock, SkeletonLine } from '../../components/ui/Skeleton';
import { focusMode, type FocusMode } from './focusMode';

type Mode = FocusMode;

// How far out we gather the rotation pool. The list comes back nearest-first, so
// cycling through it walks outward from the closest place to the ~4 km edge and
// then wraps back to the start — a continuous loop with no dead end. (The pace is
// user-configurable — see the `focusRotateSec` setting.)
const POOL_RADIUS_M = 4_000;

/**
 * The welcome screen's single focal point — one large card instead of several
 * competing equal ones. It shows either today's writing prompt (with a one-tap
 * "write about this") or a notable place near you (Wikipedia blurb + thumbnail),
 * and you can flip between them.
 *
 * **Defaults to the prompt** (changed 2026-08-05 at the user's request: "keep the
 * prompt as default and places to be the option… that makes the welcome page much
 * more clean"). The place card leads with a photo, which made opening the app a
 * picture of somewhere else rather than an invitation to write — and writing is
 * what the app is for. Places are one tap away on the toggle. Falls through to
 * place mode when the prompt is switched off in Settings.
 *
 * In place mode the card auto-rotates through nearby places (nearest-first, out
 * to ~4 km) every ~12 s, looping back to the start once it reaches the end.
 * Summaries are cached per title (in the `summaries` map) so re-looping is
 * instant and offline-friendly.
 *
 * Fully self-pruning: renders nothing when neither a prompt (setting off) nor a
 * place (offline / no coords / nothing found) is available.
 */
export default function DailyFocus({ className = '' }: { className?: string }) {
  const coords = useAtlasStore((s) => s.coords);
  const startComposing = useAtlasStore((s) => s.startComposing);
  const onlineLookups = useSettings((s) => s.onlineLookups);
  const showPrompt = useSettings((s) => s.showPrompt);
  const focusRotateSec = useSettings((s) => s.focusRotateSec);

  const [prompt, setPrompt] = useState(() => pickFresh('focus-prompt', PROMPTS) ?? PROMPTS[0]);
  // null = pool not loaded yet (or no location); [] = loaded but nothing nearby.
  const [places, setPlaces] = useState<NearbyPlace[] | null>(null);
  const [idx, setIdx] = useState(0); // which place in the pool is featured
  const [summaries, setSummaries] = useState<Record<string, NearbyInfo>>({}); // title → hydrated blurb
  const [preferred, setPreferred] = useState<Mode | null>(null); // explicit user toggle

  const canPlace = !!coords && onlineLookups;

  // Gather the rotation pool (nearest-first, out to ~4 km) whenever the location
  // or online-lookups setting changes. `nearbyPlacesOfInterest` fails soft to an
  // empty array, so `places` only stays null while genuinely still loading.
  useEffect(() => {
    if (!coords || !onlineLookups) return;
    const ctrl = new AbortController();
    nearbyPlacesOfInterest(coords.lat, coords.lon, POOL_RADIUS_M, ctrl.signal)
      .then((list) => { setPlaces(list); setIdx(0); })
      .catch(() => {});
    return () => ctrl.abort();
  }, [coords?.lat, coords?.lon, onlineLookups]); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = places && places.length ? places[idx % places.length] : null;
  const place = cur ? summaries[cur.title] ?? null : null;

  // Hydrate the featured place's summary (blurb + thumbnail) on demand, once per
  // title — cached in `summaries` so wrapping back around costs no network.
  useEffect(() => {
    if (!cur || summaries[cur.title]) return;
    const ctrl = new AbortController();
    placeSummary(cur.title, ctrl.signal)
      .then((info) => { if (info) setSummaries((prev) => ({ ...prev, [cur.title]: info })); })
      .catch(() => {});
    return () => ctrl.abort();
  }, [cur, summaries]);

  const canShowPlace = canPlace && !!places && places.length > 0;
  const canShowPrompt = showPrompt;

  // Honour the user's toggle when that side is available; otherwise show the
  // prompt, falling back to a nearby place only when the prompt is switched off.
  const mode: Mode = focusMode(preferred, canShowPrompt, canShowPlace);
  const bothAvailable = canShowPrompt && canShowPlace;

  // Auto-advance the featured place on a timer while in place mode. Wrapping the
  // index with modulo is what "rolls back to the beginning" at the end of the
  // pool. Pauses when the tab is hidden so we don't churn in the background.
  const poolSize = places?.length ?? 0;
  const rotateMs = Math.max(5, Math.min(120, focusRotateSec || 30)) * 1000;
  useEffect(() => {
    if (mode !== 'place' || poolSize <= 1) return;
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      setIdx((i) => (i + 1) % poolSize);
    }, rotateMs);
    return () => clearInterval(id);
  }, [mode, poolSize, rotateMs]);

  if (!canShowPrompt && !canShowPlace) {
    // The pool may still be loading — hold the space with a skeleton; otherwise
    // there's genuinely nothing to feature, so render nothing.
    if (canPlace && places === null) {
      return (
        <div className={`welcome-card-land rounded-xl border border-water p-4 animate-card-in ${className}`}>
          <SkeletonBlock height="8rem" />
          <div className="mt-3 space-y-2">
            <SkeletonLine width="50%" />
            <SkeletonLine width="80%" />
          </div>
        </div>
      );
    }
    return null;
  }

  const reshuffle = () => {
    if (mode === 'prompt') setPrompt(pickFresh('focus-prompt', PROMPTS) ?? PROMPTS[0]);
    else if (poolSize) setIdx((i) => (i + 1) % poolSize);
  };

  return (
    <div className={`welcome-card-land select-none cursor-default rounded-xl border border-water p-4 animate-card-in ${className}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink/55">Today's focus</span>
        <div className="flex items-center gap-1.5">
          {/* Default side first, so the toggle reads in the same order the card
              falls back through. */}
          {bothAvailable && (
            <div className="flex rounded-full border border-water p-0.5 text-[10px] font-medium">
              <button
                onClick={() => setPreferred('prompt')}
                className={`rounded-full px-2 py-0.5 cursor-pointer pointer-events-auto transition-colors ${mode === 'prompt' ? 'bg-terracotta text-white' : 'text-ink/55 hover:text-ink'}`}
              >
                Prompt
              </button>
              <button
                onClick={() => setPreferred('place')}
                className={`rounded-full px-2 py-0.5 cursor-pointer pointer-events-auto transition-colors ${mode === 'place' ? 'bg-terracotta text-white' : 'text-ink/55 hover:text-ink'}`}
              >
                Place
              </button>
            </div>
          )}
          <button
            onClick={reshuffle}
            className="icon-spin text-ink/40 hover:text-terracotta text-sm leading-none cursor-pointer pointer-events-auto"
            title={mode === 'prompt' ? 'Another prompt' : 'Another place'}
            aria-label={mode === 'prompt' ? 'Show another prompt' : 'Show another place'}
          >
            ↻
          </button>
        </div>
      </div>

      {mode === 'place' ? (
        place ? (
          // Keyed on the title so React remounts the block on each rotation,
          // replaying the fade+slide-in for a smooth "sliding window" swap.
          <div key={place.title} className="animate-focus-swap">
            {place.thumbnail && (
              <img
                src={place.thumbnail}
                alt=""
                loading="lazy"
                className="mb-3 h-36 w-full rounded-lg object-cover"
              />
            )}
            <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-terracotta">Nearby · worth a look</div>
            <h3 className="font-serif text-lg font-bold leading-tight text-ink/90">{place.title}</h3>
            {place.extract && <p className="mt-1 text-sm leading-relaxed text-ink/65">{place.extract}</p>}
            <a
              href={place.url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-xs font-medium text-terracotta hover:underline cursor-pointer pointer-events-auto"
            >
              Read on Wikipedia ↗
            </a>
          </div>
        ) : (
          // The pool is ready but this place's summary is still loading.
          <div>
            <SkeletonBlock height="8rem" />
            <div className="mt-3 space-y-2">
              <SkeletonLine width="50%" />
              <SkeletonLine width="80%" />
            </div>
          </div>
        )
      ) : (
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-terracotta">Today's prompt</div>
          <p className="font-serif text-lg italic leading-relaxed text-ink/80">{prompt}</p>
          <button onClick={() => startComposing('journal')} className="btn btn-primary btn-sm mt-3 cursor-pointer pointer-events-auto">
            ✍ Write about this
          </button>
        </div>
      )}
    </div>
  );
}
