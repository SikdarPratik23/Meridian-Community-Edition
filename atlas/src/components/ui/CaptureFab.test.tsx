import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import CaptureFab from './CaptureFab';
import { useAtlasStore } from '../../store/atlas';

describe('CaptureFab', () => {
  beforeEach(() => {
    useAtlasStore.setState({
      composing: null,
      selectedEvent: null,
      selectedDay: null,
      selectedTrip: null,
      editing: null,
      yearReviewOpen: false,
      mapExpanded: false,
      pendingCaptureMode: null,
      pendingCapturePhoto: null,
      activeTab: 'timeline',
    });
  });

  it('renders write button on phone layout', () => {
    render(<CaptureFab />);
    expect(screen.getByRole('button', { name: /write/i })).toBeInTheDocument();
  });

  it('triggers startComposing when main write button is clicked', () => {
    render(<CaptureFab />);
    const writeBtn = screen.getByRole('button', { name: /write/i });
    fireEvent.click(writeBtn);
    expect(useAtlasStore.getState().composing).toBe('journal');
  });

  it('expands speed dial menu when toggle chevron is clicked', () => {
    render(<CaptureFab />);
    const toggleBtn = screen.getByLabelText(/quick capture/i);
    fireEvent.click(toggleBtn);

    expect(screen.getByRole('button', { name: /photo/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /voice note/i })).toBeInTheDocument();
  });

  it('sets pendingCapturePhoto and starts composing when a photo file is chosen', () => {
    const { container } = render(<CaptureFab />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).not.toBeNull();

    const dummyFile = new File(['dummy content'], 'test-photo.jpg', { type: 'image/jpeg' });
    fireEvent.change(fileInput, { target: { files: [dummyFile] } });

    expect(useAtlasStore.getState().pendingCapturePhoto).toBe(dummyFile);
    expect(useAtlasStore.getState().composing).toBe('journal');
  });

  it('sets pendingCaptureMode audio and starts composing when voice button clicked', () => {
    render(<CaptureFab />);
    const toggleBtn = screen.getByLabelText(/quick capture/i);
    fireEvent.click(toggleBtn);

    const voiceBtn = screen.getByRole('button', { name: /voice note/i });
    fireEvent.click(voiceBtn);

    expect(useAtlasStore.getState().pendingCaptureMode).toBe('audio');
    expect(useAtlasStore.getState().composing).toBe('journal');
  });

  // Regression guard, 2026-08-08: the FAB floats over the bottom strip of
  // whichever tab is showing, and on Settings that strip is where "Save
  // settings" lives — it was covering the button's left half. Writing an entry
  // isn't something you do from Settings or Data, so it stays away entirely.
  it.each(['settings', 'data'] as const)('does not render on the %s tab', (tab) => {
    useAtlasStore.setState({ activeTab: tab });
    render(<CaptureFab />);
    expect(screen.queryByRole('button', { name: /write/i })).toBeNull();
  });

  it.each(['home', 'timeline', 'explore'] as const)('still renders on the %s tab', (tab) => {
    useAtlasStore.setState({ activeTab: tab });
    render(<CaptureFab />);
    expect(screen.getByRole('button', { name: /write/i })).toBeInTheDocument();
  });
});
