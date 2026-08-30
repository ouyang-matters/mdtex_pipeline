import { describe, it, expect } from 'vitest';
import {
  scriptForLanguage, containsCjk, planCjk, cjkPreamble, resolveCjkPlan,
  classifyFamily, parseRegistryFonts, windowsRegistryFamilies, windowsFontFiles,
} from '../src/core/latex/cjk.js';
import { parseLatexLog } from '../src/core/pdf/log-parser.js';

/**
 * The rule under test: a PDF that dropped characters is not a successful build.
 *
 * TeX reports each missing glyph and carries on, so the failure mode this guards
 * against is not a crash — it is a clean exit code and a blank page.
 */

const NOTO = {
  byScript: {
    sc: ['Noto Serif CJK SC', 'Noto Sans Mono CJK SC'],
    tc: ['Noto Serif CJK TC'],
    jp: ['Noto Serif CJK JP'],
    kr: ['Noto Serif CJK KR'],
  },
};
const NO_FONTS = { byScript: { sc: [], tc: [], jp: [], kr: [] } };
const HAS_XECJK = { checked: true, xecjk: true, ctex: true, luatexja: true };
const NO_PACKAGES = { checked: true, xecjk: false, ctex: false, luatexja: false };

describe('scriptForLanguage', () => {
  it('separates traditional from simplified', () => {
    expect(scriptForLanguage('zh-TW')).toBe('tc');
    expect(scriptForLanguage('zh-HK')).toBe('tc');
    expect(scriptForLanguage('zh-Hant')).toBe('tc');
    expect(scriptForLanguage('zh-CN')).toBe('sc');
    expect(scriptForLanguage('zh')).toBe('sc');
  });

  it('recognises Japanese and Korean', () => {
    expect(scriptForLanguage('ja')).toBe('jp');
    expect(scriptForLanguage('ko-KR')).toBe('kr');
  });

  it('returns nothing for a language that needs no CJK font', () => {
    expect(scriptForLanguage('en')).toBeNull();
    expect(scriptForLanguage('')).toBeNull();
  });
});

describe('planCjk', () => {
  it('treats a missing font as a blocker, not a warning', () => {
    const plan = planCjk({ language: 'zh-CN', engine: 'xelatex', fonts: NO_FONTS, packages: HAS_XECJK });
    expect(plan.usable).toBe(false);
    expect(plan.blocker).toMatch(/No font on this machine/);
    // Nothing is emitted for a plan that cannot work.
    expect(cjkPreamble(plan)).toBe('');
  });

  it('treats a missing package as a warning, not a blocker', () => {
    const plan = planCjk({ language: 'zh-CN', engine: 'xelatex', fonts: NOTO, packages: NO_PACKAGES });
    expect(plan.usable).toBe(true);
    expect(plan.blocker).toBeNull();
    expect(plan.quality).toBe('glyphs-only');
    expect(cjkPreamble(plan)).toContain('\\setmainfont{Noto Serif CJK SC}');
  });

  it('will not put xeCJK in a LuaLaTeX document', () => {
    const plan = planCjk({ language: 'ja', engine: 'lualatex', fonts: NOTO, packages: HAS_XECJK });
    const preamble = cjkPreamble(plan);
    expect(preamble).not.toContain('xeCJK');
    expect(preamble).toContain('luatexja-fontspec');
  });

  it('will not put XeTeX primitives in a LuaLaTeX document', () => {
    const plan = planCjk({ language: 'ja', engine: 'lualatex', fonts: NOTO, packages: NO_PACKAGES });
    expect(cjkPreamble(plan)).not.toContain('XeTeX');
  });

  it('refuses pdfLaTeX outright rather than producing an empty page', () => {
    const plan = planCjk({ language: 'zh-CN', engine: 'pdflatex', fonts: NOTO, packages: HAS_XECJK });
    expect(plan.usable).toBe(false);
    expect(plan.blocker).toMatch(/pdfLaTeX cannot typeset/);
  });

  it('falls back to any font that covers the script', () => {
    const plan = planCjk({
      language: 'zh-CN', engine: 'xelatex', packages: HAS_XECJK,
      fonts: { byScript: { sc: ['Some Unlisted CJK Font'] } },
    });
    expect(plan.usable).toBe(true);
    expect(plan.mainFont).toBe('Some Unlisted CJK Font');
  });

  it('emits nothing at all for a document with no CJK', () => {
    const plan = planCjk({ language: 'en', engine: 'xelatex', fonts: NOTO, packages: HAS_XECJK });
    expect(plan.needed).toBe(false);
    expect(cjkPreamble(plan)).toBe('');
  });
});

