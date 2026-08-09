/**
 * Unit tests for the composed effective-motion hook — just wiring, since the
 * actual decision logic (`effectiveMotion`) is tested on its own in
 * utils/motion.test.ts. What matters here is that the wiring reads the real
 * settings store and the real OS preference, not stand-ins for them.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useEffectiveMotion } from './useEffectiveMotion'
import { useSettings } from '../store/settings'

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? matches : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  useSettings.setState({ motion: 'full' })
})

describe('useEffectiveMotion', () => {
  test('returns the setting when the OS does not request reduced motion', () => {
    stubReducedMotion(false)
    useSettings.setState({ motion: 'reduced' })
    const { result } = renderHook(() => useEffectiveMotion())
    expect(result.current).toBe('reduced')
  })

  test('the OS preference overrides a "full" setting', () => {
    stubReducedMotion(true)
    useSettings.setState({ motion: 'full' })
    const { result } = renderHook(() => useEffectiveMotion())
    expect(result.current).toBe('off')
  })

  test('defaults to full motion on a fresh settings store', () => {
    stubReducedMotion(false)
    const { result } = renderHook(() => useEffectiveMotion())
    expect(result.current).toBe('full')
  })
})
