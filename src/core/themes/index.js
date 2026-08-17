import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, basename, extname, join } from 'path';

const THEMES_DIR = resolve(import.meta.dirname, '../../../themes');

/**
 * Load a CSS theme by name or file path.
 */
export function loadTheme(nameOrPath) {
  let cssPath;

  if (existsSync(nameOrPath)) {
    cssPath = nameOrPath;
  } else {
    // Try as theme name in themes directory
    const candidate = join(THEMES_DIR, nameOrPath.endsWith('.css') ? nameOrPath : `${nameOrPath}.css`);
    if (existsSync(candidate)) {
      cssPath = candidate;
    } else {
      throw new Error(`Theme not found: ${nameOrPath}`);
    }
  }

  const css = readFileSync(cssPath, 'utf-8');
  const name = basename(cssPath, extname(cssPath));

  return { name, css, path: cssPath };
}

/**
 * List all available themes.
 */
export function listThemes() {
  if (!existsSync(THEMES_DIR)) return [];
  return readdirSync(THEMES_DIR)
    .filter(f => f.endsWith('.css'))
    .map(f => ({
      name: basename(f, '.css'),
      path: join(THEMES_DIR, f),
    }));
}

/**
 * Resolve CSS variables in a stylesheet to their values.
 * Only resolves simple var(--name) references defined in :root or #nice.
 */
export function resolveCssVariables(css) {
  // Extract variable definitions
  const vars = {};
  const varDefPattern = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let match;
  while ((match = varDefPattern.exec(css)) !== null) {
    vars[match[1]] = match[2].trim();
  }

  // Replace var() references
  let resolved = css;
  let iterations = 0;
  const maxIterations = 10; // prevent infinite loops with circular refs

  while (/var\(--[\w-]+\)/.test(resolved) && iterations < maxIterations) {
    resolved = resolved.replace(/var\((--[\w-]+)(?:\s*,\s*([^)]+))?\)/g, (_, name, fallback) => {
      return vars[name] || fallback || '';
    });
    iterations++;
  }

  return resolved;
}
