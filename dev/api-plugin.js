import { fetchAllRecords, UnknownUserError, UpstreamTimeoutError } from '../shared/records.mjs';

/**
 * Serves /api/records from the Vite dev server so local development needs no
 * netlify-cli. Same shared upstream module the deployed function uses; caching is
 * the CDN's job in production and irrelevant here.
 */
export default function devApi() {
  return {
    name: 'dev-api',
    configureServer(server) {
      server.middlewares.use('/api/records', async (request, response) => {
        const query = new URL(request.url, 'http://localhost').searchParams;
        const username = query.get('username')?.trim();
        const months = Number(query.get('months')) || undefined;
        const send = (status, body) => {
          response.statusCode = status;
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify(body));
        };

        if (!username) return send(400, { error: 'Missing username.' });
        try {
          send(200, await fetchAllRecords(username, { months }));
        } catch (cause) {
          if (cause instanceof UnknownUserError) return send(404, { error: cause.message });
          if (cause instanceof UpstreamTimeoutError) return send(504, { error: cause.message });
          send(502, { error: `Upstream error: ${cause.message}` });
        }
      });
    },
  };
}
