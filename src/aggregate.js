/** Records per YYYY-MM, keyed by credit date. */
export function recordsByMonth(records) {
  const months = {};
  for (const record of records) {
    const key = record.credited.slice(0, 7);
    months[key] = (months[key] || 0) + 1;
  }
  return months;
}

/** [project machine name, issue ids] pairs — newest credit first, biggest project first. */
export function recordsByProject(records) {
  const projects = new Map();
  for (const record of [...records].sort((a, b) => b.credited.localeCompare(a.credited))) {
    if (!projects.has(record.project)) projects.set(record.project, []);
    projects.get(record.project).push(record.issue);
  }
  return [...projects.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );
}

export function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Every month from the earliest key up to `through`, gaps included. Runs to the current
 * month by default, so the current year is always on the axis even with nothing in it yet.
 */
export function monthSequence(months, through = currentMonth()) {
  const keys = [...Object.keys(months), through].sort();
  const [firstYear, firstMonth] = keys[0].split('-').map(Number);
  const [lastYear, lastMonth] = keys[keys.length - 1].split('-').map(Number);
  const sequence = [];
  for (
    let year = firstYear, month = firstMonth;
    year < lastYear || (year === lastYear && month <= lastMonth);

  ) {
    sequence.push(`${year}-${String(month).padStart(2, '0')}`);
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return sequence;
}

export function bestMonth(months) {
  const entries = Object.entries(months);
  if (!entries.length) return null;
  return entries.reduce((best, entry) => (entry[1] > best[1] ? entry : best));
}

export function formatMonth(key, options = { month: 'short', year: 'numeric' }) {
  return new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en', { ...options, timeZone: 'UTC' });
}
