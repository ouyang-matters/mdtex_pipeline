import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Local backend API.
 *
 * These tests exercise the HTTP surface the browser actually uses, including
 * the security posture: the API must refuse an unauthenticated request and must
 * refuse to serve files outside the workspace.
 */

let server;
let root;
let workspace;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'mdtex-api-'));
  workspace = join(root, 'workspace');
  process.env.XDG_CONFIG_HOME = join(root, 'config');
  process.env.XDG_DATA_HOME = join(root, 'data');
  process.env.XDG_CACHE_HOME = join(root, 'cache');

  const { startServer } = await import('../src/server/index.js');
  server = await startServer({
    port: 0,
    serveUi: false,
    writeRuntime: false,
    workspaceRoot: workspace,
    quiet: true,
  });
});

afterAll(async () => {
  await server?.stop();
  rmSync(root, { recursive: true, force: true });
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.XDG_DATA_HOME;
  delete process.env.XDG_CACHE_HOME;
});

async function call(method, path, body, { token = server.token, headers = {} } = {}) {
  const response = await fetch(`${server.url}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { 'x-mdtex-token': token } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, response };
}

/** Issue a request with full control over the Host header. */
async function rawRequest({ host, path, token }) {
  const { request } = await import('http');
  return new Promise((resolvePromise, rejectPromise) => {
    const req = request({
      host: '127.0.0.1',
      port: server.port,
      path,
      method: 'GET',
      headers: { host, 'x-mdtex-token': token },
    }, (res) => {
      res.resume();
      res.on('end', () => resolvePromise(res.statusCode));
    });
    req.on('error', rejectPromise);
    req.end();
  });
}

async function waitForJob(jobId) {
  for (let i = 0; i < 600; i++) {
    const { body } = await call('GET', `/api/jobs/${jobId}`);
    if (['succeeded', 'failed', 'cancelled'].includes(body.job.status)) return body.job;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Job did not finish in time.');
}

describe('Authentication', () => {
  it('rejects a request with no token', async () => {
    const { status } = await call('GET', '/api/health', undefined, { token: null });
    expect(status).toBe(401);
  });

  it('rejects a request with the wrong token', async () => {
    const { status } = await call('GET', '/api/health', undefined, { token: 'not-the-token' });
    expect(status).toBe(401);
  });

  it('accepts the session token', async () => {
    const { status, body } = await call('GET', '/api/health');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.app).toBe('mdtex');
  });

  it('accepts the token as a query parameter, for EventSource', async () => {
    const response = await fetch(`${server.url}/api/health?token=${encodeURIComponent(server.token)}`);
    expect(response.status).toBe(200);
  });

  it('rejects a cross-origin request even with a valid token', async () => {
    const { status } = await call('GET', '/api/health', undefined, {
      headers: { origin: 'https://evil.example.com' },
    });
    expect(status).toBe(401);
  });

  it('rejects a non-loopback Host header, which blocks DNS rebinding', async () => {
    // `fetch` treats Host as a forbidden header and will not send ours, so the
    // request has to be made at the socket level to test this at all.
    const status = await rawRequest({
      host: 'attacker.example.com',
      path: '/api/health',
      token: server.token,
    });
    expect(status).toBe(401);
  });

  it('accepts a loopback Host header at the socket level', async () => {
    const status = await rawRequest({
      host: `127.0.0.1:${server.port}`,
      path: '/api/health',
      token: server.token,
    });
    expect(status).toBe(200);
  });

  it('binds to loopback only', () => {
    expect(server.host).toBe('127.0.0.1');
  });
});

describe('Environment', () => {
  it('reports what is installed without the browser probing anything', async () => {
    const { body } = await call('GET', '/api/env');
    expect(body.platform).toBe(process.platform);
    expect(body.latex).toBeTruthy();
    expect(typeof body.latex.available).toBe('boolean');
    expect(Array.isArray(body.pdfTemplates)).toBe(true);
    expect(body.paths.workspace).toBeTruthy();

    // When LaTeX is missing, the UI needs actionable guidance, not just a flag.
    if (!body.latex.available) {
      expect(body.latex.hint).toBeTruthy();
      expect(body.latex.hint.options.length).toBeGreaterThan(0);
    }
  });
});

describe('Workspace', () => {
  let articleId;

  it('creates folders and articles', async () => {
    const folder = await call('POST', '/api/workspace/folder', { path: 'notes' });
    expect(folder.status).toBe(201);

    const created = await call('POST', '/api/workspace/article', {
      title: 'Test Article',
      folder: 'notes',
      tags: ['alpha', 'beta'],
    });
    expect(created.status).toBe(201);
    articleId = created.body.article.id;
    expect(created.body.article.folder).toBe('notes');
    expect(created.body.article.sourceFile).toBe('source.md');
  });

  it('refuses a folder path that escapes the workspace', async () => {
    const { status } = await call('POST', '/api/workspace/folder', { path: '../../escape' });
    expect(status).toBe(409);
    expect(existsSync(join(root, 'escape'))).toBe(false);
  });

  it('saves and reads back the source', async () => {
    const saved = await call('PUT', `/api/workspace/article/${articleId}/source`, { source: '# Hi\n\n$x^2$\n' });
    expect(saved.status).toBe(200);

    const read = await call('GET', `/api/workspace/article/${articleId}`);
    expect(read.body.source).toContain('$x^2$');
  });

  it('applies editable metadata and ignores identity fields', async () => {
    const before = await call('GET', `/api/workspace/article/${articleId}`);

    const { body } = await call('PUT', `/api/workspace/article/${articleId}/meta`, {
      title: 'Renamed',
      tags: 'one, two, one',
      series: 'A Series',
      id: 'attacker-controlled-id',
      createdAt: '1999-01-01T00:00:00.000Z',
      dirName: 'somewhere-else',
    });

    expect(body.article.title).toBe('Renamed');
    expect(body.article.tags).toEqual(['one', 'two']);
    expect(body.article.series).toBe('A Series');

    // Identity is preserved and the attempt is reported rather than silently dropped.
    expect(body.article.id).toBe(articleId);
    expect(body.article.createdAt).toBe(before.body.article.createdAt);
    expect(body.article.dirName).toBe(before.body.article.dirName);
    expect(body.ignored).toEqual(expect.arrayContaining(['id', 'createdAt', 'dirName']));
  });

  it('keeps the directory name when the title changes', async () => {
    const { body } = await call('GET', `/api/workspace/article/${articleId}`);
    expect(body.article.title).toBe('Renamed');
    expect(body.article.dirName).toBe('test-article');
  });

  it('moves an article without changing its identity', async () => {
    const { body } = await call('POST', `/api/workspace/article/${articleId}/move`, { folder: '' });
    expect(body.article.folder).toBe('');
    expect(body.article.id).toBe(articleId);
  });

  it('duplicates an article with a fresh identity', async () => {
    const { status, body } = await call('POST', `/api/workspace/article/${articleId}/duplicate`, {});
    expect(status).toBe(201);
    expect(body.article.id).not.toBe(articleId);
    expect(body.article.title).toContain('(copy)');

    await call('DELETE', `/api/workspace/article/${body.article.id}?permanent=0`);
  });

  it('deletes to the trash and restores', async () => {
    const created = await call('POST', '/api/workspace/article', { title: 'Doomed' });
    const id = created.body.article.id;

    const deleted = await call('DELETE', `/api/workspace/article/${id}`);
    expect(deleted.body.restorable).toBe(true);

    let tree = await call('GET', '/api/workspace/tree');
    expect(tree.body.articles.some(a => a.id === id)).toBe(false);
    expect(tree.body.trash.some(a => a.id === id)).toBe(true);

    await call('POST', `/api/workspace/article/${id}/restore`);
    tree = await call('GET', '/api/workspace/tree');
    expect(tree.body.articles.some(a => a.id === id)).toBe(true);
  });

  it('stores an uploaded asset and returns an insertable reference', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const { status, body } = await call('POST', `/api/workspace/article/${articleId}/asset`, {
      name: 'my photo (1).png',
      dataBase64: png.toString('base64'),
    });

    expect(status).toBe(201);
    // The stored name is sanitised.
    expect(body.asset.name).not.toMatch(/[ ()]/);
    expect(body.reference).toContain('![');
    expect(body.reference).toContain(body.asset.relativePath);

    const fetched = await fetch(`${server.url}${body.url}`, {
      headers: { 'x-mdtex-token': server.token },
    });
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get('content-type')).toBe('image/png');
  });

  it('searches by title, tag and body', async () => {
    const byTag = await call('GET', '/api/workspace/search?q=two');
    expect(byTag.body.results.some(a => a.id === articleId)).toBe(true);

    const byBody = await call('GET', '/api/workspace/search?q=x%5E2&body=1');
    expect(byBody.body.results.some(a => a.id === articleId)).toBe(true);
  });

  it('exposes the metadata schema the properties dialog builds from', async () => {
    const { body } = await call('GET', '/api/workspace/schema');
    expect(body.statuses).toContain('draft');
    expect(body.sourceFormats.map(f => f.value)).toEqual(['markdown', 'latex']);
    expect(body.immutableFields).toEqual(['id', 'createdAt', 'dirName']);
    expect(body.pdfTemplates.length).toBeGreaterThan(0);
    expect(body.themes.length).toBeGreaterThan(0);
  });
});

describe('Target builds', () => {
  let articleId;
  const source = '# Build Me\n\nInline $a^2 + b^2 = c^2$ and display:\n\n$$\n\\int_0^1 x\\,dx = \\tfrac12\n$$\n';

  beforeEach(async () => {
    if (articleId) return;
    const created = await call('POST', '/api/workspace/article', { title: 'Build Target' });
    articleId = created.body.article.id;
    await call('PUT', `/api/workspace/article/${articleId}/source`, { source });
  });

  it('compiles as a job and reports formula progress', async () => {
    const started = await call('POST', '/api/build/target', { articleId, platform: 'wechat', theme: 'default' });
    expect(started.status).toBe(202);

    const job = await waitForJob(started.body.jobId);
    expect(job.status).toBe('succeeded');
    expect(job.result.formulas.total).toBe(2);
    expect(job.result.validation.valid).toBe(true);

    const messages = job.events.filter(e => e.kind === 'progress').map(e => e.message).filter(Boolean);
    expect(messages.some(m => /Rendering formulas \d+\/\d+/.test(m))).toBe(true);
    expect(messages.some(m => /Inlining styles/.test(m))).toBe(true);
    expect(messages.some(m => /Ready to copy/.test(m))).toBe(true);
  });

  it('serves the compiled bytes without recompiling', async () => {
    const status = await call('POST', '/api/build/target/status', { articleId, platform: 'wechat', theme: 'default' });
    expect(status.body.prepared).toBe(true);

    const fetched = await call('GET', `/api/build/target/${status.body.key}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.html).toContain('<svg');
    expect(fetched.body.plainText).toContain('Build Me');
    // The plain-text flavour keeps the mathematics as LaTeX.
    expect(fetched.body.plainText).toContain('a^2 + b^2 = c^2');
  });

  it('returns a cache hit instead of a job when nothing changed', async () => {
    const again = await call('POST', '/api/build/target', { articleId, platform: 'wechat', theme: 'default' });
    expect(again.status).toBe(200);
    expect(again.body.cached).toBe(true);
  });

  it('misses the cache when the theme changes', async () => {
    const other = await call('POST', '/api/build/target', {
      articleId, platform: 'wechat', themeCss: '#nice p { color: red; }', themeName: 'custom',
    });
    expect(other.body.cached).toBeFalsy();
    await waitForJob(other.body.jobId);
  });

  it('misses the cache when the source changes', async () => {
    const other = await call('POST', '/api/build/target', {
      articleId, platform: 'wechat', theme: 'default', source: `${source}\nOne more line.\n`,
    });
    expect(other.body.cached).toBeFalsy();
    await waitForJob(other.body.jobId);
  });

  it('refuses to serve a target key that was never prepared', async () => {
    const { status } = await call('GET', '/api/build/target/0000000000000000');
    expect(status).toBe(404);
  });
});

