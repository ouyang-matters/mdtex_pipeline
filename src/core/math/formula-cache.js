import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { paths, ensureDir } from '../paths.js';

const RENDERER_VERSION = '1';

/**
 * Compute a deterministic cache key for a formula.
 * Includes: LaTeX source, display mode, renderer version.
 */
export function formulaCacheKey(latex, displayMode) {
  const input = JSON.stringify({
    latex,
    displayMode,
    rendererVersion: RENDERER_VERSION,
  });
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/**
 * Formula asset cache backed by the filesystem.
 */
export class FormulaCache {
  constructor(cacheDir = null) {
    this.cacheDir = cacheDir || join(paths.cacheDir, 'formulas');
    this.memoryCache = new Map();
  }

  _ensureDir() {
    ensureDir(this.cacheDir);
  }

  /**
   * Get a cached formula asset.
   * Returns { svg, png, dataUri, width, height, verticalAlign } or null.
   */
  get(latex, displayMode) {
    const key = formulaCacheKey(latex, displayMode);

    // Memory cache first
    if (this.memoryCache.has(key)) {
      return this.memoryCache.get(key);
    }

    // Disk cache
    const metaPath = join(this.cacheDir, `${key}.json`);
    if (!existsSync(metaPath)) return null;

    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));

      // Load SVG if exists
      const svgPath = join(this.cacheDir, `${key}.svg`);
      if (existsSync(svgPath)) {
        meta.svg = readFileSync(svgPath, 'utf-8');
      }

      // Load PNG if exists
      const pngPath = join(this.cacheDir, `${key}.png`);
      if (existsSync(pngPath)) {
        meta.pngPath = pngPath;
      }

      this.memoryCache.set(key, meta);
      return meta;
    } catch {
      return null;
    }
  }

  /**
   * Store a formula asset in the cache.
   */
  set(latex, displayMode, asset) {
    this._ensureDir();
    const key = formulaCacheKey(latex, displayMode);

    // Save SVG
    if (asset.svg) {
      writeFileSync(join(this.cacheDir, `${key}.svg`), asset.svg, 'utf-8');
    }

    // Save PNG
    if (asset.pngBuffer) {
      const pngPath = join(this.cacheDir, `${key}.png`);
      writeFileSync(pngPath, asset.pngBuffer);
      asset.pngPath = pngPath;
    }

    // Save metadata (excluding large binary data)
    const meta = {
      latex,
      displayMode,
      width: asset.width,
      height: asset.height,
      widthPx: asset.widthPx,
      heightPx: asset.heightPx,
      widthEx: asset.widthEx,
      heightEx: asset.heightEx,
      verticalAlign: asset.verticalAlign,
      verticalAlignPx: asset.verticalAlignPx,
      dataUri: asset.dataUri,
      pngDataUri: asset.pngDataUri,
      error: asset.error,
      rendererVersion: RENDERER_VERSION,
    };
    writeFileSync(join(this.cacheDir, `${key}.json`), JSON.stringify(meta, null, 2), 'utf-8');

    // Memory cache
    this.memoryCache.set(key, { ...meta, svg: asset.svg, pngPath: asset.pngPath });
  }

  /**
   * Check if a formula is cached.
   */
  has(latex, displayMode) {
    const key = formulaCacheKey(latex, displayMode);
    if (this.memoryCache.has(key)) return true;
    return existsSync(join(this.cacheDir, `${key}.json`));
  }
}
