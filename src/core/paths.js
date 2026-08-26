import { resolve, join, relative, isAbsolute, sep, win32 as pathWin32, posix as pathPosix } from 'path';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { homedir } from 'os';

/**
 * Where everything lives.
 *
 * Five categories, kept in separate roots so that updating the application can
 * never reach the user's work:
 *
 *   application   the git checkout — src/, dist/, node_modules/. Replaced by updates.
 *   built-in      themes and templates shipped with the app. Replaced by updates.
 *   config        user configuration and secrets. Never replaced; merged.
 *   data          articles, assets, user themes, history. Never touched.
 *   cache         regenerable. Safe to delete at any time.
 *
 * The logical model is identical on every platform: a config root, a data root
 * and a cache root, each with the same contents. Only the physical location of
 * those three roots differs, which is what the platform conventions dictate.
 *
 *   Linux/macOS   ~/.config/publisher   ~/.local/share/publisher   ~/.cache/publisher
 *   Windows       %LOCALAPPDATA%\MDTeX\config  …\data  …\cache
 *
 * See `src/core/data-model.js` for the machine-readable classification, and
 * `src/core/migrate/data.js` for movement out of legacy locations.
 */

const APP_NAME = 'publisher';
const WINDOWS_APP_DIR = 'MDTeX';

/**
 * Resolve the three roots.
 *
 * `env` and `platform` are parameters rather than direct `process` reads so the
 * Windows layout can be tested from Linux — a layout nobody can verify by
 * running it here is a layout that breaks silently.
 */
export function resolveRoots(env = process.env, platform = process.platform, home = homedir()) {
  const isWindows = platform === 'win32';
  // Join with the *target* platform's rules, not the running one. On Windows
  // this is exactly `join`; on Linux it makes the Windows layout testable
  // rather than something that can only be checked by shipping it.
  const join = isWindows ? pathWin32.join : pathPosix.join;

  // An explicit override always wins, on every platform, and names the app's
  // own directory rather than its parent.
  const explicit = {
    config: env.MDTEX_CONFIG_HOME || null,
    data: env.MDTEX_DATA_HOME || null,
    cache: env.MDTEX_CACHE_HOME || null,
  };

  if (isWindows) {
    // One root with three children. %LOCALAPPDATA%\publisher used to hold
    // config files and user data side by side, which made "config" and "data"
    // the same directory — a distinction Linux had and Windows did not.
    const base = env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    const root = join(base, WINDOWS_APP_DIR);
    return {
      config: explicit.config || join(root, 'config'),
      data: explicit.data || join(root, 'data'),
      // Deliberately not %TEMP%: cleanup tools empty it while the app is running.
      cache: explicit.cache || join(root, 'cache'),
      windowsRoot: root,
    };
  }

  const xdg = (varName, fallback) => env[varName] || join(home, ...fallback);
  return {
    config: explicit.config || join(xdg('XDG_CONFIG_HOME', ['.config']), APP_NAME),
    data: explicit.data || join(xdg('XDG_DATA_HOME', ['.local', 'share']), APP_NAME),
    cache: explicit.cache || join(xdg('XDG_CACHE_HOME', ['.cache']), APP_NAME),
    windowsRoot: null,
  };
}

export const paths = {
  // ── Application code (the git checkout) — replaced by updates ──────────────
  get appRoot() {
    return resolve(import.meta.dirname, '..', '..');
  },
  get builtinThemes() {
    return join(this.appRoot, 'themes', 'builtin');
  },
  get testFixtures() {
    return join(this.appRoot, 'tests', 'fixtures');
  },

  // ── Roots ─────────────────────────────────────────────────────────────────
  get configDir() { return resolveRoots().config; },
  get dataDir() { return resolveRoots().data; },
  get cacheDir() { return resolveRoots().cache; },

  // ── User configuration — merged on update, never replaced ─────────────────
  get configFile() { return join(this.configDir, 'config.json'); },
  get preferencesFile() { return join(this.configDir, 'preferences.json'); },
  get platformsFile() { return join(this.configDir, 'platforms.json'); },
  get secretsFile() { return join(this.configDir, 'secrets.env'); },
  get aiProfilesFile() { return join(this.configDir, 'ai.json'); },

  // ── Persistent user data — never touched by an update ─────────────────────
  get userThemes() { return join(this.dataDir, 'themes'); },
  get workspace() { return join(this.dataDir, 'workspace'); },
  get history() { return join(this.dataDir, 'history'); },
  get assets() { return join(this.dataDir, 'assets'); },
  get presets() { return join(this.dataDir, 'presets'); },
  get snippets() { return join(this.dataDir, 'snippets'); },
  get backups() { return join(this.dataDir, 'backups'); },

  // ── Cache — regenerable ───────────────────────────────────────────────────
  get renderedCache() { return join(this.cacheDir, 'rendered'); },
  get imageCache() { return join(this.cacheDir, 'images'); },
};

export function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Create the user directories that are missing.
 *
 * Idempotent by construction: it only ever creates, so running install, init or
 * update again on a populated installation is a no-op.
 */
export function ensureUserDirs() {
  const dirs = [
    paths.configDir,
    paths.dataDir,
    paths.userThemes,
    paths.workspace,
    paths.history,
    paths.assets,
    paths.presets,
    paths.snippets,
    paths.backups,
    paths.cacheDir,
    paths.renderedCache,
    paths.imageCache,
  ];
  for (const d of dirs) ensureDir(d);
}

/** Whether `child` is inside `parent` (or is `parent`). Path-aware, not string-prefix. */
export function isInside(parent, child) {
  if (!parent || !child) return false;
  const rel = relative(resolve(parent), resolve(child));
  if (rel === '') return true;
  return !rel.startsWith('..') && !isAbsolute(rel) && !rel.split(sep).includes('..');
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
