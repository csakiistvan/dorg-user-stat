// Client side of the paged API. Every /api/* source answers with a single page, because the
// function's time budget applies per invocation — so stitching the pages together is this
// file's job, and progress is reported as they land rather than after the last one.
//
// Upstream is slow and cold caches time out, so no single page failing is allowed to throw
// away the pages that did arrive: a page is retried, and what is still missing at the end is
// reported as partial rather than as an error.

import { issueKey } from './aggregate.js';

// A stop for runaway histories: past this the newest pages are kept and the result is
// flagged truncated, which the UI owns up to.
const MAX_PAGES = 40;
// Two at a time: the upstream view takes seconds on a cold cache, and a wider burst makes
// every page in it time out rather than making the set arrive sooner.
const RECORD_CONCURRENCY = 2;
const RETRY_DELAYS = [800, 2500];

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });

class PageError extends Error {}

async function attempt(source, query, page, signal) {
  const params = new URLSearchParams(query);
  params.set('page', String(page));
  const response = await fetch(`/api/${source}?${params}`, { signal });
  const body = await response.json();
  if (response.ok) return body;
  const error = new PageError(body.error || `HTTP ${response.status}`);
  // A timeout or a bad gateway is worth another go; a 404 for an unknown user is not.
  error.retryable = response.status === 504 || response.status === 502;
  throw error;
}

async function get(source, query, page, signal) {
  for (let tries = 0; ; tries++) {
    try {
      return await attempt(source, query, page, signal);
    } catch (cause) {
      if (cause.name === 'AbortError') throw cause;
      if (tries >= RETRY_DELAYS.length || cause.retryable === false) throw cause;
      await sleep(RETRY_DELAYS[tries], signal);
    }
  }
}

/**
 * Walks a source page by page until it reports no more. Sequential by necessity: `hasMore` is
 * what tells us the cutoff has been reached, so the next page is only known to be wanted once
 * the current one is in. A page that will not come ends the walk with what was collected.
 */
async function walk(source, query, signal, onPage) {
  const pages = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    let body;
    try {
      body = await get(source, query, page, signal);
    } catch (cause) {
      if (cause.name === 'AbortError') throw cause;
      // The first page failing means there is nothing to show; a later one only means the
      // tail of the history is missing.
      if (!pages.length) throw cause;
      return { pages, truncated: true, partial: true };
    }
    pages.push(body);
    onPage?.(body, pages);
    if (!body.hasMore) return { pages, truncated: false, partial: false };
  }
  return { pages, truncated: true, partial: false };
}

/**
 * Contribution records. Page 0 reveals the page count, so the rest go out a couple at a time —
 * a heavy account is four to twenty pages, and walking them strictly in series is a long wait.
 * Pages that never arrive are counted, not fatal.
 */
export async function loadRecords(query, { signal, onProgress } = {}) {
  const first = await get('records', query, 0, signal);
  const pageCount = Math.min(first.pageCount || 1, MAX_PAGES);
  const records = [...first.records];
  let failed = 0;
  const report = (pages) =>
    onProgress?.({ loaded: records.length, total: first.total, pages, pageCount, failed });
  report(1);

  const rest = Array.from({ length: pageCount - 1 }, (_, index) => index + 1);
  let done = 1;
  for (let start = 0; start < rest.length; start += RECORD_CONCURRENCY) {
    const batch = await Promise.all(
      rest.slice(start, start + RECORD_CONCURRENCY).map((page) =>
        get('records', query, page, signal).catch((cause) => {
          if (cause.name === 'AbortError') throw cause;
          failed++;
          return null;
        }),
      ),
    );
    for (const body of batch) if (body) records.push(...body.records);
    done += batch.length;
    report(done);
  }

  return {
    user: first.user,
    range: first.range,
    fetchedAt: first.fetchedAt,
    records,
    total: first.total,
    // Two different gaps, both meaning "fewer records than the total shown": more pages than
    // the cap allows, or pages that kept timing out.
    truncated: (first.pageCount || 1) > MAX_PAGES,
    failedPages: failed,
    pageCount,
  };
}

/**
 * Merges commented issues by project and issue number, keeping the newest comment date and
 * the summed count. The number alone is not unique: a GitLab work item id belongs to its
 * project, so the same number can name a different issue — or a release node — elsewhere.
 */
function merge(...sets) {
  const issues = new Map();
  for (const list of sets) {
    for (const entry of list) {
      const existing = issues.get(issueKey(entry));
      if (!existing) {
        issues.set(issueKey(entry), { ...entry });
        continue;
      }
      existing.comments += entry.comments;
      if (entry.at > existing.at) existing.at = entry.at;
      // Prefer the drupal.org issue page over the GitLab work item when both are known.
      if (entry.url?.includes('www.drupal.org')) existing.url = entry.url;
    }
  }
  return [...issues.values()].sort((a, b) => b.at.localeCompare(a.at));
}

function collect(pages) {
  return pages.flatMap((body) => body.issues ?? []);
}

/**
 * Issues the user commented on, from both places that hold them. Issues migrated to GitLab
 * work items, so the legacy api-d7 endpoint holds the older history and the GitLab event
 * stream the newer; neither is complete on its own.
 *
 * Either side may fail without costing us the other, so both settle independently.
 */
export async function loadActivity(query, { signal, onProgress } = {}) {
  const progress = { comments: null, gitlab: null };
  const report = (side, value) => {
    progress[side] = value;
    onProgress?.({ ...progress });
  };
  const rethrowAbort = (cause) => {
    if (cause.name === 'AbortError') throw cause;
    return null;
  };

  const [comments, gitlab] = await Promise.all([
    walk('comments', query, signal, (body, pages) =>
      report('comments', { issues: collect(pages).length, pages: pages.length }),
    ).catch(rethrowAbort),
    walk('gitlab', query, signal, (body, pages) =>
      report('gitlab', {
        issues: collect(pages).length,
        pages: pages.length,
        pageCount: pages[0]?.pageCount ?? null,
        unavailable: Boolean(pages[0]?.unavailable),
      }),
    ).catch(rethrowAbort),
  ]);

  if (!comments && !gitlab) throw new Error('Comment history unavailable.');

  const d7Issues = comments ? collect(comments.pages) : [];
  const gitlabPages = gitlab?.pages ?? [];
  const gitlabIssues = collect(gitlabPages);
  const gitlabFound = gitlabPages.length > 0 && !gitlabPages[0].unavailable;

  return {
    issues: merge(d7Issues, gitlabIssues),
    truncated: Boolean(comments?.truncated) || Boolean(gitlab?.truncated),
    sources: {
      comments: comments ? d7Issues.length : null,
      gitlab: gitlabFound ? gitlabIssues.length : null,
      gitlabUser: gitlabPages.find((body) => body.username)?.username ?? null,
      gitlabRateLimited: gitlabPages.some((body) => body.rateLimited),
      gitlabIncomplete: gitlabPages.some((body) => body.incomplete),
      // One side missing entirely, or a walk that stopped short of the cutoff.
      commentsFailed: !comments,
      gitlabFailed: !gitlab,
    },
  };
}
