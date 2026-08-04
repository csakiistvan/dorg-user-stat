import { handle } from '../../shared/handlers.mjs';

// Cached on Netlify's durable CDN cache, not in the browser: a shared link stays fast,
// and stale-if-error keeps serving the last good response while drupal.org is down.
export const CDN_CACHE = 'public, s-maxage=300, stale-while-revalidate=3600, stale-if-error=604800';

export default async (request) => {
  const { status, body } = await handle('records', new URL(request.url).searchParams);
  return Response.json(body, {
    status,
    headers:
      status === 200
        ? { 'Netlify-CDN-Cache-Control': CDN_CACHE, 'Cache-Control': 'public, max-age=0' }
        : {},
  });
};

export const config = { path: '/api/records' };
