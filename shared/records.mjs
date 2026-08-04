// Upstream access to the drupal.org contribution records API. Shared by the Netlify
// function and the local dev middleware so both paths behave identically.
// https://www.drupal.org/drupalorg/docs/apis/rest-and-other-apis#s-contribution-records

const ENDPOINT = 'https://new.drupal.org/contribution-records-by-user';
const PAGE_SIZE = 50;
const MAX_CONCURRENCY = 8;
// Page fan-out, not query time, is the real ceiling: a very active account has thousands
// of records (5000+ is ~110 pages), which no synchronous function can collect in time.
// Past the cap the newest records are returned and the response is flagged truncated.
const MAX_PAGES = 24;
// All-time queries are slow on a cold upstream cache — an account nobody has asked for
// in a while can take half a minute, well past the function's own budget. Bail out early
// with a useful message; the attempt warms drupal.org's cache, so a retry is fast.
const PAGE_TIMEOUT_MS = 8000;

export class UnknownUserError extends Error {
  constructor(username) {
    super(`No drupal.org user named "${username}".`);
    this.name = 'UnknownUserError';
  }
}

export class UpstreamTimeoutError extends Error {
  constructor() {
    super('drupal.org did not answer in time (cold cache for this account). Try again shortly.');
    this.name = 'UpstreamTimeoutError';
  }
}

/** Reads the issue id off a record's source link (…/-/work_items/3574246). */
function issueId(uri) {
  const match = /(\d+)\s*$/.exec(uri || '');
  return match ? match[1] : null;
}

function normalize(node) {
  const a = node.attributes;
  return {
    nid: a.drupal_internal__nid,
    title: a.title,
    project: a.field_project_name,
    // The credit date — when the issue reached its final status, not when the record was created.
    credited: (a.field_last_status_change || a.changed).slice(0, 10),
    issue: issueId(a.field_source_link?.uri),
  };
}

/** An abort can surface on the fetch itself or on the body read, wrapped or not. */
function isTimeout(error) {
  for (let current = error; current; current = current.cause) {
    if (current.name === 'TimeoutError' || current.name === 'AbortError') return true;
  }
  return false;
}

async function fetchPage(username, page, months) {
  const params = new URLSearchParams({ username, is_sa: '0', page: String(page) });
  if (months) params.set('months', String(months));
  try {
    // The friendly endpoint 302s to the JSON:API view with the resolved uid; fetch follows it.
    const response = await fetch(`${ENDPOINT}?${params}`, {
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`drupal.org returned HTTP ${response.status}.`);
    }
    // An unknown username redirects to the drupal.org homepage, which is HTML.
    if (!response.headers.get('content-type')?.includes('json')) {
      throw new UnknownUserError(username);
    }
    const body = await response.json();
    return { records: body.data.map(normalize), total: Number(body.meta?.count ?? 0) };
  } catch (cause) {
    if (isTimeout(cause)) throw new UpstreamTimeoutError();
    throw cause;
  }
}

/** Runs tasks with a concurrency cap, keeping input order in the result. */
async function pooled(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]();
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Contribution records for a username, security advisories excluded. Omit `months`
 * for all-time. Page 0 reveals the total, so the rest are fetched in parallel —
 * sequential paging would blow the function's time budget.
 */
export async function fetchAllRecords(username, { months } = {}) {
  const first = await fetchPage(username, 0, months);
  const pageCount = Math.min(Math.ceil(first.total / PAGE_SIZE), MAX_PAGES);
  const rest = await pooled(
    Array.from(
      { length: Math.max(0, pageCount - 1) },
      (_, i) => () => fetchPage(username, i + 1, months),
    ),
    MAX_CONCURRENCY,
  );
  const records = [first, ...rest].flatMap((page) => page.records);
  return {
    username,
    months: months ?? null,
    fetchedAt: new Date().toISOString(),
    total: first.total,
    truncated: records.length < first.total,
    records,
  };
}
