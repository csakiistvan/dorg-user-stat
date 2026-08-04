// Issue comments from the legacy api-d7 endpoint — the only public trace of work that
// has not been credited (yet). Note this measures what was *posted* on drupal.org, not
// what was worked on privately.
// https://www.drupal.org/drupalorg/docs/apis/rest-and-other-apis

import { fetchJson, pooled, MAX_PAGES, MAX_CONCURRENCY } from './fetch.mjs';

const ENDPOINT = 'https://www.drupal.org/api-d7/comment.json';
const ISSUE_URL = /\/project\/([^/]+)\/issues\/(\d+)/;

function normalize(comment) {
  // The comment URL is the only place carrying the project machine name.
  const match = ISSUE_URL.exec(comment.url || '');
  if (!match) return null;
  return {
    project: match[1],
    issue: comment.node?.id ?? match[2],
    at: new Date(Number(comment.created) * 1000).toISOString().slice(0, 10),
  };
}

async function fetchPage(uid, page) {
  const params = new URLSearchParams({
    author: uid,
    sort: 'created',
    direction: 'DESC',
    page: String(page),
  });
  const body = await fetchJson(`${ENDPOINT}?${params}`);
  return {
    comments: (body?.list ?? []).map(normalize).filter(Boolean),
    // Total pages are only discoverable from the "last" pager link.
    lastPage: Number(/page=(\d+)/.exec(body?.last || '')?.[1] ?? 0),
  };
}

function cutoffDate(months) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date.toISOString().slice(0, 10);
}

/** This endpoint has no server-side date filter, so an exact cutoff costs nothing extra. */
function cutoffFor({ months, from }) {
  if (from) return from;
  return months ? cutoffDate(months) : null;
}

/**
 * Issues the user commented on, newest comment first, one entry per issue.
 * Within a range the pages are walked in order and stopped at the cutoff, which is far
 * cheaper than collecting an entire history; for all-time, pages go out in parallel.
 */
export async function fetchCommentedIssues(uid, options = {}) {
  const first = await fetchPage(uid, 0);
  const pages = [first];
  const cutoff = cutoffFor(options);

  const reachedCutoff = (page) => page.comments.some((comment) => comment.at < cutoff);
  const pageLimit = Math.min(first.lastPage, MAX_PAGES - 1);
  let truncated;

  if (cutoff) {
    // Walk in order until a comment older than the cutoff proves the range is covered.
    let covered = reachedCutoff(first);
    let page = 1;
    while (!covered && page <= first.lastPage && page < MAX_PAGES) {
      const next = await fetchPage(uid, page++);
      pages.push(next);
      covered = reachedCutoff(next);
    }
    // Covered either by an older comment turning up, or by having read every page.
    truncated = !covered && page <= first.lastPage;
  } else {
    pages.push(
      ...(await pooled(
        Array.from({ length: Math.max(0, pageLimit) }, (_, i) => () => fetchPage(uid, i + 1)),
        MAX_CONCURRENCY,
      )),
    );
    truncated = first.lastPage > pageLimit;
  }

  const comments = pages
    .flatMap((page) => page.comments)
    .filter((comment) => !cutoff || comment.at >= cutoff);

  // One entry per issue, carrying the newest comment date and how many comments there are.
  const issues = new Map();
  for (const comment of comments) {
    const existing = issues.get(comment.issue);
    if (existing) {
      existing.comments++;
      if (comment.at > existing.at) existing.at = comment.at;
      continue;
    }
    issues.set(comment.issue, { ...comment, comments: 1 });
  }

  return {
    issues: [...issues.values()].sort((a, b) => b.at.localeCompare(a.at)),
    commentCount: comments.length,
    truncated,
  };
}
