import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname, resolve, sep, normalize } from 'path';
import { paths, ensureUserDirs, ensureDir, getVersionSync } from '../core/paths.js';
import {
  sendJson, sendText, sendBuffer, matchPath, tokensMatch, isLoopbackHost, HttpError,
} from './http.js';
import { JobManager, JobStatus } from './jobs.js';
import { createSessionToken, writeRuntimeFile, clearRuntimeFile } from './runtime.js';
import { systemRoutes } from './routes/system.js';
import { workspaceRoutes } from './routes/workspace.js';
import { buildRoutes } from './routes/build.js';
import { themeRoutes } from './routes/themes.js';
import { aiRoutes } from './routes/ai.js';

/**
 * The MDTeX local backend.
 *
 * Everything the browser UI cannot do itself — filesystem access, LaTeX
 * compilation, MathJax/juice publishing builds, AI orchestration — lives behind
 * this HTTP API. The frontend never implements build or filesystem behaviour.
 *
 * Security posture: bound to the loopback interface only, and every /api call
 * must carry the per-session token that is generated at startup and handed to
 * the page when it is served. There is no unauthenticated network surface.
 */

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

export async function startServer({
  port = 0,
  host = '127.0.0.1',
  serveUi = true,
  uiDir = null,
  workspaceRoot = null,
  token = null,
  writeRuntime = true,
  quiet = false,
} = {}) {
  ensureUserDirs();

  const sessionToken = token || createSessionToken();
  const jobs = new JobManager();
  const staticRoot = uiDir || join(paths.appRoot, 'dist', 'ui');
  const scratchDir = ensureDir(join(paths.cacheDir, 'scratch'));

  const ctx = {
    token: sessionToken,
    jobs,
    workspaceRoot: workspaceRoot || paths.workspace,
    startedAt: new Date().toISOString(),
    scratchDir,
    lastPdfBuilds: new Map(),
    baseUrl: null, // filled in once the port is known
    /**
     * Only files MDTeX itself produced may be read back through the API.
     * Everything it produces lives under the workspace or the cache directory.
     */
    isBuildArtifact(candidate) {
      if (!candidate) return false;
      const target = resolve(candidate);
      const roots = [resolve(ctx.workspaceRoot), resolve(paths.cacheDir), resolve(paths.dataDir)];
      return roots.some(root => target === root || target.startsWith(root + sep));
    },
  };

  const routes = {
    ...systemRoutes(ctx),
    ...workspaceRoutes(ctx),
    ...buildRoutes(ctx),
    ...themeRoutes(ctx),
    ...aiRoutes(ctx),
    ...jobRoutes(ctx),
  };

  const compiled = Object.entries(routes).map(([key, handler]) => {
    const [method, pattern] = key.split(' ');
    return { method, pattern, handler };
  });

  const server = createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
      sendJson(res, 400, { error: 'Malformed request URL.' });
      return;
    }

    const pathname = decodeURI(url.pathname);

    // CORS is deliberately not enabled: the UI is same-origin. A cross-origin
    // preflight is answered with a refusal rather than a permissive header.
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { Allow: 'GET, POST, PUT, DELETE' });
      res.end();
      return;
    }

    if (pathname.startsWith('/api/')) {
      if (!authorise(req, url, sessionToken)) {
        sendJson(res, 401, { error: 'Missing or invalid MDTeX session token.' });
        return;
      }

      for (const route of compiled) {
        if (route.method !== req.method) continue;
        const params = matchPath(route.pattern, pathname);
        if (!params) continue;
        try {
          await route.handler(req, res, { params, query: url.searchParams, url });
        } catch (e) {
          if (res.headersSent) return;
          if (e instanceof HttpError) {
            sendJson(res, e.status, { error: e.message, details: e.details });
          } else {
            if (!quiet) console.error(`[mdtex] ${req.method} ${pathname}:`, e);
            sendJson(res, 500, { error: e.message || 'Internal error.' });
          }
        }
        return;
      }

      sendJson(res, 404, { error: `No such endpoint: ${req.method} ${pathname}` });
      return;
    }

    if (!serveUi) {
      sendJson(res, 404, { error: 'Not found.' });
      return;
    }

    serveStatic(res, staticRoot, pathname, sessionToken);
  });

  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(port, host, () => {
      server.off('error', rejectPromise);
      resolvePromise();
    });
  });

  const address = server.address();
  const actualPort = address.port;
  const baseUrl = `http://${host}:${actualPort}`;
  ctx.baseUrl = baseUrl;

  if (writeRuntime) {
    writeRuntimeFile({
      pid: process.pid,
      host,
      port: actualPort,
      url: baseUrl,
      token: sessionToken,
      version: getVersionSync(),
      startedAt: ctx.startedAt,
    });
  }

  const stop = async () => {
    jobs.cancelAll();
    if (writeRuntime) clearRuntimeFile();
    await new Promise((r) => server.close(r));
  };

  return {
    server,
    port: actualPort,
    host,
    url: baseUrl,
    token: sessionToken,
    jobs,
    ctx,
    stop,
  };
}

