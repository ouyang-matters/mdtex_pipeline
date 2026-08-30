import { existsSync, readdirSync } from 'fs';
import { runCommand } from '../exec/run.js';
import { resolveExecutable } from '../exec/which.js';

/**
 * Chinese, Japanese and Korean typesetting.
 *
 * The rule this module exists to enforce: **a PDF that dropped characters is
 * not a successful build.** XeLaTeX will happily typeset a Chinese article in
 * Latin Modern, emit `Missing character` for every glyph, exit 0, and hand back
 * a blank page. Reporting that as success is worse than failing, so support is
 * decided before the build and verified after it.
 *
 * Support is a property of the machine, not of the article:
 *
 *   engine    xelatex and lualatex can do it; pdflatex cannot, at all
 *   package   xeCJK (XeTeX) or luatexja (LuaTeX) — better line breaking and
 *             punctuation, but not required
 *   font      a font containing the script — this *is* required, and it is the
 *             piece the old code never checked
 *
 * The package is the optional part and the font is the mandatory one, which is
 * the opposite of what MDTeX used to assume. `fontspec` plus an installed CJK
 * font produces correct glyphs on its own; xeCJK improves how they are spaced
 * and broken across lines.
 */

/** Scripts we distinguish, and how to ask fontconfig about each. */
const SCRIPTS = {
  sc: { lang: 'zh-cn', label: 'Simplified Chinese' },
  tc: { lang: 'zh-tw', label: 'Traditional Chinese' },
  jp: { lang: 'ja', label: 'Japanese' },
  kr: { lang: 'ko', label: 'Korean' },
};

/**
 * Preferred fonts per script, best first.
 *
 * Ordered by how likely they are to be both present and appropriate: the Noto
 * and Source Han families are the same typeface under two names and ship with
 * most Linux desktops, then the platform system fonts, then the older ones that
 * only a legacy installation still has.
 */
const FONT_PREFERENCES = {
  sc: [
    'Noto Serif CJK SC', 'Source Han Serif SC', 'Noto Sans CJK SC', 'Source Han Sans SC',
    'Songti SC', 'STSong', 'PingFang SC',
    'SimSun', 'Microsoft YaHei', 'FandolSong',
  ],
  tc: [
    'Noto Serif CJK TC', 'Source Han Serif TC', 'Noto Sans CJK TC', 'Source Han Sans TC',
    'Songti TC', 'PingFang TC', 'LiSong Pro',
    'PMingLiU', 'MingLiU', 'Microsoft JhengHei',
  ],
  jp: [
    'Noto Serif CJK JP', 'Source Han Serif JP', 'Noto Sans CJK JP', 'Source Han Sans JP',
    'Hiragino Mincho ProN', 'Hiragino Sans',
    'Yu Mincho', 'Yu Gothic', 'MS Mincho', 'IPAexMincho',
  ],
  kr: [
    'Noto Serif CJK KR', 'Source Han Serif KR', 'Noto Sans CJK KR', 'Source Han Sans KR',
    'Apple SD Gothic Neo', 'AppleMyungjo',
    'Malgun Gothic', 'Batang', 'NanumMyeongjo',
  ],
};

/** Monospace preferences, so code blocks in a CJK document are not tofu either. */
const MONO_PREFERENCES = {
  sc: ['Noto Sans Mono CJK SC', 'Source Han Mono SC', 'Sarasa Mono SC'],
  tc: ['Noto Sans Mono CJK TC', 'Source Han Mono TC', 'Sarasa Mono TC'],
  jp: ['Noto Sans Mono CJK JP', 'Source Han Mono J', 'Sarasa Mono J'],
  kr: ['Noto Sans Mono CJK KR', 'Source Han Mono K', 'Sarasa Mono K'],
};

/** The script an article's language tag calls for, or null when it is not CJK. */
export function scriptForLanguage(language) {
  const tag = String(language || '').toLowerCase();
  if (/^zh[-_]?(tw|hk|mo|hant)/.test(tag)) return 'tc';
  if (/^zh/.test(tag)) return 'sc';
  if (/^ja/.test(tag)) return 'jp';
  if (/^ko/.test(tag)) return 'kr';
  return null;
}

