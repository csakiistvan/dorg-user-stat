// Request handling shared by the Netlify functions and the local dev middleware, so both
// paths behave identically.
//
// Every source answers with a single page. One request per page is what keeps large accounts
// working: the function's time budget applies per invocation, so four pages of a few seconds
// each succeed where one request collecting them all runs out of time.

import { resolveUser, UnknownUserError, UpstreamTimeoutError } from './user.mjs';
import { fetchRecords } from './records.mjs';
import { cutoffFor, fetchD7CommentedIssues } from './comments.mjs';
import { fetchGitlabCommentedIssues } from './gitlab.mjs';
import { DEFAULT_RANGE, isRange, resolveRange } from './range.mjs';

const SOURCES = {
  records: fetchRecords,
  comments: fetchD7CommentedIssues,
  gitlab: fetchGitlabCommentedIssues,
};

/** Runs one page of one source and returns { status, body }. */
export async function handle(source, query) {
  const input = query.get('user');
  if (!input?.trim()) {
    return { status: 400, body: { error: 'Missing user.' } };
  }
  if (!SOURCES[source]) {
    return { status: 400, body: { error: `Unknown source "${source}".` } };
  }
  const requested = query.get('range');
  const range = isRange(requested) ? requested : DEFAULT_RANGE;
  const page = Math.max(0, Number(query.get('page')) || 0);

  try {
    const user = await resolveUser(input);
    const window = resolveRange(range);
    // Neither comment source has a server-side date filter, so both walk until a page reaches
    // past an exact cutoff. Without one — 2y and 5y only carry a month count — GitLab would
    // walk the account's entire event history.
    const options =
      source === 'gitlab' ? { ...window, from: cutoffFor(window) } : { ...window };
    const payload = await SOURCES[source](user.uid, { ...options, page });
    // A missing GitLab account is not an error: most of the app works without one.
    if (!payload) {
      return { status: 200, body: { user, range, source, unavailable: true, issues: [], hasMore: false } };
    }
    return {
      status: 200,
      body: { user, range, source, from: window.from ?? null, fetchedAt: new Date().toISOString(), ...payload },
    };
  } catch (cause) {
    if (cause instanceof UnknownUserError) return { status: 404, body: { error: cause.message } };
    if (cause instanceof UpstreamTimeoutError) return { status: 504, body: { error: cause.message } };
    return { status: 502, body: { error: `Upstream error: ${cause.message}` } };
  }
}
