import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { unifiedDiff, diffStats } from '../core/diff.js';
import { createCheckpoint } from '../workspace/checkpoints.js';
import { listThemes, loadTheme } from '../core/themes/index.js';
import { paths, ensureDir } from '../core/paths.js';
import { listPdfTemplates } from '../core/latex/templates.js';

/**
 * The MDTeX tool layer.
 *
 * Whatever the active backend is — Local Claude Code, Remote ClaudeClaw or the
 * Anthropic API — it sees the SAME logical capabilities defined here. The agent
 * never talks to the editor or the filesystem directly: MDTeX builds the task
 * context, exposes these tools, and enforces permissions, validation,
 * checkpoints and diffs on every write.
 *
 * Tools are grouped by permission:
 *   read     — always allowed
 *   write    — requires the run to be granted 'content' or 'theme' scope
 *   build    — runs a local compiler; allowed unless explicitly disabled
 */

export const TOOL_PERMISSIONS = {
  READ: 'read',
  WRITE_CONTENT: 'write:content',
  WRITE_THEME: 'write:theme',
  WRITE_METADATA: 'write:metadata',
  BUILD: 'build',
  PUBLISH_CHECK: 'publish:check',
};

/**
 * JSON-schema tool definitions, in the shape the Anthropic Messages API wants.
 * The same list is rendered as instructions for CLI-driven backends, so the
 * capability surface stays identical across backends.
 */
export const TOOL_DEFINITIONS = [
  {
    name: 'read_source',
    permission: TOOL_PERMISSIONS.READ,
    description: 'Read the article source currently open in the editor. Returns the full text, '
      + 'plus the active selection when the user has one.',
    input_schema: {
      type: 'object',
      properties: {
        include_selection: { type: 'boolean', description: 'Also return the active editor selection.' },
      },
    },
  },
  {
    name: 'read_metadata',
    permission: TOOL_PERMISSIONS.READ,
    description: 'Read the article metadata: title, language, tags, series, targets, themes and templates.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'read_theme',
    permission: TOOL_PERMISSIONS.READ,
    description: 'Read a theme stylesheet. Defaults to the theme selected for this article.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Theme name; omit for the active theme.' } },
    },
  },
  {
    name: 'list_assets',
    permission: TOOL_PERMISSIONS.READ,
    description: 'List the images and files stored in the article assets directory.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'apply_patch',
    permission: TOOL_PERMISSIONS.WRITE_CONTENT,
    description: 'Replace an exact span of the article source with new text. Prefer this over '
      + 'rewriting the whole document: it keeps the change reviewable. `old_text` must appear '
      + 'exactly once in the source.',
    input_schema: {
      type: 'object',
      properties: {
        old_text: { type: 'string', description: 'Exact text to replace. Must be unique in the source.' },
        new_text: { type: 'string', description: 'Replacement text.' },
        reason: { type: 'string', description: 'One line explaining the edit.' },
      },
      required: ['old_text', 'new_text'],
    },
  },
  {
    name: 'write_source',
    permission: TOOL_PERMISSIONS.WRITE_CONTENT,
    description: 'Replace the entire article source. Use only for whole-document work such as a '
      + 'Markdown to LaTeX conversion; use apply_patch for local edits.',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['content'],
    },
  },
  {
    name: 'write_theme',
    permission: TOOL_PERMISSIONS.WRITE_THEME,
    description: 'Replace the CSS of a user theme. Built-in themes are read-only; ask MDTeX to '
      + 'copy one first. Only available when the user granted theme scope.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Theme name; omit for the active theme.' },
        css: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['css'],
    },
  },
  {
    name: 'update_metadata',
    permission: TOOL_PERMISSIONS.WRITE_METADATA,
    description: 'Update editable article metadata (title, tags, series, summary, targets, themes). '
      + 'Identity fields such as the article ID cannot be changed.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        subtitle: { type: 'string' },
        summary: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        series: { type: 'string' },
        language: { type: 'string' },
        targets: { type: 'array', items: { type: 'string' } },
        theme: { type: 'string' },
        pdfTemplate: { type: 'string' },
      },
    },
  },
  {
    name: 'compile_pdf',
    permission: TOOL_PERMISSIONS.BUILD,
    description: 'Compile the article to PDF locally with latexmk and return the result, including '
      + 'the parsed error and warning list.',
    input_schema: {
      type: 'object',
      properties: {
        engine: { type: 'string', enum: ['xelatex', 'lualatex', 'pdflatex'] },
      },
    },
  },
  {
    name: 'read_build_log',
    permission: TOOL_PERMISSIONS.READ,
    description: 'Read the most recent PDF compiler log for this article, so a failure can be diagnosed.',
    input_schema: {
      type: 'object',
      properties: { tail_lines: { type: 'integer', description: 'How many trailing lines to return (default 200).' } },
    },
  },
  {
    name: 'render_wechat',
    permission: TOOL_PERMISSIONS.BUILD,
    description: 'Compile the article for WeChat and return validation results: formula counts, '
      + 'errors and warnings. Does not touch the clipboard.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'blogpipe_check',
    permission: TOOL_PERMISSIONS.PUBLISH_CHECK,
    description: 'Run a read-only Blog Pipeline check (detect the CLI and query publication status). '
      + 'Never deploys or publishes anything.',
    input_schema: { type: 'object', properties: {} },
  },
];

