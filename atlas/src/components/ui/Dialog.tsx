import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  DialogContext,
  type ConfirmOptions,
  type PromptOptions,
  type AlertOptions,
} from './dialogs';

/**
 * The dialog UI: a `DialogProvider` that renders one queued modal at a time.
 * The imperative helpers and types live in `./dialogs` (so this file only
 * exports a component — required for Fast Refresh). Components call:
 *
 *   const { confirm, prompt } = useDialogs();
 *   if (await confirm({ title: 'Delete this entry?', variant: 'danger' })) { ... }
 *
 * `confirm` resolves to a boolean, `prompt` to the entered string (or `null` if
 * cancelled), and `alert` to nothing. One dialog shows at a time; calls made
 * while another is open queue and run in order.
 */

type Kind = 'confirm' | 'prompt' | 'alert';

interface DialogRequest {
  id: number;
  kind: Kind;
  options: ConfirmOptions & PromptOptions & AlertOptions;
  resolve: (value: boolean | string | null | void) => void;
}

let nextId = 0;

export function DialogProvider({ children }: { children: ReactNode }) {
  // A queue so overlapping calls don't clobber one another; we render queue[0].
  const [queue, setQueue] = useState<DialogRequest[]>([]);

  const enqueue = useCallback(
    <T,>(kind: Kind, options: DialogRequest['options']) =>
      new Promise<T>((resolve) => {
        nextId += 1;
        setQueue((q) => [...q, { id: nextId, kind, options, resolve: resolve as DialogRequest['resolve'] }]);
      }),
    [],
  );

  const confirm = useCallback(
    (opts: ConfirmOptions) => enqueue<boolean>('confirm', opts),
    [enqueue],
  );
  const prompt = useCallback(
    (opts: PromptOptions) => enqueue<string | null>('prompt', opts),
    [enqueue],
  );
  const alert = useCallback(
    (opts: AlertOptions) => enqueue<void>('alert', opts),
    [enqueue],
  );

  const active = queue[0] ?? null;

  const close = useCallback(
    (value: boolean | string | null | void) => {
      setQueue((q) => {
        const [head, ...rest] = q;
        head?.resolve(value);
        return rest;
      });
    },
    [],
  );

  return (
    <DialogContext.Provider value={{ confirm, prompt, alert }}>
      {children}
      {active && <DialogHost key={active.id} request={active} onClose={close} />}
    </DialogContext.Provider>
  );
}

/** Selector for the elements a focus trap should cycle through. */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function DialogHost({
  request,
  onClose,
}: {
  request: DialogRequest;
  onClose: (value: boolean | string | null | void) => void;
}) {
  const { kind, options } = request;
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [value, setValue] = useState(options.defaultValue ?? '');
  const titleId = useId();
  const descId = useId();

  const cancel = useCallback(() => {
    onClose(kind === 'prompt' ? null : kind === 'alert' ? undefined : false);
  }, [kind, onClose]);

  const accept = useCallback(() => {
    if (kind === 'prompt') {
      if (options.required && !value.trim()) return;
      onClose(value);
    } else if (kind === 'alert') {
      onClose(undefined);
    } else {
      onClose(true);
    }
  }, [kind, options.required, value, onClose]);

  // Move focus into the dialog on open; restore it to the trigger on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Prefer the text field for prompts, otherwise the default action button.
    const target = inputRef.current ?? panelRef.current?.querySelector<HTMLElement>('[data-autofocus]');
    target?.focus();
    if (target === inputRef.current) inputRef.current?.select();
    return () => previouslyFocused?.focus?.();
  }, []);

  // Esc cancels; Tab is trapped inside the panel.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
        return;
      }
      if (e.key === 'Tab') {
        const focusable = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (!focusable || focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [cancel]);

  // Lock background scroll while the dialog is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const danger = options.variant === 'danger';
  const confirmClass = danger
    ? 'bg-red-500 text-white hover:bg-red-600'
    : 'bg-terracotta text-white hover:bg-terracotta/90';

  const dialog = (
    <div
      className="dialog-backdrop fixed inset-0 z-[100] flex items-end justify-center p-0 md:items-center md:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}
    >
      <div
        ref={panelRef}
        role={kind === 'alert' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={options.message ? descId : undefined}
        className="dialog-panel relative max-h-[90dvh] w-full max-w-none overflow-y-auto rounded-t-2xl border border-water bg-parchment shadow-xl pb-[env(safe-area-inset-bottom)] md:max-w-sm md:rounded-xl md:pb-0"
      >
        {/* Grab-handle affordance for the mobile bottom sheet. */}
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-water md:hidden" />
        {/* Close (✕) at the top-right — always dismisses (cancel semantics). */}
        <button
          type="button"
          onClick={cancel}
          aria-label="Close"
          className="absolute right-2.5 top-2.5 z-10 flex h-7 w-7 items-center justify-center rounded-full text-base leading-none text-ink/45 transition-colors hover:bg-land hover:text-ink"
        >
          ✕
        </button>
        <div className="p-4 pr-10 space-y-2">
          <h2 id={titleId} className="font-serif text-lg font-bold text-ink">{options.title}</h2>
          {options.message && (
            <div id={descId} className="text-sm text-ink/60 leading-relaxed">{options.message}</div>
          )}
          {kind === 'prompt' && (
            <div className="pt-1">
              {options.label && <span className="block text-xs text-ink/50 mb-1">{options.label}</span>}
              {options.multiline ? (
                <textarea
                  ref={inputRef}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={options.placeholder}
                  rows={4}
                  className="w-full px-3 py-2 bg-surface border border-water rounded text-sm resize-none focus:outline-none focus:border-terracotta"
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); accept(); } }}
                />
              ) : (
                <input
                  ref={inputRef}
                  type="text"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={options.placeholder}
                  className="w-full px-3 py-2 bg-surface border border-water rounded text-sm focus:outline-none focus:border-terracotta"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); accept(); } }}
                />
              )}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-4 pb-4">
          {kind !== 'alert' && (
            <button
              type="button"
              onClick={cancel}
              className="px-3 py-1.5 text-sm rounded border border-water text-ink/70 hover:bg-land transition-colors"
            >
              {options.cancelLabel ?? 'Cancel'}
            </button>
          )}
          <button
            type="button"
            data-autofocus
            onClick={accept}
            disabled={kind === 'prompt' && options.required ? !value.trim() : false}
            className={`px-3 py-1.5 text-sm rounded font-medium transition-colors disabled:opacity-50 ${confirmClass}`}
          >
            {options.confirmLabel ?? (kind === 'confirm' ? 'Confirm' : kind === 'prompt' ? 'Save' : 'OK')}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}