/** Whether a string contains characters only a CJK font can render. */
export function containsCjk(text) {
  return /[\u1100-\u11FF\u2E80-\u2EFF\u3000-\u303F\u3040-\u30FF\u3130-\u318F\u3400-\u4DBF\u4E00-\u9FFF\uA960-\uA97F\uAC00-\uD7FF\uF900-\uFAFF\uFF00-\uFFEF\u{20000}-\u{2A6DF}]/u
    .test(String(text || ''));
}

// ── Detection ────────────────────────────────────────────────────────────────

let _fontCache = null;

/**
 * Fonts installed on this machine that can render each CJK script.
 *
 * fontconfig is the reliable answer where it exists, because it knows what is
 * actually installed rather than what is usually installed. Windows has no
 * equivalent, so the font directory is read directly and matched against the
 * files those fonts ship as.
 *
 * Returns `{ available: string[], byScript: { sc: [], tc: [], jp: [], kr: [] },
 * method }`. An empty result means "we could not find one", which is treated as
 * "there is none" — claiming support we cannot demonstrate is how a blank PDF
 * gets reported as a success.
 */
export async function detectCjkFonts({ force = false, signal } = {}) {
  if (_fontCache && !force) return _fontCache;

  const byScript = { sc: [], tc: [], jp: [], kr: [] };
  let method = 'none';

  const fc = resolveExecutable('fc-list');
  if (fc) {
    method = 'fontconfig';
    for (const [script, { lang }] of Object.entries(SCRIPTS)) {
      const result = await runCommand(fc, [`:lang=${lang}`, 'family'], { timeout: 10000, signal });
      if (result.code !== 0) continue;
      byScript[script] = parseFontFamilies(result.stdout);
    }
  } else if (process.platform === 'win32') {
    method = 'windows-font-directory';
    const installed = windowsFontFamilies();
    for (const script of Object.keys(byScript)) {
      byScript[script] = [...FONT_PREFERENCES[script], ...MONO_PREFERENCES[script]]
        .filter(name => installed.has(name.toLowerCase()));
    }
  }

  const available = [...new Set(Object.values(byScript).flat())];
  _fontCache = { available, byScript, method };
  return _fontCache;
}

/** Drop the cached font probe, so an install is picked up without a restart. */
export function resetCjkFontCache() {
  _fontCache = null;
}

/**
 * fc-list prints one line per face, with comma-separated family aliases.
 * "Noto Serif CJK SC,Noto Serif CJK SC Regular" is one family under two names;
 * the first is the one fontspec wants.
 */
function parseFontFamilies(stdout) {
  const families = new Set();
  for (const line of String(stdout).split('\n')) {
    const name = line.split(',')[0].trim();
    if (name) families.add(name);
  }
  return [...families].sort();
}

/** Family names implied by the font files present in the Windows font directory. */
function windowsFontFamilies() {
  const dir = process.env.SystemRoot ? `${process.env.SystemRoot}\\Fonts` : 'C:\\Windows\\Fonts';
  if (!existsSync(dir)) return new Set();

  const FILE_TO_FAMILY = {
    'simsun.ttc': 'simsun', 'simsunb.ttf': 'simsun',
    'msyh.ttc': 'microsoft yahei', 'msyhbd.ttc': 'microsoft yahei',
    'msjh.ttc': 'microsoft jhenghei',
    'mingliu.ttc': 'mingliu', 'pmingliu.ttf': 'pmingliu',
    'yugothm.ttc': 'yu gothic', 'yumin.ttf': 'yu mincho',
    'msmincho.ttc': 'ms mincho',
    'malgun.ttf': 'malgun gothic', 'batang.ttc': 'batang',
  };

  const found = new Set();
  try {
    for (const file of readdirSync(dir)) {
      const family = FILE_TO_FAMILY[file.toLowerCase()];
      if (family) found.add(family);
    }
  } catch {
    return new Set();
  }
  return found;
}

/**
 * Which CJK LaTeX packages this distribution has.
 * `checked` is false when we could not ask, which is not the same as "no".
 */