export function toolDefinitionsForApi(grantedPermissions) {
  return TOOL_DEFINITIONS
    .filter(t => grantedPermissions.includes(t.permission))
    .map(({ name, description, input_schema }) => ({ name, description, input_schema }));
}

/**
 * Human-readable capability description, used for backends that drive an agent
 * through a prompt rather than a structured tool API.
 */
export function toolInstructions(grantedPermissions) {
  const available = TOOL_DEFINITIONS.filter(t => grantedPermissions.includes(t.permission));
  return available.map(t => `- ${t.name}: ${t.description}`).join('\n');
}

/**
 * Executes tool calls against a live article.
 *
 * Every write goes through a checkpoint and produces a diff, and nothing is
 * committed to disk until the run finishes and the user accepts — the executor
 * stages changes and reports them.
 */
export class ToolExecutor {
  /**
   * @param {object} context
   * @param {Article} context.article
   * @param {string} context.source          the buffer currently in the editor
   * @param {{start:number,end:number,text:string}|null} context.selection
   * @param {string} context.themeName
   * @param {string} context.themeCss
   * @param {string[]} context.permissions
   * @param {object} context.services        { compilePdf, renderWeChat, blogpipe }
   */
  constructor(context) {
    this.article = context.article;
    this.originalSource = context.source ?? '';
    this.source = context.source ?? '';
    this.selection = context.selection || null;
    this.themeName = context.themeName || null;
    this.originalThemeCss = context.themeCss ?? '';
    this.themeCss = context.themeCss ?? '';
    this.permissions = context.permissions || [TOOL_PERMISSIONS.READ];
    this.services = context.services || {};
    this.metadataPatch = {};
    this.log = [];
    this.checkpoint = null;
  }

  can(permission) { return this.permissions.includes(permission); }

  get sourceChanged() { return this.source !== this.originalSource; }
  get themeChanged() { return this.themeCss !== this.originalThemeCss; }
  get metadataChanged() { return Object.keys(this.metadataPatch).length > 0; }
  get anyChanges() { return this.sourceChanged || this.themeChanged || this.metadataChanged; }

  /** Run one tool call. Never throws: errors are returned to the model. */
  async run(name, input = {}) {
    const definition = TOOL_DEFINITIONS.find(t => t.name === name);
    if (!definition) {
      return this._record(name, input, { error: `Unknown tool: ${name}` });
    }
    if (!this.can(definition.permission)) {
      return this._record(name, input, {
        error: `Permission denied: "${name}" needs the "${definition.permission}" scope, which this run was not granted.`,
      });
    }

    try {
      const result = await this[`_${name}`](input);
      return this._record(name, input, result);
    } catch (e) {
      return this._record(name, input, { error: e.message || String(e) });
    }
  }

  _record(name, input, result) {
    this.log.push({ tool: name, input: summariseInput(input), ok: !result?.error, at: Date.now() });
    return result;
  }

  // ── Read tools ─────────────────────────────────────────────────────────────

