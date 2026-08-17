import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { join } from 'path';
import { paths, ensureDir } from '../paths.js';

const CONFIG_VERSION = 1;
const DATA_VERSION = 1;

const DEFAULT_CONFIG = {
  config_version: CONFIG_VERSION,
  default_theme: 'default',
  default_platform: 'wechat',
  output_dir: './dist',
};

const DEFAULT_PREFERENCES = {
  config_version: CONFIG_VERSION,
  editor_font_size: 14,
  editor_tab_size: 2,
  preview_auto_scroll: true,
  dark_editor: true,
};

const DEFAULT_PLATFORMS = {
  config_version: CONFIG_VERSION,
  wechat: {
    enabled: true,
  },
  zhihu: {
    enabled: true,
  },
};

/**
 * Load a JSON config file. Returns parsed content or null if missing.
 */
export function loadConfig(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (e) {
    throw new Error(`Failed to parse config ${filePath}: ${e.message}`);
  }
}

/**
 * Save a JSON config file.
 */
export function saveConfig(filePath, data) {
  ensureDir(join(filePath, '..'));
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * Initialize default config files. Only writes if file doesn't exist.
 * Returns { created: string[], preserved: string[] }.
 */
export function initConfig() {
  const created = [];
  const preserved = [];

  const files = [
    [paths.configFile, DEFAULT_CONFIG],
    [paths.preferencesFile, DEFAULT_PREFERENCES],
    [paths.platformsFile, DEFAULT_PLATFORMS],
  ];

  for (const [filePath, defaults] of files) {
    if (existsSync(filePath)) {
      preserved.push(filePath);
    } else {
      saveConfig(filePath, defaults);
      created.push(filePath);
    }
  }

  // Create empty secrets file if missing
  if (!existsSync(paths.secretsFile)) {
    writeFileSync(paths.secretsFile, '# Publisher secrets - never commit this file\n# WECHAT_APP_ID=\n# WECHAT_APP_SECRET=\n', 'utf-8');
    created.push(paths.secretsFile);
  } else {
    preserved.push(paths.secretsFile);
  }

  return { created, preserved };
}

/**
 * Get merged config (defaults + user overrides).
 * Unknown user keys are preserved.
 */
export function getConfig() {
  const userConfig = loadConfig(paths.configFile);
  if (!userConfig) return { ...DEFAULT_CONFIG };
  // Merge: user values override defaults, unknown keys preserved
  return { ...DEFAULT_CONFIG, ...userConfig, config_version: userConfig.config_version || CONFIG_VERSION };
}

export function getPreferences() {
  const userPrefs = loadConfig(paths.preferencesFile);
  if (!userPrefs) return { ...DEFAULT_PREFERENCES };
  return { ...DEFAULT_PREFERENCES, ...userPrefs, config_version: userPrefs.config_version || CONFIG_VERSION };
}

export function getPlatforms() {
  const userPlats = loadConfig(paths.platformsFile);
  if (!userPlats) return { ...DEFAULT_PLATFORMS };
  return { ...DEFAULT_PLATFORMS, ...userPlats, config_version: userPlats.config_version || CONFIG_VERSION };
}

/**
 * Migrate config to current schema version.
 * Returns { migrated: boolean, fromVersion: number, toVersion: number, changes: string[] }.
 */
export function migrateConfig() {
  const changes = [];
  let migrated = false;

  const config = loadConfig(paths.configFile);
  if (!config) return { migrated: false, fromVersion: 0, toVersion: CONFIG_VERSION, changes: [] };

  const fromVersion = config.config_version || 0;

  if (fromVersion < CONFIG_VERSION) {
    // Run migrations sequentially
    if (fromVersion < 1) {
      // Migration to v1: add missing defaults
      for (const [key, val] of Object.entries(DEFAULT_CONFIG)) {
        if (!(key in config)) {
          config[key] = val;
          changes.push(`Added config key: ${key}`);
        }
      }
    }

    config.config_version = CONFIG_VERSION;
    saveConfig(paths.configFile, config);
    migrated = true;
  }

  // Similarly migrate preferences
  const prefs = loadConfig(paths.preferencesFile);
  if (prefs && (prefs.config_version || 0) < CONFIG_VERSION) {
    for (const [key, val] of Object.entries(DEFAULT_PREFERENCES)) {
      if (!(key in prefs)) {
        prefs[key] = val;
        changes.push(`Added preference: ${key}`);
      }
    }
    prefs.config_version = CONFIG_VERSION;
    saveConfig(paths.preferencesFile, prefs);
    migrated = true;
  }

  return { migrated, fromVersion, toVersion: CONFIG_VERSION, changes };
}

export { CONFIG_VERSION, DATA_VERSION };