describe('resolveCjkPlan', () => {
  it('goes by the text, not the language tag', async () => {
    // The metadata says English. The title does not.
    const plan = await resolveCjkPlan({
      engine: 'xelatex',
      language: 'en',
      text: 'An article about 汉字 in an English-labelled document.',
    });

    // On a machine with no CJK fonts this is a blocker rather than a plan; both
    // outcomes are correct, and both prove the text was what triggered it.
    expect(plan.needed).toBe(true);
    expect(plan.script).toBe('sc');
  });

  it('leaves a genuinely Latin document alone', async () => {
    const plan = await resolveCjkPlan({ engine: 'xelatex', language: 'en', text: 'Plain ASCII only.' });
    expect(plan.needed).toBe(false);
    expect(plan.usable).toBe(true);
  });

  it('tells Japanese from Chinese by the kana', async () => {
    const plan = await resolveCjkPlan({ engine: 'xelatex', language: 'en', text: 'テストです' });
    expect(plan.script).toBe('jp');
  });

  it('tells Korean from Chinese by the hangul', async () => {
    const plan = await resolveCjkPlan({ engine: 'xelatex', language: 'en', text: '한국어 테스트' });
    expect(plan.script).toBe('kr');
  });
});

describe('the log parser sees dropped characters', () => {
  const LOG = [
    'Missing character: There is no 中 (U+4E2D) in font [lmroman10-regular]:mapping=tex-text;!',
    'Missing character: There is no 文 (U+6587) in font [lmroman10-regular]:mapping=tex-text;!',
    'Missing character: There is no 中 (U+4E2D) in font [lmroman10-regular]:mapping=tex-text;!',
    'Output written on article.pdf (1 page).',
  ].join('\n');

  it('counts them and groups them by the font that could not draw them', () => {
    const { missingCharacters } = parseLatexLog(LOG);
    expect(missingCharacters).toHaveLength(1);
    expect(missingCharacters[0].count).toBe(3);
    expect(missingCharacters[0].font).toContain('lmroman10-regular');
    expect(missingCharacters[0].samples).toEqual(['中', '文']);
  });

  it('does not mistake them for ordinary errors', () => {
    const { errors } = parseLatexLog(LOG);
    expect(errors).toHaveLength(0);
  });

  it('reports none for a clean log', () => {
    expect(parseLatexLog('Output written on article.pdf (1 page).').missingCharacters).toEqual([]);
  });
});

describe('containsCjk', () => {
  it('covers every script MDTeX claims to support', () => {
    expect(containsCjk('简体')).toBe(true);
    expect(containsCjk('繁體')).toBe(true);
    expect(containsCjk('カタカナ')).toBe(true);
    expect(containsCjk('ひらがな')).toBe(true);
    expect(containsCjk('한글')).toBe(true);
    expect(containsCjk('，。「」')).toBe(true);
  });

  it('is not fooled by Latin, Greek or Cyrillic', () => {
    expect(containsCjk('naïve café Übergröße')).toBe(false);
    expect(containsCjk('αβγ ΔΣΩ')).toBe(false);
    expect(containsCjk('Привет мир')).toBe(false);
  });
});

