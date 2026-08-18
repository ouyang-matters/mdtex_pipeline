import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, renameSync, statSync } from 'fs';
import { join, basename, extname, dirname, relative } from 'path';
import { paths, ensureDir } from '../core/paths.js';

/**
 * Article represents a single writing project in the workspace.
 *
 * An article is a small project:
 *   article.yml     - metadata (id, title, tags, targets, theme)
 *   source.md       - primary Markdown source (or main.tex for LaTeX)
 *   assets/         - managed images and files
 *   dist/           - build outputs (WeChat HTML, PDF, etc.)
 *
 * The article ID is stable across renames and moves.
 * Folder structure is user-facing organization, not identity.
 */
export class Article {
  constructor(meta = {}) {
    this.id = meta.id || randomUUID();
    this.title = meta.title || 'Untitled';
    this.language = meta.language || 'zh-CN';
    this.tags = meta.tags || [];
    this.series = meta.series || null;
    this.sourceFormat = meta.sourceFormat || 'markdown'; // 'markdown' | 'latex'
    this.sourceFile = meta.sourceFile || 'source.md';
    this.targets = meta.targets || ['wechat', 'zhihu', 'pdf'];
    this.theme = meta.theme || 'default';
    this.pdfEngine = meta.pdfEngine || 'xelatex';
    this.createdAt = meta.createdAt || new Date().toISOString();
    this.updatedAt = meta.updatedAt || new Date().toISOString();
    this.publishState = meta.publishState || {};
    this._dir = meta._dir || null;
  }

  get dir() {
    return this._dir;
  }

  get sourcePath() {
    return this._dir ? join(this._dir, this.sourceFile) : null;
  }

  get assetsDir() {
    return this._dir ? join(this._dir, 'assets') : null;
  }

  get distDir() {
    return this._dir ? join(this._dir, 'dist') : null;
  }

  get metaPath() {
    return this._dir ? join(this._dir, 'article.json') : null;
  }

  /**
   * Read the article source content.
   */
  readSource() {
    if (!this.sourcePath || !existsSync(this.sourcePath)) return '';
    return readFileSync(this.sourcePath, 'utf-8');
  }

  /**
   * Write the article source content and update timestamp.
   */
  writeSource(content) {
    if (!this.sourcePath) return;
    ensureDir(dirname(this.sourcePath));
    writeFileSync(this.sourcePath, content, 'utf-8');
    this.updatedAt = new Date().toISOString();
    this.saveMeta();
  }

  /**
   * Import an image into the article's assets directory.
   * Returns the relative path for use in Markdown/LaTeX.
   */
  importAsset(srcPath, originalName = null) {
    if (!this.assetsDir) return null;
    ensureDir(this.assetsDir);

    const name = originalName || basename(srcPath);
    // Ensure safe filename
    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const destPath = join(this.assetsDir, safeName);

    // Handle name collisions
    let finalPath = destPath;
    let counter = 1;
    while (existsSync(finalPath)) {
      const ext = extname(safeName);
      const base = basename(safeName, ext);
      finalPath = join(this.assetsDir, `${base}_${counter}${ext}`);
      counter++;
    }

    copyFileSync(srcPath, finalPath);
    const relPath = `assets/${basename(finalPath)}`;

    if (this.sourceFormat === 'markdown') {
      return `![${basename(finalPath, extname(finalPath))}](${relPath})`;
    } else {
      return `\\includegraphics{${relPath}}`;
    }
  }

  /**
   * List all assets in the article's assets directory.
   */
  listAssets() {
    if (!this.assetsDir || !existsSync(this.assetsDir)) return [];
    return readdirSync(this.assetsDir).map(f => ({
      name: f,
      path: join(this.assetsDir, f),
      relativePath: `assets/${f}`,
    }));
  }

  /**
   * Save article metadata to article.json.
   */
  saveMeta() {
    if (!this.metaPath) return;
    ensureDir(dirname(this.metaPath));
    const meta = {
      id: this.id,
      title: this.title,
      language: this.language,
      tags: this.tags,
      series: this.series,
      sourceFormat: this.sourceFormat,
      sourceFile: this.sourceFile,
      targets: this.targets,
      theme: this.theme,
      pdfEngine: this.pdfEngine,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      publishState: this.publishState,
    };
    writeFileSync(this.metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf-8');
  }

  /**
   * Load article from a directory containing article.json.
   */
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
   * Import a standalone .md file as a new article.
   * Non-destructive: copies the file rather than moving it.
   */
  static importMarkdown(mdPath, libraryDir) {
    const content = readFileSync(mdPath, 'utf-8');
    const name = basename(mdPath, extname(mdPath));

    // Extract title from first heading
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : name;

    const article = new Article({
      title,
      sourceFormat: 'markdown',
      sourceFile: 'source.md',
    });

    const articleDir = join(libraryDir, name);
    ensureDir(articleDir);
    ensureDir(join(articleDir, 'assets'));

    article._dir = articleDir;
    writeFileSync(join(articleDir, 'source.md'), content, 'utf-8');
    article.saveMeta();

    return article;
  }
}
