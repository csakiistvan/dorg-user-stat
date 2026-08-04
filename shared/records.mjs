// Upstream access to the drupal.org contribution records API. Shared by the Netlify
// function and the local dev middleware so both paths behave identically.
// https://www.drupal.org/drupalorg/docs/apis/rest-and-other-apis#s-contribution-records

const ENDPOINT = 'https://new.drupal.org/contribution-records-by-user';
// The friendly endpoint only resolves usernames, and a profile URL is not one: /u/admitriiev
// belongs to the user "a.dmitriiev". Numeric input therefore goes straight to the view the
// friendly endpoint redirects to, skipping the name lookup.
const VIEW = 'https://new.drupal.org/jsonapi/views/contribution_records/by_user';
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
    super(
      `No drupal.org user named "${username}". Profile URLs drop dots — /u/admitriiev is the ` +
        'user "a.dmitriiev" — so use the exact username or the numeric user ID.',
    );
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

const PROFILE_URL = /drupal\.org\/u(?:ser)?\/([^/?#]+)/i;

/**
 * A profile page carries its own uid in the shortlink meta tag, which is the only
 * dependable way back from an alias: /u/admitriiev is the user "a.dmitriiev".
 */
async function uidFromProfile(alias) {
  const response = await fetch(`https://www.drupal.org/u/${encodeURIComponent(alias)}`, {
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
  });
  if (!response.ok) throw new UnknownUserError(alias);
  const uid = /rel="shortlink" href="[^"]*\/user\/(\d+)"/.exec(await response.text())?.[1];
  if (!uid) throw new UnknownUserError(alias);
  return uid;
}

/**
 * Turns whatever the user pasted — profile URL, username or numeric id — into
 * something the records endpoints accept.
 */
export async function resolveUser(input) {
  const value = input.trim();
  if (/^\d+$/.test(value)) return value;

  const match = PROFILE_URL.exec(value);
  if (!match) return value;

  const segment = decodeURIComponent(match[1]);
  // /user/3235287 already is the id; /u/<alias> needs the profile page.
  return /^\d+$/.test(segment) ? segment : uidFromProfile(segment);
}

/** Numeric input is a user ID, anything else a username. */
function pageUrl(user, page, months) {
  if (/^\d+$/.test(user)) {
    const params = new URLSearchParams({
      'views-argument[0]': user,
      'views-filter[field_is_sa_value]': '0',
      page: String(page),
    });
    if (months) params.set('views-filter[last_status_change]', `${months} months ago`);
    return `${VIEW}?${params}`;
  }
  const params = new URLSearchParams({ username: user, is_sa: '0', page: String(page) });
  if (months) params.set('months', String(months));
  return `${ENDPOINT}?${params}`;
}

async function fetchPage(username, page, months) {
  try {
    // The friendly endpoint 302s to the JSON:API view with the resolved uid; fetch follows it.
    const response = await fetch(pageUrl(username, page, months), {
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
export async function fetchAllRecords(input, { months } = {}) {
  let user = await resolveUser(input);
  let first;
  try {
    first = await fetchPage(user, 0, months);
  } catch (cause) {
    // A bare name the endpoint cannot resolve may still be a profile alias.
    if (!(cause instanceof UnknownUserError)) throw cause;
    user = await uidFromProfile(user);
    first = await fetchPage(user, 0, months);
  }
  const pageCount = Math.min(Math.ceil(first.total / PAGE_SIZE), MAX_PAGES);
  const rest = await pooled(
    Array.from(
      { length: Math.max(0, pageCount - 1) },
      (_, i) => () => fetchPage(user, i + 1, months),
    ),
    MAX_CONCURRENCY,
  );
  const records = [first, ...rest].flatMap((page) => page.records);
  return {
    // What was asked for, and what it turned out to be — the app links back to the profile.
    input: input.trim(),
    user,
    months: months ?? null,
    fetchedAt: new Date().toISOString(),
    total: first.total,
    truncated: records.length < first.total,
    records,
  };
}
