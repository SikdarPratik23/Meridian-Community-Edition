import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Optional localized fallback — use to isolate one feature (e.g. the map) so a
   *  crash there shows a small notice instead of replacing the whole app. */
  fallback?: ReactNode;
}
interface State { error: Error | null }

/**
 * Catches render/lifecycle errors anywhere below it and shows a recoverable
 * message instead of letting the error unmount the whole tree (a white screen,
 * which would otherwise trip the global catcher in index.html and replace the
 * page). Your saved data is untouched — only the current render failed.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Meridian render error:', error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <div className="flex min-h-dvh items-center justify-center bg-parchment p-6 text-ink">
        <div className="max-w-md space-y-3 text-center">
          <div className="text-3xl">🗺️</div>
          <div className="font-serif text-lg font-bold">Something went wrong</div>
          <p className="text-sm text-ink/60">
            Meridian hit an unexpected error while drawing the screen. Your saved entries
            are safe — a reload usually clears it.
          </p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-land p-3 text-left text-[11px] text-ink/60">
            {error.message}
          </pre>
          <button
            onClick={() => location.reload()}
            className="rounded bg-terracotta px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-terracotta/90"
          >
            Reload Meridian
          </button>
        </div>
      </div>
    );
  }
}
