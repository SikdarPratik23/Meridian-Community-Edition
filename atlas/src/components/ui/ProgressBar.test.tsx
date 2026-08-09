/**
 * Unit tests for the shared <ProgressBar>. The visible fill animation is CSS
 * (`transform: scaleX(var(--mo-progress))`); what's testable here is the
 * contract: the value clamps to [0, 1], and the accessible progressbar role
 * reports the same number a screen reader would read aloud.
 */
import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import ProgressBar from './ProgressBar'

describe('ProgressBar', () => {
  test('reports 0–100 via aria-valuenow', () => {
    render(<ProgressBar value={0.42} aria-label="Download progress" />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
  })

  test('clamps a value below 0', () => {
    render(<ProgressBar value={-0.5} aria-label="p" />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })

  test('clamps a value above 1', () => {
    render(<ProgressBar value={1.5} aria-label="p" />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  })

  test('sets the --mo-progress custom property the fill reads', () => {
    const { container } = render(<ProgressBar value={0.75} aria-label="p" />)
    const fill = container.querySelector('.mo-progress-fill') as HTMLElement
    expect(fill.style.getPropertyValue('--mo-progress')).toBe('0.75')
  })
})
