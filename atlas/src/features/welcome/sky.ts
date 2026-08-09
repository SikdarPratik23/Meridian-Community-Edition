/**
 * Where the sun is, computed entirely offline — no network, just the date, the
 * clock, and your coordinates. Drives the welcome screen's day/night cycle (sun
 * by day, moon by night, warm light at golden hour). A low-precision solar
 * position formula (NOAA / Astronomical Almanac "Approximate Solar Coordinates")
 * accurate to a few arc-minutes — far more than enough to know whether the sun
 * is up, and roughly how high.
 */

export type SkyPhase = 'day' | 'golden' | 'night';

const RAD = Math.PI / 180;
const J2000 = Date.UTC(2000, 0, 1, 12); // 2000-01-01 12:00 UTC
const DAY_MS = 86_400_000;

/** Declination + hour angle at a moment/longitude — the intermediate values
 *  shared by both `solarAltitudeDeg` (altitude alone) and `solarPositionDeg`
 *  (altitude + azimuth, added for MOTION_PLAN.md M43). Kept private so the two
 *  public functions can never drift against each other. */
function sunEquatorial(date: Date, longitude: number): { decl: number; H: number } {
  // Days (and fraction) since the J2000.0 epoch.
  const d = (date.getTime() - J2000) / DAY_MS;

  const g = (357.529 + 0.98560028 * d) * RAD;            // mean anomaly
  const q = 280.459 + 0.98564736 * d;                    // mean longitude
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD; // ecliptic longitude
  const e = (23.439 - 0.00000036 * d) * RAD;             // obliquity of the ecliptic

  const decl = Math.asin(Math.sin(e) * Math.sin(L));     // declination
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD; // right ascension (deg)

  const gmst = 280.46061837 + 360.98564736629 * d;       // Greenwich mean sidereal time (deg)
  const lst = gmst + longitude;                          // local sidereal time (deg)
  let H = (lst - ra) % 360;                              // hour angle (deg)
  H = ((H + 540) % 360) - 180;                           // normalise to -180..180

  return { decl, H };
}

/** Sun altitude above the horizon, in degrees (negative = below the horizon). */
export function solarAltitudeDeg(date: Date, latitude: number, longitude: number): number {
  const { decl, H } = sunEquatorial(date, longitude);
  const lat = latitude * RAD;
  const alt = Math.asin(
    Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H * RAD),
  );
  return alt / RAD;
}

/**
 * Sun altitude AND azimuth (compass bearing the sun sits at: 0=N, 90=E,
 * 180=S, 270=W), both in degrees. Added for MOTION_PLAN.md M43 — placing the
 * sun/moon on a real arc needs a horizontal position too, not altitude alone.
 * `altitude` here always agrees with `solarAltitudeDeg` for the same inputs
 * (both read the same shared `sunEquatorial`).
 */
export function solarPositionDeg(date: Date, latitude: number, longitude: number): { altitude: number; azimuth: number } {
  const { decl, H } = sunEquatorial(date, longitude);
  const lat = latitude * RAD;
  const Hr = H * RAD;
  const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(Hr);
  const altRad = Math.asin(sinAlt);
  const cosLat = Math.cos(lat);
  // At the poles cosLat is ~0, which would divide-by-zero the azimuth formula
  // below — azimuth is meaningless there anyway (every direction is "south"),
  // so park it at a stable 180° rather than propagate a NaN.
  let azimuth = 180;
  if (Math.abs(cosLat) > 1e-6) {
    const cosAz = (Math.sin(decl) - Math.sin(lat) * sinAlt) / (cosLat * Math.cos(altRad));
    azimuth = Math.acos(Math.min(1, Math.max(-1, cosAz))) / RAD;
    if (Math.sin(Hr) > 0) azimuth = 360 - azimuth;
  }
  return { altitude: altRad / RAD, azimuth };
}

/**
 * Turns a sun position into a small normalised on-screen offset for the arc
 * (M43): `xFrac` swings roughly -1 (near sunrise) → 0 (due south, local noon
 * in the N. hemisphere) → +1 (near sunset); `yFrac` rises 0 (horizon) → 1
 * (well overhead). Both are clamped, so a caller can multiply by whatever
 * pixel amplitude fits its own layout without this function knowing about
 * pixels at all. Not astronomically exact (a real arc's shape also depends on
 * latitude/season) — a deliberately simple, monotonic approximation, which is
 * all a few-pixel decorative drift needs.
 */
