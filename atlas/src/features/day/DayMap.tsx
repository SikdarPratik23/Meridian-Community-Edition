import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature } from 'geojson';
import type { AnyEvent } from '../../types';
import { useSettings } from '../../store/settings';
import { isDarkTheme, mapStyleFor } from '../map/mapStyle';

const ROUTE_SOURCE = 'day-route';
const ROUTE_LAYER = 'day-route-line';

/**
 * A compact, read-only map of a single day's located entries, in the order they
 * happened: numbered pins joined by a dashed route line, framed to fit them all.
 * Self-contained (its own maplibre instance) so it never fights the main map's
 * camera. `events` must already be the day's located entries in time order.
 */
export default function DayMap({ events, onSelect }: { events: AnyEvent[]; onSelect: (e: AnyEvent) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Create the map once. Camera/markers are filled in by the draw effect below.
  useEffect(() => {
    if (!container.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      // Same basemap choice as the main map (see features/map/mapStyle.ts). Read
      // at mount only — this map is short-lived, so it doesn't restyle in place.
      style: mapStyleFor(useSettings.getState().mapStyle, isDarkTheme()),
      center: [0, 0],
      zoom: 1,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    mapRef.current = map;
    map.on('load', () => setLoaded(true));

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container.current);
    return () => {
      ro.disconnect();
      markersRef.current.forEach((m) => m.remove());
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // (Re)draw numbered markers, the route line, and the framing whenever the day's
  // entries change. `onSelect` is a stable store action, safe in the dep list.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = events.map((event, i) => {
      const el = document.createElement('div');
      el.className =
        'flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-terracotta text-[11px] font-bold text-white shadow-md cursor-pointer transition-transform hover:scale-110';
      el.textContent = String(i + 1);
      el.title = event.title;
      el.addEventListener('click', () => onSelect(event));
      return new maplibregl.Marker({ element: el }).setLngLat([event.longitude, event.latitude]).addTo(map);
    });

    const data: Feature = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: events.map((e) => [e.longitude, e.latitude]) },
      properties: {},
    };
    const src = map.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(data);
    } else {
      map.addSource(ROUTE_SOURCE, { type: 'geojson', data });
      map.addLayer({
        id: ROUTE_LAYER,
        type: 'line',
        source: ROUTE_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#C05A45', 'line-width': 2.5, 'line-opacity': 0.75, 'line-dasharray': [2, 1.5] },
      });
    }

    if (events.length === 1) {
      map.setCenter([events[0].longitude, events[0].latitude]);
      map.setZoom(15);
    } else if (events.length > 1) {
      const bounds = new maplibregl.LngLatBounds();
      events.forEach((e) => bounds.extend([e.longitude, e.latitude]));
      map.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: 0 });
    }
  }, [events, loaded, onSelect]);

  return <div ref={container} className="h-full w-full" />;
}
