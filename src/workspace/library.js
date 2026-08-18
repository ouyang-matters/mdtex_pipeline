import { existsSync, readdirSync, mkdirSync, renameSync, rmSync, statSync, readFileSync } from 'fs';
import { join, basename, relative } from 'path';
import { paths, ensureDir } from '../core/paths.js';
import { Article } from './article.js';

/**
 * ArticleLibrary manages the collection of articles in the workspace.
 *
 * Structure:
 *   ~/.local/share/publisher/workspace/
 *     folder1/
 *       article-a/
 *         article.json
 *         source.md
 *         assets/
 *       article-b/
 *         ...
 *     folder2/
 *       ...
 *
 * Each article directory contains article.json (metadata) and source files.
 * Folder structure is for user organization; article IDs are stable.
 */
export class ArticleLibrary {
  constructor(rootDir = null) {
    this.rootDir = rootDir || paths.workspace;
    ensureDir(this.rootDir);
  }

  /**
   * List all articles in the library (recursive).
   * Returns [{ article, folder }] sorted by updatedAt descending.
   */
  listAll() {
    const articles = [];
    this._scanDir(this.rootDir, '', articles);
    articles.sort((a, b) => (b.article.updatedAt || '').localeCompare(a.article.updatedAt || ''));
    return articles;
  }

  /**
   * List articles in a specific folder (non-recursive).
   */
  listFolder(folder = '') {
    const dir = join(this.rootDir, folder);
    if (!existsSync(dir)) return [];

    const entries = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const articleDir = join(dir, entry.name);
      const article = Article.fromDir(articleDir);
      if (article) {
        entries.push({
          article,
          folder: folder ? `${folder}/${entry.name}` : entry.name,
        });
      }
    }
    return entries;
  }

  /**
   * List folders (for folder tree view).
   */
  listFolders(parent = '') {
    const dir = join(this.rootDir, parent);
    if (!existsSync(dir)) return [];

    return readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .filter(e => !existsSync(join(dir, e.name, 'article.json'))) // folders, not article dirs
      .map(e => ({
        name: e.name,
        path: parent ? `${parent}/${e.name}` : e.name,
      }));
  }

  /**
   * Get an article by ID.
   */
  getById(id) {
    const all = this.listAll();
    return all.find(entry => entry.article.id === id)?.article || null;
  }

  /**
   * Get an article by folder path.
   */
  getByPath(folderPath) {
    const dir = join(this.rootDir, folderPath);
    return Article.fromDir(dir);
  }

  /**
   * Create a new article.
   */
  create({ title = 'Untitled', folder = '', sourceFormat = 'markdown', template = '' } = {}) {
    const slug = slugify(title);
    const articleDir = join(this.rootDir, folder, slug);

    if (existsSync(articleDir)) {
      throw new Error(`Article directory already exists: ${slug}`);
    }

    ensureDir(articleDir);
    ensureDir(join(articleDir, 'assets'));

    const sourceFile = sourceFormat === 'latex' ? 'main.tex' : 'source.md';
    const article = new Article({
      title,
      sourceFormat,
      sourceFile,
      _dir: articleDir,
    });

    // Write initial source
    const defaultContent = sourceFormat === 'latex'
      ? `\\documentclass{article}\n\\begin{document}\n\\title{${title}}\n\\maketitle\n\n\\end{document}\n`
      : `# ${title}\n\n`;

    article.writeSource(template || defaultContent);
    article.saveMeta();

    return article;
  }

  /**
   * Create a folder.
   */
  createFolder(path) {
    const dir = join(this.rootDir, path);
    ensureDir(dir);
    return dir;
  }

  /**
   * Rename an article (changes title and optionally directory name).
   */
  rename(article, newTitle) {
    article.title = newTitle;
    article.updatedAt = new Date().toISOString();
    article.saveMeta();
    return article;
  }

  /**
   * Move an article to a different folder.
   */
  move(article, newFolder) {
    const oldDir = article.dir;
    const dirName = basename(oldDir);
    const newDir = join(this.rootDir, newFolder, dirName);

    if (existsSync(newDir)) {
      throw new Error(`Target directory already exists: ${newDir}`);
    }

    ensureDir(join(this.rootDir, newFolder));
    renameSync(oldDir, newDir);
    article._dir = newDir;
    article.updatedAt = new Date().toISOString();
    article.saveMeta();

    return article;
  }

  /**
   * Import a standalone .md file into the library.
   */
  importFile(filePath, folder = '') {
    return Article.importMarkdown(filePath, join(this.rootDir, folder));
  }

  /**
   * Search articles by title or filename.
   */
  search(query) {
    if (!query || !query.trim()) return this.listAll();

    const q = query.toLowerCase().trim();
    return this.listAll().filter(entry => {
      const title = (entry.article.title || '').toLowerCase();
      const filename = basename(entry.article.dir || '').toLowerCase();
      const tags = (entry.article.tags || []).join(' ').toLowerCase();
      return title.includes(q) || filename.includes(q) || tags.includes(q);
    });
  }

  /**
   * Get recently modified articles.
   */
  recent(limit = 10) {
    return this.listAll().slice(0, limit);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _scanDir(dir, folder, results) {
    if (!existsSync(dir)) return;

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const subDir = join(dir, entry.name);
      const subFolder = folder ? `${folder}/${entry.name}` : entry.name;

      // Check if this directory is an article
      const article = Article.fromDir(subDir);
      if (article) {
        results.push({ article, folder: subFolder });
      } else {
        // Recurse into folders
        this._scanDir(subDir, subFolder, results);
      }
    }
  }
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80) || 'untitled';
}
