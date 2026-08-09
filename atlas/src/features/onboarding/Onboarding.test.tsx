/**
 * Component tests for the first-run introduction.
 *
 * This is the only screen that can block access to the entire app, so the tests
 * that matter are the ESCAPE HATCHES: skip works from every step, Escape works,
 * finishing sets the flag, and the flag is persisted so it can't reappear on the
 * next launch. A bug that traps a new user behind an un-dismissable modal would be
 * the worst possible first impression.
 *
 * Nothing here asserts on styling — only on behaviour a user would notice.
 */
import { beforeEach, describe, expect, test } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Onboarding from './Onboarding'
import { useSettings } from '../../store/settings'

const KEY = 'meridian_settings'

/** Advance from the opening step to the named one. */
async function goTo(step: 'you' | 'look' | 'done') {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /get started/i }))
  if (step === 'you') return user
  await user.click(screen.getByRole('button', { name: /^next$/i }))
  if (step === 'look') return user
  await user.click(screen.getByRole('button', { name: /^next$/i }))
  return user
}

beforeEach(() => {
  localStorage.clear()
  useSettings.setState({
    onboarded: false,
    name: '',
    title: '',
    theme: 'system',
    language: 'en',
    fontSize: 'medium',
    graphicsQuality: 'low',
  })
})

describe('structure', () => {
  test('renders as a modal dialog', () => {
    render(<Onboarding />)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
  })

  test('opens on the welcome step, naming the app and its purpose', () => {
    render(<Onboarding />)
    expect(screen.getByRole('heading', { name: 'Meridian' })).toBeInTheDocument()
    expect(screen.getByText(/a journal for geographers/i)).toBeInTheDocument()
  })

  test('says up front that nothing is locked in', () => {
    render(<Onboarding />)
    expect(screen.getByText(/changeable later/i)).toBeInTheDocument()
  })

  test('states that the journal stays on the device', () => {
    // The app's central promise; the intro is where it should be made.
    render(<Onboarding />)
    expect(screen.getByText(/no account and no server/i)).toBeInTheDocument()
  })
})

describe('navigation', () => {
  test('Get started moves to the "who is writing" step', async () => {
    render(<Onboarding />)
    await goTo('you')
    expect(screen.getByRole('heading', { name: /who's writing/i })).toBeInTheDocument()
  })

  test('walks forward through every step to the finish', async () => {
    render(<Onboarding />)
    await goTo('done')
    expect(screen.getByRole('button', { name: /start journaling/i })).toBeInTheDocument()
  })

  test('Back returns to the previous step', async () => {
    render(<Onboarding />)
    const user = await goTo('look')
    expect(screen.getByRole('heading', { name: /how should it look/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^back$/i }))
    expect(screen.getByRole('heading', { name: /who's writing/i })).toBeInTheDocument()
  })

  test('there is no Back on the first step', () => {
    render(<Onboarding />)
    expect(screen.queryByRole('button', { name: /^back$/i })).not.toBeInTheDocument()
  })

  test('the final step offers no Skip — it is already the end', async () => {
    render(<Onboarding />)
    await goTo('done')
    expect(screen.queryByRole('button', { name: /^skip$/i })).not.toBeInTheDocument()
  })
})

describe('dismissal (the escape hatches)', () => {
  test('Skip marks the install as onboarded', async () => {
    render(<Onboarding />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^skip$/i }))
    expect(useSettings.getState().onboarded).toBe(true)
  })

  test('Skip works from every step that offers it', async () => {
    for (const step of ['you', 'look'] as const) {
      useSettings.setState({ onboarded: false })
      const view = render(<Onboarding />)
      const user = await goTo(step)
      await user.click(screen.getByRole('button', { name: /^skip$/i }))
      expect(useSettings.getState().onboarded, `skip failed at step "${step}"`).toBe(true)
      view.unmount()
    }
  })

  test('Escape dismisses it', async () => {
    render(<Onboarding />)
    const user = userEvent.setup()
    await user.keyboard('{Escape}')
    expect(useSettings.getState().onboarded).toBe(true)
  })

  test('Start journaling finishes it', async () => {
    render(<Onboarding />)
    const user = await goTo('done')
    await user.click(screen.getByRole('button', { name: /start journaling/i }))
    expect(useSettings.getState().onboarded).toBe(true)
  })

  test('finishing PERSISTS the flag, so it cannot reappear next launch', async () => {
    // The regression that would matter most: dismissed in memory but not on disk,
    // so the introduction returns on every single launch.
    render(<Onboarding />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^skip$/i }))
    expect(JSON.parse(localStorage.getItem(KEY)!).onboarded).toBe(true)
  })

  test('skipping changes nothing else — defaults are left alone', async () => {
    render(<Onboarding />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^skip$/i }))
    const state = useSettings.getState()
    expect(state.name).toBe('')
    expect(state.theme).toBe('system')
    expect(state.graphicsQuality).toBe('low')
  })
})

