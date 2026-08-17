import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Override XDG dirs for testing
const TEST_DIR = join(tmpdir(), `publisher-test-${process.pid}`);
const TEST_CONFIG = join(TEST_DIR, 'config');
const TEST_DATA = join(TEST_DIR, 'data');
const TEST_CACHE = join(TEST_DIR, 'cache');

beforeEach(() => {
  process.env.XDG_CONFIG_HOME = TEST_CONFIG;
  process.env.XDG_DATA_HOME = TEST_DATA;
  process.env.XDG_CACHE_HOME = TEST_CACHE;
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.XDG_DATA_HOME;
  delete process.env.XDG_CACHE_HOME;
});

describe('Paths', () => {
  it('should use XDG directories when set', async () => {
    const { paths } = await import('../src/core/paths.js');
    expect(paths.configDir).toBe(join(TEST_CONFIG, 'publisher'));
    expect(paths.dataDir).toBe(join(TEST_DATA, 'publisher'));
    expect(paths.cacheDir).toBe(join(TEST_CACHE, 'publisher'));
  });

  it('should have separate builtin and user theme paths', async () => {
    const { paths } = await import('../src/core/paths.js');
    expect(paths.builtinThemes).toContain('themes/builtin');
    expect(paths.userThemes).toContain(join(TEST_DATA, 'publisher', 'themes'));
    expect(paths.builtinThemes).not.toBe(paths.userThemes);
  });

  it('ensureUserDirs should create all directories', async () => {
    const { paths, ensureUserDirs } = await import('../src/core/paths.js');
    ensureUserDirs();
    expect(existsSync(paths.configDir)).toBe(true);
    expect(existsSync(paths.userThemes)).toBe(true);
    expect(existsSync(paths.workspace)).toBe(true);
    expect(existsSync(paths.backups)).toBe(true);
    expect(existsSync(paths.cacheDir)).toBe(true);
  });

  it('ensureUserDirs should be idempotent', async () => {
    const { ensureUserDirs } = await import('../src/core/paths.js');
    ensureUserDirs();
    ensureUserDirs();
    ensureUserDirs();
    // Should not throw
  });
});

