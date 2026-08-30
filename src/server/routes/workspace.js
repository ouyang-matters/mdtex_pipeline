import { existsSync, readFileSync, statSync } from 'fs';
import { join, extname } from 'path';
import { sendJson, sendBuffer, readJson, badRequest, notFound, conflict } from '../http.js';
import { ArticleLibrary } from '../../workspace/library.js';
import { ARTICLE_STATUSES, safeAssetName } from '../../workspace/article.js';
import { listCheckpoints, createCheckpoint, restoreCheckpoint, deleteCheckpoint } from '../../workspace/checkpoints.js';
import { latexSourceOf, adoptLatexSource } from '../../workspace/latex-source.js';
import { detectCjkSupport } from '../../core/pdf/compiler.js';
import { detectLatexEnvironment } from '../../core/latex/environment.js';
import { listThemes } from '../../core/themes/index.js';
import { listPdfTemplates } from '../../core/latex/templates.js';
import { listPlatforms } from '../../core/compiler/index.js';
import { ENGINES } from '../../core/latex/environment.js';

/**
 * Article workspace API.
 *
 * All filesystem access for the library lives here; the browser never touches
 * paths. Identity fields are enforced server-side — a metadata update cannot
 * change an article's ID no matter what the client sends.
 */
/**
 * Whether this TeX installation can typeset CJK, cached briefly.
 *
 * The answer only changes when someone installs a package, but it costs two
 * `kpsewhich` subprocesses to find out — too much to pay every time the LaTeX
 * tab is opened, and not something to answer once and never revisit. A short
 * window is the honest middle: a fresh install is picked up within a minute
 * without a restart.
 */
const CJK_TTL_MS = 60_000;
let cjkCache = { at: 0, available: false };

async function cjkAvailability() {
  const now = Date.now();
  if (now - cjkCache.at < CJK_TTL_MS) return cjkCache.available;
  let available = false;
  try {
    const env = await detectLatexEnvironment();
    if (env.available) available = (await detectCjkSupport(env)).available;
  } catch {
    available = false;
  }
  cjkCache = { at: now, available };
  return available;
}

