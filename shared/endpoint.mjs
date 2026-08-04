// One Netlify function per source, all identical apart from the source name — so the wiring
// lives here and each function file is just its own declaration.
//
// Cached on Netlify's durable CDN cache, not in the browser: a shared link stays fast, and
// stale-if-error keeps serving the last good response while drupal.org is down. Paging makes
// the cache matter more, not less — every page is its own cacheable URL.

import { handle } from './handlers.mjs';

export const CDN_CACHE = 'public, s-maxage=300, stale-while-revalidate=3600, stale-if-error=604800';

export function endpoint(source) {
  return async (request) => {
    const { status, body } = await handle(source, new URL(request.url).searchParams);
    return Response.json(body, {
      status,
      headers:
        status === 200
          ? { 'Netlify-CDN-Cache-Control': CDN_CACHE, 'Cache-Control': 'public, max-age=0' }
          : {},
    });
  };
}
