import { useEffect, useMemo, useState } from 'react';
import { bestMonth, formatMonth, recordsByMonth, recordsByProject } from './aggregate.js';
import MonthlyBars from './components/MonthlyBars.jsx';
import ProjectBars from './components/ProjectBars.jsx';

/** Shareable links are /u/<username>, with an optional ?range= window. */
function usernameFromPath() {
  return decodeURIComponent(location.pathname.match(/^\/u\/([^/]+)/)?.[1] || '');
}

// Current year by default: all-time is what makes the heaviest accounts fail to load.
const RANGES = [
  { key: 'year', label: String(new Date().getFullYear()) },
  { key: '2y', label: '2 years' },
  { key: '5y', label: '5 years' },
  { key: 'all', label: 'All-time' },
];
const DEFAULT_RANGE = 'year';

function rangeFromQuery() {
  const requested = new URLSearchParams(location.search).get('range');
  return RANGES.some((range) => range.key === requested) ? requested : DEFAULT_RANGE;
}

function rangeLabel(key) {
  return RANGES.find((range) => range.key === key)?.label ?? key;
}

export default function App() {
  const [username, setUsername] = useState(usernameFromPath);
  const [range, setRange] = useState(rangeFromQuery);
  const [input, setInput] = useState(username);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // A month picked in the histogram, filtering the per-project breakdown.
  const [month, setMonth] = useState(null);
  const [activity, setActivity] = useState(null);

  useEffect(() => {
    const onPopState = () => {
      const next = usernameFromPath();
      setUsername(next);
      setInput(next);
      setRange(rangeFromQuery());
    };
    addEventListener('popstate', onPopState);
    return () => removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (!username) {
      setData(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);
    setMonth(null);
    setActivity(null);

    const query = new URLSearchParams({ user: username });
    query.set('range', range);
    const load = (source) =>
      fetch(`/api/${source}?${query}`, { signal: controller.signal }).then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
        return body;
      });

    load('records')
      .then((body) => {
        setData(body);
        // Tidy a pasted profile URL down to what it resolved to, so the address bar stays linkable.
        if (body.user.name !== usernameFromPath()) {
          const suffix = range === DEFAULT_RANGE ? '' : `?range=${range}`;
          history.replaceState(null, '', `/u/${encodeURIComponent(body.user.name)}${suffix}`);
          setInput(body.user.name);
        }
      })
      .catch((cause) => {
        if (cause.name !== 'AbortError') setError(cause.message);
      })
      .finally(() => setLoading(false));

    // Comment history is the slower of the two, so it lands on its own and never blocks
    // the records view. A failure here leaves the rest of the page intact.
    load('activity')
      .then(setActivity)
      .catch(() => setActivity({ failed: true }));

    return () => controller.abort();
  }, [username, range]);

  // Summary and histogram always describe the whole fetched range, never the month selection.
  const view = useMemo(() => {
    if (!data) return null;
    const months = recordsByMonth(data.records);
    const best = bestMonth(months);
    const thisYear = String(new Date().getFullYear());
    return {
      months,
      stats: [
        { label: 'records', value: data.records.length },
        { label: 'projects credited', value: recordsByProject(data.records).length },
        // Redundant when the range already is the current year.
        ...(range === 'year'
          ? []
          : [
              {
                label: `in ${thisYear}`,
                value: Object.entries(months)
                  .filter(([key]) => key.startsWith(thisYear))
                  .reduce((sum, [, count]) => sum + count, 0),
              },
            ]),
        ...(best ? [{ label: `best month (${formatMonth(best[0])})`, value: best[1] }] : []),
      ],
    };
  }, [data, range]);

  /**
   * Issues with a comment but no contribution record — work that is public but uncredited.
   * Grouped like the records breakdown so it renders through the same component.
   */
  const uncredited = useMemo(() => {
    if (!data || !activity?.issues) return null;
    const credited = new Set(data.records.map((record) => record.issue));
    const issues = activity.issues.filter((issue) => !credited.has(issue.issue));
    const months = {};
    for (const issue of issues) {
      const key = issue.at.slice(0, 7);
      months[key] = (months[key] || 0) + 1;
    }
    return { issues, months, count: issues.length };
  }, [data, activity]);

  /** Same grouping as the credited breakdown, honouring the month selection. */
  const uncreditedProjects = useMemo(() => {
    if (!uncredited) return [];
    const scope = month
      ? uncredited.issues.filter((issue) => issue.at.startsWith(month))
      : uncredited.issues;
    const byProject = new Map();
    for (const issue of scope) {
      if (!byProject.has(issue.project)) byProject.set(issue.project, []);
      byProject.get(issue.project).push(issue.issue);
    }
    return [...byProject.entries()].sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
    );
  }, [uncredited, month]);

  const projects = useMemo(() => {
    if (!data) return [];
    const scope = month
      ? data.records.filter((record) => record.credited.startsWith(month))
      : data.records;
    return recordsByProject(scope);
  }, [data, month]);

  /** Keeps the address bar in step, so any view can be linked or reloaded. */
  function pushUrl(nextUsername, nextRange) {
    const query = nextRange === DEFAULT_RANGE ? '' : `?range=${nextRange}`;
    history.pushState(null, '', nextUsername ? `/u/${encodeURIComponent(nextUsername)}${query}` : '/');
  }

  function submit(event) {
    event.preventDefault();
    const next = input.trim();
    if (next === username) return;
    pushUrl(next, range);
    setUsername(next);
  }

  function selectRange(nextRange) {
    if (nextRange === range) return;
    pushUrl(username, nextRange);
    setRange(nextRange);
  }

  return (
    <div className="viz-root">
      <h1>Drupal.org contribution records</h1>
      <form className="pick" onSubmit={submit}>
        <label htmlFor="user">drupal.org profile</label>
        <input
          id="user"
          value={input}
          placeholder="profile URL, username or user ID"
          autoComplete="off"
          spellCheck="false"
          onChange={(event) => setInput(event.target.value)}
        />
        <button type="submit">Load</button>
        <span className="ranges" role="group" aria-label="Time range">
          {RANGES.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={option.key === range}
              onClick={() => selectRange(option.key)}
            >
              {option.label}
            </button>
          ))}
        </span>
      </form>

      {!username && !loading && (
        <p className="cap">
          Paste a drupal.org profile URL — or a username or user ID — to pull its contribution
          records live from the drupal.org API. Security advisories are excluded.
        </p>
      )}
      {loading && (
        <p className="cap">Loading {rangeLabel(range)}…</p>
      )}
      {error && (
        <p className="err">
          {error}
          {range === 'all' &&
            ' The heaviest accounts hold thousands of records — try a shorter range.'}
        </p>
      )}

      {view && (
        <>
          <p className="sub">
            <a href={`https://www.drupal.org/user/${data.user.uid}`} target="_blank" rel="noopener">
              {data.user.name}
            </a>{' '}
            · {rangeLabel(data.range)} · security advisories
            excluded · fetched {new Date(data.fetchedAt).toLocaleString()}
          </p>
          {data.truncated && (
            <p className="err">
              Showing the {data.records.length} newest of {data.total} records — the rest exceed
              what one request can collect. Narrow the range for a complete picture.
            </p>
          )}

          {data.records.length === 0 ? (
            <p className="cap">No contribution records for this user.</p>
          ) : (
            <>
              <div className="stats">
                {view.stats.map(({ label, value }) => (
                  <div className="stat" key={label}>
                    <b>{value}</b>
                    <span>{label}</span>
                  </div>
                ))}
                {uncredited && (
                  <div className="stat">
                    <b>{uncredited.count}</b>
                    <span>worked on, not credited</span>
                  </div>
                )}
              </div>

              <section>
                <h2>Records per month</h2>
                <p className="cap">
                  By credit date (<code>field_last_status_change</code>). Newest month first —
                  scroll sideways for the full history. Click a month to break it down below.
                </p>
                <MonthlyBars
                  months={view.months}
                  second={uncredited?.months}
                  secondLabel="Worked on, not credited"
                  selected={month}
                  onSelect={setMonth}
                />
              </section>

              <section>
                <h2>
                  Records per project
                  {month && (
                    <>
                      {' | '}
                      {formatMonth(month)}
                      <button type="button" className="clear" onClick={() => setMonth(null)}>
                        clear
                      </button>
                    </>
                  )}
                </h2>
                <p className="cap">Credited issues per project, newest credit first.</p>
                <ProjectBars entries={projects} />
              </section>

              <section>
                <h2>
                  Worked on, not credited
                  {month && (
                    <>
                      {' | '}
                      {formatMonth(month)}
                      <button type="button" className="clear" onClick={() => setMonth(null)}>
                        clear
                      </button>
                    </>
                  )}
                </h2>
                <p className="cap">
                  Issues this user commented on that carry no contribution record yet. Comments are
                  the only public trace of uncredited work, so anything done without posting on the
                  issue is invisible here.
                </p>
                {!activity && <p className="cap">Loading comment history…</p>}
                {activity?.failed && (
                  <p className="cap">Comment history unavailable — the records above are unaffected.</p>
                )}
                {uncredited && (
                  <>
                    {activity.truncated && (
                      <p className="err">
                        Comment history was too long to collect in full — older issues are missing.
                      </p>
                    )}
                    {uncreditedProjects.length ? (
                      <ProjectBars entries={uncreditedProjects} accent />
                    ) : (
                      <p className="cap">
                        {month
                          ? 'No uncredited issues in this month.'
                          : 'Every commented issue has a contribution record.'}
                      </p>
                    )}
                  </>
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
