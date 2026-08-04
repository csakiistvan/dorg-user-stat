# dorg-user-stat

Contribution stats for any drupal.org user, read live from the
[drupal.org APIs](https://www.drupal.org/drupalorg/docs/apis/rest-and-other-apis).
Vite + React front end, Netlify functions in front of the APIs.

Two sources, cross-referenced:

- `/api/records` — credited contribution records (`new.drupal.org` JSON:API view).
- `/api/activity` — issues the user commented on, merged from the legacy `api-d7/comment.json`
  history and the commented events of the matching `git.drupalcode.org` account. Subtracting the
  credited issues leaves **worked on, not credited**.

Neither comment source is complete alone: issues migrated to GitLab work items, so recent
discussion never reaches api-d7. Measured on one account, 62 of 100 GitLab issues were missing
from api-d7, and of 54 locally tested issues with no api-d7 comment, 52 were found on GitLab.

Comments are still the only public trace of uncredited work, so anything done without posting on
the issue does not appear — a related metric, not a complete activity log.

Takes a profile URL, a username or a numeric user ID and works out the rest.
Shareable URLs: `/u/<username-or-id>`, optionally `?range=2y|5y|all`. The range defaults to the
current year — all-time is what makes the heaviest accounts fail to load.

## Develop

```sh
npm install
npm run dev
```

`/api/records` is served by a Vite middleware ([dev/api-plugin.js](dev/api-plugin.js)) that runs
the same [shared/records.mjs](shared/records.mjs) module as the deployed function, so no
netlify-cli is needed locally.

## Why a function instead of fetching from the browser

drupal.org sends no `Access-Control-Allow-Origin` header, so the API cannot be called from
client-side JavaScript at all. The function also hides the upstream URL shape behind one file
and provides the CDN cache below.

## Upstream behaviour worth knowing

- The friendly endpoint `302`s to the JSON:API view with the resolved uid. Server-side `fetch`
  follows it; a Netlify redirect-proxy would not, which is why this is a function.
- An **unknown username redirects to the drupal.org homepage** and returns HTML, not a JSON
  error — hence the content-type check that produces the 404.
- **A profile URL is not a username.** `/u/admitriiev` belongs to the user `a.dmitriiev`; the
  alias drops the dot, and the API resolves usernames only. Profile pages carry their own uid in
  a `rel="shortlink"` tag, which is how any alias gets turned into an id. Numeric input skips the
  friendly endpoint and queries the underlying view directly.
- Pages hold 50 records, `meta.count` gives the total. Page 0 is fetched first so the remaining
  pages can go out in parallel.
- **Cold queries are slow, warm ones are fast.** A single warm page is ~0.5 s; the first request
  for a user/range combination can take 10–30 s and hits the per-page timeout, returning a 504
  that asks for a retry. The attempt warms drupal.org's cache, so the retry usually succeeds.
- **`months` does not make things faster.** Counter to the API docs' suggestion, the filtered
  query is *slower* than the unfiltered one; its only benefit is fewer pages to collect.
- **Only relative date filters work.** `views-filter[last_status_change]` accepts `N months ago`;
  an absolute date returns zero rows, exactly like a nonsense value. The current-year range is
  therefore requested as the months elapsed this year and trimmed to January 1st server-side.
- **Comment history has no date filter.** `api-d7/comment.json` sorts by `created` but cannot be
  bounded server-side, so a `months` window is walked page by page and stopped at the cutoff;
  all-time fans the pages out in parallel instead.
- **The GitLab account is only discoverable from the profile page.** A drupal.org username is not
  a GitLab username — "gábor hojtsy" is `goba` there — and `/api/v4/users?search=` answers 403
  anonymously, so the link on the drupal.org profile is the bridge. Exact `?username=` lookups and
  a user's own event stream are public; per-issue note lists answer 401.
- **GitLab allows 180 anonymous requests per minute per IP** (`throttle_unauthenticated_api`), a
  budget every visitor of a deployed instance shares. Event pages and project-name lookups are
  both capped, names known from api-d7 are reused, and a 429 is reported rather than swallowed.
- **Quick actions dominate GitLab comment events.** On one account 191 of 346 were bodies like
  `/do:unassign me`; counting them would inflate the figure by half with bookkeeping.
- **Users resolve through `api-d7`, records through `new.drupal.org`.** Two API generations are in
  play. `user.json?name=` maps a username to a uid and gives back the display name; everything
  else keys on the uid, so both sources share one cache key per user.
- Very active accounts are past what one request can gather (5661 records ≈ 114 pages), so
  collection stops at `MAX_PAGES` and the response is flagged `truncated` for the UI to report.

## Deploy

Netlify: build `npm run build`, publish `dist`, functions in `netlify/functions`. Responses carry
`Netlify-CDN-Cache-Control` with `stale-if-error`, so a shared link keeps serving the last good
data while drupal.org is unavailable.

If request-time collection proves too fragile, the next step is a scheduled background function
writing to Netlify Blobs, with the app reading only the store.
