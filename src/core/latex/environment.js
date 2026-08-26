import { dirname } from 'path';
import { resolveTexExecutable, texSearchDirs } from '../exec/which.js';
import { probeVersion } from '../exec/run.js';

/**
 * Engines MDTeX knows how to drive through latexmk.
 * `flag` is the latexmk switch that selects the engine.
 */
export const ENGINES = {
  xelatex: { flag: '-xelatex', label: 'XeLaTeX', unicode: true },
  lualatex: { flag: '-lualatex', label: 'LuaLaTeX', unicode: true },
  pdflatex: { flag: '-pdf', label: 'pdfLaTeX', unicode: false },
};

export const DEFAULT_ENGINE = 'xelatex';

export function isSupportedEngine(name) {
  return Object.prototype.hasOwnProperty.call(ENGINES, name);
}

/**
 * Tools we look for. `required` marks what PDF compilation cannot work without.
 */
const TOOLS = [
  { name: 'latexmk', required: true, versionArgs: ['-version'] },
  { name: 'xelatex', required: false, versionArgs: ['--version'] },
  { name: 'lualatex', required: false, versionArgs: ['--version'] },
  { name: 'pdflatex', required: false, versionArgs: ['--version'] },
  { name: 'biber', required: false, versionArgs: ['--version'] },
  { name: 'bibtex', required: false, versionArgs: ['--version'] },
  { name: 'kpsewhich', required: false, versionArgs: ['--version'] },
  // XeLaTeX emits an .xdv that xdvipdfmx turns into the PDF. A distribution can
  // ship xelatex without it (or with it in a directory that is not on PATH),
  // in which case latexmk stops one step short of a PDF.
  { name: 'xdvipdfmx', required: false, versionArgs: ['--version'] },
  { name: 'dvipdfmx', required: false, versionArgs: ['--version'] },
];

let _cache = null;

/**
 * Detect the local LaTeX environment.
 *
 * Resolution goes through the cross-platform executable resolver, so it works
 * whether TeX Live is on PATH, installed under C:\texlive\<year>\bin\windows,
 * under /usr/local/texlive/<year>/bin/<arch>, or in a user home directory.
 *
 * Returns:
 *   {
 *     available,          // latexmk plus at least one engine were found
 *     latexmk: { path, version } | null,
 *     engines: { xelatex: {path, version}, ... },
 *     defaultEngine,      // best available engine, preferring XeLaTeX
 *     tools: { biber, bibtex, kpsewhich },
 *     distribution,       // 'TeX Live' | 'MiKTeX' | 'unknown'
 *     searchedDirs,
 *     missing: string[],
 *     hint,               // install guidance when unavailable
 *   }
 */
export async function detectLatexEnvironment({ force = false, env = process.env } = {}) {
  if (_cache && !force) return _cache;

  const found = {};
  for (const tool of TOOLS) {
    const path = resolveTexExecutable(tool.name, { env });
    if (!path) {
      found[tool.name] = null;
      continue;
    }
    const version = await probeVersion(path, tool.versionArgs);
    found[tool.name] = { path, version: version || '' };
  }

  const engines = {};
  for (const name of Object.keys(ENGINES)) {
    if (found[name]) engines[name] = found[name];
  }

  // Every directory a TeX binary was found in. latexmk shells out to helper
  // programs (xdvipdfmx, bibtex, mktexpk, ...) by bare name, so these all have
  // to be on the child PATH — otherwise a split installation, where latexmk
  // lives in /usr/bin but xdvipdfmx only exists under /usr/local/texlive,
  // silently produces an .xdv and no PDF.
  const binDirs = [];
  for (const entry of Object.values(found)) {
    if (!entry) continue;
    const dir = dirname(entry.path);
    if (!binDirs.includes(dir)) binDirs.push(dir);
  }

  const enginePreference = ['xelatex', 'lualatex', 'pdflatex'];
  let defaultEngine = enginePreference.find(e => engines[e]) || null;

  // XeLaTeX without a working xdv->pdf converter cannot finish; prefer an
  // engine that can, rather than failing every build.
  const hasXdv = Boolean(found.xdvipdfmx || found.dvipdfmx);
  if (defaultEngine === 'xelatex' && !hasXdv) {
    defaultEngine = enginePreference.slice(1).find(e => engines[e]) || defaultEngine;
  }

  const versionBlob = [found.latexmk?.version, ...Object.values(engines).map(e => e.version)]
    .filter(Boolean).join(' ');
  let distribution = 'unknown';
  if (/MiKTeX/i.test(versionBlob)) distribution = 'MiKTeX';
  else if (/TeX Live/i.test(versionBlob)) distribution = 'TeX Live';
  else if (found.latexmk || defaultEngine) distribution = 'TeX (distribution not identified)';

  const missing = [];
  if (!found.latexmk) missing.push('latexmk');
  if (!defaultEngine) missing.push('xelatex (or lualatex/pdflatex)');

  const notes = [];
  if (engines.xelatex && !hasXdv) {
    notes.push('xelatex is installed but xdvipdfmx is not, so XeLaTeX cannot produce a PDF. '
      + 'Install the full TeX Live binaries (Debian/Ubuntu: texlive-binaries) or use LuaLaTeX.');
  }

  const available = Boolean(found.latexmk && defaultEngine);

  _cache = {
    available,
    latexmk: found.latexmk,
    engines,
    defaultEngine,
    tools: {
      biber: found.biber,
      bibtex: found.bibtex,
      kpsewhich: found.kpsewhich,
      xdvipdfmx: found.xdvipdfmx,
      dvipdfmx: found.dvipdfmx,
    },
    binDirs,
    xdvSupport: hasXdv,
    distribution,
    searchedDirs: texSearchDirs(env),
    missing,
    notes,
    hint: available ? null : installHint(),
    checkedAt: new Date().toISOString(),
  };

  return _cache;
}

