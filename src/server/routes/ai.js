import { randomUUID } from 'crypto';
import { join } from 'path';
import { sendJson, readJson, badRequest, notFound, conflict } from '../http.js';
import {
  listProfiles, saveProfile, deleteProfile, setActiveProfile, getProfile,
  backendFor, getActiveProfile, quickConnectOptions, recordTestResult, resetAiCache,
  BACKEND_TYPES, SELECTABLE_MODELS, EFFORT_LEVELS,
} from '../../ai/registry.js';
import {
  ToolExecutor, runAiRequest, buildContext, scopePermissions, SCOPES,
} from '../../ai/session.js';
import { toolDefinitionsForApi } from '../../ai/tools.js';
import { ArticleLibrary } from '../../workspace/library.js';
import { loadTheme, resolveCssVariables } from '../../core/themes/index.js';
import { detectLatexEnvironment } from '../../core/latex/environment.js';
import { compileArticleToPdf } from '../../core/pdf/compiler.js';
import { Compiler } from '../../core/compiler/index.js';
import { BlogPipelineIntegration } from '../../workspace/blogpipe.js';

/**
 * AI connection management and agent runs.
 *
 * The run endpoint stages every edit: it returns diffs, and nothing reaches
 * disk until the user accepts. `/api/ai/run/:id/tool` is the callback the MCP
 * bridge uses, so a CLI-driven agent executes through the same ToolExecutor as
 * the API-driven ones.
 */
