// Time ranges the UI offers. The upstream view only understands "N months ago" — absolute
// dates are silently ignored and return nothing — so the current year is requested as the
// months elapsed this year and then trimmed to January 1st exactly.

export const DEFAULT_RANGE = 'year';

/** Maps a range key to { months, from }: an upstream window plus an optional exact cutoff. */
export function resolveRange(key = DEFAULT_RANGE) {
  const now = new Date();
  switch (key) {
    case 'all':
      return {};
    case '2y':
      return { months: 24 };
    case '5y':
      return { months: 60 };
    case 'year':
    default:
      return {
        months: now.getMonth() + 1,
        from: `${now.getFullYear()}-01-01`,
      };
  }
}

export function isRange(key) {
  return ['year', '2y', '5y', 'all'].includes(key);
}

/**
 * Ranges nest — this year is inside 2y is inside 5y is inside all-time — so a narrower view
 * can be cut out of a wider one that has already been fetched. Ordering them makes that
 * containment testable.
 */
const WIDTH = { year: 0, '2y': 1, '5y': 2, all: 3 };

export function contains(outer, inner) {
  return WIDTH[outer] >= WIDTH[inner];
}

/**
 * The exact date a range begins, or null for all-time. The upstream view only understands
 * "N months ago", so a fetched 2y may reach a few days further back than this — trimming a
 * wider result with it is therefore slightly stricter than refetching, never looser.
 */
export function rangeCutoff(key) {
  const { months, from } = resolveRange(key);
  if (from) return from;
  if (!months) return null;
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date.toISOString().slice(0, 10);
}
