// Issue comments from the legacy api-d7 endpoint — the only public trace of work that
// has not been credited (yet). Note this measures what was *posted* on drupal.org, not
// what was worked on privately.
// https://www.drupal.org/drupalorg/docs/apis/rest-and-other-apis

import { fetchJson } from './fetch.mjs';

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
    // Drop the #comment- fragment: the issue page is what the chip should open.
    url: `https://www.drupal.org/project/${match[1]}/issues/${match[2]}`,
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
export function cutoffFor({ months, from }) {
  if (from) return from;
  return months ? cutoffDate(months) : null;
}

/**
 * One page of commented issues, newest comment first. Comments are explicitly sorted by
 * creation date, so a page holding anything older than the cutoff ends the walk.
 */
export async function fetchD7CommentedIssues(uid, options = {}) {
  const page = options.page ?? 0;
  const cutoff = cutoffFor(options);
  const { comments, lastPage } = await fetchPage(uid, page);
  const inRange = cutoff ? comments.filter((comment) => comment.at >= cutoff) : comments;
  const reachedCutoff = Boolean(cutoff) && inRange.length < comments.length;

  // One entry per issue, carrying the newest comment date and how many comments there are.
  const issues = new Map();
  for (const comment of inRange) {
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
    page,
    pageCount: lastPage + 1,
    hasMore: !reachedCutoff && page < lastPage,
  };
}