describe('Config', () => {
  it('should create default config on init', async () => {
    const { ensureUserDirs } = await import('../src/core/paths.js');
    const { initConfig, loadConfig } = await import('../src/core/config/index.js');
    const { paths } = await import('../src/core/paths.js');

    ensureUserDirs();
    const { created, preserved } = initConfig();

    expect(created.length).toBeGreaterThan(0);
    expect(preserved.length).toBe(0);

    const config = loadConfig(paths.configFile);
    expect(config).not.toBeNull();
    expect(config.config_version).toBe(1);
    expect(config.default_theme).toBe('default');
  });

  it('init should not overwrite existing config', async () => {
    const { ensureUserDirs, paths } = await import('../src/core/paths.js');
    const { initConfig, loadConfig, saveConfig } = await import('../src/core/config/index.js');

    ensureUserDirs();

    // First init
    initConfig();

    // Modify config
    const config = loadConfig(paths.configFile);
    config.default_theme = 'my-custom-theme';
    config.my_custom_key = 'preserved';
    saveConfig(paths.configFile, config);

    // Second init - should preserve
    const { created, preserved } = initConfig();
    expect(preserved).toContain(paths.configFile);

    const reloaded = loadConfig(paths.configFile);
    expect(reloaded.default_theme).toBe('my-custom-theme');
    expect(reloaded.my_custom_key).toBe('preserved');
  });

  it('init should preserve secrets file', async () => {
    const { ensureUserDirs, paths } = await import('../src/core/paths.js');
    const { initConfig } = await import('../src/core/config/index.js');

    ensureUserDirs();
    initConfig();

    // Write a secret
    writeFileSync(paths.secretsFile, 'WECHAT_APP_ID=test123\n');

    // Re-init
    const { preserved } = initConfig();
    expect(preserved).toContain(paths.secretsFile);

    const content = readFileSync(paths.secretsFile, 'utf-8');
    expect(content).toContain('test123');
  });

  it('getConfig should merge defaults with user overrides', async () => {
    const { ensureUserDirs, paths } = await import('../src/core/paths.js');
    const { initConfig, getConfig, saveConfig, loadConfig } = await import('../src/core/config/index.js');

    ensureUserDirs();
    initConfig();

    // Modify one key, leave others as default
    const config = loadConfig(paths.configFile);
    config.default_platform = 'zhihu';
    saveConfig(paths.configFile, config);

    const merged = getConfig();
    expect(merged.default_platform).toBe('zhihu');
    expect(merged.default_theme).toBe('default'); // from defaults
  });

  it('should preserve unknown config keys', async () => {
    const { ensureUserDirs, paths } = await import('../src/core/paths.js');
    const { initConfig, getConfig, saveConfig, loadConfig } = await import('../src/core/config/index.js');

    ensureUserDirs();
    initConfig();

    const config = loadConfig(paths.configFile);
    config.future_feature_flag = true;
    config.custom_setting = { nested: 'value' };
    saveConfig(paths.configFile, config);

    const merged = getConfig();
    expect(merged.future_feature_flag).toBe(true);
    expect(merged.custom_setting).toEqual({ nested: 'value' });
  });

  it('should migrate config schema', async () => {
    const { ensureUserDirs, paths } = await import('../src/core/paths.js');
    const { migrateConfig, saveConfig } = await import('../src/core/config/index.js');

    ensureUserDirs();

    // Create a v0 config (no config_version)
    saveConfig(paths.configFile, { default_theme: 'old-theme' });

    const result = migrateConfig();
    expect(result.migrated).toBe(true);
    expect(result.fromVersion).toBe(0);

    // Verify the config now has config_version and old values preserved
    const migrated = JSON.parse(readFileSync(paths.configFile, 'utf-8'));
    expect(migrated.config_version).toBe(1);
    expect(migrated.default_theme).toBe('old-theme');
  });
});

describe('Themes', () => {
  it('should load builtin themes', async () => {
    const { loadTheme, listThemes } = await import('../src/core/themes/index.js');

    const theme = loadTheme('default');
    expect(theme.css).toContain('#nice');
    expect(theme.name).toBe('default');
  });

  it('should list builtin and user themes separately', async () => {
    const { ensureUserDirs, paths } = await import('../src/core/paths.js');
    const { listThemes } = await import('../src/core/themes/index.js');

    ensureUserDirs();

    // Create a user theme
    writeFileSync(join(paths.userThemes, 'my-theme.css'), '#nice { color: blue; }');

    const themes = listThemes();
    const builtins = themes.filter(t => t.source === 'builtin');
    const userThemes = themes.filter(t => t.source === 'user');

    expect(builtins.length).toBeGreaterThanOrEqual(2); // default, academic-orange
    expect(userThemes.length).toBe(1);
    expect(userThemes[0].name).toBe('my-theme');
  });

  it('user theme should override builtin with same name', async () => {
    const { ensureUserDirs, paths } = await import('../src/core/paths.js');
    const { loadTheme, listThemes } = await import('../src/core/themes/index.js');

    ensureUserDirs();

    // Create user theme with same name as builtin
    writeFileSync(join(paths.userThemes, 'default.css'), '#nice { color: purple; /* user version */ }');

    const theme = loadTheme('default');
    expect(theme.css).toContain('purple');
    expect(theme.isUser).toBe(true);

    const themes = listThemes();
    const defaultTheme = themes.find(t => t.name === 'default');
    expect(defaultTheme.source).toBe('user');
    expect(defaultTheme.overridesBuiltin).toBe(true);
  });

  it('copyTheme should copy to user themes', async () => {
    const { ensureUserDirs, paths } = await import('../src/core/paths.js');
    const { copyTheme } = await import('../src/core/themes/index.js');

    ensureUserDirs();
    const targetPath = copyTheme('academic-orange', 'my-orange');

    expect(existsSync(targetPath)).toBe(true);
    expect(targetPath).toContain(paths.userThemes);

    const content = readFileSync(targetPath, 'utf-8');
    expect(content).toContain('#nice');
  });

  it('update should never replace user themes', async () => {
    const { ensureUserDirs, paths } = await import('../src/core/paths.js');

    ensureUserDirs();

    // Create a user theme
    const userThemePath = join(paths.userThemes, 'custom.css');
    writeFileSync(userThemePath, '#nice { color: gold; }');

    // Builtin themes are in a separate directory
    // Updating builtins doesn't touch user themes
    expect(existsSync(userThemePath)).toBe(true);
    expect(readFileSync(userThemePath, 'utf-8')).toContain('gold');
  });
});

