import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join, sep } from 'path';
import { tmpdir } from 'os';
import {
  AssetResolver, AssetKind, safeAssetName, canonicalAssetPath, toPosixPath,
  chooseAssetName, hashBytes, contentTypeFor,
} from '../src/core/assets/resolver.js';
import { applyAssetsToHtml } from '../src/core/assets/embed.js';
import { Article } from '../src/workspace/article.js';

/**
 * The canonical article asset model.
 *
 * One rule for every target: article source references `assets/<name>`, and
 * each target resolves that through the same resolver. These tests pin the
 * rule down at every layer, because the bug they exist to prevent — an image
 * that renders in one target and is missing in another — comes from targets
 * disagreeing about where an asset lives.
 */

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

let root;

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'mdtex-assets-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

/** An article on disk, with an optional asset already stored. */
function makeArticle({ folder = '', name = 'my-article', format = 'markdown', asset = null } = {}) {
  const dir = folder ? join(root, ...folder.split('/'), name) : join(root, name);
  mkdirSync(join(dir, 'assets'), { recursive: true });
  const article = new Article({ title: name, sourceFormat: format, _dir: dir });
  if (asset) writeFileSync(join(dir, 'assets', asset), PNG);
  return { article, dir };
}

describe('path normalisation', () => {
  it('converts native separators to POSIX', () => {
    expect(toPosixPath('assets\\figure-01.png')).toBe('assets/figure-01.png');
    expect(toPosixPath('assets/figure-01.png')).toBe('assets/figure-01.png');
    expect(toPosixPath(['assets', 'figure-01.png'].join(sep))).toBe('assets/figure-01.png');
  });

  it('builds canonical paths that never contain a backslash', () => {
    expect(canonicalAssetPath('figure-01.png')).toBe('assets/figure-01.png');
    expect(canonicalAssetPath('图表-01.png')).toBe('assets/图表-01.png');
    expect(canonicalAssetPath('figure-01.png')).not.toContain('\\');
  });

  it('resolves a Windows-style reference the same as a POSIX one', () => {
    const { article } = makeArticle({ asset: 'figure-01.png' });
    const resolver = article.assetResolver();

    expect(resolver.resolve('assets/figure-01.png').exists).toBe(true);
    // A source written on Windows must render on Linux.
    expect(resolver.resolve('assets\\figure-01.png').exists).toBe(true);
  });
});

describe('safeAssetName', () => {
  it('keeps Unicode letters so a Chinese filename stays readable', () => {
    expect(safeAssetName('图表-01.png')).toBe('图表-01.png');
    expect(safeAssetName('図-01.png')).toBe('図-01.png');
  });

  it('replaces spaces, which Markdown link targets cannot carry unquoted', () => {
    expect(safeAssetName('my figure.png')).toBe('my_figure.png');
    expect(safeAssetName('图表 01.png')).toBe('图表_01.png');
  });

  it('strips path separators and traversal', () => {
    expect(safeAssetName('../../etc/passwd')).not.toContain('/');
    expect(safeAssetName('..\\..\\windows\\system32')).not.toContain('\\');
    expect(safeAssetName('../../etc/passwd')).not.toContain('..');
  });

  it('never returns an empty name', () => {
    expect(safeAssetName('')).toBe('file');
    expect(safeAssetName('...')).toBe('file');
  });
});

describe('AssetResolver classification', () => {
  it('recognises each reference kind', () => {
    const resolver = new AssetResolver({ articleRoot: root });
    expect(resolver.classify('assets/figure-01.png')).toBe(AssetKind.ARTICLE);
    expect(resolver.classify('data:image/png;base64,AAAA')).toBe(AssetKind.DATA);
    expect(resolver.classify('https://example.com/a.png')).toBe(AssetKind.REMOTE);
    expect(resolver.classify('//cdn.example.com/a.png')).toBe(AssetKind.REMOTE);
    expect(resolver.classify('/home/me/a.png')).toBe(AssetKind.ABSOLUTE);
    expect(resolver.classify('C:\\Users\\me\\a.png')).toBe(AssetKind.ABSOLUTE);
    expect(resolver.classify('../outside.png')).toBe(AssetKind.ESCAPING);
  });

  it('refuses a reference that climbs out of the article', () => {
    const { article } = makeArticle();
    const record = article.assetResolver().resolve('../../../etc/passwd');
    expect(record.exists).toBe(false);
    expect(record.error).toMatch(/outside the article/);
  });
});

