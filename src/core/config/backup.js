import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, cpSync, statSync } from 'fs';
import { join, basename } from 'path';
import { paths, ensureDir } from '../paths.js';

/**
 * Create a timestamped backup of user config and data.
 * Returns the backup directory path.
 */
export function createBackup(label = '') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dirName = label ? `${timestamp}_${label}` : timestamp;
  const backupDir = join(paths.backups, dirName);
  ensureDir(backupDir);

  // Back up config files
  const configFiles = ['config.json', 'preferences.json', 'platforms.json', 'secrets.env'];
  for (const f of configFiles) {
    const src = join(paths.configDir, f);
    if (existsSync(src)) {
      cpSync(src, join(backupDir, f));
    }
  }

  // Back up user themes (they're small CSS files)
  if (existsSync(paths.userThemes)) {
    const themesBackup = join(backupDir, 'themes');
    ensureDir(themesBackup);
    for (const f of readdirSync(paths.userThemes)) {
      if (f.endsWith('.css')) {
        cpSync(join(paths.userThemes, f), join(themesBackup, f));
      }
    }
  }

  // Back up presets
  if (existsSync(paths.presets)) {
    const presetsBackup = join(backupDir, 'presets');
    ensureDir(presetsBackup);
    for (const f of readdirSync(paths.presets)) {
      cpSync(join(paths.presets, f), join(presetsBackup, f));
    }
  }

  // Write manifest
  const manifest = {
    timestamp: new Date().toISOString(),
    label,
    files: readdirSync(backupDir, { recursive: true }).filter(f => !f.startsWith('.')),
  };
  writeFileSync(join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  return backupDir;
}

/**
 * List all backups with their metadata.
 */
export function listBackups() {
  if (!existsSync(paths.backups)) return [];

  return readdirSync(paths.backups)
    .filter(d => {
      const full = join(paths.backups, d);
      return statSync(full).isDirectory();
    })
    .sort()
    .reverse()
    .map(d => {
      const dir = join(paths.backups, d);
      const manifestPath = join(dir, 'manifest.json');
      let manifest = {};
      if (existsSync(manifestPath)) {
        try { manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')); } catch {}
      }
      return {
        name: d,
        path: dir,
        timestamp: manifest.timestamp || d,
        label: manifest.label || '',
        files: manifest.files || [],
      };
    });
}

/**
 * Restore a backup by name.
 * Restores config files and user themes.
 */
export function restoreBackup(name) {
  const backupDir = join(paths.backups, name);
  if (!existsSync(backupDir)) {
    throw new Error(`Backup not found: ${name}`);
  }

  const restored = [];

  // Restore config files
  const configFiles = ['config.json', 'preferences.json', 'platforms.json', 'secrets.env'];
  for (const f of configFiles) {
    const src = join(backupDir, f);
    if (existsSync(src)) {
      ensureDir(paths.configDir);
      cpSync(src, join(paths.configDir, f));
      restored.push(f);
    }
  }

  // Restore user themes
  const themesBackup = join(backupDir, 'themes');
  if (existsSync(themesBackup)) {
    ensureDir(paths.userThemes);
    for (const f of readdirSync(themesBackup)) {
      if (f.endsWith('.css')) {
        cpSync(join(themesBackup, f), join(paths.userThemes, f));
        restored.push(`themes/${f}`);
      }
    }
  }

  return restored;
}
