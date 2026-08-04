import { fetchAllRecords, UnknownUserError, UpstreamTimeoutError } from '../../shared/records.mjs';

// Cached on Netlify's durable CDN cache, not in the browser: a shared link stays fast,
// and stale-if-error keeps serving the last good response while drupal.org is down —
// the resilience the previous baked-data snapshot gave us for free.
const CDN_CACHE = 'public, s-maxage=300, stale-while-revalidate=3600, stale-if-error=604800';

export default async (request) => {
  const query = new URL(request.url).searchParams;
  const username = query.get('username')?.trim();
  if (!username) {
    return Response.json({ error: 'Missing username.' }, { status: 400 });
  }
  const months = Number(query.get('months')) || undefined;

  try {
    const payload = await fetchAllRecords(username, { months });
    return Response.json(payload, {
      headers: { 'Netlify-CDN-Cache-Control': CDN_CACHE, 'Cache-Control': 'public, max-age=0' },
    });
  } catch (cause) {
    if (cause instanceof UnknownUserError) {
      return Response.json({ error: cause.message }, { status: 404 });
    }
    if (cause instanceof UpstreamTimeoutError) {
      return Response.json({ error: cause.message }, { status: 504 });
    }
    return Response.json({ error: `Upstream error: ${cause.message}` }, { status: 502 });
  }
};

export const config = { path: '/api/records' };
