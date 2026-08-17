import { resolve, join } from 'path';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { homedir } from 'os';

const APP_NAME = 'publisher';
const IS_WINDOWS = process.platform === 'win32';

function xdgConfig() {
  if (process.env.XDG_CONFIG_HOME) return process.env.XDG_CONFIG_HOME;
  if (IS_WINDOWS) return process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  return join(homedir(), '.config');
}
function xdgData() {
  if (process.env.XDG_DATA_HOME) return process.env.XDG_DATA_HOME;
  if (IS_WINDOWS) return process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  return join(homedir(), '.local', 'share');
}
function xdgCache() {
  if (process.env.XDG_CACHE_HOME) return process.env.XDG_CACHE_HOME;
  if (IS_WINDOWS) return process.env.TEMP || join(homedir(), 'AppData', 'Local', 'Temp');
  return join(homedir(), '.cache');
}

export const paths = {
  // Application source (the git checkout)
  get appRoot() {
    return resolve(import.meta.dirname, '..', '..');
  },
  get builtinThemes() {
    return join(this.appRoot, 'themes', 'builtin');
  },
  get testFixtures() {
    return join(this.appRoot, 'tests', 'fixtures');
  },

  // User configuration (~/.config/publisher/)
  get configDir() {
    return join(xdgConfig(), APP_NAME);
  },
  get configFile() {
    return join(this.configDir, 'config.json');
  },
  get preferencesFile() {
    return join(this.configDir, 'preferences.json');
  },
  get platformsFile() {
    return join(this.configDir, 'platforms.json');
  },
  get secretsFile() {
    return join(this.configDir, 'secrets.env');
  },

  // Persistent user data (~/.local/share/publisher/)
  get dataDir() {
    return join(xdgData(), APP_NAME);
  },
  get userThemes() {
    return join(this.dataDir, 'themes');
  },
  get workspace() {
    return join(this.dataDir, 'workspace');
  },
  get history() {
    return join(this.dataDir, 'history');
  },
  get assets() {
    return join(this.dataDir, 'assets');
  },
  get presets() {
    return join(this.dataDir, 'presets');
  },
  get backups() {
    return join(this.dataDir, 'backups');
  },

  // Cache (~/.cache/publisher/)
  get cacheDir() {
    return join(xdgCache(), APP_NAME);
  },
  get renderedCache() {
    return join(this.cacheDir, 'rendered');
  },
  get imageCache() {
    return join(this.cacheDir, 'images');
  },
};

export function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function ensureUserDirs() {
  const dirs = [
    paths.configDir,
    paths.dataDir,
    paths.userThemes,
    paths.workspace,
    paths.history,
    paths.assets,
    paths.presets,
    paths.backups,
    paths.cacheDir,
    paths.renderedCache,
    paths.imageCache,
  ];
  for (const d of dirs) ensureDir(d);
}

export function getVersionSync() {
  try {
    return JSON.parse(readFileSync(join(paths.appRoot, 'package.json'), 'utf-8')).version;
  } catch {
    return 'unknown';
  }
}

export function getGitCommitSync() {
  try {
    const head = readFileSync(join(paths.appRoot, '.git', 'HEAD'), 'utf-8').trim();
    if (head.startsWith('ref: ')) {
      const ref = head.slice(5);
      return readFileSync(join(paths.appRoot, '.git', ref), 'utf-8').trim().slice(0, 7);
    }
    return head.slice(0, 7);
  } catch {
    return 'unknown';
  }
}
