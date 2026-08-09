import { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useAtlasStore } from '../../store/atlas';
import { useSettings } from '../../store/settings';
import { formatDistance } from '../../utils';
import { isDarkTheme, mapStyleFor, vectorFallbackFor } from '../../features/map/mapStyle';
import { QUALITY_ORDER } from '../../features/welcome/quality';
import { partialLine, flightPlan } from '../../features/map/mapMotion';
import Presence from '../ui/Presence';
import IconSwap from '../ui/IconSwap';
import { useFrozen } from '../../hooks/useFrozen';
import { useEffectiveMotion } from '../../hooks/useEffectiveMotion';
import type { AnyEvent } from '../../types';
import type { StyleSpecification } from 'maplibre-gl';
import type { Feature } from 'geojson';

/**
 * The basemap. `mapStyleFor` returns satellite imagery (labelled or not), the
 * parchment vector cartography, or plain OSM raster tiles, per the user's setting
 * and the active theme — see `features/map/mapStyle.ts`. Read at call time rather
 * than held in a constant so changing the setting or the theme restyles the live map.
 */
const currentMapStyle = (): StyleSpecification =>
  mapStyleFor(useSettings.getState().mapStyle, isDarkTheme());

const eventColors: Record<string, string> = {
  journal: '#C05A45',
  place: '#8B7355',
};

// Default zoom used when focusing a single point — selecting an entry, dropping a
// location pin, or locating yourself. Read from the user's setting at call time so
// it always reflects the latest value without re-running effects. ~17 ≈ street level.
const focusZoom = () => useSettings.getState().mapZoom;

// Source/layer ids for the optional "route line" connecting located entries.
const PATH_SOURCE = 'entry-path';
const PATH_LAYER = 'entry-path-line';

// Source/layer ids for the optional density heatmap ("where I've been").
const HEAT_SOURCE = 'entry-heat';
const HEAT_LAYER = 'entry-heat-layer';

// M30: how long a removed entry marker's scale-out plays before the marker is
// actually removed — matches `--mo-fast` at full motion (same fixed-JS-timer
// convention as `ToastHost`'s `EXIT_MS`, Known Issue #20).
const MARKER_EXIT_MS = 180;
// M31: how long the route's first progressive draw-in takes.
const ROUTE_DRAW_MS = 1000;
// M33: how long a layer's opacity fade takes before its data is actually
// cleared — matches the `line-opacity-transition`/`heatmap-opacity-transition`
// paint properties set on the layers themselves.
const LAYER_FADE_MS = 400;
const PATH_OPACITY = 0.7;
const HEAT_OPACITY = 0.75;

/** Treat 0,0 (the "null island") and missing coords as "no location". */
function hasLocation(e: { longitude: number; latitude: number }): boolean {
  return !(e.longitude === 0 && e.latitude === 0);
}

/** Escape a Wikipedia title for safe interpolation into popup HTML. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function getFilteredEvents(events: AnyEvent[], filter: string): AnyEvent[] {
  if (filter === 'all') return events;
  return events.filter((e) => e.type === filter);
}

/**
 * `onSurfaceClick` — what a plain click on the basemap does. MainPane passes an
 * expand action while the map is the small corner card and nothing once it's
 * full-screen, which is what makes "just click the map" open it. Undefined leaves
 * map clicks alone entirely.
 */
