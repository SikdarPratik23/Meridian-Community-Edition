/**
 * Fuzzy matching for the command palette.
 *
 * The palette has to answer one question well: given a few characters, which of a
 * few hundred candidates (every entry, day, trip, and action) did the user mean?
 * Substring matching is too strict — nobody types `zugspitze` in full — and a
 * naive subsequence match is too loose, matching `set` inside "the **s**umm**e**r
 * of Augus**t**". So this is a SCORED subsequence match: every candidate character
 * must appear in order, but where they appear decides the ranking.
 *
 * What earns points, in descending order of weight:
 *   - matching at the start of the text (you usually type the beginning)
 *   - matching at the start of a word (`ny` should find "New York")
 *   - consecutive matches (a real substring beats scattered letters)
 *   - matching a shorter text (a precise hit beats one buried in a long entry)
 *
 * Kept pure and separate from the React component so the ranking can be tested
 * directly — "does the obvious thing come first?" is exactly the kind of question
 * that's painful to verify by clicking and trivial to assert.
 */

/** How a single candidate scored, plus which characters matched (for highlighting). */
export interface MatchResult {
  score: number;
  /** Indices in the target string that matched, in order. */
  indices: number[];
}

const SCORE_START_OF_TEXT = 40;
const SCORE_START_OF_WORD = 18;
const SCORE_CONSECUTIVE = 12;
const SCORE_MATCH = 2;
/** Subtracted per character skipped between matches, so tight matches win. */
const PENALTY_GAP = 0.4;

/** Characters that begin a new "word" for scoring purposes. */
function isBoundary(char: string): boolean {
  return char === ' ' || char === '-' || char === '_' || char === '/' || char === '.' || char === ',';
}

/**
 * Score `query` against `text`. Returns null when the query isn't a subsequence of
 * the text at all (i.e. no match), rather than a zero score — callers filter on
 * null, and a real match can legitimately score low.
 *
 * An empty query matches everything with score 0, which keeps the palette's
 * default (unfiltered) listing in its natural order.
 */
export function fuzzyMatch(query: string, text: string): MatchResult | null {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0, indices: [] };

  const haystack = text.toLowerCase();
  if (q.length > haystack.length) return null;

  const indices: number[] = [];
  let score = 0;
  let cursor = 0;
  let previousMatch = -2;

  for (const needle of q) {
    const found = haystack.indexOf(needle, cursor);
    if (found === -1) return null;

    if (found === 0) {
      score += SCORE_START_OF_TEXT;
    } else if (isBoundary(haystack[found - 1])) {
      score += SCORE_START_OF_WORD;
    } else {
      score += SCORE_MATCH;
    }

    if (found === previousMatch + 1) score += SCORE_CONSECUTIVE;
    else if (previousMatch >= 0) score -= (found - previousMatch - 1) * PENALTY_GAP;

    indices.push(found);
    previousMatch = found;
    cursor = found + 1;
  }

  // Prefer a hit in a short label over the same hit buried in a long one.
  score += Math.max(0, 20 - haystack.length * 0.08);
  return { score, indices };
}

/** Anything rankable: something with text to match and an optional keyword list. */
export interface Rankable {
  /** The text shown and matched against. */
  label: string;
  /** Extra terms that should also find this item but aren't displayed —
   *  e.g. a place name for an entry, or "dark" for the theme toggle. */
  keywords?: string[];
}

export interface Ranked<T> {
  item: T;
  score: number;
  /** Matched indices within `label`, or empty when the match came from a keyword. */
  indices: number[];
}

/**
 * Rank candidates against a query, best first, dropping non-matches.
 *
 * A keyword match scores slightly LOWER than the same match in the visible label,
 * so a result whose highlighted text explains itself outranks one that matched on
 * something invisible. Ties break on label length then alphabetically, so the
 * order is deterministic — without that, equally-scored results shuffle between
 * keystrokes, which reads as flicker.
 */
export function rank<T extends Rankable>(items: T[], query: string, limit = 40): Array<Ranked<T>> {
  const q = query.trim();

  // With no query there is nothing to rank BY, and the tie-breaks below would
  // alphabetise — scrambling the caller's deliberate order (actions first, then
  // most-recent entries), which is the palette's whole default listing.
  if (!q) {
    return items.slice(0, limit).map((item) => ({ item, score: 0, indices: [] }));
  }

  const results: Array<Ranked<T>> = [];

  for (const item of items) {
    const labelMatch = fuzzyMatch(q, item.label);
    let best: Ranked<T> | null = labelMatch
      ? { item, score: labelMatch.score, indices: labelMatch.indices }
      : null;

    for (const keyword of item.keywords ?? []) {
      const keywordMatch = fuzzyMatch(q, keyword);
      if (!keywordMatch) continue;
      const score = keywordMatch.score * 0.8;
      if (!best || score > best.score) best = { item, score, indices: [] };
    }

    if (best) results.push(best);
  }

  results.sort(
    (a, b) =>
      b.score - a.score ||
      a.item.label.length - b.item.label.length ||
      a.item.label.localeCompare(b.item.label),
  );
  return results.slice(0, limit);
}

/**
 * Split a label into matched / unmatched runs, for highlighting. Returns an
 * alternating list so the renderer can just map over it — no index arithmetic in
 * the component.
 */
export function highlightParts(label: string, indices: number[]): Array<{ text: string; match: boolean }> {
  if (!indices.length) return [{ text: label, match: false }];

  const parts: Array<{ text: string; match: boolean }> = [];
  const matched = new Set(indices);
  let run = '';
  let runIsMatch = matched.has(0);

  for (let i = 0; i < label.length; i++) {
    const isMatch = matched.has(i);
    if (isMatch === runIsMatch) {
      run += label[i];
    } else {
      if (run) parts.push({ text: run, match: runIsMatch });
      run = label[i];
      runIsMatch = isMatch;
    }
  }
  if (run) parts.push({ text: run, match: runIsMatch });
  return parts;
}
