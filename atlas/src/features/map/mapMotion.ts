/**
 * Pure geometry/threshold helpers behind Map.tsx's Wave 6 motion (MOTION_PLAN.md
 * M31, M37). Kept in their own module — not exported from Map.tsx itself —
 * because Map.tsx imports `maplibre-gl`, which self-executes a
 * `window.URL.createObjectURL` worker-setup call at module scope; jsdom (this
 * project's unit-test environment) doesn't implement that, so importing
 * anything from Map.tsx, even a pure named export, crashes the test file
 * before a single assertion runs. A plain `.ts` module with no such import has
 * no such problem.
 */
import { haversineKm } from '../../utils';

/**
 * M31: the route line "draws itself" — this returns the prefix of `coords`
 * reached after travelling fraction `p` (0–1) of the FULL route's geodesic
 * length, ending with a linearly-interpolated cut point on the segment `p`
 * lands in. Cutting by length (not by vertex count) is what makes the draw
 * read at a constant apparent speed regardless of how unevenly the entries
 * are spaced along the route.
 */
export function partialLine(coords: [number, number][], p: number): [number, number][] {
  if (coords.length < 2 || p >= 1) return coords;
  if (p <= 0) return [coords[0]];
  const segLengths: number[] = [];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = haversineKm(coords[i - 1], coords[i]);
    segLengths.push(d);
    total += d;
  }
  if (total === 0) return coords; // every point coincides — nothing to draw toward
  const target = total * p;
  const result: [number, number][] = [coords[0]];
  let acc = 0;
  for (let i = 0; i < segLengths.length; i++) {
    const segLen = segLengths[i];
    if (acc + segLen >= target) {
      const segP = segLen === 0 ? 0 : (target - acc) / segLen;
      const [lon1, lat1] = coords[i];
      const [lon2, lat2] = coords[i + 1];
      result.push([lon1 + (lon2 - lon1) * segP, lat1 + (lat2 - lat1) * segP]);
      return result;
    }
    acc += segLen;
    result.push(coords[i + 1]);
  }
  return coords;
}

/**
 * M37: a long flight pulls back and swoops (a higher `curve`, a touch slower);
 * a short one stays direct and snappy. `baseDuration` is each call site's own
 * existing duration (1200ms for selecting an entry / locating yourself, 800ms
 * for a dropped pin) — only lengthened for a genuinely long-haul flight, never
 * shortened, so a nearby hop never feels rushed.
 */
export function flightPlan(
  from: [number, number],
  to: [number, number],
  baseDuration: number,
): { duration: number; curve: number; speed: number } {
  const km = haversineKm(from, to);
  if (km > 500) return { duration: Math.min(4000, baseDuration + km), curve: 1.6, speed: 0.9 };
  if (km < 5) return { duration: baseDuration, curve: 1, speed: 1.6 };
  return { duration: baseDuration, curve: 1.42, speed: 1.2 };
}
