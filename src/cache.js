// Collecting a heavy account is dozens of upstream requests, so a fetched result is kept and
// reused. Two things make that worth doing beyond the current view:
//
//   - Ranges nest. Once 5y is in hand, 2y and this year are a filter away, not a refetch.
//   - localStorage survives a reload, which is exactly when the wait is most annoying.
//
// Only the widest result per user is stored, since narrower ones are derivable from it.

import { contains, rangeCutoff } from '../shared/range.mjs';

const PREFIX = 'dorg-user-stat:v1:';
// Credits are awarded continuously, so a stored result is a shortcut, not a source of truth.
// Long enough to cover a session of clicking around, short enough that a revisit is fresh.
const TTL_MS = 6 * 60 * 60 * 1000;
// A very active account's 5y records run to a few hundred kB. Past this the entry is kept in
// memory only: filling the origin's quota would break every other key we hold.
const MAX_ENTRY_BYTES = 1_500_000;

const memory = new Map();

const keyFor = (kind, user) => `${PREFIX}${kind}:${user.toLowerCase()}`;

/**
 * The same account arrives as a profile URL, a username or a uid, and only the server can say
 * they are one user. Remembering what each input resolved to lets all three share one entry —
 * without it, pasting a URL refetches what the username already has cached.
 */
const ALIASES = `${PREFIX}aliases`;

function canonical(user) {
  const map = readStored(ALIASES) ?? {};
  return map[user.toLowerCase()] ?? user;
}

export function rememberAlias(input, name) {
  if (input.toLowerCase() === name.toLowerCase()) return;
  const map = readStored(ALIASES) ?? {};
  map[input.toLowerCase()] = name;
  writeStored(ALIASES, map);
}

function readStored(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    // Disabled storage, or an entry written by an older shape — either way, no cache.
    return null;
  }
}

/** Drops every key we own. Used to recover the quota rather than to give up on caching. */
function evictAll() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    /* nothing to do: storage is unavailable */
  }
}

function writeStored(key, entry) {
  let serialized;
  try {
    serialized = JSON.stringify(entry);
  } catch {
    return;
  }
  if (serialized.length > MAX_ENTRY_BYTES) return;
  try {
    localStorage.setItem(key, serialized);
  } catch {
    // Almost certainly the quota. Our own keys are the only ones we may drop, and the entry
    // being written is the freshest of them, so clear and retry once.
    evictAll();
    try {
      localStorage.setItem(key, serialized);
    } catch {
      /* memory-only from here */
    }
  }
}

/**
 * A stored entry wide enough to answer `range`, or null. Expiry is checked on read so a stale
 * entry never surfaces, even if nothing has written since it aged out.
 */
function lookup(kind, user, range) {
  const key = keyFor(kind, canonical(user));
  const entry = memory.get(key) ?? readStored(key);
  if (!entry) return null;
  if (Date.now() - entry.at > TTL_MS) {
    memory.delete(key);
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage unavailable; the memory copy is already gone */
    }
    return null;
  }
  memory.set(key, entry);
  return contains(entry.range, range) ? entry : null;
}

function store(kind, user, range, payload) {
  const key = keyFor(kind, canonical(user));
  const existing = memory.get(key) ?? readStored(key);
  // Never trade a wider cached result for a narrower one: the wide entry answers both.
  if (existing && Date.now() - existing.at <= TTL_MS && contains(existing.range, range)) return;
  const entry = { range, at: Date.now(), payload };
  memory.set(key, entry);
  writeStored(key, entry);
}

/**
 * Records cut down to a narrower range. `total` is recomputed because the upstream total
 * described the wider window, and the gap flags are dropped: only complete results are cached,
 * so there is nothing missing to warn about.
 */
function narrowRecords(payload, range) {
  const from = rangeCutoff(range);
  const records = from ? payload.records.filter((record) => record.credited >= from) : payload.records;
  return { ...payload, range, records, total: records.length, derivedFrom: payload.range };
}

/**
 * Commented issues cut down to a narrower range. The per-source counts cannot survive the cut —
 * the merge lost which side each issue came from — so they are dropped and the UI says where
 * the numbers came from instead.
 */
function narrowActivity(payload, range) {
  const from = rangeCutoff(range);
  const issues = from ? payload.issues.filter((issue) => issue.at >= from) : payload.issues;
  return {
    ...payload,
    issues,
    sources: {
      gitlabUser: payload.sources.gitlabUser,
      gitlabRateLimited: payload.sources.gitlabRateLimited,
      gitlabIncomplete: payload.sources.gitlabIncomplete,
      derivedFrom: payload.range,
    },
  };
}

/**
 * The cached answer for a view, narrowed if it came from a wider fetch, or null to go and
 * fetch it. Anything with a known gap in it — timed-out pages, a walk that stopped short — is
 * never cached, because a partial result would be indistinguishable from a complete one later.
 */
export function cachedRecords(user, range) {
  const entry = lookup('records', user, range);
  if (!entry) return null;
  return entry.range === range ? entry.payload : narrowRecords(entry.payload, range);
}

export function cachedActivity(user, range) {
  const entry = lookup('activity', user, range);
  if (!entry) return null;
  return entry.range === range ? entry.payload : narrowActivity(entry.payload, range);
}

export function cacheRecords(user, range, payload) {
  if (payload.truncated || payload.failedPages > 0) return;
  store('records', user, range, { ...payload, range });
}

export function cacheActivity(user, range, payload) {
  if (payload.truncated || payload.sources.commentsFailed || payload.sources.gitlabFailed) return;
  store('activity', user, range, { ...payload, range });
}