export async function detectCjkPackages(environment, { signal } = {}) {
  const kpsewhich = environment?.tools?.kpsewhich?.path;
  if (!kpsewhich) return { checked: false, xecjk: false, ctex: false, luatexja: false };

  const has = async (file) => {
    const result = await runCommand(kpsewhich, [file], { timeout: 8000, signal });
    return result.code === 0 && Boolean(result.stdout.trim());
  };

  return {
    checked: true,
    xecjk: await has('xeCJK.sty'),
    ctex: await has('ctex.sty'),
    luatexja: await has('luatexja-fontspec.sty'),
  };
}

// ── Planning ─────────────────────────────────────────────────────────────────

/**
 * Decide how — or whether — this machine can typeset a script.
 *
 * @returns {{
 *   script, needed, usable, engine, package: string|null,
 *   mainFont: string|null, monoFont: string|null,
 *   quality: 'full' | 'glyphs-only' | 'none',
 *   warnings: string[], blocker: string|null,
 * }}
 *
 * `usable: false` with a `blocker` means the build must not run: it would exit
 * zero and produce a page with nothing on it.
 */
export function planCjk({
  language,
  engine,
  fonts = { byScript: {} },
  packages = { checked: false },
  preferredFont = null,
  requireForScript = null,
}) {
  const script = requireForScript || scriptForLanguage(language);
  const warnings = [];

  if (!script) {
    return {
      script: null, needed: false, usable: true, engine, package: null,
      mainFont: null, monoFont: null, quality: 'none', warnings, blocker: null,
    };
  }

  const installed = fonts.byScript?.[script] || [];

  if (engine === 'pdflatex') {
    return {
      script, needed: true, usable: false, engine, package: null,
      mainFont: null, monoFont: null, quality: 'none', warnings,
      blocker: `pdfLaTeX cannot typeset ${SCRIPTS[script].label}. `
        + 'Switch the PDF engine to XeLaTeX or LuaLaTeX in the article properties.',
    };
  }

  const mainFont = chooseFont(preferredFont, FONT_PREFERENCES[script], installed);
  if (!mainFont) {
    return {
      script, needed: true, usable: false, engine, package: null,
      mainFont: null, monoFont: null, quality: 'none', warnings,
      blocker: `No font on this machine can render ${SCRIPTS[script].label}, so the PDF `
        + 'would be typeset with every character missing. Install a CJK font — '
        + `${installHint(script)}`,
    };
  }

  if (preferredFont && mainFont !== preferredFont) {
    warnings.push(`The requested CJK font "${preferredFont}" is not installed; using "${mainFont}".`);
  }

  const monoFont = chooseFont(null, MONO_PREFERENCES[script], installed);

  // The package improves line breaking and punctuation. Its absence costs
  // quality, not correctness, so it is a warning rather than a blocker.
  let pkg = null;
  if (engine === 'lualatex') {
    if (packages.luatexja) pkg = 'luatexja';
  } else if (packages.xecjk) {
    pkg = 'xeCJK';
  }

  if (!pkg) {
    warnings.push(
      packages.checked
        ? `${engine === 'lualatex' ? 'luatexja' : 'xeCJK'} is not installed, so CJK text is set `
          + 'with the font alone: glyphs are correct, but line breaking and punctuation spacing '
          + `are not. Install ${engine === 'lualatex' ? 'texlive-lang-japanese' : 'texlive-lang-chinese'} for proper typesetting.`
        : 'kpsewhich is not available, so MDTeX cannot tell whether xeCJK is installed. '
          + 'CJK text is set with the font alone: glyphs are correct, spacing is basic.',
    );
  }

  return {
    script,
    needed: true,
    usable: true,
    engine,
    package: pkg,
    mainFont,
    monoFont,
    quality: pkg ? 'full' : 'glyphs-only',
    warnings,
    blocker: null,
  };
}

/**
 * The CJK plan for one document, from what this machine actually has.
 *
 * The trigger is the *text*, not the language tag. An article marked `en` that
 * quotes a Chinese title still needs a font that can draw it, and metadata is
 * the last place that gets updated. Reading the content is the only check that
 * cannot be wrong about what the document contains.
 */
