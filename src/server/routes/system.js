import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { sendJson, readJson } from '../http.js';
import { paths, getVersionSync, getGitCommitSync } from '../../core/paths.js';
import { getConfig, getPreferences, saveConfig, loadConfig, CONFIG_VERSION, DATA_VERSION } from '../../core/config/index.js';
import { detectLatexEnvironment, resetLatexEnvironmentCache, ENGINES } from '../../core/latex/environment.js';
import { listPdfTemplates } from '../../core/latex/templates.js';
import { listPlatforms } from '../../core/compiler/index.js';
import { findClaudeCli } from '../../ai/backends/local-claude.js';
import { BlogPipelineIntegration } from '../../workspace/blogpipe.js';

/**
 * Health, environment detection and application preferences.
 *
 * `/api/env` is what the UI uses to decide whether to show the "Compile PDF"
 * button or a LaTeX setup card — the frontend never probes the system itself.
 */
export function systemRoutes(ctx) {
  return {
    'GET /api/health': async (req, res) => {
      sendJson(res, 200, {
        ok: true,
        app: 'mdtex',
        version: getVersionSync(),
        commit: getGitCommitSync(),
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        pid: process.pid,
        startedAt: ctx.startedAt,
        configVersion: CONFIG_VERSION,
        dataVersion: DATA_VERSION,
      });
    },

    'GET /api/env': async (req, res, { query }) => {
      const force = query.get('refresh') === '1';
      if (force) resetLatexEnvironmentCache();

      const latex = await detectLatexEnvironment({ force });
      const blogpipe = new BlogPipelineIntegration().detect();
      const claudePath = findClaudeCli();

      sendJson(res, 200, {
        platform: process.platform,
        paths: {
          appRoot: paths.appRoot,
          configDir: paths.configDir,
          dataDir: paths.dataDir,
          cacheDir: paths.cacheDir,
          workspace: paths.workspace,
          userThemes: paths.userThemes,
        },
        latex: {
          available: latex.available,
          distribution: latex.distribution,
          defaultEngine: latex.defaultEngine,
          engines: Object.fromEntries(
            Object.entries(latex.engines).map(([k, v]) => [k, { path: v.path, version: v.version, label: ENGINES[k].label }]),
          ),
          latexmk: latex.latexmk ? { path: latex.latexmk.path, version: latex.latexmk.version } : null,
          tools: Object.fromEntries(
            Object.entries(latex.tools).map(([k, v]) => [k, v ? { path: v.path, version: v.version } : null]),
          ),
          missing: latex.missing,
          notes: latex.notes,
          hint: latex.hint,
          searchedDirCount: latex.searchedDirs.length,
          checkedAt: latex.checkedAt,
        },
        pdfTemplates: listPdfTemplates(),
        platforms: listPlatforms(),
        claudeCode: { available: Boolean(claudePath), path: claudePath },
        blogpipe,
      });
    },

    'GET /api/preferences': async (req, res) => {
      sendJson(res, 200, { preferences: getPreferences(), config: getConfig() });
    },

    'PUT /api/preferences': async (req, res) => {
      const body = await readJson(req);
      const current = loadConfig(paths.preferencesFile) || {};
      const next = { ...current, ...body, config_version: CONFIG_VERSION };
      saveConfig(paths.preferencesFile, next);
      sendJson(res, 200, { preferences: next });
    },

    'PUT /api/config': async (req, res) => {
      const body = await readJson(req);
      const current = loadConfig(paths.configFile) || {};
      const next = { ...current, ...body, config_version: CONFIG_VERSION };
      saveConfig(paths.configFile, next);
      sendJson(res, 200, { config: next });
    },
  };
}