describe('Build artifact access', () => {
  it('refuses to read a file outside the MDTeX directories', async () => {
    const { status } = await call('GET', `/api/build/pdf/file?path=${encodeURIComponent('/etc/passwd')}`);
    expect(status).toBe(404);
  });

  it('refuses a traversal attempt through the workspace root', async () => {
    const target = join(workspace, '..', '..', 'etc', 'passwd');
    const { status } = await call('GET', `/api/build/pdf/file?path=${encodeURIComponent(target)}`);
    expect(status).toBe(404);
  });
});

describe('Themes', () => {
  it('lists built-in themes as read-only', async () => {
    const { body } = await call('GET', '/api/themes');
    const builtin = body.themes.find(t => t.source === 'builtin');
    expect(builtin.editable).toBe(false);
  });

  it('creates, reads, renames and deletes a user theme', async () => {
    const created = await call('POST', '/api/themes', { name: 'my-theme', css: '#nice p { color: teal; }' });
    expect(created.status).toBe(201);

    const read = await call('GET', '/api/themes/my-theme');
    expect(read.body.css).toContain('teal');
    expect(read.body.editable).toBe(true);

    await call('POST', '/api/themes/my-theme/rename', { name: 'renamed-theme' });
    expect((await call('GET', '/api/themes/renamed-theme')).status).toBe(200);

    await call('DELETE', '/api/themes/renamed-theme');
    expect((await call('GET', '/api/themes/renamed-theme')).status).toBe(404);
  });

  it('refuses to delete a built-in theme', async () => {
    const { status } = await call('DELETE', '/api/themes/default');
    expect(status).toBe(404);
  });
});