describe('AssetResolver resolution', () => {
  it('resolves a canonical path against the article root', () => {
    const { article, dir } = makeArticle({ asset: 'figure-01.png' });
    const record = article.assetResolver().resolve('assets/figure-01.png');

    expect(record.exists).toBe(true);
    expect(record.absolutePath).toBe(join(dir, 'assets', 'figure-01.png'));
    expect(record.bytes).toBe(PNG.length);
  });

  it('resolves inside a nested article folder', () => {
    const { article, dir } = makeArticle({ folder: 'research/2026/q3', asset: 'figure-01.png' });
    const record = article.assetResolver().resolve('assets/figure-01.png');

    expect(record.exists).toBe(true);
    expect(record.absolutePath).toBe(join(dir, 'assets', 'figure-01.png'));
  });

  it('resolves a Chinese filename', () => {
    const { article } = makeArticle({ asset: '图表-01.png' });
    expect(article.assetResolver().resolve('assets/图表-01.png').exists).toBe(true);
  });

  it('resolves a percent-encoded reference, as Markdown writes it', () => {
    const { article } = makeArticle({ asset: '图表-01.png' });
    const encoded = `assets/${encodeURIComponent('图表-01.png')}`;
    expect(article.assetResolver().resolve(encoded).exists).toBe(true);
  });

  it('resolves under an article whose own folder has spaces and Unicode', () => {
    const { article } = makeArticle({ folder: '我的 文章', name: 'uniform integrability', asset: 'figure-01.png' });
    expect(article.assetResolver().resolve('assets/figure-01.png').exists).toBe(true);
  });

  it('reports a content hash that changes when the file changes', () => {
    const { article, dir } = makeArticle({ asset: 'figure-01.png' });
    const before = article.assetResolver().hashOf('assets/figure-01.png');

    writeFileSync(join(dir, 'assets', 'figure-01.png'), Buffer.concat([PNG, Buffer.from([1, 2, 3])]));
    const after = article.assetResolver().hashOf('assets/figure-01.png');

    expect(before).toBeTruthy();
    expect(after).not.toBe(before);
  });

  it('says the article is unsaved rather than pretending the file is missing', () => {
    const record = new AssetResolver({ articleRoot: null }).resolve('assets/figure-01.png');
    expect(record.error).toMatch(/no directory on disk/);
  });
});

