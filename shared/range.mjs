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
