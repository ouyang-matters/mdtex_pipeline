import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, renameSync, statSync, rmSync } from 'fs';
import { join, basename, extname, dirname, relative } from 'path';
import { paths, ensureDir } from '../core/paths.js';

/**
 * Article represents a single writing project in the workspace.
 *
 * An article is a small project:
 *   article.json    - metadata (id, title, tags, targets, themes, templates)
 *   source.md       - primary Markdown source (or main.tex for LaTeX)
 *   assets/         - managed images and files
 *   dist/           - build outputs (WeChat HTML, PDF, etc.)
 *
 * Identity vs presentation
 * ------------------------
 * `id`, `createdAt` and the on-disk directory are IDENTITY: stable across
 * renames and moves, and never editable from the properties dialog. Everything
 * else (title, tags, series, targets, themes) is presentation and is freely
 * editable. Renaming an article therefore cannot break links, build caches or
 * publish state.
 */

/** Metadata fields a user may edit. Anything outside this set is identity. */
export const EDITABLE_FIELDS = [
  'title', 'subtitle', 'author', 'summary', 'language', 'tags', 'series',
  'seriesIndex', 'targets', 'theme', 'pdfTemplate', 'pdfEngine', 'status', 'slug',
];

/** Fields that establish identity and are never changed by an edit. */
export const IMMUTABLE_FIELDS = ['id', 'createdAt', 'dirName'];

export const ARTICLE_STATUSES = ['draft', 'review', 'published', 'archived'];

export class Article {
  constructor(meta = {}) {
    // ── Identity ──
    this.id = meta.id || randomUUID();
    this.createdAt = meta.createdAt || new Date().toISOString();

    // ── Presentation ──
    this.title = meta.title || 'Untitled';
    this.subtitle = meta.subtitle || '';
    this.author = meta.author || '';
    this.summary = meta.summary || '';
    this.language = meta.language || 'zh-CN';
    this.tags = Array.isArray(meta.tags) ? meta.tags : [];
    this.series = meta.series || null;
    this.seriesIndex = meta.seriesIndex ?? null;
    this.sourceFormat = meta.sourceFormat || 'markdown'; // 'markdown' | 'latex'
    this.sourceFile = meta.sourceFile || (this.sourceFormat === 'latex' ? 'main.tex' : 'source.md');
    this.targets = Array.isArray(meta.targets) ? meta.targets : ['wechat', 'pdf'];
    this.theme = meta.theme || 'default';
    this.pdfTemplate = meta.pdfTemplate || 'default';
    this.pdfEngine = meta.pdfEngine || 'xelatex';
    this.status = ARTICLE_STATUSES.includes(meta.status) ? meta.status : 'draft';
    this.slug = meta.slug || '';

    this.updatedAt = meta.updatedAt || new Date().toISOString();
    this.publishState = meta.publishState || {};
    this.deletedAt = meta.deletedAt || null;
    this.originalFolder = meta.originalFolder || null;

    this._dir = meta._dir || null;
  }

  get dir() { return this._dir; }
  get dirName() { return this._dir ? basename(this._dir) : null; }
  get sourcePath() { return this._dir ? join(this._dir, this.sourceFile) : null; }
  get assetsDir() { return this._dir ? join(this._dir, 'assets') : null; }
  get distDir() { return this._dir ? join(this._dir, 'dist') : null; }
  get metaPath() { return this._dir ? join(this._dir, 'article.json') : null; }

  /** Read the article source content. */
  readSource() {
    if (!this.sourcePath || !existsSync(this.sourcePath)) return '';
    return readFileSync(this.sourcePath, 'utf-8');
  }

  /** Write the article source content and update the timestamp. */
  writeSource(content) {
    if (!this.sourcePath) return;
    ensureDir(dirname(this.sourcePath));
    writeFileSync(this.sourcePath, content, 'utf-8');
    this.updatedAt = new Date().toISOString();
    this.saveMeta();
  }

