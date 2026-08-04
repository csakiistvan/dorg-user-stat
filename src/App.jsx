import { useEffect, useMemo, useState } from 'react';
import { bestMonth, formatMonth, recordsByMonth, recordsByProject } from './aggregate.js';
import MonthlyBars from './components/MonthlyBars.jsx';
import ProjectBars from './components/ProjectBars.jsx';

/** Shareable links are /u/<username>, with an optional ?months= window. */
function usernameFromPath() {
  return decodeURIComponent(location.pathname.match(/^\/u\/([^/]+)/)?.[1] || '');
}

function monthsFromQuery() {
  return Number(new URLSearchParams(location.search).get('months')) || null;
}

const RANGES = [
  { label: '2 years', months: 24 },
  { label: '5 years', months: 60 },
  { label: 'All-time', months: null },
];

export default function App() {
  const [username, setUsername] = useState(usernameFromPath);
  const [months, setMonths] = useState(monthsFromQuery);
  const [input, setInput] = useState(username);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const onPopState = () => {
      const next = usernameFromPath();
      setUsername(next);
      setInput(next);
      setMonths(monthsFromQuery());
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
    const query = new URLSearchParams({ username });
    if (months) query.set('months', String(months));
    fetch(`/api/records?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
        return body;
      })
      .then((body) => {
        setData(body);
        // Tidy a pasted profile URL down to what it resolved to, so the address bar stays linkable.
        if (body.user !== usernameFromPath()) {
          const suffix = months ? `?months=${months}` : '';
          history.replaceState(null, '', `/u/${encodeURIComponent(body.user)}${suffix}`);
          setInput(body.user);
        }
      })
      .catch((cause) => {
        if (cause.name !== 'AbortError') setError(cause.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [username, months]);

  const view = useMemo(() => {
    if (!data) return null;
    const months = recordsByMonth(data.records);
    const projects = recordsByProject(data.records);
    const best = bestMonth(months);
    const thisYear = String(new Date().getFullYear());
    return {
      months,
      projects,
      stats: [
        { label: 'records', value: data.records.length },
        { label: 'projects credited', value: projects.length },
        {
          label: `in ${thisYear}`,
          value: Object.entries(months)
            .filter(([key]) => key.startsWith(thisYear))
            .reduce((sum, [, count]) => sum + count, 0),
        },
        ...(best ? [{ label: `best month (${formatMonth(best[0])})`, value: best[1] }] : []),
      ],
    };
  }, [data]);

  /** Keeps the address bar in step, so any view can be linked or reloaded. */
  function pushUrl(nextUsername, nextMonths) {
    const query = nextMonths ? `?months=${nextMonths}` : '';
    history.pushState(null, '', nextUsername ? `/u/${encodeURIComponent(nextUsername)}${query}` : '/');
  }

  function submit(event) {
    event.preventDefault();
    const next = input.trim();
    if (next === username) return;
    pushUrl(next, months);
    setUsername(next);
  }

  function selectRange(nextMonths) {
    if (nextMonths === months) return;
    pushUrl(username, nextMonths);
    setMonths(nextMonths);
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
          {RANGES.map((range) => (
            <button
              key={range.label}
              type="button"
              aria-pressed={range.months === months}
              onClick={() => selectRange(range.months)}
            >
              {range.label}
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
        <p className="cap">Loading {months ? `the last ${months} months` : 'all-time records'}…</p>
      )}
      {error && (
        <p className="err">
          {error}
          {!months && ' Very active accounts have thousands of records — try a shorter range.'}
        </p>
      )}

      {view && (
        <>
          <p className="sub">
            <a
              href={`https://www.drupal.org/${/^\d+$/.test(data.user) ? 'user' : 'u'}/${data.user}`}
              target="_blank"
              rel="noopener"
            >
              {data.user}
            </a>{' '}
            · {data.months ? `last ${data.months} months` : 'all-time'} · security advisories
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
              </div>

              <section>
                <h2>Records per month</h2>
                <p className="cap">
                  By credit date (<code>field_last_status_change</code>). Newest month first —
                  scroll sideways for the full history.
                </p>
                <MonthlyBars months={view.months} />
              </section>

              <section>
                <h2>Records per project</h2>
                <p className="cap">Credited issues per project, newest credit first.</p>
                <ProjectBars entries={view.projects} />
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
