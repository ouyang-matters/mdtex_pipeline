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

/**
 * The font to guess when no probe could tell us what is installed.
 *
 * One per platform and script, chosen for being the thing that platform has
 * always shipped rather than the thing that looks best. A wrong guess stops the
 * build with "font not found", which is a good failure; a guess biased towards
 * a font that is usually absent would stop builds that should have worked.
 */
const PLATFORM_FALLBACK = {
  win32: { sc: 'SimSun', tc: 'PMingLiU', jp: 'MS Mincho', kr: 'Batang' },
  darwin: { sc: 'Songti SC', tc: 'Songti TC', jp: 'Hiragino Mincho ProN', kr: 'Apple SD Gothic Neo' },
  default: { sc: 'Noto Serif CJK SC', tc: 'Noto Serif CJK TC', jp: 'Noto Serif CJK JP', kr: 'Noto Serif CJK KR' },
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

/**
 * Families that are known to cover a script, whatever names a platform gives
 * them. Used to classify what a probe reports, so a font MDTeX has never heard
 * of is still recognised when the platform tells us its name.
 */
const KNOWN_FAMILIES = {
  sc: [
    'noto serif cjk sc', 'noto sans cjk sc', 'noto sans mono cjk sc', 'noto serif sc', 'noto sans sc',
    'source han serif sc', 'source han sans sc', 'source han mono sc',
    'simsun', 'nsimsun', 'simhei', 'kaiti', 'fangsong', 'dengxian',
    'microsoft yahei', 'microsoft yahei ui',
    'songti sc', 'stsong', 'stheiti', 'heiti sc', 'pingfang sc', 'hiragino sans gb',
    'fandolsong', 'fandolhei', 'wenquanyi micro hei', 'wenquanyi zen hei', 'sarasa mono sc',
  ],
  tc: [
    'noto serif cjk tc', 'noto sans cjk tc', 'noto sans mono cjk tc', 'noto serif tc', 'noto sans tc',
    'source han serif tc', 'source han sans tc', 'source han mono tc',
    'pmingliu', 'mingliu', 'mingliu_hkscs', 'dfkai-sb',
    'microsoft jhenghei', 'microsoft jhenghei ui',
    'songti tc', 'pingfang tc', 'lisong pro', 'heiti tc', 'apple ligothic', 'sarasa mono tc',
  ],
  jp: [
    'noto serif cjk jp', 'noto sans cjk jp', 'noto sans mono cjk jp', 'noto serif jp', 'noto sans jp',
    'source han serif jp', 'source han sans jp', 'source han mono j',
    'ms mincho', 'ms pmincho', 'ms gothic', 'ms pgothic',
    'meiryo', 'meiryo ui', 'yu gothic', 'yu gothic ui', 'yu mincho',
    'biz udmincho', 'biz udgothic', 'ipaexmincho', 'ipaexgothic',
    'hiragino mincho pron', 'hiragino sans', 'hiragino kaku gothic pron', 'sarasa mono j',
  ],
  kr: [
    'noto serif cjk kr', 'noto sans cjk kr', 'noto sans mono cjk kr', 'noto serif kr', 'noto sans kr',
    'source han serif kr', 'source han sans kr', 'source han mono k',
    'batang', 'batangche', 'gungsuh', 'gungsuhche', 'dotum', 'dotumche', 'gulim', 'gulimche',
    'malgun gothic', 'nanummyeongjo', 'nanumgothic',
    'apple sd gothic neo', 'applemyungjo', 'sarasa mono k',
  ],
};

/** Which scripts a font family name covers, by name alone. */
export function classifyFamily(name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return [];

  const scripts = [];
  for (const [script, families] of Object.entries(KNOWN_FAMILIES)) {
    if (families.includes(key)) scripts.push(script);
  }
  if (scripts.length) return scripts;

  // A pan-CJK family named for its script, e.g. "Foo Sans CJK SC".
  const m = key.match(/\bcjk\s*(sc|tc|hk|jp|kr|k|j)\b/);
  if (m) {
    const tag = { sc: 'sc', tc: 'tc', hk: 'tc', jp: 'jp', j: 'jp', kr: 'kr', k: 'kr' }[m[1]];
    return tag ? [tag] : [];
  }
  // "... CJK" with no script tag covers all four.
  if (/\bcjk\b/.test(key)) return ['sc', 'tc', 'jp', 'kr'];

  return [];
}

let _fontCache = null;

/**
 * Fonts installed on this machine that can render each CJK script.
 *
 * Every probe that can answer is asked and the answers are merged, because no
 * single one is right everywhere:
 *
 *   fontconfig  authoritative on Linux and macOS. On Windows it is usually
 *               TeX Live's own fc-list, whose cache covers TeX Live's fonts
 *               rather than the system's — so on Windows it is a contributor,
 *               never the whole answer.
 *   registry    authoritative on Windows: it lists installed family names
 *               directly, for the machine and for the user.
 *   directories the Windows font folders, system and per-user, as a backstop
 *               when the registry cannot be read.
 *
 * `certain` says whether any probe actually answered. It is the difference
 * between "this machine has no CJK font" and "MDTeX could not find out", and
 * only the first may refuse a build.
 */
export async function detectCjkFonts({ force = false, signal, env = process.env } = {}) {
  if (_fontCache && !force) return _fontCache;

  const byScript = { sc: [], tc: [], jp: [], kr: [] };
  const methods = [];
  let certain = false;

  const add = (script, name) => {
    if (!byScript[script].some(f => f.toLowerCase() === name.toLowerCase())) {
      byScript[script].push(name);
    }
  };

  const fc = resolveExecutable('fc-list', { env });
  if (fc) {
    let answered = false;
    for (const [script, { lang }] of Object.entries(SCRIPTS)) {
      const result = await runCommand(fc, [`:lang=${lang}`, 'family'], { timeout: 10000, signal });
      if (result.code !== 0) continue;
      answered = true;
      for (const name of parseFontFamilies(result.stdout)) add(script, name);
    }
    if (answered) {
      methods.push('fontconfig');
      // On Windows this is very often TeX Live's fc-list, which knows about
      // TeX Live's fonts and not the system's. An empty answer there proves
      // nothing, so it does not settle the question on its own.
      if (process.platform !== 'win32') certain = true;
    }
  }

  if (process.platform === 'win32') {
    const registry = await windowsRegistryFamilies({ signal });
    if (registry.ok) {
      methods.push('windows-registry');
      certain = true;
      for (const name of registry.families) {
        for (const script of classifyFamily(name)) add(script, name);
      }
    }

    const fromDisk = windowsFontFiles(env);
    if (fromDisk.ok) {
      methods.push('windows-font-directory');
      if (fromDisk.families.size) certain = true;
      for (const name of fromDisk.families) {
        for (const script of classifyFamily(name)) add(script, name);
      }
    }
  }

  const available = [...new Set(Object.values(byScript).flat())].sort();
  _fontCache = { available, byScript, methods, method: methods[0] || 'none', certain };
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

/**
 * Family names from the Windows font registry.
 *
 * This is the authoritative list: Windows records every installed font here,
 * for the machine and for the current user, under its real family name — so a
 * font MDTeX has no filename for is still found.
 */
export async function windowsRegistryFamilies({ signal, run = runCommand } = {}) {
  const KEYS = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
    'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
  ];

  const families = new Set();
  let ok = false;

  for (const key of KEYS) {
    const result = await run('reg', ['query', key], { timeout: 10000, signal });
    if (result.code !== 0) continue;
    ok = true;
    for (const name of parseRegistryFonts(result.stdout)) families.add(name);
  }

  return { ok, families: [...families] };
}

/**
 * Parse `reg query` output into family names.
 *
 *     SimSun & NSimSun (TrueType)    REG_SZ    simsun.ttc
 *
 * The value name carries the families, ampersand-separated, with the format in
 * parentheses. That is the only part we want.
 */
export function parseRegistryFonts(stdout) {
  const families = new Set();
  for (const line of String(stdout).split(/\r?\n/)) {
    const m = line.match(/^\s{2,}(.+?)\s+REG_(?:SZ|EXPAND_SZ)\s+\S/);
    if (!m) continue;
    const label = m[1].replace(/\s*\((?:TrueType|OpenType|VarType|All res)\)\s*$/i, '').trim();
    for (const part of label.split('&')) {
      const name = part.trim();
      if (name) families.add(name);
    }
  }
  return [...families];
}

/**
 * Family names implied by the font files present in the Windows font
 * directories, system-wide and per-user. A backstop for when the registry
 * cannot be read; the map only has to cover the fonts Windows itself ships.
 */
export function windowsFontFiles(env = process.env, { readDir = readdirSync, exists = existsSync, dirs = null } = {}) {
  const FILE_TO_FAMILY = {
    'simsun.ttc': 'SimSun', 'simsunb.ttf': 'SimSun', 'simhei.ttf': 'SimHei',
    'simkai.ttf': 'KaiTi', 'simfang.ttf': 'FangSong',
    'msyh.ttc': 'Microsoft YaHei', 'msyhbd.ttc': 'Microsoft YaHei', 'msyhl.ttc': 'Microsoft YaHei',
    'deng.ttf': 'DengXian', 'dengb.ttf': 'DengXian',
    'msjh.ttc': 'Microsoft JhengHei', 'msjhbd.ttc': 'Microsoft JhengHei',
    'mingliu.ttc': 'MingLiU', 'pmingliu.ttf': 'PMingLiU', 'kaiu.ttf': 'DFKai-SB',
    'msmincho.ttc': 'MS Mincho', 'msgothic.ttc': 'MS Gothic',
    'meiryo.ttc': 'Meiryo', 'meiryob.ttc': 'Meiryo',
    'yugothm.ttc': 'Yu Gothic', 'yugothb.ttc': 'Yu Gothic', 'yugothr.ttc': 'Yu Gothic',
    'yumin.ttf': 'Yu Mincho', 'yumindb.ttf': 'Yu Mincho',
    'malgun.ttf': 'Malgun Gothic', 'malgunbd.ttf': 'Malgun Gothic',
    'batang.ttc': 'Batang', 'gulim.ttc': 'Gulim',
  };

  const home = env.USERPROFILE || '';
  // Both of them: a font installed "for me only" — which is what a download
  // usually does — lands in the per-user directory and never appears in the
  // system one. Looking only at C:\Windows\Fonts misses it entirely.
  const searchDirs = dirs || [
    env.SystemRoot ? `${env.SystemRoot}\\Fonts` : 'C:\\Windows\\Fonts',
    env.LOCALAPPDATA
      ? `${env.LOCALAPPDATA}\\Microsoft\\Windows\\Fonts`
      : (home ? `${home}\\AppData\\Local\\Microsoft\\Windows\\Fonts` : null),
  ].filter(Boolean);

  const families = new Set();
  let ok = false;

  for (const dir of searchDirs) {
    if (!exists(dir)) continue;
    try {
      ok = true;
      for (const file of readDir(dir)) {
        const family = FILE_TO_FAMILY[String(file).toLowerCase()];
        if (family) families.add(family);
      }
    } catch { /* an unreadable font directory is not an answer */ }
  }

  return { ok, families };
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
 * zero and produce a page with nothing on it. That verdict requires `fonts` to
 * be a real answer — see `certain` in `detectCjkFonts`. When no probe could
 * answer, the plan guesses and says so, because the post-build check catches a
 * guess that was wrong and a wall helps nobody.
 */
export function planCjk({
  language,
  engine,
  fonts = { byScript: {}, certain: true },
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

  let mainFont = chooseFont(preferredFont, FONT_PREFERENCES[script], installed);
  let unverified = false;

  if (!mainFont) {
    // Refusing is only right when we *know* there is no font. When no probe
    // could answer, refusing turns a detection gap into a wall — and there is
    // no need for the guess to be safe, because the build is checked afterwards
    // for characters that did not reach the page. Attempt, and let that catch it.
    if (fonts.certain === false) {
      mainFont = (PLATFORM_FALLBACK[process.platform] || PLATFORM_FALLBACK.default)[script];
      unverified = true;
      warnings.push(
        `MDTeX could not read this machine's installed fonts, so it is guessing `
        + `"${mainFont}" for ${SCRIPTS[script].label}. If that font is not present the `
        + 'build will stop and say so — it will not produce a PDF with the text missing.',
      );
    } else {
      const probed = fonts.methods?.length ? fonts.methods.join(', ') : 'no probe';
      return {
        script, needed: true, usable: false, engine, package: null,
        mainFont: null, monoFont: null, quality: 'none', warnings,
        blocker: `No font on this machine can render ${SCRIPTS[script].label}, so the PDF `
          + `would be typeset with every character missing. ${installHint(script)} `
          + `(checked: ${probed}.)`,
      };
    }
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
    quality: unverified ? 'unverified' : (pkg ? 'full' : 'glyphs-only'),
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
  if (process.platform === 'win32') {
    const pack = {
      sc: 'Chinese (Simplified)', tc: 'Chinese (Traditional)',
      jp: 'Japanese', kr: 'Korean',
    }[script];
    return `Windows ships these fonts with its language packs: add ${pack} under `
      + 'Settings → Time & language → Language & region, or install Noto Serif CJK '
      + 'and choose "Install for all users" — a font installed for one user only is '
      + 'still found, but only for that user.';
  }
  if (process.platform === 'darwin') {
    return 'macOS ships Songti SC, Hiragino Mincho and Apple SD Gothic Neo; check Font Book, '
      + 'or install Noto Serif CJK.';
  }
  return 'Install a CJK font: fonts-noto-cjk (Debian/Ubuntu), '
    + 'google-noto-sans-cjk-fonts (Fedora), noto-fonts-cjk (Arch).';
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
