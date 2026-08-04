// Issue comments from git.drupalcode.org. Issues migrated to GitLab work items, so recent
// discussion lives here and never reaches the legacy api-d7 comment endpoint.
//
// Only two things are readable without a token: a user lookup by exact username and a user's
// own event stream. Per-issue note lists answer 401, and ?search= answers 403.

import { pooled } from './fetch.mjs';

const API = 'https://git.drupalcode.org/api/v4';
const PER_PAGE = 100;
const TIMEOUT_MS = 8000;
// Unauthenticated callers get 180 requests per minute per IP (throttle_unauthenticated_api),
// and on a deployed function that budget is shared by every visitor. Project lookups are
// therefore capped per page, and both names and accounts are cached for the instance's life.
const MAX_PROJECT_LOOKUPS = 40;
const LOOKUP_CONCURRENCY = 8;

async function get(path, state) {
  const response = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (response.status === 429) {
    state.rateLimited = true;
    return null;
  }
  if (!response.ok) return null;
  return response.json();
}

/** Page 1 also reveals the page count, so the rest can be fetched in parallel. */
async function firstEventPage(id) {
  const response = await fetch(
    `${API}/users/${id}/events?action=commented&per_page=${PER_PAGE}&page=1`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (!response.ok) return null;
  return {
    events: await response.json(),
    totalPages: Number(response.headers.get('x-total-pages') ?? 1),
  };
}

/**
 * The GitLab username is not derivable from the drupal.org one — "gábor hojtsy" is "goba"
 * there — but the drupal.org profile links to the account, so read it from the profile page.
 */
export async function gitlabUsernameFor(uid) {
  const response = await fetch(`https://www.drupal.org/user/${uid}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const match = /git\.drupalcode\.org\/([A-Za-z0-9._-]+)/.exec(await response.text());
  return match?.[1] ?? null;
}

async function userId(username, state) {
  const users = await get(`/users?username=${encodeURIComponent(username)}`, state);
  return users?.[0]?.id ?? null;
}

/** Project ids come back numeric; the machine name needs a lookup, cached per instance. */
const projectNames = new Map();

async function projectName(projectId, state) {
  const project = await get(`/projects/${projectId}`, state);
  // Paths look like "project/<machine_name>"; anything else is not a contrib project.
  const name = project?.path_with_namespace?.replace(/^project\//, '') ?? null;
  if (name) projectNames.set(projectId, name);
  return name;
}

/**
 * Quick actions are bookkeeping, not work: over half of a busy account's comment events are
 * bodies like "/do:unassign me". Counting them would inflate the figure with noise.
 */
function isQuickActionOnly(body) {
  return body
    .trim()
    .split('\n')
    .every((line) => !line.trim() || line.trim().startsWith('/'));
}

/**
 * Issues the user commented on, from their GitLab event stream. Events arrive newest first,
 * so a cutoff stops the walk early. Returns null when the account cannot be located, which
 * is not an error — plenty of users have no GitLab activity to read.
 */
/** Resolving the account costs two requests, so remember it for the instance's life. */
const accounts = new Map();

async function accountFor(uid, state) {
  if (accounts.has(uid)) return accounts.get(uid);
  const username = await gitlabUsernameFor(uid);
  const id = username ? await userId(username, state) : null;
  const account = id ? { username, id } : null;
  accounts.set(uid, account);
  return account;
}

export async function fetchGitlabCommentedIssues(uid, { from, page = 0 } = {}) {
  const state = { rateLimited: false };
  const account = await accountFor(uid, state);
  if (!account) return null;

  const batch =
    page === 0
      ? await firstEventPage(account.id)
      : {
          events: await get(
            `/users/${account.id}/events?action=commented&per_page=${PER_PAGE}&page=${page + 1}`,
            state,
          ),
          totalPages: null,
        };
  if (!batch?.events) return null;

  // Events are newest first, so anything older than the cutoff ends the walk.
  const reachedCutoff =
    Boolean(from) && batch.events.some((event) => event.created_at.slice(0, 10) < from);

  const issues = new Map();
  for (const event of batch.events) {
    const note = event.note;
    if (note?.noteable_type !== 'Issue' || isQuickActionOnly(note.body)) continue;
    const at = event.created_at.slice(0, 10);
    if (from && at < from) continue;

    const issue = String(note.noteable_iid);
    const existing = issues.get(issue);
    if (existing) {
      existing.comments++;
      if (at > existing.at) existing.at = at;
      continue;
    }
    issues.set(issue, { issue, at, comments: 1, projectId: event.project_id });
  }

  // Only names not cached from earlier pages are looked up, capped to stay inside the limit.
  const entries = [...issues.values()];
  const unresolved = [
    ...new Set(entries.filter((e) => !projectNames.has(e.projectId)).map((e) => e.projectId)),
  ];
  await pooled(
    unresolved.slice(0, MAX_PROJECT_LOOKUPS).map((projectId) => () => projectName(projectId, state)),
    LOOKUP_CONCURRENCY,
  );

  const named = entries
    .map(({ projectId, ...entry }) => {
      const project = projectNames.get(projectId);
      return {
        ...entry,
        project,
        // Work item ids are per project, so only this URL identifies the issue. Building a
        // drupal.org/i/<id> link from the number would point at an unrelated node.
        url: project
          ? `https://git.drupalcode.org/project/${project}/-/work_items/${entry.issue}`
          : null,
      };
    })
    .filter((entry) => entry.project);

  return {
    username: account.username,
    issues: named,
    page,
    pageCount: batch.totalPages,
    hasMore: !reachedCutoff && batch.events.length === PER_PAGE,
    // Anything dropped for want of a project name is a gap the UI should own up to.
    incomplete: named.length < entries.length,
    rateLimited: state.rateLimited,
  };
}