export async function resolveCjkPlan({
  environment = null,
  engine = 'xelatex',
  language = 'en',
  text = '',
  preferredFont = null,
  signal,
} = {}) {
  const declared = scriptForLanguage(language);
  const script = declared || (containsCjk(text) ? inferScript(text) : null);

  if (!script) {
    return planCjk({ language: 'en', engine });
  }

  const [fonts, packages] = await Promise.all([
    detectCjkFonts({ signal }),
    detectCjkPackages(environment, { signal }),
  ]);

  const plan = planCjk({ language, engine, fonts, packages, preferredFont, requireForScript: script });

  if (!declared && plan.needed) {
    plan.warnings.unshift(
      `This article is marked "${language}" but contains CJK characters, so it is typeset `
      + `with ${plan.mainFont || 'a CJK font'}. Set the article language for better spacing.`,
    );
  }

  return plan;
}

/** Which script a run of text is written in, when the metadata does not say. */
function inferScript(text) {
  if (/[぀-ヿ]/.test(text)) return 'jp';
  if (/[가-힯ᄀ-ᇿ]/.test(text)) return 'kr';
  return 'sc';
}

function chooseFont(preferred, preferences, installed) {
  const has = (name) => installed.some(f => f.toLowerCase() === name.toLowerCase());
  if (preferred && has(preferred)) return preferred;
  for (const candidate of preferences) {
    if (has(candidate)) return candidate;
  }
  // Nothing from the preference list, but fontconfig found *something* for this
  // script. A font that renders the text beats no font at all.
  return installed[0] || null;
}

function installHint(script) {
  const packages = {
    sc: 'fonts-noto-cjk (Debian/Ubuntu), google-noto-sans-cjk-fonts (Fedora), noto-fonts-cjk (Arch)',
    tc: 'fonts-noto-cjk (Debian/Ubuntu), google-noto-sans-cjk-fonts (Fedora), noto-fonts-cjk (Arch)',
    jp: 'fonts-noto-cjk (Debian/Ubuntu), or install Source Han Serif JP',
    kr: 'fonts-noto-cjk (Debian/Ubuntu), or install Source Han Serif KR',
  };
  if (process.platform === 'darwin') return 'macOS ships Songti SC, Hiragino and Apple SD Gothic Neo; check Font Book.';
  if (process.platform === 'win32') return 'Windows ships SimSun, Microsoft YaHei, Yu Gothic and Malgun Gothic; install the matching language pack.';
  return packages[script];
}

/**
 * The preamble lines a plan calls for.
 * Returns an empty string for a plan that needs nothing, so a non-CJK document
 * is byte-identical to what it was before this module existed.
 */
export function cjkPreamble(plan) {
  if (!plan?.needed || !plan.usable) return '';

  const lines = [];

  if (plan.package === 'xeCJK') {
    lines.push('\\usepackage{xeCJK}');
    lines.push('\\xeCJKsetup{CJKmath=true}');
    lines.push(`\\setCJKmainfont{${plan.mainFont}}`);
    lines.push(`\\setCJKsansfont{${plan.mainFont}}`);
    if (plan.monoFont) lines.push(`\\setCJKmonofont{${plan.monoFont}}`);
  } else if (plan.package === 'luatexja') {
    lines.push('\\usepackage{luatexja-fontspec}');
    lines.push(`\\setmainjfont{${plan.mainFont}}`);
    lines.push(`\\setsansjfont{${plan.mainFont}}`);
    if (plan.monoFont) lines.push(`\\setmonojfont{${plan.monoFont}}`);
  } else {
    // No CJK package: the main font has to carry the script itself. These
    // families cover Latin as well, so one font serves the whole document.
    lines.push(`\\setmainfont{${plan.mainFont}}`);
    if (plan.monoFont) lines.push(`\\setmonofont{${plan.monoFont}}`);
    // XeTeX still needs telling that CJK may be broken between any two
    // characters; without it a long run of Chinese overflows the margin. These
    // are XeTeX primitives — emitting them under LuaLaTeX would abort the run.
    if (plan.engine === 'xelatex') {
      lines.push('\\XeTeXlinebreaklocale "zh"');
      lines.push('\\XeTeXlinebreakskip = 0pt plus 1pt');
    }
  }

  return lines.join('\n');
}
