// Request handling shared by the Netlify functions and the local dev middleware, so both
// paths behave identically.

import { resolveUser, UnknownUserError, UpstreamTimeoutError } from './user.mjs';
import { fetchRecords } from './records.mjs';
import { fetchCommentedIssues } from './comments.mjs';
import { DEFAULT_RANGE, isRange, resolveRange } from './range.mjs';

const SOURCES = {
  records: fetchRecords,
  activity: fetchCommentedIssues,
};

/**
 * Resolves the user, runs the requested source and returns { status, body }.
 * `source` is 'records' or 'activity'.
 */
export async function handle(source, query) {
  const input = query.get('user') ?? query.get('username');
  if (!input?.trim()) {
    return { status: 400, body: { error: 'Missing user.' } };
  }
  const requested = query.get('range');
  const range = isRange(requested) ? requested : DEFAULT_RANGE;

  try {
    const user = await resolveUser(input);
    const window = resolveRange(range);
    const payload = await SOURCES[source](user.uid, window);
    return {
      status: 200,
      body: {
        user,
        range,
        from: window.from ?? null,
        fetchedAt: new Date().toISOString(),
        ...payload,
      },
    };
  } catch (cause) {
    if (cause instanceof UnknownUserError) return { status: 404, body: { error: cause.message } };
    if (cause instanceof UpstreamTimeoutError) return { status: 504, body: { error: cause.message } };
    return { status: 502, body: { error: `Upstream error: ${cause.message}` } };
  }
}