describe('preview URLs', () => {
  it('carries the content hash so a replaced image is never stale', () => {
    const { article } = makeArticle({ asset: 'figure-01.png' });
    const resolver = article.assetResolver();
    const url = resolver.previewUrl('assets/figure-01.png');

    expect(url).toContain(`/api/assets/${article.id}/assets/figure-01.png`);
    expect(url).toMatch(/\?v=[0-9a-f]{12}$/);
  });

  it('percent-encodes a Chinese filename', () => {
    const { article } = makeArticle({ asset: '图表-01.png' });
    const url = article.assetResolver().previewUrl('assets/图表-01.png');
    expect(url).toContain(encodeURIComponent('图表-01.png'));
    expect(url).not.toContain('图表');
  });

  it('never contains a backslash, whatever the source used', () => {
    const { article } = makeArticle({ asset: 'figure-01.png' });
    expect(article.assetResolver().previewUrl('assets\\figure-01.png')).not.toContain('\\');
  });

  it('passes data and remote references straight through', () => {
    const { article } = makeArticle();
    const resolver = article.assetResolver();
    expect(resolver.previewUrl('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
    expect(resolver.previewUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
  });
});

describe('diagnostics', () => {
  it('names the source, the article root and the expected path', () => {
    const { article, dir } = makeArticle();
    const text = article.assetResolver().describeFailure('assets/figure-01.png');

    expect(text).toContain('Image not found');
    expect(text).toContain('assets/figure-01.png');
    expect(text).toContain(dir);
    expect(text).toContain(join(dir, 'assets', 'figure-01.png'));
  });

  it('suggests the closest existing file for a case mistake', () => {
    const { article } = makeArticle({ asset: 'figure-02.png' });
    const text = article.assetResolver().describeFailure('assets/Figure-02.PNG');
    expect(text).toContain('Did you mean');
    expect(text).toContain('assets/figure-02.png');
  });

  it('explains an unsaved article instead of blaming the file', () => {
    const text = new AssetResolver({ articleRoot: null }).describeFailure('assets/a.png');
    expect(text).toContain('article not saved to disk');
  });
});

describe('collision handling', () => {
  it('reuses the stored file when the bytes are identical', () => {
    const { dir } = makeArticle({ asset: 'figure.png' });
    const choice = chooseAssetName(join(dir, 'assets'), 'figure.png', PNG);
    expect(choice).toEqual({ name: 'figure.png', reused: true });
  });

  it('picks a deterministic alternative when the bytes differ', () => {
    const { dir } = makeArticle({ asset: 'figure.png' });
    const different = Buffer.concat([PNG, Buffer.from([9])]);
    expect(chooseAssetName(join(dir, 'assets'), 'figure.png', different))
      .toEqual({ name: 'figure-2.png', reused: false });
  });

  it('never overwrites unless replacement was asked for', () => {
    const { dir } = makeArticle({ asset: 'figure.png' });
    const different = Buffer.concat([PNG, Buffer.from([9])]);

    expect(chooseAssetName(join(dir, 'assets'), 'figure.png', different).name).not.toBe('figure.png');
    expect(chooseAssetName(join(dir, 'assets'), 'figure.png', different, { replace: true }).name).toBe('figure.png');
  });
});

describe('Article.writeAsset', () => {
  it('stores the file and returns a canonical article-relative reference', () => {
    const { article, dir } = makeArticle();
    const asset = article.writeAsset('figure-01.png', PNG);

    expect(existsSync(join(dir, 'assets', 'figure-01.png'))).toBe(true);
    expect(asset.canonical).toBe('assets/figure-01.png');
    expect(asset.reference).toBe('![figure-01](assets/figure-01.png)');
  });

  it('never writes an absolute path into the source', () => {
    const { article } = makeArticle();
    const asset = article.writeAsset('figure-01.png', PNG);

    expect(asset.reference).not.toMatch(/^[a-zA-Z]:[\\/]/);
    expect(asset.reference).not.toContain(root);
    expect(asset.reference).not.toContain('data:');
    expect(asset.reference).not.toContain('blob:');
    expect(asset.reference).not.toContain('/api/');
  });

  it('produces a LaTeX reference using the same canonical path', () => {
    const { article } = makeArticle({ format: 'latex' });
    const asset = article.writeAsset('figure-01.png', PNG);

    expect(asset.canonical).toBe('assets/figure-01.png');
    expect(asset.reference).toContain('\\includegraphics[width=0.8\\textwidth]{assets/figure-01.png}');
  });

  it('refuses an empty file rather than storing a broken asset', () => {
    const { article } = makeArticle();
    expect(() => article.writeAsset('empty.png', Buffer.alloc(0))).toThrow(/empty/i);
  });

  it('verifies the copy before returning a reference', () => {
    const { article, dir } = makeArticle();
    const asset = article.writeAsset('figure-01.png', PNG);
    // The returned size is the verified on-disk size, not the requested one.
    expect(asset.bytes).toBe(readFileSync(join(dir, 'assets', asset.name)).length);
    expect(asset.hash).toBe(hashBytes(PNG));
  });

  it('lists assets with hashes for cache busting', () => {
    const { article } = makeArticle();
    article.writeAsset('figure-01.png', PNG);
    const [asset] = article.listAssets();

    expect(asset.canonical).toBe('assets/figure-01.png');
    expect(asset.hash).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('platform rendering (WeChat / Zhihu)', () => {
  it('inlines a local asset so a pasted article is self-contained', () => {
    const { article } = makeArticle({ asset: 'figure-01.png' });
    const html = '<p><img src="assets/figure-01.png" alt="f"></p>';

    const result = applyAssetsToHtml(html, article.assetResolver(), { mode: 'inline' });

    expect(result.embedded).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.html).toContain('src="data:image/png;base64,');
    expect(result.html).not.toContain('assets/figure-01.png');
  });

  it('inlines a Chinese-named asset', () => {
    const { article } = makeArticle({ asset: '图表-01.png' });
    const html = `<p><img src="assets/${encodeURIComponent('图表-01.png')}" alt="f"></p>`;

    const result = applyAssetsToHtml(html, article.assetResolver(), { mode: 'inline' });
    expect(result.embedded).toBe(1);
    expect(result.html).toContain('data:image/png;base64,');
  });

  it('reports a missing asset with a full diagnostic', () => {
    const { article, dir } = makeArticle();
    const html = '<p><img src="assets/figure-01.png" alt="f"></p>';

    const result = applyAssetsToHtml(html, article.assetResolver(), { mode: 'inline' });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('assets/figure-01.png');
    expect(result.errors[0].diagnostic).toContain(dir);
    expect(result.errors[0].articleRoot).toBe(dir);
  });

  it('leaves formula data URIs alone', () => {
    const { article } = makeArticle();
    const html = '<p><img src="data:image/png;base64,AAAA" alt="formula"></p>';

    const result = applyAssetsToHtml(html, article.assetResolver(), { mode: 'inline' });
    expect(result.errors).toEqual([]);
    expect(result.html).toBe(html);
  });

  it('leaves remote images as links', () => {
    const { article } = makeArticle();
    const html = '<p><img src="https://example.com/a.png"></p>';

    const result = applyAssetsToHtml(html, article.assetResolver(), { mode: 'inline' });
    expect(result.errors).toEqual([]);
    expect(result.html).toContain('https://example.com/a.png');
  });

  it('can emit backend URLs instead of inlining', () => {
    const { article } = makeArticle({ asset: 'figure-01.png' });
    const html = '<p><img src="assets/figure-01.png"></p>';

    const result = applyAssetsToHtml(html, article.assetResolver(), { mode: 'url' });
    expect(result.html).toContain(`/api/assets/${article.id}/assets/figure-01.png`);
  });
});

describe('content types', () => {
  it('maps the formats an article can carry', () => {
    expect(contentTypeFor('a.png')).toBe('image/png');
    expect(contentTypeFor('a.JPG')).toBe('image/jpeg');
    expect(contentTypeFor('a.svg')).toBe('image/svg+xml');
    expect(contentTypeFor('assets/图表.png')).toBe('image/png');
    expect(contentTypeFor('a.unknown')).toBe('application/octet-stream');
  });
});
