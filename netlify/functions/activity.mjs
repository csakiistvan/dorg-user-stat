import { handle } from '../../shared/handlers.mjs';
import { CDN_CACHE } from './records.mjs';

// Comment history is slower and larger than the records view, so the cache matters more here.
export default async (request) => {
  const { status, body } = await handle('activity', new URL(request.url).searchParams);
  return Response.json(body, {
    status,
    headers:
      status === 200
        ? { 'Netlify-CDN-Cache-Control': CDN_CACHE, 'Cache-Control': 'public, max-age=0' }
        : {},
  });
};

export const config = { path: '/api/activity' };
