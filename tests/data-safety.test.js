import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, symlinkSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { resolveRoots, isInside } from '../src/core/paths.js';
import {
  Kind, dataModel, classifyPath, isReplaceableByUpdate, isProtected,
  checkUpdateSafety, inventory, compareInventories, protectedEntries, regenerableEntries,
} from '../src/core/data-model.js';
import { legacySources, detectLegacyData, migrateLegacyData } from '../src/core/migrate/data.js';

/**
 * The invariant under test:
 *
 *   Updating MDTeX changes the application, not the user's workspace.
 *
 * A user should be able to accumulate years of articles, LaTeX projects,
 * images, themes and AI configuration while repeatedly updating, without ever
 * backing anything up by hand.
 */

let sandbox;
const savedEnv = {};

function useSandboxRoots() {
  sandbox = mkdtempSync(join(tmpdir(), 'mdtex-safety-'));
  for (const key of ['MDTEX_CONFIG_HOME', 'MDTEX_DATA_HOME', 'MDTEX_CACHE_HOME']) {
    savedEnv[key] = process.env[key];
  }
  process.env.MDTEX_CONFIG_HOME = join(sandbox, 'config');
  process.env.MDTEX_DATA_HOME = join(sandbox, 'data');
  process.env.MDTEX_CACHE_HOME = join(sandbox, 'cache');
  return sandbox;
}

function restoreRoots() {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (sandbox) rmSync(sandbox, { recursive: true, force: true });
  sandbox = null;
}

// ── The five categories ───────────────────────────────────────────────────────

describe('code, built-ins, config, data and cache are separate', () => {
  beforeEach(useSandboxRoots);
  afterEach(restoreRoots);

  it('classifies every location exactly once', () => {
    const model = dataModel();
    expect(model.length).toBeGreaterThan(0);
    for (const entry of model) {
      expect(Object.values(Kind)).toContain(entry.kind);
      expect(classifyPath(entry.path).id).toBe(entry.id);
    }
  });

  it('lets an update replace application code and built-in resources', () => {
    for (const id of ['app-root', 'builtin-themes']) {
      const entry = dataModel().find(e => e.id === id);
      expect(isReplaceableByUpdate(entry.path)).toBe(true);
      expect(isProtected(entry.path)).toBe(false);
    }
  });

  it('never lets an update replace user data or configuration', () => {
    const mustSurvive = [
      'workspace', 'user-themes', 'snippets', 'presets', 'history', 'assets', 'backups', 'config',
    ];
    for (const id of mustSurvive) {
      const entry = dataModel().find(e => e.id === id);
      expect(entry, `${id} is missing from the data model`).toBeTruthy();
      expect(isProtected(entry.path), `${id} must be protected`).toBe(true);
      expect(isReplaceableByUpdate(entry.path), `${id} must not be replaceable`).toBe(false);
    }
  });

  it('classifies built-in themes as built-in, not as part of the workspace', () => {
    const builtin = dataModel().find(e => e.id === 'builtin-themes');
    // The entry order matters: builtin/ lives inside appRoot.
    expect(classifyPath(builtin.path).kind).toBe(Kind.BUILTIN);
    expect(classifyPath(join(builtin.path, 'default.css')).kind).toBe(Kind.BUILTIN);
  });

  it('marks only cache and built-ins as regenerable', () => {
    const ids = regenerableEntries().map(e => e.id).sort();
    expect(ids).toEqual(['app-root', 'builtin-themes', 'cache']);

    // Explicitly: none of these may ever be treated as a cache.
    for (const id of ['workspace', 'user-themes', 'snippets', 'presets', 'config', 'assets']) {
      expect(dataModel().find(e => e.id === id).regenerable).toBe(false);
    }
  });

  it('stores no user data inside the application directory', () => {
    const { safe, violations } = checkUpdateSafety();
    expect(violations).toEqual([]);
    expect(safe).toBe(true);
  });

  it('refuses to update when the workspace is inside the checkout', () => {
    const appRoot = dataModel().find(e => e.id === 'app-root').path;
    const { safe, violations } = checkUpdateSafety({ workspaceRoot: join(appRoot, 'workspace') });
    expect(safe).toBe(false);
    expect(violations[0].container.id).toBe('app-root');
  });
});