export function workspaceRoutes(ctx) {
  const library = () => new ArticleLibrary(ctx.workspaceRoot);

  const findArticle = (id) => {
    const lib = library();
    const entry = lib.getEntryById(id);
    if (!entry) throw notFound(`No article with id ${id}`);
    return { lib, ...entry };
  };

  const view = (article, folder, path) => ({
    ...article.toJSON(),
    folder,
    path,
    dirName: article.dirName,
    assets: article.listAssets().map(a => ({
      name: a.name,
      canonical: a.canonical,
      relativePath: a.canonical,
      bytes: a.bytes,
      hash: a.hash,
    })),
  });

  return {
    'GET /api/workspace/tree': async (req, res) => {
      const lib = library();
      const entries = lib.listAll();
      sendJson(res, 200, {
        root: lib.rootDir,
        folders: lib.listFolders(),
        articles: entries.map(e => ({
          ...e.article.toJSON(),
          folder: e.folder,
          path: e.path,
          dirName: e.article.dirName,
        })),
        trash: lib.listTrash().map(e => ({ ...e.article.toJSON(), folder: e.folder, path: e.path })),
        tags: lib.allTags(),
        series: lib.allSeries(),
      });
    },

    'GET /api/workspace/schema': async (req, res) => {
      sendJson(res, 200, {
        statuses: ARTICLE_STATUSES,
        sourceFormats: [
          { value: 'markdown', label: 'Markdown', file: 'source.md' },
          { value: 'latex', label: 'LaTeX', file: 'main.tex' },
        ],
        targets: [
          ...listPlatforms().map(p => ({ value: p, label: p === 'wechat' ? 'WeChat' : 'Zhihu' })),
          { value: 'pdf', label: 'PDF' },
          { value: 'blog', label: 'Blog' },
        ],
        themes: listThemes().map(t => ({ value: t.name, label: t.name, source: t.source })),
        pdfTemplates: listPdfTemplates().map(t => ({ value: t.id, label: t.label, description: t.description })),
        pdfEngines: Object.entries(ENGINES).map(([value, e]) => ({ value, label: e.label })),
        languages: [
          { value: 'zh-CN', label: '简体中文 (zh-CN)' },
          { value: 'zh-TW', label: '繁體中文 (zh-TW)' },
          { value: 'en', label: 'English (en)' },
          { value: 'ja', label: '日本語 (ja)' },
          { value: 'ko', label: '한국어 (ko)' },
        ],
        // Explicitly surfaced so the properties dialog can show them read-only.
        immutableFields: ['id', 'createdAt', 'dirName'],
      });
    },

    'GET /api/workspace/search': async (req, res, { query }) => {
      const lib = library();
      const results = lib.search(query.get('q') || '', { includeBody: query.get('body') === '1' });
      sendJson(res, 200, {
        results: results.map(e => ({ ...e.article.toJSON(), folder: e.folder, path: e.path })),
      });
    },

    'POST /api/workspace/article': async (req, res) => {
      const body = await readJson(req);
      if (!body.title?.trim()) throw badRequest('A title is required.');
      const lib = library();
      let article;
      try {
        article = lib.create({
          title: body.title.trim(),
          folder: body.folder || '',
          sourceFormat: body.sourceFormat === 'latex' ? 'latex' : 'markdown',
          language: body.language || 'zh-CN',
          tags: body.tags || [],
          series: body.series || null,
          theme: body.theme || 'default',
          pdfTemplate: body.pdfTemplate || 'default',
          pdfEngine: body.pdfEngine || 'xelatex',
          targets: body.targets || ['wechat', 'pdf'],
          template: body.content || '',
        });
      } catch (e) {
        throw conflict(e.message);
      }
      const entry = lib.getEntryById(article.id);
      sendJson(res, 201, { article: view(article, entry?.folder ?? '', entry?.path ?? '') });
    },

    'POST /api/workspace/import': async (req, res) => {
      const body = await readJson(req);
      if (typeof body.content !== 'string') throw badRequest('`content` is required.');
      const lib = library();
      const article = lib.importContent({
        name: body.name || 'imported.md',
        content: body.content,
        folder: body.folder || '',
        title: body.title || null,
      });
      const entry = lib.getEntryById(article.id);
      sendJson(res, 201, { article: view(article, entry?.folder ?? '', entry?.path ?? '') });
    },

    'GET /api/workspace/article/:id': async (req, res, { params }) => {
      const { article, folder, path } = findArticle(params.id);
      sendJson(res, 200, {
        article: view(article, folder, path),
        source: article.readSource(),
      });
    },

    'PUT /api/workspace/article/:id/source': async (req, res, { params }) => {
      const body = await readJson(req);
      if (typeof body.source !== 'string') throw badRequest('`source` must be a string.');
      const { article, folder, path } = findArticle(params.id);
      article.writeSource(body.source);
      sendJson(res, 200, { article: view(article, folder, path), savedAt: article.updatedAt });
    },

    // ── The LaTeX face of a Markdown article ─────────────────────────────────
    //
    // Read-only for a Markdown article: the document is generated by the same
    // builder the PDF build uses, so what the editor shows is exactly what a
    // build compiles and exactly what adopting would write.

    'GET /api/workspace/article/:id/latex': async (req, res, { params }) => {
      const { article } = findArticle(params.id);
      const latex = latexSourceOf(article, {
        cjkAvailable: await cjkAvailability(),
        persist: true,
      });
      sendJson(res, 200, { ...latex, sourceFormat: article.sourceFormat });
    },

    'POST /api/workspace/article/:id/latex/adopt': async (req, res, { params }) => {
      const { article, folder, path } = findArticle(params.id);
      let result;
      try {
        result = adoptLatexSource(article, { cjkAvailable: await cjkAvailability() });
      } catch (e) {
        throw conflict(e.message);
      }
      sendJson(res, 200, { ...result, article: view(article, folder, path) });
    },

    'PUT /api/workspace/article/:id/meta': async (req, res, { params }) => {
      const body = await readJson(req);
      const { article, folder, path } = findArticle(params.id);

      let formatChange = null;
      if (body.sourceFormat && body.sourceFormat !== article.sourceFormat) {
        try {
          formatChange = article.changeSourceFormat(body.sourceFormat);
        } catch (e) {
          throw conflict(e.message);
        }
      }

      const { applied, ignored } = article.applyMetadata(body);
      sendJson(res, 200, {
        article: view(article, folder, path),
        applied,
        // Reported rather than silently dropped, so the UI can explain why an
        // identity field did not change.
        ignored,
        formatChange,
      });
    },

    'POST /api/workspace/article/:id/move': async (req, res, { params }) => {
      const body = await readJson(req);
      const { lib, article } = findArticle(params.id);
      try {
        lib.move(article, body.folder ?? '');
      } catch (e) {
        throw conflict(e.message);
      }
      const entry = lib.getEntryById(article.id);
      sendJson(res, 200, { article: view(article, entry?.folder ?? '', entry?.path ?? '') });
    },

    'POST /api/workspace/article/:id/duplicate': async (req, res, { params }) => {
      const body = await readJson(req);
      const { lib, article } = findArticle(params.id);
      const copy = lib.duplicate(article, { title: body.title || null });
      const entry = lib.getEntryById(copy.id);
      sendJson(res, 201, { article: view(copy, entry?.folder ?? '', entry?.path ?? '') });
    },

    'DELETE /api/workspace/article/:id': async (req, res, { params, query }) => {
      const lib = library();
      if (query.get('permanent') === '1') {
        const trashed = lib.getTrashedById(params.id);
        if (!trashed) throw notFound('That article is not in the trash.');
        lib.purge(trashed);
        sendJson(res, 200, { purged: params.id });
        return;
      }
      const { article } = findArticle(params.id);
      lib.delete(article);
      sendJson(res, 200, { deleted: params.id, deletedAt: article.deletedAt, restorable: true });
    },

    'POST /api/workspace/article/:id/restore': async (req, res, { params }) => {
      const lib = library();
      const article = lib.getTrashedById(params.id);
      if (!article) throw notFound('That article is not in the trash.');
      lib.restore(article);
      const entry = lib.getEntryById(article.id);
      sendJson(res, 200, { article: view(article, entry?.folder ?? '', entry?.path ?? '') });
    },

    'POST /api/workspace/trash/empty': async (req, res) => {
      const count = library().emptyTrash();
      sendJson(res, 200, { removed: count });
    },

    // ── Folders ──────────────────────────────────────────────────────────────

    'POST /api/workspace/folder': async (req, res) => {
      const body = await readJson(req);
      try {
        sendJson(res, 201, { folder: library().createFolder(body.path || body.name || '') });
      } catch (e) {
        throw conflict(e.message);
      }
    },

    'PUT /api/workspace/folder': async (req, res) => {
      const body = await readJson(req);
      try {
        sendJson(res, 200, { folder: library().renameFolder(body.path, body.name) });
      } catch (e) {
        throw conflict(e.message);
      }
    },

    'DELETE /api/workspace/folder': async (req, res, { query }) => {
      try {
        sendJson(res, 200, { folder: library().deleteFolder(query.get('path') || '') });
      } catch (e) {
        throw conflict(e.message);
      }
    },

    // ── Assets ───────────────────────────────────────────────────────────────

    'POST /api/workspace/article/:id/asset': async (req, res, { params }) => {
      const body = await readJson(req);
      if (!body.name || typeof body.dataBase64 !== 'string') {
        throw badRequest('`name` and `dataBase64` are required.');
      }
      const { article } = findArticle(params.id);
      const buffer = Buffer.from(body.dataBase64, 'base64');
      if (!buffer.length) throw badRequest('The uploaded file is empty.');

      // writeAsset verifies the file landed before returning; a reference is
      // never handed back for an asset that failed to copy.
      let asset;
      try {
        asset = article.writeAsset(body.name, buffer, { replace: Boolean(body.replace) });
      } catch (e) {
        throw badRequest(e.message);
      }

      const resolver = article.assetResolver();
      sendJson(res, 201, {
        asset: {
          name: asset.name,
          canonical: asset.canonical,
          relativePath: asset.canonical,
          bytes: asset.bytes,
          hash: asset.hash,
          reused: asset.reused,
        },
        // The canonical article-relative form — this is what goes in the source.
        reference: asset.reference,
        canonical: asset.canonical,
        // A rendering detail for the preview; never written into the source.
        url: resolver.previewUrl(asset.canonical),
      });
    },

    'GET /api/workspace/article/:id/asset/:name': async (req, res, { params }) => {
      const { article } = findArticle(params.id);
      const name = safeAssetName(params.name);
      const file = join(article.assetsDir || '', name);
      if (!article.assetsDir || !existsSync(file) || !statSync(file).isFile()) throw notFound('Asset not found.');
      sendBuffer(res, 200, readFileSync(file), contentTypeFor(name), { 'Cache-Control': 'no-cache' });
    },

    'DELETE /api/workspace/article/:id/asset/:name': async (req, res, { params }) => {
      const { article } = findArticle(params.id);
      const ok = article.deleteAsset(params.name);
      if (!ok) throw notFound('Asset not found.');
      sendJson(res, 200, { deleted: params.name });
    },

    // ── Checkpoints ──────────────────────────────────────────────────────────

    'GET /api/workspace/article/:id/checkpoints': async (req, res, { params }) => {
      const { article } = findArticle(params.id);
      sendJson(res, 200, { checkpoints: listCheckpoints(article) });
    },

    'POST /api/workspace/article/:id/checkpoints': async (req, res, { params }) => {
      const body = await readJson(req);
      const { article } = findArticle(params.id);
      sendJson(res, 201, {
        checkpoint: createCheckpoint(article, {
          label: body.label || 'Manual checkpoint',
          origin: 'manual',
          themeName: body.themeName || null,
          themeCss: body.themeCss || null,
        }),
      });
    },

    'POST /api/workspace/article/:id/checkpoints/:checkpointId/restore': async (req, res, { params }) => {
      const { article, folder, path } = findArticle(params.id);
      let restored;
      try {
        restored = restoreCheckpoint(article, params.checkpointId);
      } catch (e) {
        throw notFound(e.message);
      }
      sendJson(res, 200, { ...restored, article: view(article, folder, path) });
    },

    'DELETE /api/workspace/article/:id/checkpoints/:checkpointId': async (req, res, { params }) => {
      const { article } = findArticle(params.id);
      const ok = deleteCheckpoint(article, params.checkpointId);
      if (!ok) throw notFound('Checkpoint not found.');
      sendJson(res, 200, { deleted: params.checkpointId });
    },
  };
}

const CONTENT_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.bib': 'text/plain; charset=utf-8',
  '.tex': 'text/plain; charset=utf-8',
  '.sty': 'text/plain; charset=utf-8',
};

function contentTypeFor(name) {
  return CONTENT_TYPES[extname(name).toLowerCase()] || 'application/octet-stream';
}