export function aiRoutes(ctx) {
  const runs = ctx.aiRuns || (ctx.aiRuns = new Map());
  const library = () => new ArticleLibrary(ctx.workspaceRoot);

  function buildExecutor(body) {
    const lib = library();
    const entry = body.articleId ? lib.getEntryById(body.articleId) : null;
    if (body.articleId && !entry) throw notFound(`No article with id ${body.articleId}`);
    const article = entry?.article || null;

    const source = typeof body.source === 'string' ? body.source : (article?.readSource() ?? '');
    const themeName = body.themeName || article?.theme || 'default';

    let themeCss = body.themeCss;
    if (typeof themeCss !== 'string') {
      try { themeCss = loadTheme(themeName).css; } catch { themeCss = ''; }
    }

    const permissions = scopePermissions(body.scope || 'content');

    const compiler = new Compiler();

    const services = {
      compilePdf: async ({ source: latestSource, engine }) => {
        const environment = await detectLatexEnvironment();
        if (!environment.available) {
          return { success: false, errors: [{ message: 'LaTeX is not installed on this machine.' }], warnings: [] };
        }
        const outputDir = article?.dir
          ? join(article.dir, 'dist', 'pdf')
          : join(ctx.scratchDir, 'ai-pdf');
        return compileArticleToPdf({
          sourceFormat: article?.sourceFormat || 'markdown',
          source: latestSource,
          dir: article?.dir || null,
          sourceFile: article?.sourceFile || null,
          title: article?.title || null,
          language: article?.language || 'en',
          pdfTemplate: article?.pdfTemplate || 'default',
          pdfEngine: engine || article?.pdfEngine || environment.defaultEngine,
        }, { outputDir, environment });
      },
      renderWeChat: async ({ source: latestSource, themeCss: latestCss }) =>
        compiler.compile(latestSource, {
          themeCss: resolveCssVariables(latestCss || themeCss || ''),
          themeName,
          platform: 'wechat',
          baseDir: article?.dir || process.cwd(),
        }),
      blogpipe: async ({ articleId }) => {
        const integration = new BlogPipelineIntegration();
        const detection = integration.detect();
        if (!detection.available) {
          return { available: false, detail: 'The blogpipe CLI was not found on this machine.' };
        }
        const status = articleId ? await integration.status(articleId) : { available: true };
        return { available: true, version: detection.version, status };
      },
    };

    const executor = new ToolExecutor({
      article,
      source,
      selection: body.selection || null,
      themeName,
      themeCss,
      permissions,
      services,
    });

    return { executor, article, entry, source, themeName };
  }

  return {
    'GET /api/ai/backends': async (req, res) => {
      const active = getActiveProfile();
      sendJson(res, 200, {
        profiles: listProfiles(),
        activeProfileId: active?.id || null,
        quickConnect: quickConnectOptions(),
        types: BACKEND_TYPES,
        models: SELECTABLE_MODELS,
        effortLevels: EFFORT_LEVELS,
        scopes: Object.entries(SCOPES).map(([value, s]) => ({ value, label: s.label })),
      });
    },

    'POST /api/ai/backends': async (req, res) => {
      const body = await readJson(req);
      try {
        const profile = saveProfile(body);
        // A new or changed connection is usable immediately: no restart.
        resetAiCache();
        sendJson(res, 201, { profile: listProfiles().find(p => p.id === profile.id), profiles: listProfiles() });
      } catch (e) {
        throw badRequest(e.message);
      }
    },

    'DELETE /api/ai/backends/:id': async (req, res, { params }) => {
      if (!deleteProfile(params.id)) throw notFound('No such AI connection.');
      resetAiCache();
      sendJson(res, 200, { profiles: listProfiles(), activeProfileId: getActiveProfile()?.id || null });
    },

    'POST /api/ai/backends/:id/activate': async (req, res, { params }) => {
      try {
        setActiveProfile(params.id === 'none' ? null : params.id);
      } catch (e) {
        throw notFound(e.message);
      }
      resetAiCache();
      sendJson(res, 200, { profiles: listProfiles(), activeProfileId: getActiveProfile()?.id || null });
    },

    /**
     * Test a connection. Accepts either a saved profile id or an unsaved draft,
     * so the quick-connect dialog can verify before it stores anything.
     */
    'POST /api/ai/test': async (req, res) => {
      const body = await readJson(req);

      let backend;
      if (body.id) {
        const profile = getProfile(body.id);
        if (!profile) throw notFound('No such AI connection.');
        backend = backendFor(profile);
      } else {
        if (!body.type) throw badRequest('`type` or `id` is required.');
        // A draft is saved first (secrets go straight to the secret store) and
        // removed again if the caller only wanted a test.
        const draftId = `draft-${randomUUID().slice(0, 8)}`;
        const saved = saveProfile({ ...body, id: draftId, name: body.name || 'Draft' });
        const profile = getProfile(saved.id);
        backend = backendFor(profile);

        const job = ctx.jobs.start('ai-test', async ({ signal }) => {
          const result = await backend.testConnection({ signal });
          backend.closeTunnel?.();
          if (result.ok && body.save) {
            const finalProfile = saveProfile({ ...body, id: undefined, name: body.name });
            deleteProfile(draftId);
            resetAiCache();
            recordTestResult(finalProfile.id, true);
            return { ...result, saved: true, profileId: finalProfile.id, profiles: listProfiles() };
          }
          deleteProfile(draftId);
          resetAiCache();
          return { ...result, saved: false };
        }, { label: 'Test AI connection' });

        sendJson(res, 202, { jobId: job.id });
        return;
      }

      const job = ctx.jobs.start('ai-test', async ({ signal }) => {
        const result = await backend.testConnection({ signal });
        backend.closeTunnel?.();
        recordTestResult(body.id, Boolean(result.ok));
        return { ...result, profiles: listProfiles() };
      }, { label: 'Test AI connection' });

      sendJson(res, 202, { jobId: job.id });
    },

    // ── Runs ─────────────────────────────────────────────────────────────────

    'POST /api/ai/run': async (req, res) => {
      const body = await readJson(req);
      if (!body.prompt?.trim()) throw badRequest('A prompt is required.');

      const profile = body.profileId ? getProfile(body.profileId) : getActiveProfile();
      if (!profile) {
        throw conflict('No AI connection is configured. Use Quick Connect in the AI panel.');
      }
      const backend = backendFor(profile);
      if (!backend) throw conflict(`Unsupported AI backend type: ${profile.type}`);

      const { executor, article, themeName } = buildExecutor(body);
      const scope = SCOPES[body.scope] ? body.scope : 'content';

      const runId = randomUUID();
      const environment = await detectLatexEnvironment();

      const context = buildContext({
        article,
        source: executor.source,
        selection: body.selection || null,
        themeName,
        platform: body.platform || 'wechat',
        scope,
        environment,
        latest: {
          pdf: ctx.lastPdfBuilds.get(article?.id || '__buffer__') || null,
          wechat: body.lastWeChat || null,
        },
      });

      const job = ctx.jobs.start('ai-run', async ({ signal, progress, log }) => {
        runs.set(runId, { executor, signal, createdAt: Date.now(), jobId: null });

        try {
          const result = await runAiRequest({
            backend,
            executor,
            prompt: body.prompt.trim(),
            scope,
            context,
            bridge: {
              apiUrl: ctx.baseUrl,
              token: ctx.token,
              runId,
            },
            signal,
            onEvent: (event) => {
              if (event.kind === 'assistant-text') progress({ phase: 'assistant', text: event.text });
              else if (event.kind === 'tool-use') progress({ phase: 'tool', message: `→ ${event.tool}`, tool: event.tool, input: event.input });
              else if (event.kind === 'tool-result') progress({ phase: 'tool', message: `← ${event.tool}${event.ok ? '' : ` failed: ${event.error}`}`, tool: event.tool, ok: event.ok });
              else progress(event);
            },
          });

          return { ...result, runId, profileId: profile.id, backend: backend.describe() };
        } finally {
          // Keep the executor around so the client can accept or discard the
          // staged changes after the job finishes.
          setTimeout(() => runs.delete(runId), 10 * 60 * 1000).unref?.();
        }
      }, { label: `AI: ${SCOPES[scope].label}`, meta: { runId, articleId: article?.id || null, scope } });

      runs.set(runId, { executor, jobId: job.id, createdAt: Date.now() });
      sendJson(res, 202, { jobId: job.id, runId });
    },

    /** Tool definitions for the MCP bridge. */
    'GET /api/ai/run/:runId/tools': async (req, res, { params }) => {
      const run = runs.get(params.runId);
      if (!run) throw notFound('That AI run is no longer active.');
      sendJson(res, 200, { tools: toolDefinitionsForApi(run.executor.permissions) });
    },

    /** Tool execution callback for the MCP bridge. */
    'POST /api/ai/run/:runId/tool': async (req, res, { params }) => {
      const run = runs.get(params.runId);
      if (!run) throw notFound('That AI run is no longer active.');
      const body = await readJson(req);
      if (!body.name) throw badRequest('`name` is required.');
      const result = await run.executor.run(body.name, body.input || {});
      sendJson(res, 200, { result });
    },

    /** Accept the staged changes from a run. */
    'POST /api/ai/run/:runId/apply': async (req, res, { params }) => {
      const run = runs.get(params.runId);
      if (!run) throw notFound('That AI run is no longer available.');
      const body = await readJson(req);

      const { checkpoint, applied } = run.executor.commit({ label: body.label || 'AI edit' });
      sendJson(res, 200, {
        applied,
        checkpoint,
        source: run.executor.source,
        themeName: run.executor.themeName,
        themeCss: run.executor.themeCss,
      });
    },

    /** Discard the staged changes from a run. */
    'POST /api/ai/run/:runId/discard': async (req, res, { params }) => {
      const run = runs.get(params.runId);
      if (!run) throw notFound('That AI run is no longer available.');
      runs.delete(params.runId);
      sendJson(res, 200, { discarded: params.runId });
    },
  };
}
