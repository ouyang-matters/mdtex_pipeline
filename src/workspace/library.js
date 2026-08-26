import { existsSync, readdirSync, renameSync, rmSync, statSync, cpSync, readFileSync, writeFileSync } from 'fs';
import { join, basename, dirname, sep, resolve, relative, isAbsolute } from 'path';
import { paths, ensureDir } from '../core/paths.js';
import { Article, slugifyName } from './article.js';

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
 *     .trash/
 *       article-b/          (soft-deleted, restorable)
 *
 * Folder structure is user-facing organisation; article IDs are stable and
 * survive renames and moves.
 */

export const TRASH_DIR = '.trash';

export class ArticleLibrary {
  constructor(rootDir = null) {
    this.rootDir = rootDir || paths.workspace;
    ensureDir(this.rootDir);
  }

  get trashDir() { return join(this.rootDir, TRASH_DIR); }

  // ── Reading ────────────────────────────────────────────────────────────────

  /**
   * List all live articles (recursive), newest first.
   * Returns [{ article, folder, path }] where `folder` is the containing
   * folder path ('' for the root) and `path` is folder/dirName.
   */
  listAll() {
    const results = [];
    this._scanDir(this.rootDir, '', results);
    results.sort((a, b) => (b.article.updatedAt || '').localeCompare(a.article.updatedAt || ''));
    return results;
  }

  /** Soft-deleted articles, newest deletion first. */
  listTrash() {
    if (!existsSync(this.trashDir)) return [];
    const out = [];
    for (const entry of readdirSync(this.trashDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const article = Article.fromDir(join(this.trashDir, entry.name));
      if (article) out.push({ article, folder: TRASH_DIR, path: `${TRASH_DIR}/${entry.name}` });
    }
    out.sort((a, b) => (b.article.deletedAt || '').localeCompare(a.article.deletedAt || ''));
    return out;
  }

  /** Every folder in the workspace (recursive), excluding article dirs and trash. */
  listFolders() {
    const folders = [];
    const walk = (dir, prefix) => {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const full = join(dir, entry.name);
        if (existsSync(join(full, 'article.json'))) continue; // an article, not a folder
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        folders.push({ name: entry.name, path, parent: prefix });
        walk(full, path);
      }
    };
    walk(this.rootDir, '');
    folders.sort((a, b) => a.path.localeCompare(b.path));
    return folders;
  }

