import { existsSync, readFileSync, writeFileSync, rmSync, renameSync } from 'fs';
import { join } from 'path';
import { sendJson, readJson, badRequest, notFound, conflict } from '../http.js';
import { listThemes, loadTheme, copyTheme } from '../../core/themes/index.js';
import { paths, ensureDir } from '../../core/paths.js';
import {
  listPdfTemplates, loadPdfTemplate, ejectPdfTemplate, userTemplatesDir,
} from '../../core/latex/templates.js';

/**
 * Theme and PDF-template API.
 *
 * Themes live on disk under ~/.local/share/publisher/themes, not in browser
 * storage, so they survive a cleared cache and are shared with the CLI.
 * Built-ins stay read-only; editing one duplicates it first.
 */
export function themeRoutes() {
  const themeFile = (name) => join(paths.userThemes, `${safeName(name)}.css`);

  return {
    'GET /api/themes': async (req, res) => {
      const themes = listThemes().map(t => ({
        name: t.name,
        source: t.source,
        overridesBuiltin: Boolean(t.overridesBuiltin),
        editable: t.source === 'user',
      }));
      sendJson(res, 200, { themes });
    },

    'GET /api/themes/:name': async (req, res, { params }) => {
      try {
        const theme = loadTheme(params.name);
        sendJson(res, 200, {
          name: theme.name,
          css: theme.css,
          source: theme.isUser ? 'user' : 'builtin',
          editable: theme.isUser,
        });
      } catch (e) {
        throw notFound(e.message);
      }
    },

    'PUT /api/themes/:name': async (req, res, { params }) => {
      const body = await readJson(req);
      if (typeof body.css !== 'string') throw badRequest('`css` is required.');

      const name = safeName(params.name);
      const builtinPath = join(paths.builtinThemes, `${name}.css`);
      const userPath = themeFile(name);

      // Saving over a built-in name writes a user theme that shadows it, which
      // is what the theme loader already expects — the built-in file is never
      // modified.
      ensureDir(paths.userThemes);
      writeFileSync(userPath, body.css, 'utf-8');

      sendJson(res, 200, {
        name,
        source: 'user',
        editable: true,
        shadowsBuiltin: existsSync(builtinPath),
      });
    },

    'POST /api/themes': async (req, res) => {
      const body = await readJson(req);
      const name = safeName(body.name);
      if (!name) throw badRequest('A theme name is required.');
      if (existsSync(themeFile(name))) throw conflict(`A theme called "${name}" already exists.`);

      ensureDir(paths.userThemes);
      if (body.from) {
        try {
          copyTheme(body.from, name);
        } catch (e) {
          throw badRequest(e.message);
        }
      } else {
        writeFileSync(themeFile(name), body.css ?? '/* Styles are scoped under #nice */\n', 'utf-8');
      }
      sendJson(res, 201, { name, source: 'user', editable: true });
    },

    'POST /api/themes/:name/rename': async (req, res, { params }) => {
      const body = await readJson(req);
      const from = safeName(params.name);
      const to = safeName(body.name);
      if (!to) throw badRequest('A new name is required.');
      if (!existsSync(themeFile(from))) throw notFound(`"${from}" is not a user theme.`);
      if (existsSync(themeFile(to))) throw conflict(`A theme called "${to}" already exists.`);
      renameSync(themeFile(from), themeFile(to));
      sendJson(res, 200, { name: to });
    },

    'DELETE /api/themes/:name': async (req, res, { params }) => {
      const name = safeName(params.name);
      if (!existsSync(themeFile(name))) throw notFound(`"${name}" is not a user theme; built-ins cannot be deleted.`);
      rmSync(themeFile(name), { force: true });
      sendJson(res, 200, { deleted: name });
    },

    // ── PDF templates ────────────────────────────────────────────────────────

    'GET /api/pdf-templates': async (req, res) => {
      sendJson(res, 200, { templates: listPdfTemplates() });
    },

    'GET /api/pdf-templates/:id': async (req, res, { params }) => {
      try {
        const template = loadPdfTemplate(params.id);
        sendJson(res, 200, {
          id: template.id,
          source: template.source,
          engine: template.engine,
          origin: template.origin,
          packages: template.packages || [],
          editable: template.origin === 'user',
        });
      } catch (e) {
        throw notFound(e.message);
      }
    },

    'PUT /api/pdf-templates/:id': async (req, res, { params }) => {
      const body = await readJson(req);
      if (typeof body.source !== 'string') throw badRequest('`source` is required.');
      const id = safeName(params.id);
      ensureDir(userTemplatesDir());
      writeFileSync(join(userTemplatesDir(), `${id}.tex`), body.source, 'utf-8');
      sendJson(res, 200, { id, origin: 'user' });
    },

    'POST /api/pdf-templates/:id/eject': async (req, res, { params }) => {
      const body = await readJson(req);
      try {
        const path = ejectPdfTemplate(params.id, body.name ? safeName(body.name) : null);
        sendJson(res, 201, { id: body.name ? safeName(body.name) : params.id, path });
      } catch (e) {
        throw badRequest(e.message);
      }
    },
  };
}

function safeName(name) {
  return String(name ?? '').trim().replace(/[^\p{L}\p{N}._-]/gu, '-').replace(/^[-.]+/, '');
}
