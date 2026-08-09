import { useEffect } from 'react';
import { useAtlasStore } from '../../store/atlas';
import { useSettings } from '../../store/settings';
import { nearbyPlacesOfInterest } from './locationInfo';

/**
 * Fetches the nearby places-of-interest list and publishes it to the store
 * (`nearbyPois`) so BOTH the welcome "Places of interest" card and the map's
 * pins can read the same data.
 *
 * This deliberately lives at the app root — NOT inside the welcome card — so
 * hiding that card never removes the pins from the map. The card's visibility
 * and the map pins (`showPoiPins`) are independent switches; the map decides on
 * its own whether to render the pins (see Map.tsx). We only fetch when there's
 * an actual consumer: online lookups on + a known location + (map pins enabled
 * OR the welcome card is currently shown). Fails soft to null.
 */
export function useNearbyPois() {
  const coords = useAtlasStore((s) => s.coords);
  const setNearbyPois = useAtlasStore((s) => s.setNearbyPois);
  const onlineLookups = useSettings((s) => s.onlineLookups);
  const showPoiPins = useSettings((s) => s.showPoiPins);
  const radiusKm = useSettings((s) => s.poiRadiusKm);
  const cardHidden = useSettings((s) => s.welcomeCardHidden);

  const cardVisible = !cardHidden.includes('poi');
  const wanted = onlineLookups && (showPoiPins || cardVisible);

  useEffect(() => {
    if (!coords || !wanted) { setNearbyPois(null); return; }
    const ctrl = new AbortController();
    nearbyPlacesOfInterest(coords.lat, coords.lon, radiusKm * 1000, ctrl.signal)
      .then((p) => setNearbyPois(p))
      .catch(() => {});
    return () => ctrl.abort();
  }, [coords?.lat, coords?.lon, wanted, radiusKm, setNearbyPois]); // eslint-disable-line react-hooks/exhaustive-deps
}