  /** Articles directly inside one folder. */
  listFolder(folder = '') {
    const dir = this._resolveFolder(folder);
    if (!existsSync(dir)) return [];

    const entries = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const article = Article.fromDir(join(dir, entry.name));
      if (article) {
        entries.push({ article, folder, path: folder ? `${folder}/${entry.name}` : entry.name });
      }
    }
    return entries;
  }

  getById(id) {
    return this.listAll().find(e => e.article.id === id)?.article || null;
  }

  getEntryById(id) {
    return this.listAll().find(e => e.article.id === id) || null;
  }

  getTrashedById(id) {
    return this.listTrash().find(e => e.article.id === id)?.article || null;
  }

  getByPath(folderPath) {
    return Article.fromDir(this._resolveFolder(folderPath));
  }

  // ── Creating ───────────────────────────────────────────────────────────────

  create({
    title = 'Untitled',
    folder = '',
    sourceFormat = 'markdown',
    template = '',
    language = 'zh-CN',
    tags = [],
    series = null,
    theme = 'default',
    pdfTemplate = 'default',
    pdfEngine = 'xelatex',
    targets = ['wechat', 'pdf'],
  } = {}) {
    const parent = this._resolveFolder(folder);
    ensureDir(parent);

    const slug = slugifyName(title);
    let articleDir = join(parent, slug);
    let counter = 1;
    while (existsSync(articleDir)) {
      articleDir = join(parent, `${slug}-${counter++}`);
    }

    ensureDir(articleDir);
    ensureDir(join(articleDir, 'assets'));

    const sourceFile = sourceFormat === 'latex' ? 'main.tex' : 'source.md';
    const article = new Article({
      title, sourceFormat, sourceFile, language, tags, series,
      theme, pdfTemplate, pdfEngine, targets,
      _dir: articleDir,
    });

    article.writeSource(template || defaultTemplateFor(sourceFormat, title));
    article.saveMeta();

    return article;
  }

  createFolder(path) {
    const clean = this._normaliseFolder(path);
    if (!clean) throw new Error('Folder name is required.');
    const dir = this._resolveFolder(clean);
    if (existsSync(dir)) throw new Error(`A folder named "${basename(clean)}" already exists here.`);
    ensureDir(dir);
    return { path: clean, dir };
  }

  renameFolder(path, newName) {
    const clean = this._normaliseFolder(path);
    const dir = this._resolveFolder(clean);
    if (!existsSync(dir)) throw new Error(`Folder not found: ${clean}`);

    const safeName = slugifyName(newName);
    if (!safeName) throw new Error('Folder name is required.');

    const parent = dirname(dir);
    const target = join(parent, safeName);
    if (existsSync(target)) throw new Error(`A folder named "${safeName}" already exists here.`);

    renameSync(dir, target);
    const parentPath = clean.includes('/') ? clean.slice(0, clean.lastIndexOf('/')) : '';
    return { path: parentPath ? `${parentPath}/${safeName}` : safeName };
  }

  /** Delete an empty folder. Non-empty folders are refused. */
  deleteFolder(path) {
    const clean = this._normaliseFolder(path);
    const dir = this._resolveFolder(clean);
    if (!existsSync(dir)) throw new Error(`Folder not found: ${clean}`);

    const contents = readdirSync(dir).filter(f => !f.startsWith('.'));
    if (contents.length > 0) {
      throw new Error(`"${basename(clean)}" is not empty. Move or delete its contents first.`);
    }
    rmSync(dir, { recursive: true, force: true });
    return { path: clean };
  }

  // ── Mutating ───────────────────────────────────────────────────────────────

  /**
   * Rename an article's title.
   *
   * The directory name is deliberately NOT changed: it is part of the article's
   * on-disk identity, and renaming it would invalidate paths held elsewhere.
   */
  rename(article, newTitle) {
    const title = String(newTitle || '').trim();
    if (!title) throw new Error('Title is required.');
    article.title = title;
    article.updatedAt = new Date().toISOString();
    article.saveMeta();
    return article;
  }

  move(article, newFolder) {
    const clean = this._normaliseFolder(newFolder);
    const oldDir = article.dir;
    if (!oldDir) throw new Error('Article has no directory on disk.');

    const dirName = basename(oldDir);
    const parent = this._resolveFolder(clean);
    const newDir = join(parent, dirName);

    if (resolve(newDir) === resolve(oldDir)) return article;
    if (existsSync(newDir)) {
      throw new Error(`"${dirName}" already exists in that folder.`);
    }

    ensureDir(parent);
    renameSync(oldDir, newDir);
    article._dir = newDir;
    article.updatedAt = new Date().toISOString();
    article.saveMeta();
    return article;
  }

  /** Copy an article, including assets, into the same folder. */
  duplicate(article, { title = null } = {}) {
    const oldDir = article.dir;
    if (!oldDir) throw new Error('Article has no directory on disk.');

    const parent = dirname(oldDir);
    const newTitle = title || `${article.title} (copy)`;
    const slug = slugifyName(newTitle);
    let newDir = join(parent, slug);
    let counter = 1;
    while (existsSync(newDir)) newDir = join(parent, `${slug}-${counter++}`);

    cpSync(oldDir, newDir, { recursive: true });

    const copy = Article.fromDir(newDir);
    // A duplicate is a NEW article: fresh identity, no inherited publish state.
    copy.id = new Article().id;
    copy.title = newTitle;
    copy.createdAt = new Date().toISOString();
    copy.updatedAt = copy.createdAt;
    copy.publishState = {};
    copy.slug = '';
    copy.saveMeta();

    // Build outputs belong to the original.
    try { rmSync(join(newDir, 'dist'), { recursive: true, force: true }); } catch {}

    return copy;
  }

  /** Soft delete: move to .trash, remembering where it came from. */
  delete(article) {
    const oldDir = article.dir;
    if (!oldDir) throw new Error('Article has no directory on disk.');

    ensureDir(this.trashDir);
    const dirName = basename(oldDir);
    let target = join(this.trashDir, dirName);
    let counter = 1;
    while (existsSync(target)) target = join(this.trashDir, `${dirName}-${counter++}`);

    const folder = this._folderOf(oldDir);
    renameSync(oldDir, target);

    article._dir = target;
    article.deletedAt = new Date().toISOString();
    article.originalFolder = folder;
    article.saveMeta();

    return article;
  }

  /** Restore a soft-deleted article to its original folder. */
  restore(article) {
    const trashPath = article.dir;
    if (!trashPath || !trashPath.startsWith(this.trashDir)) {
      throw new Error('Article is not in the trash.');
    }

    const folder = this._normaliseFolder(article.originalFolder || '');
    const parent = this._resolveFolder(folder);
    ensureDir(parent);

    const dirName = basename(trashPath);
    let target = join(parent, dirName);
    let counter = 1;
    while (existsSync(target)) target = join(parent, `${dirName}-${counter++}`);

    renameSync(trashPath, target);
    article._dir = target;
    article.deletedAt = null;
    article.originalFolder = null;
    article.updatedAt = new Date().toISOString();
    article.saveMeta();

    return article;
  }

  /** Permanently remove an article that is already in the trash. */
  purge(article) {
    const dir = article.dir;
    if (!dir || !dir.startsWith(this.trashDir)) {
      throw new Error('Only articles in the trash can be permanently deleted.');
    }
    rmSync(dir, { recursive: true, force: true });
    return true;
  }

  emptyTrash() {
    if (!existsSync(this.trashDir)) return 0;
    let count = 0;
    for (const entry of readdirSync(this.trashDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      rmSync(join(this.trashDir, entry.name), { recursive: true, force: true });
      count++;
    }
    return count;
  }

  importFile(filePath, folder = '') {
    const parent = this._resolveFolder(this._normaliseFolder(folder));
    ensureDir(parent);
    return Article.importFile(resolve(filePath), parent);
  }

  /** Import raw content (from a browser file picker) as a new article. */
  importContent({ name, content, folder = '', title = null }) {
    const parent = this._resolveFolder(this._normaliseFolder(folder));
    ensureDir(parent);

    const ext = (name || '').toLowerCase().match(/\.(tex|latex|ltx|md|markdown|txt)$/)?.[1] || 'md';
    const sourceFormat = ['tex', 'latex', 'ltx'].includes(ext) ? 'latex' : 'markdown';
    const base = (name || 'imported').replace(/\.[^.]+$/, '');

    const titleMatch = sourceFormat === 'latex'
      ? content.match(/\\title\{([^}]+)\}/)
      : content.match(/^#\s+(.+)$/m);
    const derivedTitle = title || (titleMatch ? titleMatch[1].trim() : base);

    const article = this.create({ title: derivedTitle, folder, sourceFormat, template: content });
    return article;
  }

  // ── Searching ──────────────────────────────────────────────────────────────

  /**
   * Search articles. Matches title, folder, tags, series and — when
   * `includeBody` is set — the source text itself.
   */
  search(query, { includeBody = false } = {}) {
    if (!query || !query.trim()) return this.listAll();

    const q = query.toLowerCase().trim();
    return this.listAll().filter(entry => {
      const a = entry.article;
      if ((a.title || '').toLowerCase().includes(q)) return true;
      if ((entry.folder || '').toLowerCase().includes(q)) return true;
      if (basename(a.dir || '').toLowerCase().includes(q)) return true;
      if ((a.tags || []).some(t => t.toLowerCase().includes(q))) return true;
      if ((a.series || '').toLowerCase().includes(q)) return true;
      if ((a.summary || '').toLowerCase().includes(q)) return true;
      if (includeBody) {
        try {
          if (a.readSource().toLowerCase().includes(q)) return true;
        } catch { /* unreadable source */ }
      }
      return false;
    });
  }

  recent(limit = 10) {
    return this.listAll().slice(0, limit);
  }

  /** Every distinct tag in the library, with usage counts. */
  allTags() {
    const counts = new Map();
    for (const { article } of this.listAll()) {
      for (const tag of article.tags || []) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  /** Every distinct series/column in the library. */
  allSeries() {
    const counts = new Map();
    for (const { article } of this.listAll()) {
      if (article.series) counts.set(article.series, (counts.get(article.series) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([series, count]) => ({ series, count }))
      .sort((a, b) => a.series.localeCompare(b.series));
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  _scanDir(dir, folder, results) {
    if (!existsSync(dir)) return;

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (folder === '' && entry.name === TRASH_DIR) continue;
      if (entry.name.startsWith('.')) continue;

      const subDir = join(dir, entry.name);
      const subFolder = folder ? `${folder}/${entry.name}` : entry.name;

      const article = Article.fromDir(subDir);
      if (article) {
        results.push({ article, folder, path: subFolder });
      } else {
        this._scanDir(subDir, subFolder, results);
      }
    }
  }

  _folderOf(articleDir) {
    const rel = relative(this.rootDir, dirname(articleDir));
    if (!rel || rel === '.') return '';
    return rel.split(sep).join('/');
  }

  /**
   * Normalise a user-supplied folder path and reject anything that would escape
   * the workspace root.
   */
  _normaliseFolder(folder) {
    const raw = String(folder ?? '').replace(/\\/g, '/').trim();
    if (!raw || raw === '/' || raw === '.') return '';
    const parts = raw.split('/').map(p => p.trim()).filter(p => p && p !== '.');
    if (parts.some(p => p === '..')) throw new Error('Invalid folder path.');
    if (parts[0] === TRASH_DIR) throw new Error('The trash folder cannot be used as a destination.');
    return parts.join('/');
  }

  _resolveFolder(folder) {
    const clean = folder === TRASH_DIR ? TRASH_DIR : this._normaliseFolder(folder);
    const dir = clean ? join(this.rootDir, ...clean.split('/')) : this.rootDir;
    const resolved = resolve(dir);
    if (resolved !== resolve(this.rootDir) && !resolved.startsWith(resolve(this.rootDir) + sep)) {
      throw new Error('Invalid folder path.');
    }
    return resolved;
  }
}

export function defaultTemplateFor(sourceFormat, title) {
  if (sourceFormat === 'latex') {
    return `\\documentclass[11pt,a4paper]{article}\n`
      + `\\usepackage[margin=2.5cm]{geometry}\n`
      + `\\usepackage{amsmath,amssymb,amsthm}\n`
      + `\\usepackage{graphicx}\n`
      + `\\usepackage{fontspec}\n\n`
      + `\\title{${title}}\n\\author{}\n\\date{}\n\n`
      + `\\begin{document}\n\\maketitle\n\n\n\n\\end{document}\n`;
  }
  return `# ${title}\n\n`;
}
