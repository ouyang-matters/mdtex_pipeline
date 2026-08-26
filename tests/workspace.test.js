import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Article } from '../src/workspace/article.js';
import { ArticleLibrary } from '../src/workspace/library.js';

const TEST_DIR = join(tmpdir(), `publisher-ws-test-${process.pid}`);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('Article', () => {
  it('should create with stable ID', () => {
    const a = new Article({ title: 'Test Article' });
    expect(a.id).toBeTruthy();
    expect(a.id.length).toBeGreaterThan(10);
    expect(a.title).toBe('Test Article');
    expect(a.sourceFormat).toBe('markdown');
  });

  it('should save and load metadata', () => {
    const dir = join(TEST_DIR, 'test-article');
    mkdirSync(dir, { recursive: true });

    const a = new Article({ title: 'My Article', tags: ['math', 'physics'], _dir: dir });
    a.saveMeta();

    const loaded = Article.fromDir(dir);
    expect(loaded).not.toBeNull();
    expect(loaded.title).toBe('My Article');
    expect(loaded.tags).toEqual(['math', 'physics']);
    expect(loaded.id).toBe(a.id);
  });

  it('should read and write source', () => {
    const dir = join(TEST_DIR, 'source-test');
    mkdirSync(dir, { recursive: true });

    const a = new Article({ title: 'Source Test', _dir: dir });
    a.writeSource('# Hello\n\n$E=mc^2$');

    expect(a.readSource()).toContain('Hello');
    expect(a.readSource()).toContain('$E=mc^2$');
  });

  it('should import assets with safe filenames', () => {
    const dir = join(TEST_DIR, 'asset-test');
    mkdirSync(dir, { recursive: true });

    // Create a fake image
    const imgPath = join(TEST_DIR, 'test image (1).png');
    writeFileSync(imgPath, 'fake-png-data');

    const a = new Article({ title: 'Asset Test', _dir: dir });
    const asset = a.importAsset(imgPath);

    expect(asset.reference).toContain('![');
    expect(asset.reference).toContain('assets/');
    expect(asset.relativePath).toBe(`assets/${asset.name}`);
    // Spaces and parentheses must not survive into the stored filename.
    expect(asset.name).not.toMatch(/[ ()]/);
    expect(existsSync(join(dir, 'assets'))).toBe(true);

    const assets = a.listAssets();
    expect(assets.length).toBe(1);
  });

  it('should import standalone .md file', () => {
    const mdPath = join(TEST_DIR, 'standalone.md');
    writeFileSync(mdPath, '# My Standalone Article\n\nContent here.\n');

    const article = Article.importMarkdown(mdPath, TEST_DIR);
    expect(article.title).toBe('My Standalone Article');
    expect(article.readSource()).toContain('Content here');
    expect(existsSync(article.metaPath)).toBe(true);
  });
});

describe('ArticleLibrary', () => {
  it('should create and list articles', () => {
    const lib = new ArticleLibrary(TEST_DIR);
    lib.create({ title: 'First Article' });
    lib.create({ title: 'Second Article' });

    const all = lib.listAll();
    expect(all.length).toBe(2);
    expect(all.some(e => e.article.title === 'First Article')).toBe(true);
  });

  it('should create articles in folders', () => {
    const lib = new ArticleLibrary(TEST_DIR);
    lib.createFolder('research');
    lib.create({ title: 'Paper Draft', folder: 'research' });

    const all = lib.listAll();
    expect(all.length).toBe(1);
    expect(all[0].folder).toContain('research');
  });

  it('should search by title', () => {
    const lib = new ArticleLibrary(TEST_DIR);
    lib.create({ title: 'Bayesian Inference Tutorial' });
    lib.create({ title: 'React Component Guide' });
    lib.create({ title: 'Variational Methods' });

    const results = lib.search('bayesian');
    expect(results.length).toBe(1);
    expect(results[0].article.title).toBe('Bayesian Inference Tutorial');
  });

  it('should import files', () => {
    const mdPath = join(TEST_DIR, 'import-test.md');
    writeFileSync(mdPath, '# Imported Article\n\nBody text.\n');

    const lib = new ArticleLibrary(join(TEST_DIR, 'library'));
    const article = lib.importFile(mdPath);

    expect(article.title).toBe('Imported Article');
    const all = lib.listAll();
    expect(all.length).toBe(1);
  });

  it('should rename articles without changing ID', () => {
    const lib = new ArticleLibrary(TEST_DIR);
    const article = lib.create({ title: 'Original Title' });
    const originalId = article.id;

    lib.rename(article, 'New Title');

    expect(article.title).toBe('New Title');
    expect(article.id).toBe(originalId);
  });

  it('should support LaTeX articles', () => {
    const lib = new ArticleLibrary(TEST_DIR);
    const article = lib.create({ title: 'LaTeX Paper', sourceFormat: 'latex' });

    expect(article.sourceFormat).toBe('latex');
    expect(article.sourceFile).toBe('main.tex');
    expect(article.readSource()).toContain('\\documentclass');
  });

  it('should return recent articles sorted by date', () => {
    const lib = new ArticleLibrary(TEST_DIR);
    const a1 = lib.create({ title: 'Older' });
    // Force different timestamps
    a1.updatedAt = '2024-01-01T00:00:00Z';
    a1.saveMeta();

    const a2 = lib.create({ title: 'Newer' });

    const recent = lib.recent(5);
    expect(recent[0].article.title).toBe('Newer');
  });

  it('should preserve article data during migration simulation', () => {
    const lib = new ArticleLibrary(TEST_DIR);
    const article = lib.create({ title: 'Migration Test' });
    article.writeSource('# Important Content\n\n$x^2$');
    article.tags = ['test', 'migration'];
    article.saveMeta();

    // Simulate "update" by re-reading
    const reloaded = Article.fromDir(article.dir);
    expect(reloaded.title).toBe('Migration Test');
    expect(reloaded.readSource()).toContain('Important Content');
    expect(reloaded.tags).toEqual(['test', 'migration']);
  });
});
