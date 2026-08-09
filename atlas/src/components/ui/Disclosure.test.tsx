/**
 * Unit tests for <Disclosure> — the height-animated open/close wrapper. The
 * actual open/close motion is CSS (`grid-template-rows`), so what's testable
 * here is the contract: the child always stays mounted (this animates state,
 * not presence), the `is-open` class tracks `open`, and it's marked
 * `aria-hidden` while collapsed so assistive tech doesn't announce content
 * that's visually collapsed to nothing.
 */
import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import Disclosure from './Disclosure'

describe('Disclosure', () => {
  test('keeps the child mounted whether open or closed', () => {
    const { rerender } = render(<Disclosure open={false}>panel content</Disclosure>)
    expect(screen.getByText('panel content')).toBeInTheDocument()

    rerender(<Disclosure open={true}>panel content</Disclosure>)
    expect(screen.getByText('panel content')).toBeInTheDocument()
  })

  test('applies is-open only when open', () => {
    const { container, rerender } = render(<Disclosure open={false}>x</Disclosure>)
    expect(container.firstElementChild).not.toHaveClass('is-open')

    rerender(<Disclosure open={true}>x</Disclosure>)
    expect(container.firstElementChild).toHaveClass('is-open')
  })

  test('is aria-hidden while collapsed, not while open', () => {
    const { container, rerender } = render(<Disclosure open={false}>x</Disclosure>)
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')

    rerender(<Disclosure open={true}>x</Disclosure>)
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'false')
  })

  test('forwards an extra className alongside the base classes', () => {
    const { container } = render(<Disclosure open={false} className="extra">x</Disclosure>)
    expect(container.firstElementChild).toHaveClass('mo-disclosure', 'extra')
  })
})
