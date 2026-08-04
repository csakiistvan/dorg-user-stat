// Turning whatever was pasted into a numeric uid. Both data sources key on the uid:
// the contribution records view takes it as its argument, and the legacy comment
// endpoint filters by it, so resolving once keeps one cache key per user.

const API_D7 = 'https://www.drupal.org/api-d7';
const PROFILE_URL = /drupal\.org\/u(?:ser)?\/([^/?#]+)/i;
const TIMEOUT_MS = 8000;

export class UnknownUserError extends Error {
  constructor(input) {
    super(`No drupal.org user matching "${input}".`);
    this.name = 'UnknownUserError';
  }
}

export class UpstreamTimeoutError extends Error {
  constructor() {
    super('drupal.org did not answer in time (cold cache for this account). Try again shortly.');
    this.name = 'UpstreamTimeoutError';
  }
}

/** An abort can surface on the request itself or on the body read, wrapped or not. */
function isTimeout(error) {
  for (let current = error; current; current = current.cause) {
    if (current.name === 'TimeoutError' || current.name === 'AbortError') return true;
  }
  return false;
}

export async function fetchJson(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`drupal.org returned HTTP ${response.status}.`);
    // Unresolvable paths redirect to a page, so anything but JSON means "no such thing".
    if (!response.headers.get('content-type')?.includes('json')) return null;
    return response.json();
  } catch (cause) {
    if (isTimeout(cause)) throw new UpstreamTimeoutError();
    throw cause;
  }
}

async function byName(name) {
  const body = await fetchJson(`${API_D7}/user.json?name=${encodeURIComponent(name)}`);
  const user = body?.list?.[0];
  return user ? { uid: user.uid, name: user.name } : null;
}

async function byUid(uid) {
  const user = await fetchJson(`${API_D7}/user/${uid}.json`);
  return user?.uid ? { uid: user.uid, name: user.name } : null;
}

/**
 * A profile page carries its own uid in its shortlink tag, the only dependable way back
 * from an alias: /u/admitriiev is the user "a.dmitriiev".
 */
async function byAlias(alias) {
  const response = await fetch(`https://www.drupal.org/u/${encodeURIComponent(alias)}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const uid = /rel="shortlink" href="[^"]*\/user\/(\d+)"/.exec(await response.text())?.[1];
  return uid ? byUid(uid) : null;
}

/** Accepts a profile URL, a username or a numeric user ID. Returns { uid, name }. */
export async function resolveUser(input) {
  const value = input.trim();
  if (!value) throw new UnknownUserError(input);

  if (/^\d+$/.test(value)) {
    const user = await byUid(value);
    if (!user) throw new UnknownUserError(input);
    return user;
  }

  const match = PROFILE_URL.exec(value);
  if (match) {
    const segment = decodeURIComponent(match[1]);
    const user = /^\d+$/.test(segment) ? await byUid(segment) : await byAlias(segment);
    if (!user) throw new UnknownUserError(input);
    return user;
  }

  // A bare word is usually a username, but may be a profile alias.
  const user = (await byName(value)) ?? (await byAlias(value));
  if (!user) throw new UnknownUserError(input);
  return user;
}
