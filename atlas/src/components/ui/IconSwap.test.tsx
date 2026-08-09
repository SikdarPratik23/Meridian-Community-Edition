/**
 * Unit tests for <IconSwap> — the two-glyph crossfade (MOTION_PLAN.md M9).
 * Behaviour worth pinning: both glyphs are always in the DOM (so there's no
 * layout jump when they differ in width), and exactly one carries `is-shown`
 * at a time, keyed off `active`.
 */
import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import IconSwap from './IconSwap'

describe('IconSwap', () => {
  test('both glyphs are in the DOM regardless of which is active', () => {
    render(<IconSwap active={false} on="✕" off="⤢" />)
    expect(screen.getByText('✕')).toBeInTheDocument()
    expect(screen.getByText('⤢')).toBeInTheDocument()
  })

  test('the "off" glyph is shown when inactive', () => {
    render(<IconSwap active={false} on="✕" off="⤢" />)
    expect(screen.getByText('⤢')).toHaveClass('is-shown')
    expect(screen.getByText('✕')).toHaveClass('is-hidden')
  })

  test('the "on" glyph is shown when active', () => {
    render(<IconSwap active={true} on="✕" off="⤢" />)
    expect(screen.getByText('✕')).toHaveClass('is-shown')
    expect(screen.getByText('⤢')).toHaveClass('is-hidden')
  })

  test('is aria-hidden — the caller owns the accessible label', () => {
    const { container } = render(<IconSwap active={false} on="✕" off="⤢" />)
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })

  test('forwards an extra className alongside the base class', () => {
    const { container } = render(<IconSwap active={false} on="✕" off="⤢" className="extra" />)
    expect(container.firstElementChild).toHaveClass('mo-icon-swap', 'extra')
  })
})
