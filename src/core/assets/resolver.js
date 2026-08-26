import { existsSync, statSync, readFileSync, readdirSync } from 'fs';
import { join, resolve as resolvePath, sep, posix, relative, isAbsolute, extname, basename } from 'path';
import { createHash } from 'crypto';

/**
 * The canonical article asset model.
 *
 * One rule, used by every target. An article is a project directory:
 *
 *     article-project/
 *       article.json
 *       source.md
 *       assets/
 *         figure-01.png
 *
 * and the *only* form written into article source is the article-relative
 * POSIX path:
 *
 *     ![caption](assets/figure-01.png)
 *     \includegraphics{assets/figure-01.png}
 *
 * Never an absolute path, never a data URI, never a blob: URL, never a
 * preview-server URL, never a path relative to the repository or the build
 * directory. Those all work in exactly one renderer and break in the others,
 * which is precisely the failure this module exists to prevent.
 *
 * Each target then resolves that one canonical form through this resolver:
 *
 *   live preview      -> a backend asset URL (never written back to source)
 *   WeChat / Zhihu    -> inlined bytes, so a pasted article is self-contained
 *   Markdown -> PDF   -> copied into the generated build directory
 *   LaTeX project     -> left alone; latexmk runs in the project root
 *   Blog handoff      -> the physical file list, passed to blogpipe
 */

/** Directory, inside an article, that holds managed assets. */
export const ASSET_DIR = 'assets';

/** Extensions a LaTeX \includegraphics can actually use. */
export const LATEX_IMAGE_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.eps'];

const CONTENT_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.eps': 'application/postscript',
};

/** MIME type for an asset path. Shared by the asset route and the inliner. */
export function contentTypeFor(name) {
  return CONTENT_TYPES[extname(String(name)).toLowerCase()] || 'application/octet-stream';
}

export const AssetKind = {
  ARTICLE: 'article',   // assets/figure-01.png — the canonical form
  DATA: 'data',         // data:image/png;base64,...
  REMOTE: 'remote',     // https://...
  ABSOLUTE: 'absolute', // C:\... or /home/... — never written by MDTeX
  ESCAPING: 'escaping', // ../../outside — refused
};

/**
 * Normalise any filesystem path to the POSIX form used in article source.
 *
 * Windows and Linux must have identical *public* semantics: a source file
 * written on Windows has to render on Linux and vice versa. Backslashes are
 * a filesystem detail and never appear in article source or in a URL.
 */
export function toPosixPath(value) {
  return String(value ?? '').split(sep).join('/').replace(/\\/g, '/');
}

/**
 * Make a filename safe to store, without destroying meaning.
 *
 * Unicode letters and digits are kept, so a Chinese or Japanese filename stays
 * readable. Path separators, traversal and control characters are removed.
 */
export function safeAssetName(name) {
  const cleaned = String(name || 'file')
    .replace(/[\\/]/g, '_')
    .replace(/\.\.+/g, '.')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .replace(/\s+/g, '_')
    .replace(/^[.\s]+/, '')
    .trim();
  return cleaned || 'file';
}

/** The canonical source reference for a stored asset filename. */
export function canonicalAssetPath(name) {
  return posix.join(ASSET_DIR, toPosixPath(name));
}

/** Content hash used for cache busting and duplicate detection. */
export function hashBytes(buffer) {
  return createHash('sha256').update(buffer).digest('hex').slice(0, 12);
}

/**
 * Resolves article-relative asset references against one article root.
 *
 * Construct it once per article and hand it to whichever target needs it, so
 * every target agrees on where an asset lives.
 */
export class AssetResolver {
  /**
   * @param {object} options
   * @param {string|null} options.articleRoot  absolute path to the article directory
   * @param {string|null} options.articleId    used to build preview URLs
   * @param {string} options.apiBase           backend API base for preview URLs
   */
  constructor({ articleRoot = null, articleId = null, apiBase = '/api' } = {}) {
    this.articleRoot = articleRoot ? resolvePath(articleRoot) : null;
    this.articleId = articleId;
    this.apiBase = apiBase;
    this._cache = new Map();
  }

  /** Absolute path of the article's managed asset directory. */
  get assetDir() {
    return this.articleRoot ? join(this.articleRoot, ASSET_DIR) : null;
  }

