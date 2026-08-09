/**
 * A regression guard for a real bug found while surveying the app's motion
 * (2026-08-07): `animate-dialog-fade` and `animate-dialog-pop` were used as
 * Tailwind classes on the command palette's backdrop and the entire onboarding
 * dialog (`CommandPalette.tsx`, `Onboarding.tsx`), but Tailwind v4 only emits
 * `animate-*` utilities from a declared `--animate-*` theme token — and the
 * `@theme` block declared none. Those classes generated ZERO CSS, so the
 * first-run introduction (the one screen every new install sees) had no
 * entrance animation at all.
 *
 * This is a plain string check on the source file rather than a build-output
 * check (contrast the survey's own verification, which grepped the built
 * bundle) because it needs to run without a production build, and a string
 * check on the token DECLARATION is exactly the check that would have caught
 * the original bug — the tokens simply didn't exist.
 */
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Vitest's `import.meta.url` is not a plain `file:` URL, so this is resolved
// against the working directory (the package root, per vitest.config.ts)
// rather than via `fileURLToPath(import.meta.url)`.
const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf-8')

describe('Tailwind --animate-* theme tokens', () => {
  test('--animate-dialog-fade is declared in the @theme block', () => {
    expect(css).toMatch(/--animate-dialog-fade\s*:/)
  })

  test('--animate-dialog-pop is declared in the @theme block', () => {
    expect(css).toMatch(/--animate-dialog-pop\s*:/)
  })

  test('both tokens reference keyframes that actually exist', () => {
    expect(css).toMatch(/@keyframes dialog-fade\b/)
    expect(css).toMatch(/@keyframes dialog-pop\b/)
  })
})

describe('motion token layer', () => {
  test('the --mo-* base tokens are declared', () => {
    for (const token of ['--mo-amp', '--mo-dur', '--mo-fast', '--mo-base', '--mo-slow', '--mo-slower', '--mo-ease', '--mo-spring']) {
      expect(css).toMatch(new RegExp(`${token}\\s*:`))
    }
  })

  test('the reduced/off motion levels are wired to html[data-motion]', () => {
    expect(css).toMatch(/html\[data-motion="reduced"\]/)
    expect(css).toMatch(/html\[data-motion="off"\]/)
  })
})
