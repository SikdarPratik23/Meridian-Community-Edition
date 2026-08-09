/**
 * Unit tests for the tab-navigation slice of the app store added for P1
 * (MOTION_PLAN.md Part II — the phone UI redraft).
 *
 * Two actions share the same underlying "which tab, which direction" logic
 * but differ in one important way: `setActiveTab` (desktop's own in-column
 * tab row) must NEVER touch the main pane's selection, since desktop shows
 * both at once; `navigateTab` (the phone bottom tab bar) always backs out of
 * whatever's open, since a phone shows only one surface at a time. Getting
 * that split wrong would either strand a phone user on a stale detail view
 * behind an unresponsive tab bar, or silently close whatever a desktop user
 * was reading every time they switched the sidebar's own list tab.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAtlasStore } from './atlas'
import { journal } from '../test/factories'

const INITIAL = {
  activeTab: 'timeline' as const,
  prevTab: null,
  tabDirection: 'forward' as const,
  selectedEvent: null,
  selectedDay: null,
  selectedTrip: null,
  composing: null,
  editing: null,
  pickingLocation: false,
  yearReviewOpen: false,
  mapExpanded: false,
}

beforeEach(() => {
  useAtlasStore.setState(INITIAL)
  delete document.documentElement.dataset.motion
})

afterEach(() => {
  vi.useRealTimers()
  useAtlasStore.setState(INITIAL)
  delete document.documentElement.dataset.motion
})

describe('setActiveTab (desktop\'s own tab row)', () => {
  test('switches the tab', () => {
    useAtlasStore.getState().setActiveTab('explore')
    expect(useAtlasStore.getState().activeTab).toBe('explore')
  })

  test('computes forward when moving right in VIEW_ORDER, back when moving left', () => {
    useAtlasStore.getState().setActiveTab('data') // timeline -> data: rightward
    expect(useAtlasStore.getState().tabDirection).toBe('forward')

    useAtlasStore.getState().setActiveTab('explore') // data -> explore: leftward
    expect(useAtlasStore.getState().tabDirection).toBe('back')
  })

  test('is a no-op when the tab is already active', () => {
    useAtlasStore.getState().setActiveTab('timeline')
    expect(useAtlasStore.getState().activeTab).toBe('timeline')
    expect(useAtlasStore.getState().prevTab).toBeNull()
  })

  test('has no side effects on the main pane\'s selection', () => {
    const entry = journal()
    useAtlasStore.setState({ selectedEvent: entry, composing: 'journal' })
    useAtlasStore.getState().setActiveTab('explore')
    expect(useAtlasStore.getState().selectedEvent).toBe(entry)
    expect(useAtlasStore.getState().composing).toBe('journal')
  })

  test('skips the prevTab slide bookkeeping when motion is off', () => {
    document.documentElement.dataset.motion = 'off'
    useAtlasStore.getState().setActiveTab('explore')
    expect(useAtlasStore.getState().activeTab).toBe('explore')
    expect(useAtlasStore.getState().prevTab).toBeNull()
  })

  test('clears prevTab again after the slide transition elapses', async () => {
    vi.useFakeTimers()
    useAtlasStore.getState().setActiveTab('explore')
    expect(useAtlasStore.getState().prevTab).toBe('timeline')

    await vi.advanceTimersByTimeAsync(300)
    expect(useAtlasStore.getState().prevTab).toBeNull()
  })
})

describe('navigateTab (the phone bottom tab bar)', () => {
  test('switches the tab, same as setActiveTab', () => {
    useAtlasStore.getState().navigateTab('data')
    expect(useAtlasStore.getState().activeTab).toBe('data')
  })

  test('backs out of a selected entry', () => {
    useAtlasStore.setState({ selectedEvent: journal() })
    useAtlasStore.getState().navigateTab('explore')
    expect(useAtlasStore.getState().selectedEvent).toBeNull()
  })

  test('backs out of composing/editing/a selected day or trip/Year in Review', () => {
    useAtlasStore.setState({
      composing: 'journal',
      editing: journal(),
      selectedDay: '2026-07-15',
      selectedTrip: 'trip-1',
      pickingLocation: true,
      yearReviewOpen: true,
    })
    useAtlasStore.getState().navigateTab('explore')
    const s = useAtlasStore.getState()
    expect(s.composing).toBeNull()
    expect(s.editing).toBeNull()
    expect(s.selectedDay).toBeNull()
    expect(s.selectedTrip).toBeNull()
    expect(s.pickingLocation).toBe(false)
    expect(s.yearReviewOpen).toBe(false)
  })

  test('backs out of an expanded map', () => {
    useAtlasStore.setState({ mapExpanded: true }) // activeTab stays 'timeline'
    useAtlasStore.getState().navigateTab('explore')
    expect(useAtlasStore.getState().mapExpanded).toBe(false)
    expect(useAtlasStore.getState().activeTab).toBe('explore')
  })

  test('tapping the ALREADY-active tab still closes an open detail view (does not require a tab change)', () => {
    useAtlasStore.setState({ selectedEvent: journal() }) // activeTab stays 'timeline'
    useAtlasStore.getState().navigateTab('timeline')
    expect(useAtlasStore.getState().selectedEvent).toBeNull()
    expect(useAtlasStore.getState().activeTab).toBe('timeline')
  })

  test('is a genuine no-op when the same tab is tapped and nothing is open', () => {
    useAtlasStore.getState().navigateTab('timeline')
    const s = useAtlasStore.getState()
    expect(s.activeTab).toBe('timeline')
    expect(s.prevTab).toBeNull()
  })
})

// 2026-08-08: Home split out of Timeline. Before this, the phone's Timeline tab
// rendered the welcome dashboard above the entries, so "Timeline" showed the
// greeting rather than the journal. These guard the separation itself — that
// Home and Timeline are two distinct destinations with Home to the left of it.
describe('Home is its own destination, left of Timeline', () => {
  test('Home and Timeline are separate tabs, not the same one', () => {
    useAtlasStore.getState().navigateTab('home')
    expect(useAtlasStore.getState().activeTab).toBe('home')

    useAtlasStore.getState().navigateTab('timeline')
    expect(useAtlasStore.getState().activeTab).toBe('timeline')
  })

  test('Home sits leftmost, so leaving it always slides forward and returning slides back', () => {
    useAtlasStore.getState().navigateTab('home')
    useAtlasStore.getState().navigateTab('explore')
    expect(useAtlasStore.getState().tabDirection).toBe('forward')

    useAtlasStore.getState().navigateTab('home')
    expect(useAtlasStore.getState().tabDirection).toBe('back')
  })

  test('opening an entry from Home leaves the tab alone — only navigateTab moves it', () => {
    useAtlasStore.setState({ activeTab: 'home' })
    useAtlasStore.getState().selectEvent(journal())
    expect(useAtlasStore.getState().activeTab).toBe('home')
  })
})
