import { createContext, useContext, type ReactNode } from 'react';

/**
 * Types + context + hook for the imperative dialog system. Kept separate from
 * `Dialog.tsx` (which holds the `DialogProvider` component) so that file only
 * exports components — a requirement for React Fast Refresh / HMR to work.
 *
 *   const { confirm, prompt } = useDialogs();
 *   if (await confirm({ title: 'Delete this entry?', variant: 'danger' })) { ... }
 *   const name = await prompt({ title: 'Your name', defaultValue: current });
 */

export type Variant = 'default' | 'danger';

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: Variant;
}

export interface PromptOptions {
  title: string;
  message?: ReactNode;
  /** Label shown above the input. */
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Use a multi-line textarea instead of a single-line input. */
  multiline?: boolean;
  /** When true, the confirm button is disabled until the field is non-empty. */
  required?: boolean;
}

export interface AlertOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  variant?: Variant;
}

export interface DialogContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
  alert: (opts: AlertOptions) => Promise<void>;
}

export const DialogContext = createContext<DialogContextValue | null>(null);

/** Access the imperative dialog helpers. Must be used under <DialogProvider>. */
export function useDialogs(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialogs must be used within a <DialogProvider>');
  return ctx;
}