describe('the choices it collects', () => {
  test('typing a name stores it', async () => {
    render(<Onboarding />)
    const user = await goTo('you')
    await user.type(screen.getByPlaceholderText(/your name/i), 'Pratik')
    expect(useSettings.getState().name).toBe('Pratik')
  })

  test('the name is used in the closing message', async () => {
    render(<Onboarding />)
    const user = await goTo('you')
    await user.type(screen.getByPlaceholderText(/your name/i), 'Pratik')
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    expect(screen.getByRole('heading', { name: /ready when you are, Pratik/i })).toBeInTheDocument()
  })

  test('the closing message works with no name given', async () => {
    render(<Onboarding />)
    await goTo('done')
    expect(screen.getByRole('heading', { name: /^ready when you are\.$/i })).toBeInTheDocument()
  })

  test('offers both languages and stores the choice', async () => {
    render(<Onboarding />)
    const user = await goTo('you')
    await user.click(screen.getByRole('button', { name: 'বাংলা' }))
    expect(useSettings.getState().language).toBe('bn')
  })

  test('says the language setting does not restrict what you can write', async () => {
    // Important for this user specifically: they write Bengali content with an
    // English UI, and must not think picking English limits that.
    render(<Onboarding />)
    await goTo('you')
    expect(screen.getByText(/write entries in any language/i)).toBeInTheDocument()
  })

  test('choosing a theme stores it', async () => {
    render(<Onboarding />)
    const user = await goTo('look')
    await user.click(screen.getByRole('button', { name: /dark/i }))
    expect(useSettings.getState().theme).toBe('dark')
  })

  test('choosing a text size stores it', async () => {
    render(<Onboarding />)
    const user = await goTo('look')
    await user.click(screen.getByRole('button', { name: /^large$/i }))
    expect(useSettings.getState().fontSize).toBe('large')
  })

  test('choosing a graphics tier stores it', async () => {
    render(<Onboarding />)
    const user = await goTo('look')
    await user.click(screen.getByRole('button', { name: /^ultra$/i }))
    expect(useSettings.getState().graphicsQuality).toBe('ultra')
  })

  test('the graphics blurb describes the selected tier', async () => {
    render(<Onboarding />)
    const user = await goTo('look')
    await user.click(screen.getByRole('button', { name: /^ultra$/i }))
    expect(screen.getByText(/GPU atmosphere/i)).toBeInTheDocument()
  })

  test('choices made mid-flow survive going Back and forward', async () => {
    render(<Onboarding />)
    const user = await goTo('you')
    await user.type(screen.getByPlaceholderText(/your name/i), 'Pratik')
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await user.click(screen.getByRole('button', { name: /^back$/i }))
    expect(screen.getByPlaceholderText(/your name/i)).toHaveValue('Pratik')
  })
})

describe('progress indication', () => {
  test('shows one dot per step', () => {
    render(<Onboarding />)
    const footer = screen.getByRole('dialog').lastElementChild!
    // The dots are decorative spans in the footer's first child.
    expect(within(footer as HTMLElement).getByRole('button', { name: /get started/i })).toBeInTheDocument()
    expect((footer.firstElementChild as HTMLElement).children).toHaveLength(4)
  })
})
