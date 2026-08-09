/**
 * Transient notifications ("toasts").
 *
 * Two gaps this closes. First, the app used to be silent on success — you saved an
 * entry and the pane just changed, with nothing confirming the write landed.
 * Second, and more importantly, **destructive actions had no way back**: deleting an
 * entry showed a confirm dialog and then it was gone. A confirm dialog asks you to
 * be careful; an undo lets you be wrong. Undo is the better guarantee, and a toast
 * is where it lives.
 *
 * Deliberately a tiny zustand store rather than React context: `useDeleteEntry`,
 * the editor's save path and the sync layer all want to raise a toast, and several
 * of them are not React components. A store means `toast.show(...)` works from
 * anywhere without threading a provider through.
 *
 * Toasts are LIVE-ONLY — never persisted, never synced. A notification that
 * outlived its session would be nonsense.
 */
import { create } from 'zustand';

export type ToastVariant = 'info' | 'success' | 'danger';

export interface ToastAction {
  label: string;
  /** Run when the action is pressed. The toast dismisses itself afterwards. */
  run: () => void;
}

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  /** Optional single action, e.g. Undo. */
  action?: ToastAction;
  /** Milliseconds before auto-dismissal. 0 keeps it until dismissed by hand. */
  durationMs: number;
}

/** How long a plain confirmation stays. Long enough to read, short enough to
 *  not linger over the thing you just did. */
export const DEFAULT_DURATION_MS = 3200;
/** An actionable toast lives longer — you have to notice it AND decide. */
export const ACTION_DURATION_MS = 7000;
/** More than this on screen at once is noise, so the oldest are dropped. */
export const MAX_VISIBLE = 3;

export interface ToastInput {
  message: string;
  variant?: ToastVariant;
  action?: ToastAction;
  /** Override the auto-dismiss delay. 0 disables it. */
  durationMs?: number;
}

interface ToastStore {
  toasts: Toast[];
  /** Raise a toast. Returns its id, so a caller can dismiss it early. */
  show: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

let counter = 0;
/** Monotonic id. Not `crypto.randomUUID` — this needs no unguessability, and it
 *  keeps ids readable when debugging. */
function nextId(): string {
  counter += 1;
  return `toast-${counter}`;
}

export const useToasts = create<ToastStore>((set) => ({
  toasts: [],

  show: ({ message, variant = 'info', action, durationMs }) => {
    const id = nextId();
    const toast: Toast = {
      id,
      message,
      variant,
      action,
      durationMs: durationMs ?? (action ? ACTION_DURATION_MS : DEFAULT_DURATION_MS),
    };
    // Newest first, and never more than MAX_VISIBLE — a burst (e.g. deleting a
    // whole day entry by entry) shouldn't bury the screen.
    set((state) => ({ toasts: [toast, ...state.toasts].slice(0, MAX_VISIBLE) }));
    return id;
  },

  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  clear: () => set({ toasts: [] }),
}));

/**
 * Imperative helpers, for the many callers that aren't components.
 *
 *   toast.success('Entry saved')
 *   toast.undoable('Entry deleted', () => restore(entry))
 */
export const toast = {
  info: (message: string) => useToasts.getState().show({ message }),
  success: (message: string) => useToasts.getState().show({ message, variant: 'success' }),
  error: (message: string) => useToasts.getState().show({ message, variant: 'danger' }),
  /** A toast whose whole purpose is the way back. */
  undoable: (message: string, undo: () => void, label = 'Undo') =>
    useToasts.getState().show({ message, action: { label, run: undo } }),
};