  /**
   * Apply an edit to the presentation metadata.
   *
   * Identity fields in `patch` are ignored rather than silently applied, so a
   * malformed request can never rewrite an article's ID.
   * Returns { applied, ignored }.
   */
  applyMetadata(patch = {}) {
    const applied = {};
    const ignored = [];

    for (const [key, value] of Object.entries(patch)) {
      if (IMMUTABLE_FIELDS.includes(key)) { ignored.push(key); continue; }
      if (!EDITABLE_FIELDS.includes(key)) { ignored.push(key); continue; }

      switch (key) {
        case 'tags':
          this.tags = normaliseTags(value);
          applied.tags = this.tags;
          break;
        case 'targets':
          this.targets = Array.isArray(value)
            ? [...new Set(value.filter(v => typeof v === 'string' && v.trim()))]
            : this.targets;
          applied.targets = this.targets;
          break;
        case 'status':
          if (ARTICLE_STATUSES.includes(value)) { this.status = value; applied.status = value; }
          else ignored.push('status');
          break;
        case 'seriesIndex': {
          const n = value === null || value === '' ? null : Number(value);
          this.seriesIndex = Number.isFinite(n) ? n : null;
          applied.seriesIndex = this.seriesIndex;
          break;
        }
        case 'series':
          this.series = value ? String(value).trim() : null;
          applied.series = this.series;
          break;
        case 'title': {
          const title = String(value ?? '').trim();
          if (!title) { ignored.push('title'); break; }
          this.title = title;
          applied.title = title;
          break;
        }
        default:
          this[key] = typeof value === 'string' ? value.trim() : value;
          applied[key] = this[key];
      }
    }

    this.updatedAt = new Date().toISOString();
    this.saveMeta();
    return { applied, ignored };
  }

  /**
   * Change the source format, renaming the source file to match.
   * The content is preserved verbatim — this is a container change, not a
   * conversion, and the UI says so.
   */
  changeSourceFormat(nextFormat) {
    if (nextFormat !== 'markdown' && nextFormat !== 'latex') {
      throw new Error(`Unsupported source format: ${nextFormat}`);
    }
    if (nextFormat === this.sourceFormat) return { changed: false };

    const oldPath = this.sourcePath;
    const nextFile = nextFormat === 'latex' ? 'main.tex' : 'source.md';
    const nextPath = this._dir ? join(this._dir, nextFile) : null;

    if (oldPath && nextPath && existsSync(oldPath) && oldPath !== nextPath) {
      if (existsSync(nextPath)) {
        throw new Error(`Cannot switch format: ${nextFile} already exists in this article.`);
      }
      renameSync(oldPath, nextPath);
    }

    const previous = this.sourceFormat;
    this.sourceFormat = nextFormat;
    this.sourceFile = nextFile;
    this.updatedAt = new Date().toISOString();
    this.saveMeta();
    return { changed: true, from: previous, to: nextFormat, sourceFile: nextFile };
  }

  /**
   * Import a file into the article's assets directory.
   * Returns { name, relativePath, reference } where `reference` is the snippet
   * to insert into the source.
   */
  importAsset(srcPath, originalName = null) {
    const buffer = readFileSync(srcPath);
    return this.writeAsset(originalName || basename(srcPath), buffer);
  }

  /** Write asset bytes into the article's assets directory. */
  writeAsset(name, buffer) {
    if (!this.assetsDir) throw new Error('Article has no directory on disk.');
    ensureDir(this.assetsDir);

    const safeName = safeAssetName(name);
    let finalPath = join(this.assetsDir, safeName);
    let counter = 1;
    while (existsSync(finalPath)) {
      const ext = extname(safeName);
      const base = basename(safeName, ext);
      finalPath = join(this.assetsDir, `${base}_${counter}${ext}`);
      counter++;
    }

    writeFileSync(finalPath, buffer);
    const finalName = basename(finalPath);
    const relativePath = `assets/${finalName}`;
    const label = basename(finalName, extname(finalName));

    const reference = this.sourceFormat === 'latex'
      ? `\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\textwidth]{${relativePath}}\n  \\caption{${label}}\n  \\label{fig:${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}}\n\\end{figure}`
      : `![${label}](${relativePath})`;

    this.updatedAt = new Date().toISOString();
    this.saveMeta();

    return { name: finalName, relativePath, reference, path: finalPath, bytes: buffer.length };
  }

