import { handle } from '../shared/handlers.mjs';

/**
 * Serves /api/* from the Vite dev server so local development needs no netlify-cli.
 * Same shared handlers the deployed functions use; caching is the CDN's job in production.
 */
export default function devApi() {
  return {
    name: 'dev-api',
    configureServer(server) {
      for (const source of ['records', 'activity']) {
        server.middlewares.use(`/api/${source}`, async (request, response) => {
          const { searchParams } = new URL(request.url, 'http://localhost');
          const { status, body } = await handle(source, searchParams);
          response.statusCode = status;
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify(body));
        });
      }
    },
  };
}
