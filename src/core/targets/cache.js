import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'fs';
import { join } from 'path';
import { paths, ensureDir } from '../paths.js';

/**
 * Cache of compiled platform output (WeChat / Zhihu HTML).
 *
 * The key covers everything that can change the bytes we would put on the
 * clipboard: article source, resolved theme CSS, platform, math output mode,
 * and the renderer/compiler versions. If none of those moved since the last
 * successful compile, "Copy" can reuse the stored HTML instead of re-running
 * MathJax, juice and the platform adapter.
 */

/**
 * Bump when the compiler, platform adapters or math post-processor change the
 * bytes they emit, so stale entries are never served after an update.
 */
export const TARGET_RENDERER_VERSION = '2';

export function targetCacheKey({
  source,
  themeCss,
  themeName = '',
  platform,
  mathOutput = 'svg',
  rendererVersion = TARGET_RENDERER_VERSION,
  extra = null,
}) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify({
    source,
    themeCss,
    themeName,
    platform,
    mathOutput,
    rendererVersion,
    extra,
  }));
  return hash.digest('hex').slice(0, 32);
}

/** Content hash of an article's source alone — used for staleness display. */
export function sourceHash(source) {
  return createHash('sha256').update(String(source ?? '')).digest('hex').slice(0, 16);
}

export class TargetCache {
  constructor(cacheDir = null, { maxEntries = 60 } = {}) {
    this.cacheDir = cacheDir || join(paths.cacheDir, 'targets');
    this.maxEntries = maxEntries;
    this.memory = new Map();
  }

  get(key) {
    if (this.memory.has(key)) return this.memory.get(key);

    const metaPath = join(this.cacheDir, `${key}.json`);
    const htmlPath = join(this.cacheDir, `${key}.html`);
    if (!existsSync(metaPath) || !existsSync(htmlPath)) return null;

    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      const entry = { ...meta, html: readFileSync(htmlPath, 'utf-8'), key };
      this.memory.set(key, entry);
      return entry;
    } catch {
      return null;
    }
  }

  has(key) {
    return this.memory.has(key) || existsSync(join(this.cacheDir, `${key}.json`));
  }

  set(key, { html, plainText, validation, stats, platform, theme, mathOutput, durationMs }) {
    ensureDir(this.cacheDir);
    const meta = {
      key,
      platform,
      theme,
      mathOutput,
      validation,
      stats,
      durationMs,
      bytes: html.length,
      createdAt: new Date().toISOString(),
      rendererVersion: TARGET_RENDERER_VERSION,
    };
    writeFileSync(join(this.cacheDir, `${key}.html`), html, 'utf-8');
    if (plainText !== undefined) {
      writeFileSync(join(this.cacheDir, `${key}.txt`), plainText, 'utf-8');
      meta.hasPlainText = true;
    }
    writeFileSync(join(this.cacheDir, `${key}.json`), JSON.stringify(meta, null, 2), 'utf-8');

    const entry = { ...meta, html, plainText };
    this.memory.set(key, entry);
    this._prune();
    return entry;
  }

  getPlainText(key) {
    const cached = this.memory.get(key);
    if (cached?.plainText !== undefined) return cached.plainText;
    const p = join(this.cacheDir, `${key}.txt`);
    return existsSync(p) ? readFileSync(p, 'utf-8') : null;
  }

  clear() {
    this.memory.clear();
    if (!existsSync(this.cacheDir)) return 0;
    let removed = 0;
    for (const f of readdirSync(this.cacheDir)) {
      try { rmSync(join(this.cacheDir, f), { force: true }); removed++; } catch {}
    }
    return removed;
  }

  /** Keep the cache directory bounded; evict the oldest entries first. */
  _prune() {
    if (!existsSync(this.cacheDir)) return;
    const metas = readdirSync(this.cacheDir).filter(f => f.endsWith('.json'));
    if (metas.length <= this.maxEntries) return;

    const entries = metas.map(f => {
      const full = join(this.cacheDir, f);
      let mtime = 0;
      try { mtime = statSync(full).mtimeMs; } catch {}
      return { key: f.replace(/\.json$/, ''), mtime };
    }).sort((a, b) => a.mtime - b.mtime);

    for (const entry of entries.slice(0, entries.length - this.maxEntries)) {
      for (const ext of ['.json', '.html', '.txt']) {
        try { rmSync(join(this.cacheDir, entry.key + ext), { force: true }); } catch {}
      }
      this.memory.delete(entry.key);
    }
  }
}
