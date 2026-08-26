import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { detectLatexEnvironment } from '../src/core/latex/environment.js';
import { subjectSource, materialiseMarkdownProject } from '../src/core/pdf/compiler.js';
import { ArticleLibrary } from '../src/workspace/library.js';

/**
 * One imported image, traced through every target.
 *
 * This is the end-to-end assertion the asset work exists to guarantee:
 *
 *     import image
 *       -> physical asset exists
 *       -> inserted source path is article-relative
 *       -> preview successfully loads it
 *       -> WeChat renderer resolves it
 *       -> PDF compiler resolves it
 *       -> no "image not found"
 *
 * Run against the real backend, because the bug being prevented is targets
 * disagreeing with each other — which only shows up when they all run.
 */

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

let server;
let root;
let workspace;

// Probed at module load: `it.skipIf` is evaluated while tests are collected,
// which happens before beforeAll runs.
const latexAvailable = (await detectLatexEnvironment()).available;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'mdtex-asset-e2e-'));
  workspace = join(root, 'workspace');
  process.env.XDG_CONFIG_HOME = join(root, 'config');
  process.env.XDG_DATA_HOME = join(root, 'data');
  process.env.XDG_CACHE_HOME = join(root, 'cache');

  const { startServer } = await import('../src/server/index.js');
  server = await startServer({
    port: 0, serveUi: false, writeRuntime: false, workspaceRoot: workspace, quiet: true,
  });

}, 60000);

afterAll(async () => {
  await server?.stop();
  rmSync(root, { recursive: true, force: true });
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.XDG_DATA_HOME;
  delete process.env.XDG_CACHE_HOME;
});

