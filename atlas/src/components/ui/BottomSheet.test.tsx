import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import BottomSheet from './BottomSheet';

describe('BottomSheet', () => {
  beforeEach(() => {
    // Default matchMedia to mobile (< 768px)
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  it('renders children content exactly once', () => {
    const onDismiss = vi.fn();
    render(
      <BottomSheet onDismiss={onDismiss}>
        <div>Test Sheet Content</div>
      </BottomSheet>,
    );
    expect(screen.getAllByText('Test Sheet Content')).toHaveLength(1);
  });

  it('renders desktop view without grabber when in two-pane mode', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('768px'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const onDismiss = vi.fn();
    render(
      <BottomSheet onDismiss={onDismiss}>
        <div>Desktop Sheet Content</div>
      </BottomSheet>,
    );

    expect(screen.getAllByText('Desktop Sheet Content')).toHaveLength(1);
    expect(screen.queryByTestId('bottom-sheet-grabber')).toBeNull();
  });

  it('triggers onDismiss when dragged down past threshold', () => {
    const onDismiss = vi.fn();
    render(
      <BottomSheet onDismiss={onDismiss} dismissThreshold={50}>
        <div>Test Sheet Content</div>
      </BottomSheet>,
    );

    const grabber = screen.getByTestId('bottom-sheet-grabber');
    grabber.setPointerCapture = vi.fn();
    grabber.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(grabber, { button: 0, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(grabber, { clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(grabber, { pointerId: 1 });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not trigger onDismiss when drag distance is below threshold', () => {
    const onDismiss = vi.fn();
    render(
      <BottomSheet onDismiss={onDismiss} dismissThreshold={90}>
        <div>Test Sheet Content</div>
      </BottomSheet>,
    );

    const grabber = screen.getByTestId('bottom-sheet-grabber');
    grabber.setPointerCapture = vi.fn();
    grabber.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(grabber, { button: 0, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(grabber, { clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(grabber, { pointerId: 1 });

    expect(onDismiss).not.toHaveBeenCalled();
  });
});
