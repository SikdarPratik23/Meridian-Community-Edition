import { useEffect, useState } from 'react';

/**
 * Remembers the last value seen while `keep` was true — so a `<Presence>` exit
 * animation has real content to fade out with, instead of snapping to empty the
 * instant the underlying state clears (e.g. `stats.total` hitting 0, or a scroll
 * progress bar's value going `null`).
 *
 * Updates via effect rather than during render: mutating a ref mid-render is
 * disallowed by this project's lint config (`react-hooks/refs`), and deriving
 * state from a prop change by comparing against a ref is the same shape of
 * problem. The one-tick lag this costs is invisible in practice — `keep` only
 * ever flips to false in the SAME render that produces the "empty" value, so
 * the frozen copy is always exactly the render before that.
 */
export function useFrozen<T>(value: T, keep: boolean): T {
  const [frozen, setFrozen] = useState(value);
  useEffect(() => {
    if (!keep) return;
    // Syncing the frozen copy to the live value while `keep` is true — the
    // whole point of this hook, and harmless: it only ever fires alongside a
    // render this component was already doing for other reasons.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFrozen(value);
  }, [value, keep]);
  return keep ? value : frozen;
}
