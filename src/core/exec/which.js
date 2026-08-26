import { existsSync, statSync, accessSync, constants } from 'fs';
import { join, delimiter, isAbsolute, resolve } from 'path';
import { homedir } from 'os';

const IS_WINDOWS = process.platform === 'win32';

/**
 * Executable extensions to try on Windows, in PATHEXT order.
 * latexmk in particular ships as a .exe on TeX Live and as a .bat/.cmd shim on
 * some MiKTeX installs, so we must not assume a bare name resolves.
 */
export function executableExtensions() {
  if (!IS_WINDOWS) return [''];
  const pathext = process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD';
  const exts = pathext.split(';').map(e => e.trim()).filter(Boolean);
  // Always allow the exact name too (already-qualified paths).
  return ['', ...exts.map(e => e.toLowerCase())];
}

function isExecutableFile(candidate) {
  try {
    const st = statSync(candidate);
    if (!st.isFile()) return false;
  } catch {
    return false;
  }
  if (IS_WINDOWS) return true;
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Directories on PATH, split with the platform separator.
 */
export function pathDirs(env = process.env) {
  const raw = env.PATH || env.Path || env.path || '';
  return raw.split(delimiter).map(d => d.trim()).filter(Boolean);
}

/**
 * Well-known TeX installation directories that are commonly NOT on PATH,
 * especially on Windows where the installer may not have refreshed the
 * environment of an already-running shell.
 *
 * Exported so `doctor` can report exactly where it looked.
 */
export function texSearchDirs(env = process.env) {
  const dirs = [];
  const home = homedir();

  if (IS_WINDOWS) {
    const programFiles = env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = env.LOCALAPPDATA || join(home, 'AppData', 'Local');

    // TeX Live installs to C:\texlive\<year>\bin\windows (2023+) or bin\win32.
    for (const root of ['C:\\texlive', join(programFiles, 'texlive'), join(home, 'texlive')]) {
      for (const year of texLiveYears()) {
        dirs.push(join(root, String(year), 'bin', 'windows'));
        dirs.push(join(root, String(year), 'bin', 'win32'));
      }
    }
    // MiKTeX: system-wide and per-user.
    dirs.push(join(programFiles, 'MiKTeX', 'miktex', 'bin', 'x64'));
    dirs.push(join(programFiles, 'MiKTeX', 'miktex', 'bin'));
    dirs.push(join(programFilesX86, 'MiKTeX', 'miktex', 'bin'));
    dirs.push(join(localAppData, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64'));
    dirs.push(join(localAppData, 'Programs', 'MiKTeX', 'miktex', 'bin'));
    // Strawberry Perl ships latexmk's perl dependency; TeX Live bundles its own.
  } else if (process.platform === 'darwin') {
    dirs.push('/Library/TeX/texbin');
    dirs.push('/usr/texbin');
    dirs.push('/opt/homebrew/bin');
    dirs.push('/usr/local/bin');
    for (const year of texLiveYears()) {
      dirs.push(join('/usr/local/texlive', String(year), 'bin', 'universal-darwin'));
      dirs.push(join('/usr/local/texlive', String(year), 'bin', 'x86_64-darwin'));
    }
  } else {
    // Linux: distribution packages, plus upstream TeX Live in system and user
    // locations. Never assume /usr/bin.
    dirs.push('/usr/bin', '/usr/local/bin', '/bin');
    const arches = ['x86_64-linux', 'aarch64-linux', 'i386-linux', 'armhf-linux'];
    for (const root of ['/usr/local/texlive', '/opt/texlive', join(home, 'texlive'), join(home, '.texlive')]) {
      for (const year of texLiveYears()) {
        for (const arch of arches) {
          dirs.push(join(root, String(year), 'bin', arch));
        }
      }
    }
    dirs.push(join(home, '.local', 'bin'));
    dirs.push(join(home, 'bin'));
  }

  return dirs;
}

/**
 * Candidate TeX Live year directories, newest first.
 * TeX Live releases annually; we look a year ahead and several years back.
 */
function texLiveYears() {
  const current = new Date().getFullYear();
  const years = [];
  for (let y = current + 1; y >= current - 6; y--) years.push(y);
  return years;
}

/**
 * Resolve an executable name to an absolute path.
 *
 * Cross-platform replacement for `which` / `where`:
 *   - honours PATHEXT on Windows (.exe, .cmd, .bat shims)
 *   - checks the PATH first, then any caller-supplied extra directories
 *   - accepts an already-absolute path and validates it
 *
 * Returns the absolute path, or null when not found. Never throws.
 */
export function resolveExecutable(name, { extraDirs = [], env = process.env } = {}) {
  if (!name) return null;

  const exts = executableExtensions();

  // An explicit path (absolute, or containing a separator) is used as-is.
  if (isAbsolute(name) || name.includes('/') || (IS_WINDOWS && name.includes('\\'))) {
    const abs = resolve(name);
    for (const ext of exts) {
      const candidate = abs + ext;
      if (isExecutableFile(candidate)) return candidate;
    }
    return null;
  }

  const dirs = [...pathDirs(env), ...extraDirs];
  const seen = new Set();

  for (const dir of dirs) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    if (!existsSync(dir)) continue;

    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      if (isExecutableFile(candidate)) return candidate;
    }
  }

  return null;
}

/**
 * Resolve a TeX-related executable, searching PATH plus the well-known TeX
 * installation directories for this platform.
 */
export function resolveTexExecutable(name, { env = process.env } = {}) {
  return resolveExecutable(name, { extraDirs: texSearchDirs(env), env });
}
