/**
 * A regression guard for a real bug that made Meridian unusable on a phone
 * (found 2026-08-08 by Pratik on an iPhone; introduced by the motion pass's
 * own Wave 1, M1), UPDATED for P1 (MOTION_PLAN.md Part II, 2026-08-08), which
 * removed the mechanism this bug lived in rather than just patching it.
 *
 * The original bug: the sidebar drawer used to collapse by TWO different
 * mechanisms depending on breakpoint — desktop animated its WIDTH to zero
 * (`md:w-0`), and a phone slid it off-screen with a TRANSFORM
 * (`-translate-x-full`). M1 added `animate-fade-in-up` to that same element as
 * part of the loader→app handoff stagger — and `fade-in-up`'s `to` keyframe
 * sets `transform: translateY(0)`. CSS animation declarations outrank normal
 * author declarations, and every entrance in this app runs
 * `animation-fill-mode: both`, so that `translateY(0)` was held FOREVER once
 * the animation finished, silently overriding `-translate-x-full` and pinning
 * the drawer fully on-screen — directly on top of the `☰ Meridian` button,
 * which then could not be tapped at all.
 *
 * P1 removed the phone drawer/scrim entirely (BottomTabBar.tsx is the only
 * mobile navigation now) — the sidebar's mobile visibility is a plain
 * `hidden`/`flex` class swap with NO transform involved at all, which
 * structurally removes this whole hazard class rather than just avoiding it.
 * This test now guards TWO things: that the old functional transform hasn't
 * quietly come back, and that the element still uses the same opacity-only
 * `mo-fade-in-plain` entrance for its one remaining animation (the M1 boot
 * stagger) rather than a transform-based one.
 *
 * A plain string check on the source, matching `cssTokens.test.ts`'s precedent:
 * the original failure was a CSS *cascade* interaction that jsdom does not
 * model (it computes no animation fill state), so rendering the component and
 * asserting on styles would pass while the real browser broke.
 */
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const appSource = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf-8')

/**
 * The `className={...}` of the sidebar's own wrapper in App.tsx — located by
 * the `mo-fade-in-plain` marker (its one entrance animation) rather than by
 * the now-removed `-translate-x-full`, since P1 deleted that mechanism.
 *
 * Scans forward from each `className={` rather than backward from the marker,
 * so that prose ABOUT these class names (this bug is explained at length in a
 * comment directly above the element) can never be mistaken for the element
 * itself — comments do not contain a `className={`.
 */
function sidebarWrapperClasses(): string {
  const WINDOW = 700
  for (let at = appSource.indexOf('className={'); at !== -1; at = appSource.indexOf('className={', at + 1)) {
    const block = appSource.slice(at, at + WINDOW)
    if (block.includes('mo-fade-in-plain')) return block
  }
  throw new Error('No className={...} containing mo-fade-in-plain found in App.tsx — the sidebar layout has changed; revisit this guard rather than deleting it.')
}

describe('sidebar mobile visibility has no transform to collide with an entrance animation', () => {
  test('the phone drawer transform is gone, not just hidden (P1)', () => {
    const classes = sidebarWrapperClasses()
    expect(classes).not.toContain('-translate-x-full')
    expect(classes).not.toContain('translate-x-0')
  })

  test('the wrapper does not carry a transform-animating entrance', () => {
    const classes = sidebarWrapperClasses()
    for (const hostile of ['animate-fade-in-up', 'animate-card-in', 'mo-rise-in']) {
      expect(
        classes,
        `${hostile} sets \`transform\` in its keyframes and runs fill-mode: both — pairing it with ` +
        `any future functional transform on this same element would reintroduce the 2026-08-08 bug`,
      ).not.toContain(hostile)
    }
  })

  test('the wrapper uses the opacity-only entrance instead', () => {
    expect(sidebarWrapperClasses()).toContain('mo-fade-in-plain')
  })
})

describe('mo-fade-in-plain really is opacity-only', () => {
  // The guard above is only meaningful while this stays true.
  const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf-8')

  test('its keyframes never touch transform', () => {
    const match = css.match(/@keyframes mo-fade-in-plain\s*\{[^}]*\}/)
    expect(match, '@keyframes mo-fade-in-plain should exist').not.toBeNull()
    expect(match![0]).not.toContain('transform')
  })
})