async function call(method, path, body) {
  const response = await fetch(`${server.url}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      'x-mdtex-token': server.token,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, response };
}

async function waitForJob(jobId) {
  for (let i = 0; i < 1800; i++) {
    const { body } = await call('GET', `/api/jobs/${jobId}`);
    if (['succeeded', 'failed', 'cancelled'].includes(body.job.status)) return body.job;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Job did not finish in time.');
}

/** Create an article, import an image, and put a reference in the source. */
async function articleWithImage({ title, folder = '', assetName = 'figure-01.png', format = 'markdown' }) {
  const created = await call('POST', '/api/workspace/article', { title, folder, sourceFormat: format });
  const article = created.body.article;

  const upload = await call('POST', `/api/workspace/article/${article.id}/asset`, {
    name: assetName,
    dataBase64: PNG_BASE64,
  });
  expect(upload.status).toBe(201);

  const source = format === 'latex'
    ? `\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\n${upload.body.reference}\n\\end{document}\n`
    : `# ${title}\n\nA figure:\n\n${upload.body.reference}\n\nDone.\n`;

  await call('PUT', `/api/workspace/article/${article.id}/source`, { source });

  return { article, upload: upload.body, source };
}

describe('import image -> every target resolves it', () => {
  let article;
  let upload;
  let source;

  it('imports the image and stores it physically', async () => {
    ({ article, upload, source } = await articleWithImage({
      title: 'Uniform Integrability',
      folder: 'articles',
    }));

    const onDisk = join(workspace, 'articles', 'uniform-integrability', 'assets', 'figure-01.png');
    expect(existsSync(onDisk)).toBe(true);
    expect(readFileSync(onDisk).length).toBe(Buffer.from(PNG_BASE64, 'base64').length);
    expect(upload.asset.hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it('inserts an article-relative source path, and nothing else', () => {
    expect(upload.reference).toBe('![figure-01](assets/figure-01.png)');
    expect(upload.canonical).toBe('assets/figure-01.png');

    // The forms that only work in one renderer:
    expect(upload.reference).not.toMatch(/^[a-zA-Z]:[\\/]/); // absolute Windows
    expect(upload.reference).not.toContain(workspace);        // absolute POSIX
    expect(upload.reference).not.toContain('data:');          // embedded blob
    expect(upload.reference).not.toContain('blob:');          // frontend-only
    expect(upload.reference).not.toContain('/api/');          // preview URL
    expect(upload.reference).not.toContain('\\');             // Windows separator
  });

  it('the preview can load it through the backend', async () => {
    // The exact URL the preview builds.
    const resolved = await call('POST', `/api/assets/${article.id}/resolve`, {
      sources: ['assets/figure-01.png'],
    });
    const record = resolved.body.resolved[0];

    expect(record.exists).toBe(true);
    expect(record.url).toContain(`/api/assets/${article.id}/assets/figure-01.png`);
    expect(record.url).toMatch(/v=[0-9a-f]{12}/);

    const image = await fetch(`${server.url}${record.url}`, {
      headers: { 'x-mdtex-token': server.token },
    });
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect((await image.arrayBuffer()).byteLength).toBe(Buffer.from(PNG_BASE64, 'base64').length);
  });

  it('the preview URL is never written back into the source', async () => {
    const { body } = await call('GET', `/api/workspace/article/${article.id}`);
    expect(body.source).toContain('assets/figure-01.png');
    expect(body.source).not.toContain('/api/assets/');
    expect(body.source).not.toContain('?v=');
  });

  it('the WeChat renderer resolves it', async () => {
    const started = await call('POST', '/api/build/target', {
      articleId: article.id, platform: 'wechat', theme: 'default', force: true,
    });
    const job = await waitForJob(started.body.jobId);

    expect(job.status).toBe('succeeded');
    expect(job.result.assets.errors).toEqual([]);
    expect(job.result.assets.embedded).toBe(1);
    expect(job.result.validation.errors).toEqual([]);

    const prepared = await call('GET', `/api/build/target/${job.result.key}`);
    // Self-contained: the pasted article carries the image with it.
    expect(prepared.body.html).toContain('data:image/png;base64,');
    expect(prepared.body.html).not.toContain('assets/figure-01.png');
  }, 120000);

  it('the Zhihu renderer resolves it', async () => {
    const started = await call('POST', '/api/build/target', {
      articleId: article.id, platform: 'zhihu', theme: 'default', force: true,
    });
    const job = await waitForJob(started.body.jobId);

    expect(job.status).toBe('succeeded');
    expect(job.result.assets.errors).toEqual([]);
    expect(job.result.assets.embedded).toBe(1);
  }, 120000);

  it.skipIf(!latexAvailable)('the PDF compiler resolves it', async () => {
    const started = await call('POST', '/api/build/pdf', { articleId: article.id });
    const job = await waitForJob(started.body.jobId);

    expect(job.status).toBe('succeeded');
    expect(job.result.success).toBe(true);
    expect(job.result.assetErrors).toEqual([]);
    expect(job.result.errors).toEqual([]);

    // The image was copied into the build directory and the *generated* LaTeX
    // rewritten — the canonical Markdown source is untouched.
    const texDir = join(workspace, 'articles', 'uniform-integrability', 'dist', 'pdf', 'tex');
    const tex = readFileSync(join(texDir, 'article.tex'), 'utf-8');
    expect(tex).toMatch(/\\includegraphics\[[^\]]*\]\{image-1\.png\}/);
    expect(existsSync(join(texDir, 'image-1.png'))).toBe(true);

    const { body } = await call('GET', `/api/workspace/article/${article.id}`);
    expect(body.source).toContain('assets/figure-01.png');
  }, 300000);

  it('reports no "image not found" anywhere', async () => {
    const target = await call('POST', '/api/build/target/status', {
      articleId: article.id, platform: 'wechat', theme: 'default',
    });
    const messages = JSON.stringify(target.body.validation || {});
    expect(messages).not.toMatch(/not found/i);
  });
});

describe('article shapes', () => {
  it('nested article folder', async () => {
    const { article } = await articleWithImage({ title: 'Nested', folder: 'research/2026/q3' });

    const started = await call('POST', '/api/build/target', {
      articleId: article.id, platform: 'wechat', theme: 'default', force: true,
    });
    const job = await waitForJob(started.body.jobId);
    expect(job.result.assets.errors).toEqual([]);
    expect(job.result.assets.embedded).toBe(1);
  }, 120000);

  it('filename containing spaces', async () => {
    const { article, upload } = await articleWithImage({
      title: 'Spaced Asset', assetName: 'my figure (1).png',
    });

    // Spaces cannot survive an unquoted Markdown link target.
    expect(upload.canonical).not.toContain(' ');
    expect(upload.reference).toMatch(/^!\[.*\]\(assets\/[^ )]+\)$/);

    const started = await call('POST', '/api/build/target', {
      articleId: article.id, platform: 'wechat', theme: 'default', force: true,
    });
    const job = await waitForJob(started.body.jobId);
    expect(job.result.assets.errors).toEqual([]);
    expect(job.result.assets.embedded).toBe(1);
  }, 120000);

  it('Chinese asset filename', async () => {
    const { article, upload } = await articleWithImage({
      title: 'Chinese Asset', assetName: '图表-01.png',
    });

    expect(upload.canonical).toBe('assets/图表-01.png');

    const started = await call('POST', '/api/build/target', {
      articleId: article.id, platform: 'wechat', theme: 'default', force: true,
    });
    const job = await waitForJob(started.body.jobId);
    expect(job.result.assets.errors).toEqual([]);
    expect(job.result.assets.embedded).toBe(1);
  }, 120000);

  it('Chinese article and folder names', async () => {
    const { article } = await articleWithImage({ title: '均匀可积性', folder: '文章' });

    const resolved = await call('POST', `/api/assets/${article.id}/resolve`, {
      sources: ['assets/figure-01.png'],
    });
    expect(resolved.body.resolved[0].exists).toBe(true);

    const image = await fetch(`${server.url}${resolved.body.resolved[0].url}`, {
      headers: { 'x-mdtex-token': server.token },
    });
    expect(image.status).toBe(200);
  }, 120000);

  it.skipIf(!latexAvailable)('LaTeX project resolves its own relative paths', async () => {
    const { article } = await articleWithImage({ title: 'Latex Project', format: 'latex' });

    const started = await call('POST', '/api/build/pdf', { articleId: article.id });
    const job = await waitForJob(started.body.jobId);

    expect(job.result.assetErrors).toEqual([]);
    expect(job.result.success).toBe(true);

    // Normal LaTeX semantics preserved: the source still says assets/…
    const { body } = await call('GET', `/api/workspace/article/${article.id}`);
    expect(body.source).toContain('{assets/figure-01.png}');
  }, 300000);
});

describe('image replacement and cache busting', () => {
  it('a replaced image gets a new version, so the preview cannot show a stale one', async () => {
    const { article } = await articleWithImage({ title: 'Replaceable' });

    const first = await call('POST', `/api/assets/${article.id}/resolve`, {
      sources: ['assets/figure-01.png'],
    });
    const firstUrl = first.body.resolved[0].url;
    const firstHash = first.body.resolved[0].hash;

    // Replace with different bytes under the same filename.
    const bigger = Buffer.concat([Buffer.from(PNG_BASE64, 'base64'), Buffer.from('padding')]);
    const replaced = await call('POST', `/api/workspace/article/${article.id}/asset`, {
      name: 'figure-01.png',
      dataBase64: bigger.toString('base64'),
      replace: true,
    });

    expect(replaced.body.asset.name).toBe('figure-01.png');
    expect(replaced.body.asset.hash).not.toBe(firstHash);

    const second = await call('POST', `/api/assets/${article.id}/resolve`, {
      sources: ['assets/figure-01.png'],
    });
    // Same canonical path, different URL — the browser must refetch.
    expect(second.body.resolved[0].canonical).toBe('assets/figure-01.png');
    expect(second.body.resolved[0].url).not.toBe(firstUrl);

    const image = await fetch(`${server.url}${second.body.resolved[0].url}`, {
      headers: { 'x-mdtex-token': server.token },
    });
    expect((await image.arrayBuffer()).byteLength).toBe(bigger.length);
  }, 120000);

  it('serves a 304 when the content has not changed', async () => {
    const { article } = await articleWithImage({ title: 'Cacheable' });
    const url = `/api/assets/${article.id}/assets/figure-01.png`;

    const first = await fetch(`${server.url}${url}`, { headers: { 'x-mdtex-token': server.token } });
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();

    const second = await fetch(`${server.url}${url}`, {
      headers: { 'x-mdtex-token': server.token, 'if-none-match': etag },
    });
    expect(second.status).toBe(304);
  }, 120000);

  it('re-importing identical bytes reuses the stored file', async () => {
    const { article } = await articleWithImage({ title: 'Duplicate' });

    const again = await call('POST', `/api/workspace/article/${article.id}/asset`, {
      name: 'figure-01.png',
      dataBase64: PNG_BASE64,
    });

    expect(again.body.asset.name).toBe('figure-01.png');
    expect(again.body.asset.reused).toBe(true);

    const manifest = await call('GET', `/api/assets/${article.id}`);
    expect(manifest.body.assets).toHaveLength(1);
  }, 120000);
});

describe('failures are diagnosable', () => {
  it('a missing image reports source, article root and expected path', async () => {
    const created = await call('POST', '/api/workspace/article', { title: 'Broken Reference' });
    const article = created.body.article;
    await call('PUT', `/api/workspace/article/${article.id}/source`, {
      source: '# Broken\n\n![missing](assets/figure-99.png)\n',
    });

    const started = await call('POST', '/api/build/target', {
      articleId: article.id, platform: 'wechat', theme: 'default', force: true,
    });
    const job = await waitForJob(started.body.jobId);

    expect(job.result.assets.errors).toHaveLength(1);
    const failure = job.result.assets.errors[0];

    expect(failure.diagnostic).toContain('Image not found');
    expect(failure.diagnostic).toContain('assets/figure-99.png');
    expect(failure.diagnostic).toContain(failure.articleRoot);
    expect(failure.expected).toContain(join('assets', 'figure-99.png'));

    // And the build is not quietly reported as valid.
    expect(job.result.validation.valid).toBe(false);
  }, 120000);

  it.skipIf(!latexAvailable)('a missing image fails the PDF build instead of dropping it', async () => {
    const created = await call('POST', '/api/workspace/article', { title: 'Broken Pdf' });
    const article = created.body.article;
    await call('PUT', `/api/workspace/article/${article.id}/source`, {
      source: '# Broken\n\n![missing](assets/figure-99.png)\n',
    });

    const started = await call('POST', '/api/build/pdf', { articleId: article.id });
    const job = await waitForJob(started.body.jobId);

    expect(job.result.success).toBe(false);
    expect(job.result.errors[0].diagnostic).toContain('Image not found');
    expect(job.result.errors[0].diagnostic).toContain(job.result.errors[0].articleRoot);
  }, 300000);

  it('the asset endpoint returns a diagnostic, not a bare 404', async () => {
    const created = await call('POST', '/api/workspace/article', { title: 'Diagnostic' });
    const article = created.body.article;

    const { status, body } = await call('GET', `/api/assets/${article.id}/assets/nope.png`);
    expect(status).toBe(404);
    expect(body.diagnostic).toContain('Image not found');
    expect(body.articleRoot).toBeTruthy();
    expect(body.expected).toContain('nope.png');
  });

  it('refuses to serve a path that escapes the article', async () => {
    const created = await call('POST', '/api/workspace/article', { title: 'Traversal' });
    const article = created.body.article;

    const { status } = await call(
      'GET',
      `/api/assets/${article.id}/${encodeURIComponent('../../../etc/passwd')}`,
    );
    expect(status).toBe(404);
  });
});


describe('a compile subject can be an Article or a buffer', () => {
  /**
   * `compileArticleToPdf` takes a descriptor so an unsaved editor buffer can be
   * compiled, but it is named for the Article model and callers reach for one.
   * An Article keeps its text on disk, so reading `.source` off it yields
   * `undefined` — which used to compile an empty document, reporting success
   * while silently dropping every figure.
   */
  let root;
  let library;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'mdtex-subject-'));
    library = new ArticleLibrary(root);
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('reads an Article through readSource()', () => {
    const article = library.create({ title: 'From Disk' });
    article.writeSource('# From Disk\n\nBody text.\n');
    expect(subjectSource(article)).toContain('Body text.');
  });

  it('prefers an explicit source, so an unsaved buffer still wins', () => {
    const article = library.create({ title: 'Buffered' });
    article.writeSource('# Saved\n');
    expect(subjectSource({ ...article, source: '# Unsaved edit\n' })).toBe('# Unsaved edit\n');
    expect(subjectSource({ source: '' })).toBe('');
  });

  it('has no source for an empty or missing subject', () => {
    expect(subjectSource(null)).toBe('');
    expect(subjectSource({})).toBe('');
  });

  it('materialises the figure when the subject is an Article', () => {
    const article = library.create({ title: 'Article Subject' });
    const written = article.writeAsset('figure-01.png', Buffer.from(PNG_BASE64, 'base64'));
    article.writeSource(`# Article Subject\n\n![A figure](${written.canonical})\n`);

    const buildDir = join(root, 'build');
    const project = materialiseMarkdownProject({
      source: subjectSource(article),
      buildDir,
      baseDir: article.dir,
      articleId: article.id,
      title: article.title,
    });

    expect(project.assetErrors).toEqual([]);
    expect(project.assets).toEqual(['image-1.png']);
    expect(existsSync(join(buildDir, 'image-1.png'))).toBe(true);
    expect(readFileSync(join(buildDir, 'article.tex'), 'utf-8'))
      .toMatch(/\\includegraphics\[[^\]]*\]\{image-1\.png\}/);
  });
});