describe('Windows font discovery', () => {
  const REG_OUTPUT = [
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
    '    Arial (TrueType)    REG_SZ    arial.ttf',
    '    SimSun & NSimSun (TrueType)    REG_SZ    simsun.ttc',
    '    Microsoft YaHei & Microsoft YaHei UI (TrueType)    REG_SZ    msyh.ttc',
    '    MS Mincho & MS PMincho (TrueType)    REG_SZ    msmincho.ttc',
    '    Malgun Gothic (TrueType)    REG_SZ    malgun.ttf',
    '    PMingLiU & MingLiU & MingLiU_HKSCS (TrueType)    REG_SZ    mingliu.ttc',
    '',
  ].join('\r\n');

  it('reads family names out of the registry, ampersands and all', () => {
    const families = parseRegistryFonts(REG_OUTPUT);
    expect(families).toContain('SimSun');
    expect(families).toContain('NSimSun');
    expect(families).toContain('Microsoft YaHei UI');
    expect(families).toContain('PMingLiU');
    expect(families).toContain('Arial');
  });

  it('is not confused by the key header or blank lines', () => {
    expect(parseRegistryFonts(REG_OUTPUT).some(f => f.includes('HKEY_LOCAL_MACHINE'))).toBe(false);
    expect(parseRegistryFonts('')).toEqual([]);
  });

  it('sorts the fonts Windows ships into the right scripts', () => {
    const byScript = { sc: [], tc: [], jp: [], kr: [] };
    for (const name of parseRegistryFonts(REG_OUTPUT)) {
      for (const script of classifyFamily(name)) byScript[script].push(name);
    }
    expect(byScript.sc).toContain('SimSun');
    expect(byScript.sc).toContain('Microsoft YaHei');
    expect(byScript.tc).toContain('PMingLiU');
    expect(byScript.jp).toContain('MS Mincho');
    expect(byScript.kr).toContain('Malgun Gothic');
    // Latin fonts belong to no CJK script.
    expect(Object.values(byScript).flat()).not.toContain('Arial');
  });

  it('reports whether the registry could be read at all', async () => {
    const denied = await windowsRegistryFamilies({ run: async () => ({ code: 1, stdout: '' }) });
    expect(denied.ok).toBe(false);
    expect(denied.families).toEqual([]);

    const allowed = await windowsRegistryFamilies({ run: async () => ({ code: 0, stdout: REG_OUTPUT }) });
    expect(allowed.ok).toBe(true);
    expect(allowed.families.length).toBeGreaterThan(0);
  });

  it('finds the Chinese fonts Windows ships from the font directory alone', () => {
    const files = [
      'arial.ttf', 'simsun.ttc', 'simhei.ttf', 'simkai.ttf',
      'msyh.ttc', 'msjh.ttc', 'meiryo.ttc', 'batang.ttc',
    ];
    const { ok, families } = windowsFontFiles({}, {
      dirs: ['C:\\Windows\\Fonts', 'C:\\Users\\me\\AppData\\Local\\Microsoft\\Windows\\Fonts'],
      exists: () => true,
      readDir: (dir) => (dir.includes('AppData') ? ['NotoSerifCJKsc-Regular.otf'] : files),
    });
    expect(ok).toBe(true);
    expect([...families]).toContain('SimSun');
    expect([...families]).toContain('SimHei');
    expect([...families]).toContain('KaiTi');
    expect([...families]).toContain('Microsoft JhengHei');
    expect([...families]).toContain('Meiryo');
  });
});

describe('an unanswerable probe is not a verdict', () => {
  const NOTHING = { byScript: { sc: [], tc: [], jp: [], kr: [] } };

  it('refuses when detection answered and found nothing', () => {
    const plan = planCjk({
      language: 'zh-CN', engine: 'xelatex',
      fonts: { ...NOTHING, certain: true }, packages: HAS_XECJK,
    });
    expect(plan.usable).toBe(false);
    expect(plan.blocker).toMatch(/No font on this machine/);
  });

  it('guesses, loudly, when detection could not answer', () => {
    const plan = planCjk({
      language: 'zh-CN', engine: 'xelatex',
      fonts: { ...NOTHING, certain: false }, packages: HAS_XECJK,
    });
    expect(plan.usable).toBe(true);
    expect(plan.quality).toBe('unverified');
    expect(plan.mainFont).toBeTruthy();
    expect(plan.warnings.join(' ')).toMatch(/could not read this machine's installed fonts/);
    // The guess is still checked: the build stops rather than dropping text.
    expect(plan.warnings.join(' ')).toMatch(/build will stop/);
  });
});