  /** List all assets in the article's assets directory. */
  listAssets() {
    if (!this.assetsDir || !existsSync(this.assetsDir)) return [];
    return readdirSync(this.assetsDir)
      .filter(f => !f.startsWith('.'))
      .map(f => {
        const full = join(this.assetsDir, f);
        let bytes = 0;
        try { bytes = statSync(full).size; } catch {}
        return { name: f, path: full, relativePath: `assets/${f}`, bytes };
      });
  }

  deleteAsset(name) {
    if (!this.assetsDir) return false;
    const safe = safeAssetName(name);
    const target = join(this.assetsDir, safe);
    if (!existsSync(target)) return false;
    rmSync(target, { force: true });
    return true;
  }

  /** Serialisable metadata. */
  toJSON() {
    return {
      id: this.id,
      title: this.title,
      subtitle: this.subtitle,
      author: this.author,
      summary: this.summary,
      language: this.language,
      tags: this.tags,
      series: this.series,
      seriesIndex: this.seriesIndex,
      sourceFormat: this.sourceFormat,
      sourceFile: this.sourceFile,
      targets: this.targets,
      theme: this.theme,
      pdfTemplate: this.pdfTemplate,
      pdfEngine: this.pdfEngine,
      status: this.status,
      slug: this.slug,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      publishState: this.publishState,
      deletedAt: this.deletedAt,
      originalFolder: this.originalFolder,
    };
  }

  /** Save article metadata to article.json. */
  saveMeta() {
    if (!this.metaPath) return;
    ensureDir(dirname(this.metaPath));
    writeFileSync(this.metaPath, JSON.stringify(this.toJSON(), null, 2) + '\n', 'utf-8');
  }

  /** Load article from a directory containing article.json. */
  static fromDir(dir) {
    const metaPath = join(dir, 'article.json');
    if (!existsSync(metaPath)) return null;

    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      meta._dir = dir;
      return new Article(meta);
    } catch {
      return null;
    }
  }

  /**
   * Import a standalone source file as a new article.
   * Non-destructive: copies the file rather than moving it.
   */
  static importFile(filePath, libraryDir, { title = null, folderName = null } = {}) {
    const content = readFileSync(filePath, 'utf-8');
    const name = basename(filePath, extname(filePath));
    const ext = extname(filePath).toLowerCase();
    const sourceFormat = ['.tex', '.latex', '.ltx'].includes(ext) ? 'latex' : 'markdown';

    const titleMatch = sourceFormat === 'latex'
      ? content.match(/\\title\{([^}]+)\}/)
      : content.match(/^#\s+(.+)$/m);
    const derivedTitle = title || (titleMatch ? titleMatch[1].trim() : name);

    const article = new Article({
      title: derivedTitle,
      sourceFormat,
      sourceFile: sourceFormat === 'latex' ? 'main.tex' : 'source.md',
    });

    let articleDir = join(libraryDir, folderName || slugifyName(name));
    let counter = 1;
    while (existsSync(articleDir)) {
      articleDir = join(libraryDir, `${folderName || slugifyName(name)}-${counter++}`);
    }

    ensureDir(articleDir);
    ensureDir(join(articleDir, 'assets'));

    article._dir = articleDir;
    writeFileSync(join(articleDir, article.sourceFile), content, 'utf-8');
    article.saveMeta();

    return article;
  }

  /** Backwards-compatible alias used by earlier releases. */
  static importMarkdown(mdPath, libraryDir) {
    return Article.importFile(mdPath, libraryDir);
  }
}

export function safeAssetName(name) {
  const cleaned = String(name || 'file')
    .replace(/[\\/]/g, '_')
    .replace(/\.\.+/g, '.')
    .replace(/[^\p{L}\p{N}._-]/gu, '_')
    .replace(/^\.+/, '');
  return cleaned || 'file';
}

export function normaliseTags(value) {
  const list = Array.isArray(value)
    ? value
    : String(value ?? '').split(/[,，]/);
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const tag = String(raw).trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

export function slugifyName(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'untitled';
}