describe('Jobs', () => {
  it('reports an unknown job as missing', async () => {
    const { status } = await call('GET', '/api/jobs/00000000-0000-0000-0000-000000000000');
    expect(status).toBe(404);
  });

  it('refuses to cancel a job that already finished', async () => {
    const created = await call('POST', '/api/workspace/article', { title: 'Quick' });
    await call('PUT', `/api/workspace/article/${created.body.article.id}/source`, { source: '# Tiny\n' });
    const started = await call('POST', '/api/build/target', {
      articleId: created.body.article.id, platform: 'wechat', theme: 'default',
    });
    await waitForJob(started.body.jobId);

    const { status, body } = await call('POST', `/api/jobs/${started.body.jobId}/cancel`);
    expect(status).toBe(409);
    expect(body.cancelled).toBe(false);
  });
});

describe('AI connections', () => {
  it('offers all three quick-connect options with local detection done', async () => {
    const { body } = await call('GET', '/api/ai/backends');
    const types = body.quickConnect.map(o => o.type);
    expect(types).toEqual(['local-claude', 'remote-claudeclaw', 'anthropic-api']);

    const local = body.quickConnect.find(o => o.type === 'local-claude');
    expect(typeof local.detected).toBe('boolean');
    expect(local.needsCredentials).toBe(false);

    const api = body.quickConnect.find(o => o.type === 'anthropic-api');
    expect(api.fields.some(f => f.name === 'secret' && f.type === 'password')).toBe(true);
  });

  it('stores a profile without ever returning the secret', async () => {
    const saved = await call('POST', '/api/ai/backends', {
      type: 'anthropic-api',
      name: 'Test Key',
      secret: 'sk-ant-thisisaverysecrettestkey1234',
      model: 'claude-opus-5',
    });
    expect(saved.status).toBe(201);

    const serialised = JSON.stringify(saved.body);
    expect(serialised).not.toContain('thisisaverysecrettestkey');
    expect(saved.body.profile.secretConfigured).toBe(true);
    expect(saved.body.profile.secretFingerprint).toMatch(/…1234$/);

    // Nor through the listing.
    const listed = await call('GET', '/api/ai/backends');
    expect(JSON.stringify(listed.body)).not.toContain('thisisaverysecrettestkey');

    await call('DELETE', `/api/ai/backends/${saved.body.profile.id}`);
  });

  it('refuses to run without a configured connection', async () => {
    const { status, body } = await call('POST', '/api/ai/run', { prompt: 'do something' });
    expect(status).toBe(409);
    expect(body.error).toMatch(/Quick Connect/);
  });

  it('rejects an unknown backend type', async () => {
    const { status } = await call('POST', '/api/ai/backends', { type: 'not-a-backend' });
    expect(status).toBe(400);
  });
});