export function sunArcOffset(altitudeDeg: number, azimuthDeg: number): { xFrac: number; yFrac: number } {
  const xFrac = Math.min(1, Math.max(-1, (azimuthDeg - 180) / 100));
  const yFrac = Math.min(1, Math.max(0, altitudeDeg / 70));
  return { xFrac, yFrac };
}

/**
 * The visual phase of the sky right now:
 *   - `day`    — sun comfortably up
 *   - `golden` — sun near the horizon (sunrise/sunset/twilight glow)
 *   - `night`  — sun well below the horizon
 * Falls back to the date alone (rough clock-based guess) when no coordinates are
 * known yet, so the cycle still animates before/without a location fix.
 */
export function skyPhase(
  date: Date,
  latitude: number | null,
  longitude: number | null,
): SkyPhase {
  if (latitude == null || longitude == null) {
    const h = date.getHours();
    if (h >= 7 && h < 19) return 'day';
    if (h < 5 || h >= 21) return 'night';
    return 'golden';
  }
  const alt = solarAltitudeDeg(date, latitude, longitude);
  if (alt > 4) return 'day';
  if (alt < -6) return 'night';
  return 'golden';
}

/** The current phase of the Moon, computed offline from the date alone. */
export interface MoonPhase {
  /** Position in the synodic cycle: 0 = new, 0.25 = first quarter, 0.5 = full,
   *  0.75 = last quarter, → 1 = new again. */
  fraction: number;
  /** Illuminated fraction of the disc, 0 (new) … 1 (full). */
  illum: number;
  /** Waxing (growing, lit on the right in the N. hemisphere) vs waning. */
  waxing: boolean;
  /** Friendly phase name. */
  name: string;
}

const SYNODIC = 29.530588853;           // mean length of the lunar month (days)
const REF_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14); // a known new moon (2000-01-06 18:14 UTC)

/**
 * Moon phase for a date — a small, keyless, offline computation (good to well
 * under a day, plenty for choosing which crescent/gibbous to draw). Uses the
 * mean synodic month from a reference new moon; not an ephemeris, but the shape
 * it yields is right.
 */
export function moonPhase(date: Date): MoonPhase {
  const days = (date.getTime() - REF_NEW_MOON) / DAY_MS;
  let f = (days / SYNODIC) % 1;
  if (f < 0) f += 1;
  const illum = (1 - Math.cos(2 * Math.PI * f)) / 2;
  const waxing = f < 0.5;
  let name: string;
  if (f < 0.02 || f > 0.98) name = 'New moon';
  else if (f < 0.23) name = 'Waxing crescent';
  else if (f < 0.27) name = 'First quarter';
  else if (f < 0.48) name = 'Waxing gibbous';
  else if (f < 0.52) name = 'Full moon';
  else if (f < 0.73) name = 'Waning gibbous';
  else if (f < 0.77) name = 'Last quarter';
  else name = 'Waning crescent';
  return { fraction: f, illum, waxing, name };
}

/**
 * An SVG path for the LIT part of a moon disc of radius `r` centred at
 * (`cx`,`cy`), given the synodic `fraction` (0 new … 0.5 full … 1 new). Drawn in
 * a light fill over a darker base disc, this yields the correct crescent or
 * gibbous. Northern-hemisphere convention: waxing is lit on the right. Returns
 * an empty string at new moon (nothing is lit); a full disc at full moon.
 * (Geometry verified against all eight principal phases.)
 */
export function moonLitPath(cx: number, cy: number, r: number, fraction: number): string {
  const c = Math.cos(2 * Math.PI * fraction);  // 1 at new, 0 at quarters, -1 at full
  const illum = (1 - c) / 2;                    // illuminated fraction
  if (illum < 0.01) return '';                  // new moon — nothing lit
  if (illum > 0.99) {                            // full moon — whole disc lit
    return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
  }
  const rx = Math.abs(c) * r;                    // terminator ellipse half-width
  const waxing = fraction < 0.5;                 // lit side is the right when waxing
  const gibbous = illum > 0.5;                   // terminator bulges into the dark side
  // Outer arc: the bright limb, top→bottom (right limb = sweep 1 when waxing).
  // Inner arc: the terminator ellipse back bottom→top; its sweep encodes whether
  // the lit area is a thin crescent or a fat gibbous.
  const outerSweep = waxing ? 1 : 0;
  const innerSweep = waxing ? (gibbous ? 1 : 0) : (gibbous ? 0 : 1);
  return `M ${cx} ${cy - r} A ${r} ${r} 0 0 ${outerSweep} ${cx} ${cy + r} `
    + `A ${rx.toFixed(2)} ${r} 0 0 ${innerSweep} ${cx} ${cy - r} Z`;
}