// ── The same logical model on every platform ─────────────────────────────────

describe('Windows and Linux share one logical model', () => {
  const windows = () => resolveRoots(
    { LOCALAPPDATA: 'C:\\Users\\Zhang Wei\\AppData\\Local' },
    'win32',
    'C:\\Users\\Zhang Wei',
  );
  const linux = () => resolveRoots({}, 'linux', '/home/user');

  it('gives three distinct roots on both platforms', () => {
    for (const roots of [windows(), linux()]) {
      const distinct = new Set([roots.config, roots.data, roots.cache]);
      expect(distinct.size).toBe(3);
    }
  });

  it('keeps configuration and data apart on Windows', () => {
    // These used to be the same directory: %LOCALAPPDATA%\publisher held
    // config.json next to workspace/, a distinction Linux had and Windows did not.
    const roots = windows();
    expect(roots.config).not.toBe(roots.data);
    expect(roots.config).toBe('C:\\Users\\Zhang Wei\\AppData\\Local\\MDTeX\\config');
    expect(roots.data).toBe('C:\\Users\\Zhang Wei\\AppData\\Local\\MDTeX\\data');
  });

  it('keeps the Windows cache out of %TEMP%', () => {
    // %TEMP% is emptied by cleanup tools, including while the app is running.
    const roots = resolveRoots(
      { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', TEMP: 'C:\\Users\\u\\AppData\\Local\\Temp' },
      'win32',
      'C:\\Users\\u',
    );
    expect(roots.cache).not.toContain('Temp');
    expect(roots.cache).toContain('MDTeX');
  });

  it('uses XDG locations on Linux', () => {
    const roots = resolveRoots(
      { XDG_CONFIG_HOME: '/x/config', XDG_DATA_HOME: '/x/data', XDG_CACHE_HOME: '/x/cache' },
      'linux',
      '/home/user',
    );
    expect(roots.config).toBe('/x/config/publisher');
    expect(roots.data).toBe('/x/data/publisher');
    expect(roots.cache).toBe('/x/cache/publisher');
  });

  it('honours an explicit override on either platform', () => {
    const env = { MDTEX_DATA_HOME: '/somewhere/else', LOCALAPPDATA: 'C:\\L' };
    expect(resolveRoots(env, 'win32', 'C:\\u').data).toBe('/somewhere/else');
    expect(resolveRoots(env, 'linux', '/home/u').data).toBe('/somewhere/else');
  });
});

// ── Migration out of legacy locations ────────────────────────────────────────

describe('legacy data migrates without being destroyed', () => {
  let root;
  let appRoot;
  let dataHome;
  let env;

  const options = () => ({ env, platform: 'linux', home: root, appRoot });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mdtex-legacy-'));
    appRoot = join(root, 'checkout');
    dataHome = join(root, 'data');
    env = { MDTEX_DATA_HOME: dataHome, MDTEX_CONFIG_HOME: join(root, 'config') };

    // An old installation: articles and a customised theme in the checkout.
    mkdirSync(join(appRoot, 'workspace', '论文', 'my article', 'assets'), { recursive: true });
    writeFileSync(join(appRoot, 'workspace', '论文', 'my article', 'source.md'), '# Years of work\n');
    writeFileSync(
      join(appRoot, 'workspace', '论文', 'my article', 'article.json'),
      JSON.stringify({ id: 'stable-id-123', tags: ['probability'], series: 'Notes' }),
    );
    writeFileSync(join(appRoot, 'workspace', '论文', 'my article', 'assets', '图 1.png'), 'PNG');
    mkdirSync(join(appRoot, 'themes', 'builtin'), { recursive: true });
    writeFileSync(join(appRoot, 'themes', 'default.css'), '/* my customised default */');
    writeFileSync(join(appRoot, 'themes', 'builtin', 'default.css'), '/* shipped */');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('detects data in the application directory', () => {
    const detected = detectLegacyData(options()).map(s => s.id);
    expect(detected).toContain('app-relative-workspace');
    expect(detected).toContain('app-relative-themes');
  });

  it('preserves content, identity, metadata, nesting and Unicode names', () => {
    migrateLegacyData(options());
    const article = join(dataHome, 'workspace', '论文', 'my article');

    expect(readFileSync(join(article, 'source.md'), 'utf-8')).toBe('# Years of work\n');

    const meta = JSON.parse(readFileSync(join(article, 'article.json'), 'utf-8'));
    expect(meta.id).toBe('stable-id-123');
    expect(meta.tags).toEqual(['probability']);
    expect(meta.series).toBe('Notes');

    expect(existsSync(join(article, 'assets', '图 1.png'))).toBe(true);
  });

  it('leaves the original in place', () => {
    migrateLegacyData(options());
    expect(existsSync(join(appRoot, 'workspace', '论文', 'my article', 'source.md'))).toBe(true);
    expect(existsSync(join(appRoot, 'themes', 'default.css'))).toBe(true);
  });

  it('records where the data came from', () => {
    migrateLegacyData(options());
    const marker = JSON.parse(readFileSync(join(dataHome, 'workspace', 'migrated-from.json'), 'utf-8'));
    expect(marker.migrations[0].from).toBe(join(appRoot, 'workspace'));
    expect(marker.migrations[0].copied).toBeGreaterThan(0);
  });

  it('migrates user themes but not built-in ones', () => {
    migrateLegacyData(options());
    expect(readFileSync(join(dataHome, 'themes', 'default.css'), 'utf-8')).toBe('/* my customised default */');
    expect(existsSync(join(dataHome, 'themes', 'builtin'))).toBe(false);
  });

  it('is idempotent: running it again copies nothing', () => {
    const first = migrateLegacyData(options());
    const copiedFirst = first.sources.reduce((n, s) => n + s.copied, 0);
    expect(copiedFirst).toBeGreaterThan(0);

    const second = migrateLegacyData(options());
    expect(second.sources.reduce((n, s) => n + s.copied, 0)).toBe(0);
    expect(second.sources.reduce((n, s) => n + s.skipped, 0)).toBe(copiedFirst);
  });

  it('never discards a conflicting file', () => {
    migrateLegacyData(options());
    // The user edits the copy in the old location differently.
    writeFileSync(join(appRoot, 'themes', 'default.css'), '/* a different customisation */');
    const result = migrateLegacyData(options());

    // The destination keeps its content...
    expect(readFileSync(join(dataHome, 'themes', 'default.css'), 'utf-8'))
      .toBe('/* my customised default */');
    // ...and the conflicting version is kept alongside, not dropped.
    const conflicts = result.sources.flatMap(s => s.conflicts);
    expect(conflicts).toHaveLength(1);
    expect(readFileSync(conflicts[0].savedAs, 'utf-8')).toBe('/* a different customisation */');
  });

  it('does not follow symlinks out of the legacy root', () => {
    const outside = join(root, 'outside');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'secret.md'), 'not part of the workspace');
    try {
      symlinkSync(outside, join(appRoot, 'workspace', 'linked'), 'dir');
    } catch {
      return; // symlinks unavailable on this filesystem
    }

    migrateLegacyData(options());
    expect(existsSync(join(dataHome, 'workspace', 'linked', 'secret.md'))).toBe(false);
  });

  it('maps the pre-split Windows layout onto the new one', () => {
    const winEnv = { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' };
    const sources = legacySources({ env: winEnv, platform: 'win32', home: 'C:\\Users\\u', appRoot: 'C:\\app' });
    const byId = Object.fromEntries(sources.map(s => [s.id, s]));

    expect(byId['windows-legacy-config'].from).toBe('C:\\Users\\u\\AppData\\Local\\publisher');
    expect(byId['windows-legacy-config'].to).toBe('C:\\Users\\u\\AppData\\Local\\MDTeX\\config');
    expect(byId['windows-legacy-workspace'].from).toBe('C:\\Users\\u\\AppData\\Local\\publisher\\workspace');
    expect(byId['windows-legacy-workspace'].to).toBe('C:\\Users\\u\\AppData\\Local\\MDTeX\\data\\workspace');
  });
});

