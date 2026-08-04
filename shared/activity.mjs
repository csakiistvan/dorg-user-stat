// Issues the user commented on, merged from both places that hold them.
//
// Issues migrated to GitLab work items, so the legacy api-d7 comment endpoint holds the older
// history and the GitLab event stream the newer. Neither is complete on its own: measured on
// one account, 62 of 100 GitLab issues were missing from api-d7, and api-d7 reaches back years
// where GitLab activity only starts at the migration.

import { cutoffFor, fetchD7CommentedIssues } from './comments.mjs';
import { fetchGitlabCommentedIssues } from './gitlab.mjs';

/**
 * Merges by project and issue number, keeping the newest comment date and the summed count.
 * The number alone is not unique: a GitLab work item id belongs to its project, so the same
 * number can name a different issue — or a release node — elsewhere.
 */
function merge(...sets) {
  const issues = new Map();
  for (const list of sets) {
    for (const entry of list) {
      const key = `${entry.project}#${entry.issue}`;
      const existing = issues.get(key);
      if (!existing) {
        issues.set(key, { ...entry });
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

export async function fetchCommentedIssues(uid, options = {}) {
  const cutoff = cutoffFor(options);
  // api-d7 comes first: its issue URLs carry project names, which spares GitLab lookups.
  const d7 = await fetchD7CommentedIssues(uid, options);
  const knownProjects = new Map(d7.issues.map((issue) => [issue.issue, issue.project]));

  // A GitLab failure must not cost us the api-d7 history, so it may come back empty.
  const gitlab = await fetchGitlabCommentedIssues(uid, { from: cutoff, knownProjects }).catch(
    () => null,
  );

  const issues = merge(d7.issues, gitlab?.issues ?? []);
  return {
    issues,
    commentCount: issues.reduce((sum, issue) => sum + issue.comments, 0),
    truncated: d7.truncated || Boolean(gitlab?.truncated),
    sources: {
      comments: d7.issues.length,
      gitlab: gitlab ? gitlab.issues.length : null,
      gitlabUser: gitlab?.username ?? null,
      gitlabRateLimited: Boolean(gitlab?.rateLimited),
    },
  };
}
