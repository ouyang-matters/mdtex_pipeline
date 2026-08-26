import { defineConfig } from 'vite';

/**
 * Vite config.
 *
 * `npm run dev` starts the MDTeX backend in-process and proxies /api to it,
 * injecting the session token on the way through. That means the dev server
 * and `publisher start` behave identically from the page's point of view — the
 * UI always talks to a real backend, never to a mock.
 */
function mdtexBackend() {
  let instance = null;

  return {
    name: 'mdtex-backend',
    // Only for `vite dev`. Vitest also spins up a Vite server, and starting a
    // backend there would keep the test process alive and clobber the runtime
    // handshake file of a real running instance.
    apply: 'serve',

    async configureServer(server) {
      if (process.env.VITEST) return;

      const { startServer } = await import('./src/server/index.js');

      instance = await startServer({
        port: 0,
        host: '127.0.0.1',
        // Vite serves the UI in dev; the backend only serves the API.
        serveUi: false,
        writeRuntime: true,
      });

      server.config.logger.info(`\n  MDTeX backend  ${instance.url}\n`);

      server.middlewares.use('/api', (req, res) => {
        const target = new URL(req.url, instance.url);
        const proxied = {
          method: req.method,
          headers: { ...req.headers, 'x-mdtex-token': instance.token, host: `127.0.0.1:${instance.port}` },
        };

        import('http').then(({ request }) => {
          const upstream = request(`${instance.url}/api${target.pathname}${target.search}`, proxied, (upstreamRes) => {
            res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
            upstreamRes.pipe(res);
          });
          upstream.on('error', (e) => {
            res.writeHead(502, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: `Backend unreachable: ${e.message}` }));
          });
          req.pipe(upstream);
        });
      });

      const shutdown = async () => { await instance?.stop(); instance = null; };
      server.httpServer?.once('close', shutdown);
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    },

    /**
     * The dev page has no token injected by the static server, so hand it the
     * same shape `publisher start` produces. The proxy above adds the real
     * token; the page only needs to know that an API exists.
     */
    transformIndexHtml(html) {
      if (!instance) return html;
      return html.replace('</head>',
        `<script>window.__MDTEX__={api:"/api",token:null,dev:true};</script></head>`);
    },
  };
}

export default defineConfig({
  plugins: [mdtexBackend()],
  build: {
    outDir: 'dist/ui',
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    open: false,
  },
});