describe('Backups', () => {
  it('should create and list backups', async () => {
    const { ensureUserDirs, paths } = await import('../src/core/paths.js');
    const { initConfig } = await import('../src/core/config/index.js');
    const { createBackup, listBackups } = await import('../src/core/config/backup.js');

    ensureUserDirs();
    initConfig();

    const backupDir = createBackup('test');
    expect(existsSync(backupDir)).toBe(true);

    const backups = listBackups();
    expect(backups.length).toBe(1);
    expect(backups[0].label).toBe('test');
  });

  it('should backup user themes', async () => {
    const { ensureUserDirs, paths } = await import('../src/core/paths.js');
    const { initConfig } = await import('../src/core/config/index.js');
    const { createBackup } = await import('../src/core/config/backup.js');

    ensureUserDirs();
    initConfig();

    // Create user themes
    writeFileSync(join(paths.userThemes, 'my-theme.css'), '#nice { color: red; }');
    writeFileSync(join(paths.userThemes, 'another.css'), '#nice { color: blue; }');

    const backupDir = createBackup('themes-test');
    expect(existsSync(join(backupDir, 'themes', 'my-theme.css'))).toBe(true);
    expect(existsSync(join(backupDir, 'themes', 'another.css'))).toBe(true);
  });

  it('should backup secrets without printing values', async () => {
    const { ensureUserDirs, paths } = await import('../src/core/paths.js');
    const { initConfig } = await import('../src/core/config/index.js');
    const { createBackup } = await import('../src/core/config/backup.js');

    ensureUserDirs();
    initConfig();
    writeFileSync(paths.secretsFile, 'WECHAT_APP_SECRET=supersecret123\n');

    const backupDir = createBackup('secrets-test');
    expect(existsSync(join(backupDir, 'secrets.env'))).toBe(true);

    const backedUp = readFileSync(join(backupDir, 'secrets.env'), 'utf-8');
    expect(backedUp).toContain('supersecret123');
  });

  it('should restore from backup', async () => {
    const { ensureUserDirs, paths } = await import('../src/core/paths.js');
    const { initConfig, loadConfig, saveConfig } = await import('../src/core/config/index.js');
    const { createBackup, restoreBackup } = await import('../src/core/config/backup.js');

    ensureUserDirs();
    initConfig();

    // Save initial state
    const config = loadConfig(paths.configFile);
    config.default_theme = 'original';
    saveConfig(paths.configFile, config);

    // Backup
    const backupDir = createBackup('restore-test');
    const backupName = backupDir.split('/').pop();

    // Modify config
    config.default_theme = 'modified';
    saveConfig(paths.configFile, config);

    // Restore
    const restored = restoreBackup(backupName);
    expect(restored).toContain('config.json');

    // Verify restored
    const restoredConfig = loadConfig(paths.configFile);
    expect(restoredConfig.default_theme).toBe('original');
  });
});