/** Drop the cached probe so a fresh install is picked up without a restart. */
export function resetLatexEnvironmentCache() {
  _cache = null;
}

function installHint() {
  if (process.platform === 'win32') {
    return {
      platform: 'windows',
      summary: 'Install TeX Live or MiKTeX, then reopen MDTeX so the new PATH is picked up.',
      options: [
        { label: 'TeX Live', detail: 'https://tug.org/texlive/windows.html — installs to C:\\texlive\\<year>\\bin\\windows' },
        { label: 'MiKTeX', detail: 'https://miktex.org/download — install the "Complete" scheme or enable on-the-fly package installation' },
      ],
      note: 'MDTeX also looks in C:\\texlive\\<year>\\bin\\windows and the MiKTeX program directories even when they are not on PATH.',
    };
  }
  if (process.platform === 'darwin') {
    return {
      platform: 'macos',
      summary: 'Install MacTeX (full) or BasicTeX plus latexmk.',
      options: [
        { label: 'MacTeX', detail: 'brew install --cask mactex — provides /Library/TeX/texbin' },
        { label: 'BasicTeX', detail: 'brew install --cask basictex && sudo tlmgr install latexmk' },
      ],
      note: 'MDTeX looks in /Library/TeX/texbin and /usr/local/texlive/<year>/bin even when they are not on PATH.',
    };
  }
  return {
    platform: 'linux',
    summary: 'Install TeX Live with latexmk and an XeTeX-capable engine.',
    options: [
      { label: 'Debian / Ubuntu', detail: 'sudo apt install texlive-xetex texlive-latex-extra latexmk' },
      { label: 'Fedora', detail: 'sudo dnf install texlive-scheme-medium texlive-latexmk' },
      { label: 'Arch', detail: 'sudo pacman -S texlive-basic texlive-latexextra texlive-xetex texlive-binextra' },
      { label: 'Upstream', detail: 'https://tug.org/texlive/quickinstall.html — installs to /usr/local/texlive/<year>' },
    ],
    note: 'MDTeX searches PATH plus /usr/local/texlive/<year>/bin/<arch>, /opt/texlive and ~/texlive; it never assumes /usr/bin/latexmk.',
  };
}

/**
 * Pick the engine to use for a project.
 * Falls back to whatever is installed when the requested engine is missing.
 */
export function chooseEngine(requested, environment) {
  const wanted = isSupportedEngine(requested) ? requested : DEFAULT_ENGINE;
  if (environment?.engines?.[wanted]) {
    return { engine: wanted, fallback: false };
  }
  const fallback = environment?.defaultEngine || null;
  return { engine: fallback, fallback: fallback !== null && fallback !== wanted, requested: wanted };
}