export default function MapView({
  onSurfaceClick,
  settling,
}: {
  onSurfaceClick?: () => void;
  /** True while the frame is still growing from mini to full-screen (M15) —
   *  the legend/readout/locate-error hold off appearing until the grow
   *  transition on `.map-shell` (MainPane.tsx) has settled, so the chrome
   *  doesn't fly around while the frame itself is still resizing. */
  settling?: boolean;
}) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // M30: keyed by entry id, so updateMarkers can diff instead of destroying and
  // rebuilding every pin on any change (see updateMarkers' own comment).
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const poiMarkersRef = useRef<maplibregl.Marker[]>([]);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const draftMarkerRef = useRef<maplibregl.Marker | null>(null);
  const motion = useEffectiveMotion();
  const graphicsQuality = useSettings((s) => s.graphicsQuality);
  // M31: has the route line already played its progressive first-draw? Survives
  // a restyle (so switching basemaps doesn't replay it); resets when the route
  // empties out, so re-enabling it later draws again.
  const hasDrawnRouteRef = useRef(false);
  const routeDrawRafRef = useRef<number | undefined>(undefined);
  // M33: pending "clear the data" timers, fired once a layer's opacity fade
  // has actually finished rather than the instant the toggle flips.
  const pathFadeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const heatFadeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [geoAttempted, setGeoAttempted] = useState(false);
  // Set while a manual "locate me" request is in flight (drives the button state).
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  // So the readout/error fade out showing their last real value instead of
  // blanking the instant the underlying state clears.
  const lastUserLocation = useFrozen(
    userLocation ? `${userLocation[1].toFixed(4)}, ${userLocation[0].toFixed(4)}` : '',
    !!userLocation,
  );
  const lastLocateError = useFrozen(locateError ?? '', !!locateError);

  const events = useAtlasStore((s) => s.events);
  const activeFilter = useAtlasStore((s) => s.activeFilter);
  const selectEvent = useAtlasStore((s) => s.selectEvent);
  const selectedEvent = useAtlasStore((s) => s.selectedEvent);
  const draftLocation = useAtlasStore((s) => s.draftLocation);
  const pickingLocation = useAtlasStore((s) => s.pickingLocation);
  const setDraftLocation = useAtlasStore((s) => s.setDraftLocation);
  const setPickingLocation = useAtlasStore((s) => s.setPickingLocation);
  const mapCenter = useAtlasStore((s) => s.mapCenter);
  const setMapCenter = useAtlasStore((s) => s.setMapCenter);
  const setMapZoom = useAtlasStore((s) => s.setMapZoom);
  const nearbyPois = useAtlasStore((s) => s.nearbyPois);
  const showPaths = useSettings((s) => s.showPaths);
  const showHeatmap = useSettings((s) => s.showHeatmap);
  const showPoiPins = useSettings((s) => s.showPoiPins);
  const mapStyleId = useSettings((s) => s.mapStyle);
  const theme = useSettings((s) => s.theme);
  // Pins on the map are an independent switch from the welcome POI card: the list
  // may be present (for the card) yet the user has turned map pins off.
  const poisForMap = showPoiPins ? nearbyPois : null;

  const filteredEvents = useMemo(
    () => getFilteredEvents(events, activeFilter),
    [events, activeFilter]
  );

  // The `styledata` handler is registered once on mount but must always draw the
  // CURRENT events, so it reads them through a ref rather than a closed-over value.
  const filteredEventsRef = useRef(filteredEvents);
  useEffect(() => { filteredEventsRef.current = filteredEvents; });
  /** Set once the vector basemap has failed, so we fall back only once. */
  const vectorFailedRef = useRef(false);

  /**
   * M30: a keyed diff instead of the old "remove everything, rebuild everything"
   * — which flickered every pin through a remove/add cycle on ANY change to
   * `filteredEvents` (typing in the editor, a sync tick, an unrelated filter),
   * and made "new pin" indistinguishable from "existing pin" so there was
   * nothing to animate even if we wanted to. Existing pins are now left
   * untouched (only re-positioned/re-coloured in place if their event changed),
   * new ones drop in, removed ones scale out before actually leaving the map.
   *
   * The marker's ROOT element is a bare wrapper: MapLibre writes its own
   * inline `transform` onto whatever element you hand it (for positioning),
   * which would silently stomp any CSS `transform` animation on that same
   * element. The visible dot is a CHILD instead, free to animate.
   */
  const updateMarkers = useCallback((map: maplibregl.Map, evts: AnyEvent[]) => {
    const current = markersRef.current;
    const located = evts.filter(hasLocation);
    const seen = new Set(located.map((e) => e.id));

    for (const [id, marker] of current) {
      if (seen.has(id)) continue;
      if (motion === 'off') {
        marker.remove();
      } else {
        const dot = marker.getElement().firstElementChild as HTMLElement | null;
        dot?.classList.add('mo-marker-out');
        setTimeout(() => marker.remove(), MARKER_EXIT_MS);
      }
      current.delete(id);
    }

    located.forEach((event) => {
      const existing = current.get(event.id);
      if (existing) {
        existing.setLngLat([event.longitude, event.latitude]);
        const dot = existing.getElement().firstElementChild as HTMLElement | null;
        if (dot) {
          dot.style.backgroundColor = eventColors[event.type] || '#666';
          dot.title = event.title;
        }
        return;
      }

      const root = document.createElement('div');
      const dot = document.createElement('div');
      dot.className = 'w-4 h-4 rounded-full border-2 border-white cursor-pointer shadow-md transition-transform hover:scale-150';
      if (motion !== 'off') {
        dot.classList.add('mo-marker-in');
        dot.addEventListener('animationend', () => dot.classList.remove('mo-marker-in'), { once: true });
      }
      dot.style.backgroundColor = eventColors[event.type] || '#666';
      dot.title = event.title;
      root.appendChild(dot);

      const marker = new maplibregl.Marker({ element: root })
        .setLngLat([event.longitude, event.latitude])
        .addTo(map);

      // Stop the click here: it must not also reach the map, where it would be
      // read as a click on the basemap (which expands the mini map, or in pick
      // mode drops a location pin). Clicking a dot means "open this entry", only.
      dot.addEventListener('click', (ev) => { ev.stopPropagation(); selectEvent(event); });
      current.set(event.id, marker);
    });
  }, [selectEvent, motion]);

  // Places of interest (Wikipedia geosearch, published by the welcome POI card):
  // one landmark pin per place so you can see on the map where each one is. A
  // click opens a popup with its name, distance, and a link to the article.
  //
  // M35: three DOM layers deep, all in service of the same MapLibre constraint
  // `updateMarkers` works around above. `root` (bare, MapLibre-owned) wraps
  // `bobLayer` (the continuous idle bob, gated behind Graphics quality ≥
  // Medium — this is scenery, and there can be many pins), which wraps
  // `.atlas-poi-marker` itself (the one-shot arrival pulse). Two elements
  // because the bob and the pulse both need `transform`, and one element's
  // `animation` can't cleanly run two independent transforms at once.
  // This function still fully rebuilds every pin on every call (no keyed
  // diff, unlike M30's entry markers) — which is exactly why the pulse can
  // just be an unconditional entrance class: it only plays when this callback
  // actually re-runs, i.e. when a genuinely new set of places arrives.
  const updatePoiMarkers = useCallback((map: maplibregl.Map, pois: typeof nearbyPois) => {
    poiMarkersRef.current.forEach((m) => m.remove());
    poiMarkersRef.current = [];
    if (!pois) return;

    const bobEnabled = motion !== 'off' && QUALITY_ORDER.indexOf(graphicsQuality) >= QUALITY_ORDER.indexOf('medium');

    pois.forEach((poi, i) => {
      // A little map "banner": a bright-magenta flag chip that shows just its pennant when
      // collapsed and slides open to reveal the place name on hover/tap. Built
      // with the DOM API + textContent so the (external) title can't inject HTML.
      const el = document.createElement('div');
      el.className = 'atlas-poi-marker';
      if (motion !== 'off') {
        el.classList.add('mo-poi-pulse');
        el.addEventListener('animationend', () => el.classList.remove('mo-poi-pulse'), { once: true });
      }
      el.title = `${poi.title} · ${formatDistance(poi.km)}`;
      const ic = document.createElement('span');
      ic.className = 'poi-ic';
      ic.textContent = '⚑';
      const label = document.createElement('span');
      label.className = 'poi-label';
      label.textContent = poi.title;
      el.append(ic, label);

      const bobLayer = document.createElement('div');
      if (bobEnabled) {
        bobLayer.className = 'mo-poi-bob-layer';
        // Desynchronise the bob per pin — a whole map of pins breathing in
        // unison would read as one animated object instead of many small ones.
        bobLayer.style.setProperty('--poi-bob-delay', `${(i % 5) * 0.6}s`);
        bobLayer.style.setProperty('--poi-bob-dur', `${4.5 + (i % 3) * 0.7}s`);
      }
      bobLayer.appendChild(el);

      const root = document.createElement('div');
      root.appendChild(bobLayer);

      const popup = new maplibregl.Popup({ offset: 18, closeButton: false, className: 'atlas-poi-popup' })
        .setHTML(
          `<a class="poi-pop-title" href="${escapeHtml(poi.url)}" target="_blank" rel="noreferrer">${escapeHtml(poi.title)} ↗</a>` +
          `<div class="poi-pop-dist">${escapeHtml(formatDistance(poi.km))} away</div>`,
        );

      const marker = new maplibregl.Marker({ element: root, anchor: 'bottom' })
        .setLngLat([poi.lon, poi.lat])
        .setPopup(popup)
        .addTo(map);
      poiMarkersRef.current.push(marker);
    });
  }, [motion, graphicsQuality]);

  // Optional route line: connect located entries in date order, tracing your path
  // over time. Reads the live `showPaths` setting; created lazily on the map's
  // `load`. M31: the FIRST time a route appears, it draws itself progressively
  // (by length, so it reads at constant speed) before settling into the dashed
  // style — tracked by `hasDrawnRouteRef`, which survives a restyle (so toggling
  // the basemap doesn't replay the draw) but resets when the route empties out
  // (so switching it back on later draws again). M33: turning the toggle off
  // fades the line's opacity to 0 — via MapLibre's own `line-opacity-transition`,
  // not a JS animation — and only clears its data once that fade has actually
  // finished, instead of the old instant vanish.
  const updatePath = useCallback((map: maplibregl.Map, evts: AnyEvent[]) => {
    if (!map.isStyleLoaded()) return; // set up by the 'load' handler once ready
    const show = useSettings.getState().showPaths;
    const coordinates: [number, number][] = show
      ? evts
          .filter(hasLocation)
          .slice()
          .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
          .map((e) => [e.longitude, e.latitude])
      : [];

    const setLineCoords = (coords: [number, number][]) => {
      const data: Feature = { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} };
      (map.getSource(PATH_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(data);
    };

    if (routeDrawRafRef.current !== undefined) { cancelAnimationFrame(routeDrawRafRef.current); routeDrawRafRef.current = undefined; }
    if (pathFadeTimerRef.current) { clearTimeout(pathFadeTimerRef.current); pathFadeTimerRef.current = undefined; }

    if (!map.getSource(PATH_SOURCE)) {
      map.addSource(PATH_SOURCE, {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} },
      });
      map.addLayer({
        id: PATH_LAYER,
        type: 'line',
        source: PATH_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': eventColors.journal,
          'line-width': 2,
          'line-opacity': 0,
          'line-opacity-transition': { duration: LAYER_FADE_MS },
        },
      });
    }

    if (coordinates.length < 2) {
      hasDrawnRouteRef.current = false;
      map.setPaintProperty(PATH_LAYER, 'line-opacity', 0);
      pathFadeTimerRef.current = setTimeout(() => setLineCoords([]), motion === 'off' ? 0 : LAYER_FADE_MS);
      return;
    }

    if (hasDrawnRouteRef.current || motion === 'off') {
      hasDrawnRouteRef.current = true;
      setLineCoords(coordinates);
      map.setPaintProperty(PATH_LAYER, 'line-dasharray', [2, 1.5]);
      map.setPaintProperty(PATH_LAYER, 'line-opacity', PATH_OPACITY);
      return;
    }

    hasDrawnRouteRef.current = true;
    map.setPaintProperty(PATH_LAYER, 'line-opacity', PATH_OPACITY);
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ROUTE_DRAW_MS);
      setLineCoords(partialLine(coordinates, p));
      if (p < 1) {
        routeDrawRafRef.current = requestAnimationFrame(step);
      } else {
        routeDrawRafRef.current = undefined;
        map.setPaintProperty(PATH_LAYER, 'line-dasharray', [2, 1.5]);
      }
    };
    routeDrawRafRef.current = requestAnimationFrame(step);
  }, [motion]);

  // Optional density heatmap — a warm "where I've been" wash built from every
  // located entry, so a well-travelled area glows brighter than a one-off pin.
  // Reads the live `showHeatmap` setting; created lazily once the style is ready
  // (like the route line). M33: fades via `heatmap-opacity-transition` instead
  // of snapping to an empty source the instant the toggle flips.
  const updateHeat = useCallback((map: maplibregl.Map, evts: AnyEvent[]) => {
    if (!map.isStyleLoaded()) return; // the 'load' handler sets this up once ready
    const show = useSettings.getState().showHeatmap;
    const features: Feature[] = show
      ? evts.filter(hasLocation).map((e) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [e.longitude, e.latitude] },
          properties: {},
        }))
      : [];

    if (heatFadeTimerRef.current) { clearTimeout(heatFadeTimerRef.current); heatFadeTimerRef.current = undefined; }

    if (!map.getSource(HEAT_SOURCE)) {
      map.addSource(HEAT_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: HEAT_LAYER,
        type: 'heatmap',
        source: HEAT_SOURCE,
        paint: {
          'heatmap-weight': 1,
          // Grow the glow a little as you zoom in so single points stay visible.
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 12, 3],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 8, 12, 30],
          'heatmap-opacity': 0,
          'heatmap-opacity-transition': { duration: LAYER_FADE_MS },
          // Warm parchment ramp: transparent → terracotta → gold.
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)',
            0.2, 'rgba(192,90,69,0.25)',
            0.45, 'rgba(192,90,69,0.55)',
            0.7, 'rgba(212,120,80,0.75)',
            1, 'rgba(245,200,80,0.92)',
          ],
        },
      });
    }

    const src = map.getSource(HEAT_SOURCE) as maplibregl.GeoJSONSource;
    if (show && features.length > 0) {
      src.setData({ type: 'FeatureCollection', features });
      map.setPaintProperty(HEAT_LAYER, 'heatmap-opacity', HEAT_OPACITY);
    } else {
      map.setPaintProperty(HEAT_LAYER, 'heatmap-opacity', 0);
      heatFadeTimerRef.current = setTimeout(
        () => src.setData({ type: 'FeatureCollection', features: [] }),
        motion === 'off' ? 0 : LAYER_FADE_MS,
      );
    }
  }, [motion]);

  // M32: a one-shot expanding sonar ring every time a GPS fix actually lands —
  // genuinely informative (it tells you the fix just arrived), unlike the
  // permanent `pulse-dot` halo (unchanged, still the ongoing "you are here"
  // indicator). The ring is a CHILD span, never the marker root — MapLibre
  // writes its own positioning `transform` onto the root, so an animation on
  // that same element would just be overridden every frame; `pulse-dot`
  // sidesteps this by animating `box-shadow` instead, which is why it could
  // safely live on the root all along.
  const addUserMarker = useCallback((map: maplibregl.Map, lngLat: [number, number]) => {
    if (userMarkerRef.current) userMarkerRef.current.remove();

    const el = document.createElement('div');
    el.className = 'atlas-user-marker';
    el.title = 'You are here';

    if (motion !== 'off') {
      const ping = document.createElement('span');
      ping.className = 'atlas-sonar-ping';
      el.appendChild(ping);
      ping.addEventListener('animationend', () => ping.remove(), { once: true });
    }

    userMarkerRef.current = new maplibregl.Marker({ element: el })
      .setLngLat(lngLat)
      .addTo(map);
  }, [motion]);

  // Find the current position and fly there, dropping/updating the "you are here"
  // dot. Shared by the on-mount auto-locate and the manual "locate me" button.
  // `recenter` controls whether we move the camera (true for an explicit tap).
  const locate = useCallback((recenter: boolean) => {
    if (!navigator.geolocation) {
      setGeoAttempted(true);
      setLocateError('Location not available in this browser.');
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lngLat: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        setUserLocation(lngLat);
        setGeoAttempted(true);
        setLocating(false);
        const map = mapRef.current;
        if (map) {
          addUserMarker(map, lngLat);
          if (recenter) {
            const z = Math.max(map.getZoom(), focusZoom());
            const plan = flightPlan(map.getCenter().toArray() as [number, number], lngLat, 1200);
            map.flyTo({ center: lngLat, zoom: z, ...plan });
            setMapCenter(lngLat);
            setMapZoom(z);
          }
        }
      },
      (err) => {
        console.warn('Geolocation error:', err.message);
        setGeoAttempted(true);
        setLocating(false);
        setLocateError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied — enable it for this site.'
            : "Couldn't get your location. Try again.",
        );
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [addUserMarker, setMapCenter, setMapZoom]);

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: currentMapStyle(),
      center: mapCenter,
      zoom: 2,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapRef.current = map;

    // Re-add Meridian's own sources/layers whenever a style finishes loading.
    // `styledata` (not just `load`) is what makes restyling work: setStyle wipes
    // every custom source and layer, so the entry dots, route line and heatmap
    // have to be rebuilt each time the basemap changes.
    const onStyleReady = () => {
      updateMarkers(map, filteredEventsRef.current);
      updatePath(map, filteredEventsRef.current);
      updateHeat(map, filteredEventsRef.current);
      updatePoiMarkers(map, useSettings.getState().showPoiPins ? useAtlasStore.getState().nearbyPois : null);
    };
    map.on('load', onStyleReady);
    map.on('styledata', onStyleReady);

    // If the vector tiles can't load (offline, or the host is unreachable), drop
    // to whatever still draws rather than leaving an empty grey map: hybrid keeps
    // its satellite imagery and loses only its labels, anything else falls back to
    // raster OSM, which the service worker caches. See `vectorFallbackFor`.
    map.on('error', (e) => {
      const failedVectorSource =
        (e as unknown as { sourceId?: string }).sourceId === 'openmaptiles';
      if (failedVectorSource && !vectorFailedRef.current) {
        vectorFailedRef.current = true;
        const fallback = vectorFallbackFor(useSettings.getState().mapStyle);
        console.warn(`Vector basemap unavailable — falling back to "${fallback}".`);
        map.setStyle(mapStyleFor(fallback, isDarkTheme()));
      }
    });

    map.on('moveend', () => {
      const center = map.getCenter();
      setMapCenter([center.lng, center.lat]);
      setMapZoom(map.getZoom());
    });

    // Keep the canvas sized to its container as the mini-map expands/collapses.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(mapContainer.current);

    return () => {
      ro.disconnect();
      if (routeDrawRafRef.current !== undefined) cancelAnimationFrame(routeDrawRafRef.current);
      if (pathFadeTimerRef.current) clearTimeout(pathFadeTimerRef.current);
      if (heatFadeTimerRef.current) clearTimeout(heatFadeTimerRef.current);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Fly to the selected entry (also the target for future "location cues").
  // M37: a long flight pulls back and swoops; a short one stays direct.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedEvent || !hasLocation(selectedEvent)) return;
    const to: [number, number] = [selectedEvent.longitude, selectedEvent.latitude];
    const plan = flightPlan(map.getCenter().toArray() as [number, number], to, 1200);
    map.flyTo({ center: to, zoom: focusZoom(), ...plan });
  }, [selectedEvent]);

  // Draft marker: show where a new entry will be pinned, and fly there.
  // M34: the pin stays invisible (`atlas-draft-marker-pending`) until the
  // camera's `flyTo` actually settles (a `moveend` listener, not a guessed
  // delay — robust to the flight being interrupted or re-planned), then lands
  // with a small bounce and a ground ripple, rather than appearing before the
  // camera has finished arriving. M37: a long flight pulls back and swoops.
  // The marker's ROOT is a bare wrapper for the same reason `updateMarkers`'
  // entry dots are — MapLibre owns the root's `transform` for positioning, so
  // the actual visible teardrop (`.atlas-draft-marker`) has to be a child to
  // animate freely.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (draftMarkerRef.current) { draftMarkerRef.current.remove(); draftMarkerRef.current = null; }
    if (!draftLocation) return;

    const root = document.createElement('div');
    const pin = document.createElement('div');
    pin.className = 'atlas-draft-marker';
    pin.title = 'New entry location';
    const pending = motion !== 'off';
    if (pending) pin.classList.add('atlas-draft-marker-pending');
    root.appendChild(pin);

    draftMarkerRef.current = new maplibregl.Marker({ element: root, anchor: 'bottom' })
      .setLngLat(draftLocation)
      .addTo(map);

    const plan = flightPlan(map.getCenter().toArray() as [number, number], draftLocation, 800);
    map.flyTo({ center: draftLocation, zoom: Math.max(map.getZoom(), focusZoom()), ...plan });

    if (!pending) return;
    const land = () => {
      pin.classList.remove('atlas-draft-marker-pending');
      pin.classList.add('atlas-draft-marker-land');
      const ripple = document.createElement('span');
      ripple.className = 'atlas-pin-ripple';
      pin.appendChild(ripple);
      ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
    };
    map.once('moveend', land);
    return () => { map.off('moveend', land); };
  }, [draftLocation, motion]);

  /**
   * Click the map to open it. The expand button stays where it is, but on the
   * small corner card the whole surface is now the affordance too — which is what
   * you reach for instinctively.
   *
   * Registered as a MapLibre `click` rather than a transparent overlay on purpose:
   * an overlay would swallow panning, zooming and the pins underneath it, whereas
   * MapLibre only fires `click` when the pointer did NOT drag. So the mini map
   * stays fully interactive, and a drag to look around never counts as a click.
   * Skipped in pick mode, where a click means "put the pin here".
   *
   * The matching pointer cursor is CSS, not JS (`.map-clickable` in index.css):
   * MapLibre's own stylesheet puts `cursor: grab` on the canvas CONTAINER, which
   * an inline style on the canvas can't reliably beat.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !onSurfaceClick || pickingLocation) return;
    const onClick = () => onSurfaceClick();
    map.on('click', onClick);
    return () => { map.off('click', onClick); };
  }, [onSurfaceClick, pickingLocation]);

  // Pick mode: the next map click sets the draft location.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const canvas = map.getCanvas();
    if (!pickingLocation) { canvas.style.cursor = ''; return; }
    canvas.style.cursor = 'crosshair';
    const onClick = (e: maplibregl.MapMouseEvent) => {
      setDraftLocation([e.lngLat.lng, e.lngLat.lat]);
      setPickingLocation(false);
    };
    map.on('click', onClick);
    return () => { map.off('click', onClick); canvas.style.cursor = ''; };
  }, [pickingLocation, setDraftLocation, setPickingLocation]);

  // GPS: try to locate once on mount (recentering the camera on success).
  // `locate` flips loading/attempt flags synchronously; that's the intended
  // mount behaviour, so we opt out of the set-state-in-effect heuristic here.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { locate(true); }, [locate]);

  useEffect(() => {
    if (mapRef.current) {
      updateMarkers(mapRef.current, filteredEvents);
    }
  }, [filteredEvents, updateMarkers]);

  // Redraw POI pins whenever the nearby-places list changes (published by
  // useNearbyPois once coordinates + online lookups are available) or the map-pin
  // toggle flips. `poisForMap` is null when pins are switched off.
  useEffect(() => {
    if (mapRef.current) updatePoiMarkers(mapRef.current, poisForMap);
  }, [poisForMap, updatePoiMarkers]);

  // Redraw the route line when entries change or the toggle flips.
  useEffect(() => {
    if (mapRef.current) updatePath(mapRef.current, filteredEvents);
  }, [filteredEvents, showPaths, updatePath]);

  // Redraw the heatmap when entries change or its toggle flips.
  useEffect(() => {
    if (mapRef.current) updateHeat(mapRef.current, filteredEvents);
  }, [filteredEvents, showHeatmap, updateHeat]);

  /**
   * Restyle the live map when the basemap setting or the theme changes, so the
   * parchment map switches to its night palette with the rest of the app. Skipped
   * on the first run — the map was built with the right style already.
   *
   * A *theme* change is ignored while a fallback is active, so a working raster map
   * isn't swapped back for the vector source that just failed. A deliberate
   * *basemap* change always wins, though: clearing the flag lets the user retry the
   * network (and if it fails again, the error handler simply falls back again).
   *
   * `theme` is in the dependency list rather than read directly because `system`
   * resolves via the html class — the setting changing is the signal to re-read it.
   */
  const styledOnce = useRef(false);
  const appliedStyleRef = useRef(mapStyleId);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!styledOnce.current) { styledOnce.current = true; return; }
    if (appliedStyleRef.current !== mapStyleId) {
      appliedStyleRef.current = mapStyleId;
      vectorFailedRef.current = false;
    } else if (vectorFailedRef.current) {
      return;
    }
    map.setStyle(mapStyleFor(mapStyleId, isDarkTheme()));
  }, [mapStyleId, theme]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full" />
      {/* Outer div carries the absolute + `left-1/2` positioning; the enter/exit
          animation lives on the Presence wrapper INSIDE it, and the constant
          `-translate-x-1/2` centring lives on the styled div INSIDE that — split
          across three layers so Presence's `transform`-based fade never clobbers
          the static centring transform (they'd otherwise fight over the same
          CSS property on one element). */}
      <div className="absolute top-3 left-1/2 z-10">
        <Presence when={!geoAttempted} exitMs={160} enterClassName="mo-rise-in" exitClassName="mo-fade-out">
          <div className="-translate-x-1/2 px-4 py-2 bg-surface/90 backdrop-blur rounded-full shadow text-sm text-ink/70">
            Getting your location...
          </div>
        </Presence>
      </div>
      {/* Coordinate readout. Bottom tier 1, with the locate button — the layer
          toggles stack above it on a phone rather than across it (index.css). */}
      <div className="absolute bottom-[var(--map-tier-1)] left-1/2 z-10">
        <Presence when={!!userLocation && !settling} exitMs={160} enterClassName="mo-rise-in" exitClassName="mo-fade-out">
          <div className="-translate-x-1/2 px-3 py-1.5 bg-surface/90 backdrop-blur rounded-full shadow text-xs text-ink/60">
            📍 {userLocation ? `${userLocation[1].toFixed(4)}, ${userLocation[0].toFixed(4)}` : lastUserLocation}
          </div>
        </Presence>
      </div>

      {/* Legend — what the markers mean. Only lists the kinds actually on the map
          right now, so it stays compact (and disappears entirely on an empty map). */}
      <Presence
        when={!settling && !!(userLocation || filteredEvents.length > 0 || (poisForMap && poisForMap.length > 0))}
        exitMs={160}
        enterClassName="mo-rise-in"
        exitClassName="mo-fade-out"
        className="absolute top-12 left-2 z-10"
      >
        <div className="space-y-1 rounded-md border border-water bg-surface/90 px-2.5 py-1.5 text-[10px] text-ink/70 shadow-sm backdrop-blur pointer-events-none">
          {userLocation && (
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full border border-white" style={{ background: '#3b82f6' }} />
              You are here
            </div>
          )}
          {filteredEvents.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full border border-white" style={{ background: eventColors.journal }} />
              Your entries
            </div>
          )}
          {poisForMap && poisForMap.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="leading-none" style={{ color: '#E5178F' }}>⚑</span>
              Places of interest
            </div>
          )}
        </div>
      </Presence>

      {/* Locate me — re-find the current position on demand and fly to it. */}
      <button
        type="button"
        onClick={() => locate(true)}
        disabled={locating}
        title={locating ? 'Finding your location…' : 'Centre on my location'}
        aria-label="Centre on my location"
        className="absolute bottom-[var(--map-tier-1)] right-3 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-water bg-surface/90 backdrop-blur shadow text-lg text-ink/70 hover:bg-land disabled:opacity-60 transition-colors"
      >
        <IconSwap className={locating ? 'animate-spin' : ''} active={locating} on="◌" off="◎" />
      </button>

      {/* Tier 3 on a phone, so the message clears the layer toggles on tier 2. */}
      <Presence
        when={!settling && !!locateError}
        exitMs={160}
        enterClassName="mo-rise-in"
        exitClassName="mo-fade-out"
        className="absolute bottom-[var(--map-tier-3)] right-3 z-10 max-w-[12rem] md:bottom-16"
      >
        <div className="px-3 py-1.5 bg-surface/95 backdrop-blur rounded shadow text-[11px] text-red-500">
          {locateError ?? lastLocateError}
        </div>
      </Presence>
    </div>
  );
}