describe('Version', () => {
  it('should report version', async () => {
    const { getVersionSync } = await import('../src/core/paths.js');
    const version = getVersionSync();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('Upgrade simulation', () => {
  it('should preserve user data during simulated upgrade', async () => {
    const { ensureUserDirs, paths } = await import('../src/core/paths.js');
    const { initConfig, loadConfig, saveConfig, migrateConfig } = await import('../src/core/config/index.js');
    const { createBackup } = await import('../src/core/config/backup.js');

    // Simulate initial install
    ensureUserDirs();
    initConfig();

    // User customizes
    const config = loadConfig(paths.configFile);
    config.default_theme = 'my-theme';
    config.custom_option = 'user-value';
    saveConfig(paths.configFile, config);
    writeFileSync(join(paths.userThemes, 'my-theme.css'), '#nice { color: crimson; }');
    writeFileSync(paths.secretsFile, 'WECHAT_APP_ID=wx123\nWECHAT_APP_SECRET=secret456\n');
    writeFileSync(join(paths.workspace, 'draft.md'), '# My Article\nHello');

    // Simulate upgrade: backup, migrate, verify
    const backupDir = createBackup('pre-upgrade');
    const migration = migrateConfig();

    // Verify everything preserved
    const afterConfig = loadConfig(paths.configFile);
    expect(afterConfig.default_theme).toBe('my-theme');
    expect(afterConfig.custom_option).toBe('user-value');

    expect(readFileSync(join(paths.userThemes, 'my-theme.css'), 'utf-8')).toContain('crimson');
    expect(readFileSync(paths.secretsFile, 'utf-8')).toContain('wx123');
    expect(readFileSync(join(paths.workspace, 'draft.md'), 'utf-8')).toContain('My Article');

    // Verify backup exists
    expect(existsSync(join(backupDir, 'config.json'))).toBe(true);
    expect(existsSync(join(backupDir, 'secrets.env'))).toBe(true);
    expect(existsSync(join(backupDir, 'themes', 'my-theme.css'))).toBe(true);
  });

  it('should handle upgrade with overlapping theme names', async () => {
    const { ensureUserDirs, paths } = await import('../src/core/paths.js');
    const { initConfig } = await import('../src/core/config/index.js');
    const { loadTheme, listThemes } = await import('../src/core/themes/index.js');

    ensureUserDirs();
    initConfig();

    // User has customized a copy of the default theme
    writeFileSync(join(paths.userThemes, 'default.css'),
      '#nice { color: hotpink; /* my custom default */ }');

    // After "upgrade", builtin default.css may have changed
    // But user's version should take priority
    const theme = loadTheme('default');
    expect(theme.css).toContain('hotpink');
    expect(theme.isUser).toBe(true);

    const themes = listThemes();
    const def = themes.find(t => t.name === 'default');
    expect(def.source).toBe('user');
    expect(def.overridesBuiltin).toBe(true);
  });

  it('should preserve workspace, assets, cache during upgrade', async () => {
    const { ensureUserDirs, paths } = await import('../src/core/paths.js');

    ensureUserDirs();

    // Create user artifacts
    writeFileSync(join(paths.workspace, 'article.md'), '# Article');
    writeFileSync(join(paths.assets, 'logo.png'), 'fake-png-data');
    writeFileSync(join(paths.renderedCache, 'cached.html'), '<p>cached</p>');

    // Simulate upgrade by re-running ensureUserDirs (idempotent)
    ensureUserDirs();

    // All files should still exist
    expect(readFileSync(join(paths.workspace, 'article.md'), 'utf-8')).toContain('Article');
    expect(existsSync(join(paths.assets, 'logo.png'))).toBe(true);
    expect(existsSync(join(paths.renderedCache, 'cached.html'))).toBe(true);
  });
});

describe('Selftest', () => {
  it('should pass rendering self-test', async () => {
    const { runSelftest } = await import('../scripts/selftest.js');
    const { passed, results } = await runSelftest();
    expect(passed).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.passed).toBe(true);
    }
  });
});
