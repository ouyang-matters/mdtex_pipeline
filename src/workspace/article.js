import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, renameSync, statSync, rmSync } from 'fs';
import { join, basename, extname, dirname, relative } from 'path';
import { paths, ensureDir } from '../core/paths.js';
import {
  AssetResolver, ASSET_DIR, canonicalAssetPath, chooseAssetName, hashBytes,
  safeAssetName as canonicalSafeAssetName,
} from '../core/assets/resolver.js';

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

/**
 * Every field this version of MDTeX understands.
 *
 * Anything in `article.json` that is *not* here is carried through untouched.
 * Without that, opening an article written by a newer version — or one a user
 * added a field to by hand — and saving it would silently drop the field, which
 * is data loss during an ordinary edit rather than during an upgrade.
 */
const KNOWN_META_FIELDS = new Set([
  'id', 'title', 'subtitle', 'author', 'summary', 'language', 'tags', 'series',
  'seriesIndex', 'sourceFormat', 'sourceFile', 'targets', 'theme', 'pdfTemplate',
  'pdfEngine', 'status', 'slug', 'createdAt', 'updatedAt', 'publishState',
  'deletedAt', 'originalFolder',
]);

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

    // Forward compatibility: keep fields this version does not know about.
    this._unknownFields = {};
    for (const [key, value] of Object.entries(meta)) {
      if (!KNOWN_META_FIELDS.has(key) && !key.startsWith('_')) {
        this._unknownFields[key] = value;
      }
    }
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
   * Point the article at a different source container without touching the
   * files.
   *
   * `changeSourceFormat` is the user-facing operation and moves the content
   * with the article. This is the low-level one, for callers that have already
   * written the file they are pointing at — adopting a derived LaTeX source,
   * and restoring a checkpoint that was taken in the other format. Keeping it
   * separate is what stops "the metadata says main.tex" and "the content lives
   * in source.md" from ever drifting apart silently.
   */
  setSourceContainer(format) {
    if (format !== 'markdown' && format !== 'latex') {
      throw new Error(`Unsupported source format: ${format}`);
    }
    this.sourceFormat = format;
    this.sourceFile = format === 'latex' ? 'main.tex' : 'source.md';
    this.updatedAt = new Date().toISOString();
    this.saveMeta();
    return { sourceFormat: this.sourceFormat, sourceFile: this.sourceFile };
  }

  /**
   * Import a file into the article's assets directory.
   * Returns { name, relativePath, reference } where `reference` is the snippet
   * to insert into the source.
   */
  importAsset(srcPath, originalName = null, options = {}) {
    const buffer = readFileSync(srcPath);
    return this.writeAsset(originalName || basename(srcPath), buffer, options);
  }

  /**
   * Write asset bytes into the article's managed asset directory.
   *
   * Transactional: the file is written and then *verified* before any source
   * reference is produced. A caller must never insert a reference to an asset
   * that failed to land on disk, which is how a broken image ends up in the
   * source in the first place.
   *
   * @param {string} name       requested filename
   * @param {Buffer} buffer     file contents
   * @param {object} options
   * @param {boolean} options.replace  overwrite an existing file of that name
   * @returns {{ name, canonical, relativePath, reference, path, bytes, hash, reused }}
   */
  writeAsset(name, buffer, { replace = false } = {}) {
    if (!this.assetsDir) throw new Error('Article has no directory on disk.');
    if (!buffer || buffer.length === 0) throw new Error('Refusing to store an empty file.');

    ensureDir(this.assetsDir);

    const { name: finalName, reused } = chooseAssetName(this.assetsDir, name, buffer, { replace });
    const finalPath = join(this.assetsDir, finalName);

    if (!reused) {
      writeFileSync(finalPath, buffer);
    }

    // Verify before telling anyone the asset exists.
    let written;
    try {
      written = statSync(finalPath);
    } catch (e) {
      throw new Error(`Asset was not written to ${finalPath}: ${e.message}`);
    }
    if (!written.isFile() || written.size !== buffer.length) {
      throw new Error(
        `Asset verification failed for ${finalPath}: expected ${buffer.length} bytes, found ${written.size}.`,
      );
    }

    const canonical = canonicalAssetPath(finalName);
    const reference = this.assetReference(canonical, finalName);

    this.updatedAt = new Date().toISOString();
    this.saveMeta();

    return {
      name: finalName,
      canonical,
      // Kept for compatibility; identical to `canonical`.
      relativePath: canonical,
      reference,
      path: finalPath,
      bytes: written.size,
      hash: hashBytes(buffer),
      reused,
    };
  }

  /**
   * The source snippet that references an asset.
   *
   * Always the canonical article-relative path, in both source formats, so the
   * same article renders identically in the preview, on WeChat, and in a PDF.
   */
  assetReference(canonical, displayName = null) {
    const label = (displayName || basename(canonical)).replace(/\.[^.]+$/, '');

    if (this.sourceFormat === 'latex') {
      const anchor = label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'figure';
      return `\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\textwidth]{${canonical}}\n`
        + `  \\caption{${label}}\n  \\label{fig:${anchor}}\n\\end{figure}`;
    }

    // Markdown link targets cannot contain spaces or parentheses unquoted;
    // safeAssetName has already removed them, but encode defensively.
    const target = canonical.split('/').map(part => part.replace(/[()\s]/g, encodeURIComponent)).join('/');
    return `![${label}](${target})`;
  }

  /** A resolver bound to this article. */
  assetResolver({ apiBase = '/api' } = {}) {
    return new AssetResolver({ articleRoot: this.dir, articleId: this.id, apiBase });
  }

  /**
   * List managed assets, with the content hash the preview uses for cache
   * busting, so a replaced image is never served stale.
   */
  listAssets() {
    if (!this.assetsDir || !existsSync(this.assetsDir)) return [];
    const resolver = this.assetResolver();
    return resolver.list().map(asset => ({
      name: asset.name,
      path: asset.path,
      canonical: asset.canonical,
      // Compatibility alias.
      relativePath: asset.canonical,
      bytes: asset.bytes,
      hash: asset.hash,
    }));
  }

  deleteAsset(name) {
    if (!this.assetsDir) return false;
    const safe = canonicalSafeAssetName(name);
    const target = join(this.assetsDir, safe);
    if (!existsSync(target)) return false;
    rmSync(target, { force: true });
    return true;
  }

  /** Serialisable metadata. */
  toJSON() {
    return {
      // Unknown fields first, so a known field can never be shadowed by one.
      ...this._unknownFields,
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

// The canonical implementation lives with the asset model; re-exported so
// existing importers keep working.
export { canonicalSafeAssetName as safeAssetName, ASSET_DIR };

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
