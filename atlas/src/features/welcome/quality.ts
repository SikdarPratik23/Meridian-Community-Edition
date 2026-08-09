/**
 * Graphics-quality profiles — the single source of truth for how rich the
 * animated backdrop is at each user-chosen tier (Low → Ultra).
 *
 * The idea is one small, pure lookup (`profileFor`) that every backdrop layer
 * reads to decide how hard to work: how many particles to spawn, how crisp to
 * render the canvas, and which atmospheric extras (fog, aurora, birds, a
 * shooting star, sunbeams, the butterfly) to show at all. Nothing here changes
 * *what the app does* — only how much visual work the scene puts in — so the
 * same journal behaves identically at every tier.
 *
 * Design intent (decided with the user):
 *   - `low` is the install default. It stays deliberately light so the scene is
 *     smooth and battery-friendly on any device (the reference target is an
 *     entry-level phone, a Galaxy M12 / Mali-G52). The landscape, sky, sun/moon
 *     and gentle precipitation still render — it simply drops the heavier
 *     atmosphere and thins the particle counts.
 *   - `medium` adds the drifting seasonal life (leaves/petals/pollen/fireflies),
 *     birds, sunbeams and the butterfly.
 *   - `high` layers on the full atmosphere: fog/haze, northern lights, a night
 *     shooting star, and denser particles.
 *   - `ultra` pushes particle density and canvas sharpness to the max, for
 *     powerful devices (e.g. a desktop GPU).
 *
 * `webgl` is reserved: at High/Ultra a future GPU (WebGL) enhancement layer can
 * light up when this flag is set. It is wired here so the plumbing is ready; the
 * hybrid SVG + 2D-canvas path remains the always-available fallback.
 */
import type { GraphicsQuality } from '../../store/settings';

export interface QualityProfile {
  tier: GraphicsQuality;
  /** Short label for the settings control. */
  label: string;
  /** One-line description of what this tier shows. */
  blurb: string;
  /** Multiplier on every particle count (rain, snow, leaves, petals, …). */
  particleScale: number;
  /** Canvas backing-store DPR cap. Higher = crisper particles, more GPU work. */
  maxDpr: number;
  /** Drifting seasonal life: leaves / petals / pollen / fireflies. Precipitation
   *  (rain, snow) always shows regardless — it is core weather, not decoration. */
  ambientLife: boolean;
  /** Fog / snow-haze rolling across the mid-scene. */
  fog: boolean;
  /** Northern lights on a clear, high-latitude night. */
  aurora: boolean;
  /** A small flock gliding across the daytime sky. */
  birds: boolean;
  /** An occasional shooting star on a clear night. */
  shootingStar: boolean;
  /** Rotating sunbeams radiating from the sun. */
  sunbeams: boolean;
  /** Soft decorative clouds even on an otherwise clear day. */
  richClouds: boolean;
  /** A drifting butterfly on warm sunny days. */
  butterfly: boolean;
  /** The sun/moon reflected as a shimmering column on the lake. */
  reflections: boolean;
  /** A bee or two bobbing over the flowers on warm days. */
  bees: boolean;
  /** Enable the WebGL atmosphere layer (volumetric haze + light shafts) on top
   *  of the hybrid scene (High/Ultra). Feature-detected at runtime; the hybrid
   *  SVG + canvas scene stays the fallback and default renderer. */
  webgl: boolean;
}

const PROFILES: Record<GraphicsQuality, QualityProfile> = {
  low: {
    tier: 'low',
    label: 'Low',
    blurb: 'Lightest — the landscape, sky and gentle weather. Smoothest on any device and easiest on the battery.',
    particleScale: 0.4,
    maxDpr: 1.5,
    ambientLife: false,
    fog: false,
    aurora: false,
    birds: false,
    shootingStar: false,
    sunbeams: false,
    richClouds: false,
    butterfly: false,
    reflections: false,
    bees: false,
    webgl: false,
  },
  medium: {
    tier: 'medium',
    label: 'Medium',
    blurb: 'Balanced — adds drifting seasonal particles, gliding birds, sunbeams and a butterfly on warm days.',
    particleScale: 0.75,
    maxDpr: 2,
    ambientLife: true,
    fog: false,
    aurora: false,
    birds: true,
    shootingStar: false,
    sunbeams: true,
    richClouds: false,
    butterfly: true,
    reflections: false,
    bees: false,
    webgl: false,
  },
  high: {
    tier: 'high',
    label: 'High',
    blurb: 'Rich — full atmosphere: fog, northern lights, water reflections, bees, a night shooting star and denser weather.',
    particleScale: 1,
    maxDpr: 2,
    ambientLife: true,
    fog: true,
    aurora: true,
    birds: true,
    shootingStar: true,
    sunbeams: true,
    richClouds: true,
    butterfly: true,
    reflections: true,
    bees: true,
    webgl: true,
  },
  ultra: {
    tier: 'ultra',
    label: 'Ultra',
    blurb: 'Maximum — GPU atmosphere (volumetric haze + light shafts), the densest particles and the sharpest scene. Best on a powerful device.',
    particleScale: 1.5,
    maxDpr: 2.5,
    ambientLife: true,
    fog: true,
    aurora: true,
    birds: true,
    shootingStar: true,
    sunbeams: true,
    richClouds: true,
    butterfly: true,
    reflections: true,
    bees: true,
    webgl: true,
  },
};

/** Ordered lightest → heaviest, for the settings control. */
export const QUALITY_ORDER: GraphicsQuality[] = ['low', 'medium', 'high', 'ultra'];

/** Look up the profile for a tier (falls back to `low` for anything unknown). */
export function profileFor(quality: GraphicsQuality | undefined | null): QualityProfile {
  return PROFILES[(quality ?? 'low') as GraphicsQuality] ?? PROFILES.low;
}