// ── Proving data survived ────────────────────────────────────────────────────

describe('an update can prove the workspace survived', () => {
  beforeEach(useSandboxRoots);
  afterEach(restoreRoots);

  it('counts what is there', () => {
    const workspace = join(process.env.MDTEX_DATA_HOME, 'workspace', 'a');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, 'source.md'), 'hello');

    const census = inventory();
    expect(census.entries.workspace.files).toBe(1);
    expect(census.entries.workspace.bytes).toBe(5);
  });

  it('reports an unchanged workspace as intact', () => {
    const workspace = join(process.env.MDTEX_DATA_HOME, 'workspace', 'a');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, 'source.md'), 'hello');

    const before = inventory();
    const after = inventory();
    expect(compareInventories(before, after).intact).toBe(true);
  });

  it('detects a deleted article', () => {
    const workspace = join(process.env.MDTEX_DATA_HOME, 'workspace', 'a');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, 'source.md'), 'hello');

    const before = inventory();
    rmSync(join(workspace, 'source.md'));
    const comparison = compareInventories(before, inventory());

    expect(comparison.intact).toBe(false);
    expect(comparison.losses[0].id).toBe('workspace');
  });

  it('treats added articles as fine', () => {
    const workspace = join(process.env.MDTEX_DATA_HOME, 'workspace', 'a');
    mkdirSync(workspace, { recursive: true });
    const before = inventory();
    writeFileSync(join(workspace, 'new.md'), 'written after the update');
    expect(compareInventories(before, inventory()).intact).toBe(true);
  });
});

