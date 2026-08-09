/**
 * Global test setup — runs once per test file before any test.
 *
 * Keep this minimal and side-effect-light: anything registered here applies to
 * every suite, including the pure-logic ones.
 */
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'

// The settings store and `pickFresh` both persist to localStorage. Tests must
// not leak state into each other, so clear it around every test.
beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  // React Testing Library normally registers this itself — but only when Vitest's
  // `globals` option is on, which it isn't here (suites import `test`/`expect`
  // explicitly). Without it, every render stays in the document and the next
  // `getByRole` finds several matches instead of one.
  cleanup()
  localStorage.clear()
})
