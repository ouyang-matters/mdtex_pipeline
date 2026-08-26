import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { sendJson, sendBuffer, readJson, badRequest, notFound } from '../http.js';
import { Compiler } from '../../core/compiler/index.js';
import { TargetCache, targetCacheKey } from '../../core/targets/cache.js';
import { loadTheme, resolveCssVariables } from '../../core/themes/index.js';
import { ArticleLibrary } from '../../workspace/library.js';
import { compileArticleToPdf } from '../../core/pdf/compiler.js';
import { detectLatexEnvironment } from '../../core/latex/environment.js';
import { ensureDir, paths } from '../../core/paths.js';

/**
 * Build API.
 *
 * Both expensive builds run as jobs so the UI gets streamed progress, an
 * explicit error/warning list and a working Cancel button — the WeChat
 * compilation in particular used to run on the browser main thread and froze
 * the editor for minutes on a long mathematical article.
 *
 * `POST /api/build/target` prepares and caches the platform representation.
 * `GET  /api/build/target/:key` returns already-prepared bytes for the
 * clipboard, without recompiling anything.
 */
export function buildRoutes(ctx) {
  const targetCache = ctx.targetCache || (ctx.targetCache = new TargetCache());
  const compiler = ctx.compiler || (ctx.compiler = new Compiler());
  const library = () => new ArticleLibrary(ctx.workspaceRoot);

  /** Resolve theme CSS from either a theme name or CSS supplied by the editor. */
  function resolveTheme({ theme, themeCss, themeName }) {
    if (typeof themeCss === 'string') {
      return { css: resolveCssVariables(themeCss), name: themeName || 'custom' };
    }
    const loaded = loadTheme(theme || 'default');
    return { css: resolveCssVariables(loaded.css), name: loaded.name };
  }

  /** Resolve the article + source a build request refers to. */
  function resolveSubject(body) {
    if (body.articleId) {
      const lib = library();
      const entry = lib.getEntryById(body.articleId);
      if (!entry) throw notFound(`No article with id ${body.articleId}`);
      const article = entry.article;
      // The editor buffer wins: the user may not have saved yet.
      const source = typeof body.source === 'string' ? body.source : article.readSource();
      return { article, source, folder: entry.folder };
    }
    if (typeof body.source !== 'string') throw badRequest('Either `articleId` or `source` is required.');
    return { article: null, source: body.source, folder: '' };
  }

  return {
    /**
     * Compile for a publishing target (WeChat / Zhihu).
     * Returns immediately with a cache hit when nothing relevant has changed.
     */
    'POST /api/build/target': async (req, res) => {
      const body = await readJson(req);
      const { article, source } = resolveSubject(body);
      const platform = body.platform || 'wechat';
      const mathOutput = body.mathOutput || 'svg';
      const themeInfo = resolveTheme(body);

      const key = targetCacheKey({
        source,
        themeCss: themeInfo.css,
        themeName: themeInfo.name,
        platform,
        mathOutput,
      });

      if (!body.force) {
        const cached = targetCache.get(key);
        if (cached) {
          sendJson(res, 200, {
            cached: true,
            key,
            platform: cached.platform,
            validation: cached.validation,
            stats: cached.stats,
            bytes: cached.bytes,
            durationMs: cached.durationMs,
            preparedAt: cached.createdAt,
          });
          return;
        }
      }

      const job = ctx.jobs.start('build-target', async ({ signal, progress }) => {
        const started = Date.now();
        const result = await compiler.compile(source, {
          themeCss: themeInfo.css,
          themeName: themeInfo.name,
          platform,
          mathOutput,
          baseDir: article?.dir || process.cwd(),
          signal,
          includePlainText: true,
          onProgress: (event) => progress(event),
        });

        const durationMs = Date.now() - started;
        targetCache.set(key, {
          html: result.html,
          plainText: result.plainText,
          validation: result.validation,
          stats: {
            ...result.validation.stats,
            formulas: result.mathResult,
            timings: result.timings,
          },
          platform,
          theme: themeInfo.name,
          mathOutput,
          durationMs,
        });

        progress({ phase: 'ready', message: 'Ready to copy' });

        return {
          key,
          platform,
          bytes: result.html.length,
          durationMs,
          validation: result.validation,
          formulas: result.mathResult,
          timings: result.timings,
        };
      }, { label: `Compile for ${platform}`, meta: { platform, articleId: article?.id || null, key } });

      sendJson(res, 202, { jobId: job.id, key, cached: false });
    },

    /** Fetch prepared target output. Never triggers a compile. */
    'GET /api/build/target/:key': async (req, res, { params, query }) => {
      const entry = targetCache.get(params.key);
      if (!entry) throw notFound('That target output is no longer prepared. Compile again.');

      if (query.get('format') === 'text') {
        sendJson(res, 200, { key: params.key, plainText: targetCache.getPlainText(params.key) ?? '' });
        return;
      }

      sendJson(res, 200, {
        key: params.key,
        platform: entry.platform,
        html: entry.html,
        plainText: targetCache.getPlainText(params.key) ?? '',
        validation: entry.validation,
        stats: entry.stats,
        bytes: entry.bytes,
        preparedAt: entry.createdAt,
      });
    },

    /** Report whether a given article/theme/platform combination is already prepared. */
    'POST /api/build/target/status': async (req, res) => {
      const body = await readJson(req);
      const { article, source } = resolveSubject(body);
      const themeInfo = resolveTheme(body);
      const key = targetCacheKey({
        source,
        themeCss: themeInfo.css,
        themeName: themeInfo.name,
        platform: body.platform || 'wechat',
        mathOutput: body.mathOutput || 'svg',
      });
      const entry = targetCache.get(key);
      sendJson(res, 200, {
        key,
        prepared: Boolean(entry),
        preparedAt: entry?.createdAt || null,
        bytes: entry?.bytes || 0,
        validation: entry?.validation || null,
        articleId: article?.id || null,
      });
    },

    'POST /api/build/cache/clear': async (req, res) => {
      sendJson(res, 200, { removed: targetCache.clear() });
    },

    // ── PDF ──────────────────────────────────────────────────────────────────

    'POST /api/build/pdf': async (req, res) => {
      const body = await readJson(req);
      const { article, source } = resolveSubject(body);

      const environment = await detectLatexEnvironment();
      if (!environment.available) {
        sendJson(res, 200, {
          unavailable: true,
          missing: environment.missing,
          hint: environment.hint,
          notes: environment.notes,
        });
        return;
      }

      const outputDir = article?.dir
        ? join(article.dir, 'dist', 'pdf')
        : join(ensureDir(join(paths.cacheDir, 'pdf-scratch')), 'buffer');

      const subject = {
        sourceFormat: article?.sourceFormat || (body.sourceFormat === 'latex' ? 'latex' : 'markdown'),
        source,
        dir: article?.dir || null,
        sourceFile: article?.sourceFile || null,
        title: body.title || article?.title || null,
        author: body.author ?? article?.author ?? '',
        language: body.language || article?.language || 'en',
        pdfTemplate: body.template || article?.pdfTemplate || 'default',
        pdfEngine: body.engine || article?.pdfEngine || environment.defaultEngine,
      };

      const job = ctx.jobs.start('build-pdf', async ({ signal, progress, log }) => {
        const result = await compileArticleToPdf(subject, {
          outputDir,
          signal,
          environment,
          onProgress: (event) => {
            if (event.phase === 'log') log(event.line);
            else progress(event);
          },
        });

        if (result.success) {
          progress({ phase: 'done', message: `PDF ready: ${result.pdfPath}` });
        }

        ctx.lastPdfBuilds.set(article?.id || '__buffer__', {
          success: result.success,
          pdfPath: result.pdfPath,
          logPath: result.logPath,
          errorCount: result.errors?.length || 0,
          at: Date.now(),
        });

        return {
          success: result.success,
          mode: result.mode,
          engine: result.engine,
          template: result.template || null,
          pdfPath: result.pdfPath,
          pdfBytes: result.pdfBytes || 0,
          logPath: result.logPath,
          errors: result.errors || [],
          warnings: (result.warnings || []).slice(0, 100),
          layoutNotes: (result.layoutNotes || []).slice(0, 50),
          outputDir,
          // A stable URL the UI can point an <iframe>/<embed> at.
          pdfUrl: result.pdfPath
            ? `/api/build/pdf/file?path=${encodeURIComponent(result.pdfPath)}`
            : null,
        };
      }, { label: 'Compile PDF', meta: { articleId: article?.id || null, engine: subject.pdfEngine } });

      sendJson(res, 202, { jobId: job.id, outputDir });
    },

    /** Serve a built PDF. Restricted to files MDTeX itself produced. */
    'GET /api/build/pdf/file': async (req, res, { query }) => {
      const path = query.get('path');
      if (!path) throw badRequest('`path` is required.');
      if (!ctx.isBuildArtifact(path)) throw notFound('That file is not an MDTeX build artifact.');
      if (!existsSync(path) || !statSync(path).isFile()) throw notFound('PDF not found.');

      sendBuffer(res, 200, readFileSync(path), 'application/pdf', {
        'Content-Disposition': 'inline',
        'Cache-Control': 'no-store',
      });
    },

    /** Full compiler log for the last build of an article. */
    'GET /api/build/pdf/log': async (req, res, { query }) => {
      const path = query.get('path');
      if (!path) throw badRequest('`path` is required.');
      if (!ctx.isBuildArtifact(path)) throw notFound('That file is not an MDTeX build artifact.');
      if (!existsSync(path)) throw notFound('Log not found.');
      sendJson(res, 200, { path, log: readFileSync(path, 'utf-8') });
    },
  };
}