// ── Configuration is merged, never replaced ──────────────────────────────────

describe('updating defaults preserves user configuration', () => {
  beforeEach(useSandboxRoots);
  afterEach(restoreRoots);

  it('keeps changed values and unknown keys through a migration', async () => {
    const { ensureUserDirs, paths } = await import('../src/core/paths.js');
    const { initConfig, migrateConfig, loadConfig, saveConfig } = await import('../src/core/config/index.js');

    ensureUserDirs();
    initConfig();

    const config = loadConfig(paths.configFile);
    config.default_theme = 'my-custom-theme';       // a changed default
    config.my_own_setting = { deeply: ['nested'] }; // a key MDTeX knows nothing about
    delete config.config_version;                   // an old file, pre-versioning
    saveConfig(paths.configFile, config);

    migrateConfig();

    const after = loadConfig(paths.configFile);
    expect(after.default_theme).toBe('my-custom-theme');
    expect(after.my_own_setting).toEqual({ deeply: ['nested'] });
    expect(after.config_version).toBeGreaterThan(0);
  });

  it('preserves an existing config when init runs again', async () => {
    const { ensureUserDirs, paths } = await import('../src/core/paths.js');
    const { initConfig, loadConfig, saveConfig } = await import('../src/core/config/index.js');

    ensureUserDirs();
    initConfig();
    const config = loadConfig(paths.configFile);
    config.default_platform = 'zhihu';
    saveConfig(paths.configFile, config);

    const { created, preserved } = initConfig();
    expect(created).toHaveLength(0);
    expect(preserved).toContain(paths.configFile);
    expect(loadConfig(paths.configFile).default_platform).toBe('zhihu');
  });

  it('never overwrites an existing secrets file', async () => {
    const { ensureUserDirs, paths } = await import('../src/core/paths.js');
    const { initConfig } = await import('../src/core/config/index.js');

    ensureUserDirs();
    writeFileSync(paths.secretsFile, 'ANTHROPIC_API_KEY=sk-do-not-lose-me\n', 'utf-8');
    initConfig();
    expect(readFileSync(paths.secretsFile, 'utf-8')).toContain('sk-do-not-lose-me');
  });
});

