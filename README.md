# dorg-user-stat

Contribution stats for any drupal.org user, read live from the
[contribution records API](https://www.drupal.org/drupalorg/docs/apis/rest-and-other-apis#s-contribution-records).
Vite + React front end, one Netlify function in front of the API.

Shareable URLs: `/u/<username>`, optionally `?months=24`.

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
- Pages hold 50 records, `meta.count` gives the total. Page 0 is fetched first so the remaining
  pages can go out in parallel.
- **Cold queries are slow, warm ones are fast.** A single warm page is ~0.5 s; the first request
  for a user/range combination can take 10–30 s and hits the per-page timeout, returning a 504
  that asks for a retry. The attempt warms drupal.org's cache, so the retry usually succeeds.
- **`months` does not make things faster.** Counter to the API docs' suggestion, the filtered
  query is *slower* than the unfiltered one; its only benefit is fewer pages to collect.
- Very active accounts are past what one request can gather (5661 records ≈ 114 pages), so
  collection stops at `MAX_PAGES` and the response is flagged `truncated` for the UI to report.

## Deploy

Netlify: build `npm run build`, publish `dist`, functions in `netlify/functions`. Responses carry
`Netlify-CDN-Cache-Control` with `stale-if-error`, so a shared link keeps serving the last good
data while drupal.org is unavailable.

If request-time collection proves too fragile, the next step is a scheduled background function
writing to Netlify Blobs, with the app reading only the store.
