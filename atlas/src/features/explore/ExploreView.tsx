import SearchView from '../search/SearchView';
import TripsView from '../trips/TripsView';
import { useT } from '../../i18n';

/**
 * Explore — the single "find and browse" destination, replacing what used to be
 * two separate tabs, Trips and Search (2026-08-08).
 *
 * Why they merged: both were views over the same journal, one browsing it by
 * journey and one querying it, and on a phone the 🔍 Search tab sat directly
 * under the 🔍 command-palette button in the header — two magnifying glasses,
 * which reads as the same tool twice. Meridian now has exactly one search
 * *field* (here) and one jump-to-anything *launcher* (the palette), and they do
 * genuinely different jobs: this filters your entries by photo/location/mood/
 * trip/date and shows distances; the palette jumps straight to a known entry or
 * runs an action.
 *
 * How it's one surface rather than two stacked: the query field and its filter
 * disclosure are always at the top, and the space beneath them shows the trips
 * list until you actually search — so landing here gives you something to
 * browse, and typing turns the same pane into results. Nothing from either old
 * tab was dropped; `SearchView` and `TripsView` are unchanged apart from the
 * two small props that let them compose (`idleContent`/`autoFocus`, `embedded`).
 */
export default function ExploreView() {
  const t = useT();

  return (
    <SearchView
      // Explore is somewhere you arrive to look around, so it must not throw the
      // keyboard up on arrival the way a dedicated Search tab reasonably did.
      autoFocus={false}
      idleContent={
        <div className="space-y-2 pt-1">
          <h2 className="px-1 text-[11px] uppercase tracking-wide text-ink/40">
            {t('nav.trips')}
          </h2>
          <TripsView embedded />
        </div>
      }
    />
  );
}