// ── User themes shadow built-ins ─────────────────────────────────────────────

describe('user themes are separate from built-in themes', () => {
  beforeEach(useSandboxRoots);
  afterEach(restoreRoots);

  it('resolves a user theme in preference to the built-in of the same name', async () => {
    const { paths, ensureUserDirs } = await import('../src/core/paths.js');
    const { loadTheme } = await import('../src/core/themes/index.js');

    ensureUserDirs();
    writeFileSync(join(paths.userThemes, 'default.css'), '/* mine */', 'utf-8');

    const theme = loadTheme('default');
    expect(theme.isUser).toBe(true);
    expect(theme.css).toBe('/* mine */');
    // Replacing the built-in file cannot reach this: it is in a different root.
    expect(isInside(paths.builtinThemes, theme.path)).toBe(false);
  });

  it('keeps user themes outside every directory an update replaces', async () => {
    const { paths } = await import('../src/core/paths.js');
    expect(isInside(paths.appRoot, paths.userThemes)).toBe(false);
    expect(isInside(paths.builtinThemes, paths.userThemes)).toBe(false);
  });
});

// ── Idempotency ──────────────────────────────────────────────────────────────

describe('install, init and update are idempotent', () => {
  beforeEach(useSandboxRoots);
  afterEach(restoreRoots);

  it('creating the user directories twice changes nothing', async () => {
    const { ensureUserDirs, paths } = await import('../src/core/paths.js');

    ensureUserDirs();
    const article = join(paths.workspace, 'existing');
    mkdirSync(article, { recursive: true });
    writeFileSync(join(article, 'source.md'), '# already here');

    const before = inventory();
    ensureUserDirs();
    ensureUserDirs();

    expect(compareInventories(before, inventory()).intact).toBe(true);
    expect(readFileSync(join(article, 'source.md'), 'utf-8')).toBe('# already here');
    expect(readdirSync(paths.workspace)).toContain('existing');
  });
});

// ── Article metadata ─────────────────────────────────────────────────────────

describe('article metadata survives being loaded and saved', () => {
  beforeEach(useSandboxRoots);
  afterEach(restoreRoots);

  it('keeps fields this version does not know about', async () => {
    const { ensureUserDirs, paths } = await import('../src/core/paths.js');
    const { ArticleLibrary } = await import('../src/workspace/library.js');

    ensureUserDirs();
    const library = new ArticleLibrary(paths.workspace);
    const article = library.create({ title: 'Forward Compatible' });

    // A field written by a newer MDTeX, or by the user directly.
    const meta = JSON.parse(readFileSync(article.metaPath, 'utf-8'));
    meta.futureField = { added: 'by a later version' };
    meta.myOwnAnnotation = 'keep me';
    writeFileSync(article.metaPath, JSON.stringify(meta, null, 2));

    // Load it and make an ordinary edit.
    const reloaded = new ArticleLibrary(paths.workspace).listAll()[0].article;
    reloaded.applyMetadata({ title: 'Renamed' });

    const saved = JSON.parse(readFileSync(reloaded.metaPath, 'utf-8'));
    expect(saved.title).toBe('Renamed');
    expect(saved.futureField).toEqual({ added: 'by a later version' });
    expect(saved.myOwnAnnotation).toBe('keep me');
  });

  it('never lets an edit change identity', async () => {
    const { ensureUserDirs, paths } = await import('../src/core/paths.js');
    const { ArticleLibrary } = await import('../src/workspace/library.js');

    ensureUserDirs();
    const library = new ArticleLibrary(paths.workspace);
    const article = library.create({ title: 'Stable' });
    const { id, createdAt } = article;

    article.applyMetadata({ id: 'hijacked', createdAt: '1999-01-01', title: 'Renamed' });

    expect(article.id).toBe(id);
    expect(article.createdAt).toBe(createdAt);
    expect(article.title).toBe('Renamed');
  });
});
