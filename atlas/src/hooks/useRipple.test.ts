/**
 * Unit tests for the delegated ripple listener.
 *
 * This is a single document-level `pointerdown` listener rather than a
 * per-button hook (see the file's own doc comment for why), so what's testable
 * is the delegation contract: a press on a `.btn`/`.fmt-btn` spawns a ripple
 * clipped inside THAT button, a disabled button or an unrelated element gets
 * nothing, and motion being off means no listener is attached at all.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { useGlobalRipple } from './useRipple'
import { useSettings } from '../store/settings'

function press(el: Element, x = 5, y = 5) {
  el.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }))
}

afterEach(() => {
  cleanup()
  useSettings.setState({ motion: 'full' })
  document.body.innerHTML = ''
})

describe('useGlobalRipple', () => {
  test('a press on a .btn spawns a ripple inside it', () => {
    document.body.innerHTML = '<button class="btn btn-primary">Go</button>'
    renderHook(() => useGlobalRipple())

    press(document.querySelector('.btn')!)

    expect(document.querySelector('.btn .btn-ripple')).not.toBeNull()
  })

  test('a press on a .fmt-btn also spawns a ripple', () => {
    document.body.innerHTML = '<button class="fmt-btn">B</button>'
    renderHook(() => useGlobalRipple())

    press(document.querySelector('.fmt-btn')!)

    expect(document.querySelector('.fmt-btn .btn-ripple')).not.toBeNull()
  })

  test('a press on a disabled button spawns nothing', () => {
    document.body.innerHTML = '<button class="btn" disabled>Go</button>'
    renderHook(() => useGlobalRipple())

    press(document.querySelector('.btn')!)

    expect(document.querySelector('.btn-ripple')).toBeNull()
  })

  test('a press on an unrelated element spawns nothing', () => {
    document.body.innerHTML = '<div class="not-a-button">x</div>'
    renderHook(() => useGlobalRipple())

    press(document.querySelector('.not-a-button')!)

    expect(document.querySelector('.btn-ripple')).toBeNull()
  })

  test('a press inside a .btn (e.g. on its label text) still ripples the button', () => {
    document.body.innerHTML = '<button class="btn"><span>Go</span></button>'
    renderHook(() => useGlobalRipple())

    press(document.querySelector('span')!)

    expect(document.querySelector('.btn .btn-ripple')).not.toBeNull()
  })

  test('tints the ripple on a bordered/secondary button', () => {
    document.body.innerHTML = '<button class="btn btn-secondary">Go</button>'
    renderHook(() => useGlobalRipple())

    press(document.querySelector('.btn')!)

    const ripple = document.querySelector('.btn-ripple') as HTMLElement
    expect(ripple.style.background).toContain('color-mix')
  })

  test('removes the ripple element after its lifetime', () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<button class="btn">Go</button>'
    renderHook(() => useGlobalRipple())

    press(document.querySelector('.btn')!)
    expect(document.querySelector('.btn-ripple')).not.toBeNull()

    vi.advanceTimersByTime(1000)
    expect(document.querySelector('.btn-ripple')).toBeNull()
    vi.useRealTimers()
  })

  test('attaches no listener at all when motion is off', () => {
    useSettings.setState({ motion: 'off' })
    const spy = vi.spyOn(document, 'addEventListener')
    renderHook(() => useGlobalRipple())
    expect(spy).not.toHaveBeenCalledWith('pointerdown', expect.anything())
    spy.mockRestore()
  })

  test('unmounting removes the listener', () => {
    document.body.innerHTML = '<button class="btn">Go</button>'
    const { unmount } = renderHook(() => useGlobalRipple())
    unmount()

    press(document.querySelector('.btn')!)

    expect(document.querySelector('.btn-ripple')).toBeNull()
  })
})