  async _read_source({ include_selection = true } = {}) {
    const payload = {
      source_format: this.article?.sourceFormat || 'markdown',
      source_file: this.article?.sourceFile || null,
      line_count: this.source.split('\n').length,
      content: this.source,
    };
    if (include_selection && this.selection?.text) {
      payload.selection = {
        start: this.selection.start,
        end: this.selection.end,
        text: this.selection.text,
      };
    }
    return payload;
  }

  async _read_metadata() {
    if (!this.article) return { error: 'No article is open.' };
    const meta = this.article.toJSON();
    return {
      ...meta,
      available_themes: listThemes().map(t => t.name),
      available_pdf_templates: listPdfTemplates().map(t => t.id),
      note: 'id and createdAt are identity fields and cannot be modified.',
    };
  }

  async _read_theme({ name } = {}) {
    const themeName = name || this.themeName;
    if (!themeName) return { error: 'No theme selected.' };
    if (themeName === this.themeName && this.themeCss) {
      return { name: themeName, css: this.themeCss, editable: isUserTheme(themeName) };
    }
    const theme = loadTheme(themeName);
    return { name: theme.name, css: theme.css, editable: theme.isUser };
  }

  async _list_assets() {
    if (!this.article) return { assets: [] };
    return { assets: this.article.listAssets().map(a => ({ name: a.name, path: a.relativePath, bytes: a.bytes })) };
  }

  async _read_build_log({ tail_lines = 200 } = {}) {
    if (!this.article?.dir) return { error: 'Article has no directory on disk.' };
    const candidates = [
      join(this.article.dir, 'dist', 'pdf', 'article.log'),
      join(this.article.dir, 'dist', 'pdf', 'main.log'),
    ];
    const found = candidates.find(existsSync);
    if (!found) return { error: 'No PDF build log yet. Run compile_pdf first.' };

    const lines = readFileSync(found, 'utf-8').split('\n');
    return {
      path: found,
      total_lines: lines.length,
      content: lines.slice(-Math.max(1, tail_lines)).join('\n'),
    };
  }

  // ── Write tools (staged, not committed) ────────────────────────────────────

  async _apply_patch({ old_text, new_text, reason }) {
    if (typeof old_text !== 'string' || typeof new_text !== 'string') {
      return { error: 'apply_patch needs both old_text and new_text as strings.' };
    }
    if (old_text === '') return { error: 'old_text must not be empty.' };

    const occurrences = countOccurrences(this.source, old_text);
    if (occurrences === 0) {
      return { error: 'old_text was not found in the source. Read the source again and copy the exact text, including whitespace.' };
    }
    if (occurrences > 1) {
      return { error: `old_text appears ${occurrences} times. Include more surrounding context so the match is unique.` };
    }

    this.source = this.source.replace(old_text, new_text);
    const stats = diffStats(this.originalSource, this.source);
    return { ok: true, reason: reason || null, lines_added: stats.added, lines_removed: stats.removed };
  }

  async _write_source({ content, reason }) {
    if (typeof content !== 'string') return { error: 'write_source needs a `content` string.' };
    this.source = content;
    const stats = diffStats(this.originalSource, this.source);
    return { ok: true, reason: reason || null, lines_added: stats.added, lines_removed: stats.removed };
  }

  async _write_theme({ name, css, reason }) {
    const themeName = name || this.themeName;
    if (!themeName) return { error: 'No theme selected.' };
    if (typeof css !== 'string') return { error: 'write_theme needs a `css` string.' };
    if (!isUserTheme(themeName)) {
      return {
        error: `"${themeName}" is a built-in theme and is read-only. `
          + 'Ask the user to duplicate it first (Style → Duplicate), then edit the copy.',
      };
    }
    this.themeName = themeName;
    this.themeCss = css;
    const stats = diffStats(this.originalThemeCss, css);
    return { ok: true, theme: themeName, reason: reason || null, lines_added: stats.added, lines_removed: stats.removed };
  }

