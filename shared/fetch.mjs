// Shared paging primitives for both data sources.

export const PAGE_SIZE = 50;
export const MAX_CONCURRENCY = 8;
// Page fan-out, not query time, is the ceiling: a very active account has thousands of
// records, which no synchronous function can collect. Past the cap the newest items are
// returned and the response is flagged truncated.
export const MAX_PAGES = 24;

export { fetchJson, UnknownUserError, UpstreamTimeoutError } from './user.mjs';

/** Runs tasks with a concurrency cap, keeping input order in the result. */
export async function pooled(tasks, limit) {
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