function authorise(req, url, sessionToken) {
  // Loopback binding is the primary control; the header check defends against
  // DNS-rebinding and other local processes.
  const host = req.headers.host;
  if (host && !isLoopbackHost(host)) return false;

  const origin = req.headers.origin;
  if (origin && origin !== 'null' && !isLoopbackHost(origin)) return false;

  const header = req.headers['x-mdtex-token'];
  if (typeof header === 'string' && tokensMatch(header, sessionToken)) return true;

  const queryToken = url.searchParams.get('token');
  // EventSource cannot set headers, so SSE endpoints accept the token in the query.
  if (queryToken && tokensMatch(queryToken, sessionToken)) return true;

  return false;
}

/** Job status and Server-Sent Events progress. */
function jobRoutes(ctx) {
  return {
    'GET /api/jobs': async (req, res) => {
      sendJson(res, 200, { jobs: ctx.jobs.list() });
    },

    'GET /api/jobs/:id': async (req, res, { params }) => {
      const job = ctx.jobs.describe(params.id);
      if (!job) {
        sendJson(res, 404, { error: 'No such job.' });
        return;
      }
      sendJson(res, 200, { job });
    },

    'GET /api/jobs/:id/events': async (req, res, { params }) => {
      const send = (event) => {
        if (event === null) {
          res.write('event: end\ndata: {}\n\n');
          res.end();
          return;
        }
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const unsubscribe = ctx.jobs.subscribe(params.id, send);
      if (!unsubscribe) {
        res.write(`data: ${JSON.stringify({ kind: 'error', message: 'No such job.' })}\n\n`);
        res.end();
        return;
      }

      // Keep intermediaries from closing an idle stream during a long build.
      const heartbeat = setInterval(() => {
        if (!res.writableEnded) res.write(': keep-alive\n\n');
      }, 15000);

      req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
      res.on('close', () => clearInterval(heartbeat));
    },

    'POST /api/jobs/:id/cancel': async (req, res, { params }) => {
      const cancelled = ctx.jobs.cancel(params.id);
      sendJson(res, cancelled ? 200 : 409, {
        cancelled,
        error: cancelled ? undefined : 'That job has already finished.',
      });
    },
  };
}

/**
 * Serve the built UI, injecting the session token into index.html so the page
 * can authenticate without the token ever appearing in a URL the browser might
 * record in history.
 */
function serveStatic(res, root, pathname, token) {
  if (!existsSync(root)) {
    sendText(res, 503,
      'The MDTeX UI has not been built yet.\n\nRun:  publisher build-ui\n   or: npm run build\n',
    );
    return;
  }

  let relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = resolve(root, normalize(relative));
  if (target !== resolve(root) && !target.startsWith(resolve(root) + sep)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  let file = target;
  if (!existsSync(file) || statSync(file).isDirectory()) {
    // Single-page app: unknown paths fall back to the shell.
    file = join(root, 'index.html');
    if (!existsSync(file)) {
      sendText(res, 404, 'Not found');
      return;
    }
  }

  const ext = extname(file).toLowerCase();
  const type = STATIC_TYPES[ext] || 'application/octet-stream';

  if (ext === '.html') {
    const html = readFileSync(file, 'utf-8').replace(
      '</head>',
      `<script>window.__MDTEX__=${JSON.stringify({ token, api: '/api', version: getVersionSync() })};</script></head>`,
    );
    sendText(res, 200, html, type);
    return;
  }

  sendBuffer(res, 200, readFileSync(file), type, {
    'Cache-Control': ext === '.js' || ext === '.css' ? 'public, max-age=3600' : 'no-cache',
  });
}

export { JobStatus };
