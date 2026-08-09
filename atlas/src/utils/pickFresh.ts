/**
 * Pick an item from `items` that hasn't been shown recently, so repeat visits
 * surface something new instead of the same thing by chance. Recently-shown ids
 * are remembered per `bucket` in localStorage; once the whole pool has been seen
 * it resets and starts over. Falls back to a plain random pick if storage is
 * unavailable.
 */
export function pickFresh<T>(
  bucket: string,
  items: T[],
  idOf: (item: T) => string = (x) => String(x),
): T | undefined {
  if (!items.length) return undefined;
  const key = `meridian_seen:${bucket}`;

  let recent: string[] = ((): string[] => {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  const recentSet = new Set(recent);
  let pool = items.filter((it) => !recentSet.has(idOf(it)));
  if (!pool.length) {
    // Whole pool exhausted — reset and pick from everything again.
    pool = items;
    recent = [];
  }

  const chosen = pool[Math.floor(Math.random() * pool.length)];
  const id = idOf(chosen);
  // Keep the recency window just shy of the pool size so we never block every option.
  // `items.length >= 1` (guarded above), so `cap` is always >= 0.
  const cap = Math.min(items.length - 1, 50);
  const next = [...recent.filter((r) => r !== id), id].slice(-cap);
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // storage unavailable; the random pick above is still fine
  }
  return chosen;
}