  /** What sort of reference this is, before touching the filesystem. */
  classify(src) {
    const value = String(src ?? '').trim();
    if (!value) return AssetKind.ARTICLE;
    if (/^data:/i.test(value)) return AssetKind.DATA;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return AssetKind.REMOTE;
    if (/^\/\//.test(value)) return AssetKind.REMOTE;
    if (isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value)) return AssetKind.ABSOLUTE;

    // A reference that climbs out of the article is refused rather than
    // resolved: an article must be self-contained to be movable.
    const normalised = posix.normalize(toPosixPath(value));
    if (normalised.startsWith('../') || normalised === '..') return AssetKind.ESCAPING;

    return AssetKind.ARTICLE;
  }

  /**
   * Resolve one reference.
   *
   * Always returns a record — never throws — so a caller can report a precise
   * diagnostic instead of a bare "image not found".
   *
   * @returns {{
   *   src, kind, canonical, absolutePath, exists, bytes, hash, mtimeMs,
   *   error, expected
   * }}
   */
  resolve(src) {
    const key = String(src ?? '');
    if (this._cache.has(key)) return this._cache.get(key);

    const kind = this.classify(key);
    const record = {
      src: key,
      kind,
      canonical: null,
      absolutePath: null,
      exists: false,
      bytes: 0,
      hash: null,
      mtimeMs: 0,
      error: null,
      expected: null,
    };

    if (kind === AssetKind.DATA || kind === AssetKind.REMOTE) {
      record.canonical = key;
      this._cache.set(key, record);
      return record;
    }

    if (kind === AssetKind.ESCAPING) {
      record.error = 'The path points outside the article directory. '
        + 'Article assets must live inside the article so it stays self-contained.';
      this._cache.set(key, record);
      return record;
    }

    if (kind === AssetKind.ABSOLUTE) {
      // Still resolvable on this machine, but not portable. Report it so the
      // caller can warn; MDTeX itself never writes these.
      record.absolutePath = resolvePath(key);
      record.canonical = key;
      this._stat(record);
      if (!record.exists) {
        record.error = 'Absolute path not found on this machine.';
      }
      this._cache.set(key, record);
      return record;
    }

    // The canonical case.
    const canonical = posix.normalize(toPosixPath(decodeMaybe(key)));
    record.canonical = canonical;

    if (!this.articleRoot) {
      record.error = 'The article has no directory on disk yet, so article-relative '
        + 'assets cannot be resolved. Save the article first.';
      this._cache.set(key, record);
      return record;
    }

    const absolute = resolvePath(this.articleRoot, ...canonical.split('/'));
    record.expected = absolute;

    // Defence in depth: normalisation above should have caught this already.
    if (absolute !== this.articleRoot && !absolute.startsWith(this.articleRoot + sep)) {
      record.error = 'The path resolves outside the article directory.';
      this._cache.set(key, record);
      return record;
    }

    record.absolutePath = absolute;
    this._stat(record);
    if (!record.exists) record.error = 'File not found.';

    this._cache.set(key, record);
    return record;
  }

  _stat(record) {
    try {
      const stats = statSync(record.absolutePath);
      if (!stats.isFile()) return;
      record.exists = true;
      record.bytes = stats.size;
      record.mtimeMs = stats.mtimeMs;
    } catch {
      record.exists = false;
    }
  }

  /** Content hash, read on demand. */
  hashOf(src) {
    const record = this.resolve(src);
    if (!record.exists) return null;
    if (record.hash) return record.hash;
    try {
      record.hash = hashBytes(readFileSync(record.absolutePath));
    } catch {
      record.hash = null;
    }
    return record.hash;
  }

  /** Read the bytes of a resolved asset, or null. */
  read(src) {
    const record = this.resolve(src);
    if (!record.exists) return null;
    try {
      return readFileSync(record.absolutePath);
    } catch {
      return null;
    }
  }

  /**
   * The URL the live preview should load an asset from.
   *
   * This exists only so a browser can display a local file; it is a rendering
   * detail and must never be written back into article source. The content
   * hash in the query string is what makes a replaced image show up
   * immediately instead of coming from the browser cache.
   */
  previewUrl(src, { token = null } = {}) {
    const record = this.resolve(src);
    if (record.kind === AssetKind.DATA || record.kind === AssetKind.REMOTE) return record.src;
    if (!this.articleId || !record.canonical) return null;

    const path = record.canonical.split('/').map(encodeURIComponent).join('/');
    const params = [];
    const version = this.hashOf(src);
    if (version) params.push(`v=${version}`);
    if (token) params.push(`token=${encodeURIComponent(token)}`);

    return `${this.apiBase}/assets/${encodeURIComponent(this.articleId)}/${path}`
      + (params.length ? `?${params.join('&')}` : '');
  }

