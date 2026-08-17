import { readFileSync, readdirSync, existsSync, copyFileSync } from 'fs';
import { resolve, basename, extname, join } from 'path';
import { paths, ensureDir } from '../paths.js';

/**
 * Load a CSS theme by name or file path.
 * Search order: absolute path > user themes > builtin themes.
 */
export function loadTheme(nameOrPath) {
  let cssPath;

  // 1. Absolute or relative path to a file
  if (existsSync(nameOrPath)) {
    cssPath = nameOrPath;
  } else {
    const cssName = nameOrPath.endsWith('.css') ? nameOrPath : `${nameOrPath}.css`;

    // 2. User themes directory
    const userCandidate = join(paths.userThemes, cssName);
    if (existsSync(userCandidate)) {
      cssPath = userCandidate;
    } else {
      // 3. Builtin themes directory
      const builtinCandidate = join(paths.builtinThemes, cssName);
      if (existsSync(builtinCandidate)) {
        cssPath = builtinCandidate;
      } else {
        // 4. Legacy: themes/ in app root (backward compat)
        const legacyCandidate = join(paths.appRoot, 'themes', cssName);
        if (existsSync(legacyCandidate)) {
          cssPath = legacyCandidate;
        } else {
          throw new Error(`Theme not found: ${nameOrPath}`);
        }
      }
    }
  }

  const css = readFileSync(cssPath, 'utf-8');
  const name = basename(cssPath, extname(cssPath));
  const isBuiltin = cssPath.startsWith(paths.builtinThemes);
  const isUser = cssPath.startsWith(paths.userThemes);

  return { name, css, path: cssPath, isBuiltin, isUser };
}

/**
 * List all available themes (builtin + user).
 * User themes with same name as builtin take priority.
 */
export function listThemes() {
  const themes = new Map();

  // Load builtins first
  if (existsSync(paths.builtinThemes)) {
    for (const f of readdirSync(paths.builtinThemes).filter(f => f.endsWith('.css'))) {
      const name = basename(f, '.css');
      themes.set(name, {
        name,
        path: join(paths.builtinThemes, f),
        source: 'builtin',
      });
    }
  }

  // User themes override builtins with same name
  if (existsSync(paths.userThemes)) {
    for (const f of readdirSync(paths.userThemes).filter(f => f.endsWith('.css'))) {
      const name = basename(f, '.css');
      const existing = themes.get(name);
      themes.set(name, {
        name,
        path: join(paths.userThemes, f),
        source: 'user',
        overridesBuiltin: existing?.source === 'builtin',
      });
    }
  }

  return Array.from(themes.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * List only builtin themes.
 */
export function listBuiltinThemes() {
  if (!existsSync(paths.builtinThemes)) return [];
  return readdirSync(paths.builtinThemes)
    .filter(f => f.endsWith('.css'))
    .map(f => ({
      name: basename(f, '.css'),
      path: join(paths.builtinThemes, f),
    }));
}

/**
 * List only user themes.
 */
export function listUserThemes() {
  if (!existsSync(paths.userThemes)) return [];
  return readdirSync(paths.userThemes)
    .filter(f => f.endsWith('.css'))
    .map(f => ({
      name: basename(f, '.css'),
      path: join(paths.userThemes, f),
    }));
}

/**
 * Copy a builtin theme to user themes with a new name.
 */
export function copyTheme(sourceName, targetName) {
  const sourceFile = join(paths.builtinThemes, `${sourceName}.css`);
  if (!existsSync(sourceFile)) {
    // Also check user themes
    const userSource = join(paths.userThemes, `${sourceName}.css`);
    if (!existsSync(userSource)) {
      throw new Error(`Source theme not found: ${sourceName}`);
    }
    ensureDir(paths.userThemes);
    const targetFile = join(paths.userThemes, `${targetName}.css`);
    copyFileSync(userSource, targetFile);
    return targetFile;
  }

  ensureDir(paths.userThemes);
  const targetFile = join(paths.userThemes, `${targetName}.css`);
  copyFileSync(sourceFile, targetFile);
  return targetFile;
}

/**
 * Resolve CSS variables in a stylesheet to their values.
 */
export function resolveCssVariables(css) {
  const vars = {};
  const varDefPattern = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let match;
  while ((match = varDefPattern.exec(css)) !== null) {
    vars[match[1]] = match[2].trim();
  }

  let resolved = css;
  let iterations = 0;
  const maxIterations = 10;

  while (/var\(--[\w-]+\)/.test(resolved) && iterations < maxIterations) {
    resolved = resolved.replace(/var\((--[\w-]+)(?:\s*,\s*([^)]+))?\)/g, (_, name, fallback) => {
      return vars[name] || fallback || '';
    });
    iterations++;
  }

  return resolved;
}