  async _update_metadata(patch = {}) {
    const accepted = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      accepted[key] = value;
    }
    if (!Object.keys(accepted).length) return { error: 'No metadata fields supplied.' };
    Object.assign(this.metadataPatch, accepted);
    return { ok: true, staged: accepted };
  }

  // ── Build tools ────────────────────────────────────────────────────────────

  async _compile_pdf({ engine } = {}) {
    if (!this.services.compilePdf) return { error: 'PDF compilation is not available in this run.' };
    const result = await this.services.compilePdf({ source: this.source, engine });
    return {
      success: result.success,
      engine: result.engine,
      pdf_path: result.pdfPath,
      errors: (result.errors || []).map(e => ({ line: e.line ?? null, message: e.message })),
      warnings: (result.warnings || []).slice(0, 25).map(w => w.message),
    };
  }

  async _render_wechat() {
    if (!this.services.renderWeChat) return { error: 'WeChat rendering is not available in this run.' };
    const result = await this.services.renderWeChat({ source: this.source, themeCss: this.themeCss });
    return {
      valid: result.validation?.valid ?? null,
      stats: result.validation?.stats ?? null,
      formulas: result.mathResult ?? null,
      errors: result.validation?.errors ?? [],
      warnings: result.validation?.warnings ?? [],
      bytes: result.html?.length ?? 0,
    };
  }

  async _blogpipe_check() {
    if (!this.services.blogpipe) return { error: 'Blog Pipeline integration is not available in this run.' };
    return this.services.blogpipe({ articleId: this.article?.id });
  }

  // ── Commit ─────────────────────────────────────────────────────────────────

  /** A reviewable description of everything this run wants to change. */
  describeChanges() {
    const changes = [];

    if (this.sourceChanged) {
      changes.push({
        kind: 'source',
        file: this.article?.sourceFile || 'source',
        diff: unifiedDiff(this.originalSource, this.source, {
          fromFile: this.article?.sourceFile || 'source',
          toFile: this.article?.sourceFile || 'source',
        }),
        stats: diffStats(this.originalSource, this.source),
        content: this.source,
      });
    }

    if (this.themeChanged) {
      changes.push({
        kind: 'theme',
        file: `${this.themeName}.css`,
        name: this.themeName,
        diff: unifiedDiff(this.originalThemeCss, this.themeCss, {
          fromFile: `${this.themeName}.css`,
          toFile: `${this.themeName}.css`,
        }),
        stats: diffStats(this.originalThemeCss, this.themeCss),
        content: this.themeCss,
      });
    }

    if (this.metadataChanged) {
      changes.push({ kind: 'metadata', patch: this.metadataPatch });
    }

    return changes;
  }

  /**
   * Write staged changes to disk, taking a checkpoint first.
   * Returns { checkpoint, applied: string[] }.
   */
  commit({ label = 'AI edit' } = {}) {
    if (!this.anyChanges) return { checkpoint: null, applied: [] };

    let checkpoint = null;
    if (this.article) {
      checkpoint = createCheckpoint(this.article, {
        label,
        origin: 'ai',
        themeName: this.themeChanged ? this.themeName : null,
        themeCss: this.themeChanged ? this.originalThemeCss : null,
      });
    }

    const applied = [];

    if (this.sourceChanged && this.article) {
      this.article.writeSource(this.source);
      applied.push('source');
    }

    if (this.themeChanged && this.themeName && isUserTheme(this.themeName)) {
      ensureDir(paths.userThemes);
      writeFileSync(join(paths.userThemes, `${this.themeName}.css`), this.themeCss, 'utf-8');
      applied.push('theme');
    }

    if (this.metadataChanged && this.article) {
      this.article.applyMetadata(this.metadataPatch);
      applied.push('metadata');
    }

    this.checkpoint = checkpoint;
    return { checkpoint, applied };
  }
}

function isUserTheme(name) {
  return existsSync(join(paths.userThemes, `${name}.css`));
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let index = 0;
  for (;;) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) break;
    count++;
    index = found + needle.length;
    if (count > 1) break; // callers only need "0, 1, or many"
  }
  return count;
}

function summariseInput(input) {
  const out = {};
  for (const [key, value] of Object.entries(input || {})) {
    out[key] = typeof value === 'string' && value.length > 120
      ? `${value.slice(0, 120)}… (${value.length} chars)`
      : value;
  }
  return out;
}