  /** Every managed asset in the article. */
  list() {
    if (!this.assetDir || !existsSync(this.assetDir)) return [];
    return readdirSync(this.assetDir)
      .filter(name => !name.startsWith('.'))
      .map(name => {
        const canonical = canonicalAssetPath(name);
        const record = this.resolve(canonical);
        return {
          name,
          canonical,
          path: record.absolutePath,
          bytes: record.bytes,
          hash: this.hashOf(canonical),
        };
      });
  }

  /**
   * A diagnostic a person can act on.
   *
   * "Image not found" alone tells nobody anything. This says which reference
   * failed, which article root it was resolved against, and the exact path
   * that was expected — which is normally enough to see the mistake at once.
   */
  describeFailure(src, { label = 'Image not found' } = {}) {
    const record = this.resolve(src);
    const lines = [label, '', 'Source:', `  ${record.src || '(empty)'}`];

    lines.push('', 'Article root:', `  ${this.articleRoot || '(article not saved to disk)'}`);

    if (record.expected || record.absolutePath) {
      lines.push('', 'Expected:', `  ${record.expected || record.absolutePath}`);
    }

    if (record.error) lines.push('', 'Reason:', `  ${record.error}`);

    // A near-miss is usually a typo or a case difference; naming the closest
    // existing file turns a hunt into a glance.
    const suggestion = this._suggest(record);
    if (suggestion) lines.push('', 'Did you mean:', `  ${suggestion}`);

    return lines.join('\n');
  }

  /** One-line form, for a build log. */
  describeFailureShort(src) {
    const record = this.resolve(src);
    return `${record.src} -> ${record.expected || '(unresolvable)'}`
      + `${record.error ? ` (${record.error})` : ''}`;
  }

  _suggest(record) {
    if (!record.canonical || !this.assetDir || !existsSync(this.assetDir)) return null;
    const wanted = basename(record.canonical).toLowerCase();
    const candidates = this.list();

    const caseMatch = candidates.find(a => a.name.toLowerCase() === wanted);
    if (caseMatch) return caseMatch.canonical;

    const stem = wanted.replace(/\.[^.]+$/, '');
    const stemMatch = candidates.find(a => a.name.toLowerCase().replace(/\.[^.]+$/, '') === stem);
    if (stemMatch) return stemMatch.canonical;

    return null;
  }
}

/**
 * Markdown percent-encodes characters in link targets. `assets/%E5%9B%BE.png`
 * and `assets/图.png` are the same file.
 */
function decodeMaybe(value) {
  if (!value.includes('%')) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Choose a filename that does not collide with what is already stored.
 *
 * Identical content reuses the existing file rather than making a near-copy:
 * dropping the same screenshot twice should not litter the article. Different
 * content gets a deterministic suffix; nothing is ever silently overwritten
 * unless the caller explicitly asked to replace.
 *
 * @returns {{ name, reused: boolean }}
 */
export function chooseAssetName(assetDir, requestedName, buffer, { replace = false } = {}) {
  const safe = safeAssetName(requestedName);
  const target = join(assetDir, safe);

  if (!existsSync(target)) return { name: safe, reused: false };

  if (replace) return { name: safe, reused: false };

  // Same bytes already stored under that name: reuse it.
  try {
    if (hashBytes(readFileSync(target)) === hashBytes(buffer)) {
      return { name: safe, reused: true };
    }
  } catch { /* fall through to a new name */ }

  const ext = extname(safe);
  const stem = safe.slice(0, safe.length - ext.length);

  for (let counter = 2; counter < 10000; counter++) {
    const candidate = `${stem}-${counter}${ext}`;
    const candidatePath = join(assetDir, candidate);
    if (!existsSync(candidatePath)) return { name: candidate, reused: false };
    try {
      if (hashBytes(readFileSync(candidatePath)) === hashBytes(buffer)) {
        return { name: candidate, reused: true };
      }
    } catch { /* keep looking */ }
  }

  return { name: `${stem}-${Date.now()}${ext}`, reused: false };
}
