import { describe, it, expect } from 'vitest';
import { markdownToLatexBody, escapeLatexText } from '../src/core/latex/markdown-to-latex.js';
import { loadPdfTemplate, renderPdfTemplate, buildFontSetup, listPdfTemplates } from '../src/core/latex/templates.js';
import { planCjk, containsCjk, scriptForLanguage } from '../src/core/latex/cjk.js';

/**
 * Markdown -> LaTeX conversion.
 *
 * The conversion must be deterministic and must never damage mathematics: a
 * dropped or mangled equation is a silent correctness failure that only shows
 * up in the finished PDF.
 */

describe('escapeLatexText', () => {
  it('escapes every LaTeX special character', () => {
    expect(escapeLatexText('100% & #1 _x_ ^2 ~ {a} $5 \\'))
      .toBe('100\\% \\& \\#1 \\_x\\_ \\textasciicircum{}2 \\textasciitilde{} \\{a\\} \\$5 \\textbackslash{}');
  });

  it('leaves ordinary prose untouched', () => {
    expect(escapeLatexText('A perfectly normal sentence.')).toBe('A perfectly normal sentence.');
  });
});

describe('markdownToLatexBody', () => {
  it('extracts a leading H1 as the title and demotes the rest', () => {
    const { title, body } = markdownToLatexBody('# The Title\n\n## A Section\n\nText.\n');
    expect(title).toBe('The Title');
    expect(body).toContain('\\section{A Section}');
    expect(body).not.toContain('\\section{The Title}');
  });

  it('keeps inline mathematics verbatim', () => {
    const { body, stats } = markdownToLatexBody('Cost is $\\mathcal{O}(n \\log n)$ per step.\n');
    expect(body).toContain('\\(\\mathcal{O}(n \\log n)\\)');
    expect(stats.mathInline).toBe(1);
    // Escaping must not have touched the maths.
    expect(body).not.toContain('\\textbackslash{}mathcal');
  });

  it('keeps display mathematics verbatim', () => {
    const source = '$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$\n';
    const { body, stats } = markdownToLatexBody(source);
    expect(body).toContain('\\int_0^1 x^2\\,dx = \\frac{1}{3}');
    expect(body).toContain('\\[');
    expect(stats.mathBlock).toBe(1);
  });

  it('escapes prose around mathematics without touching the mathematics', () => {
    const { body } = markdownToLatexBody('50% of $x_1$ & $y_2$.\n');
    expect(body).toContain('50\\%');
    expect(body).toContain('\\&');
    expect(body).toContain('\\(x_1\\)');
    expect(body).toContain('\\(y_2\\)');
  });

  it('converts emphasis, code and links', () => {
    const { body } = markdownToLatexBody('**bold** *em* `code_x` [text](http://a.b/c#d)\n');
    expect(body).toContain('\\textbf{bold}');
    expect(body).toContain('\\emph{em}');
    expect(body).toContain('\\texttt{code\\_x}');
    expect(body).toContain('\\href{http://a.b/c\\#d}{text}');
  });

  it('converts lists', () => {
    const { body } = markdownToLatexBody('- one\n- two\n\n1. first\n2. second\n');
    expect(body).toContain('\\begin{itemize}');
    expect(body).toContain('\\begin{enumerate}');
    expect((body.match(/\\item/g) || []).length).toBe(4);
  });

  it('converts tables with the source alignment', () => {
    const source = '| Left | Center | Right |\n| :--- | :----: | ----: |\n| a | b | c |\n';
    const { body, stats } = markdownToLatexBody(source);
    expect(body).toContain('\\begin{tabular}{lcr}');
    expect(body).toContain('\\textbf{Left}');
    expect(body).toContain('a & b & c \\\\');
    expect(stats.tables).toBe(1);
  });

  it('converts code fences to listings with a known language', () => {
    const { body } = markdownToLatexBody('```python\nprint("x")\n```\n');
    expect(body).toContain('\\begin{lstlisting}[language=Python]');
    expect(body).toContain('print("x")');
  });

  it('omits the language option for a fence listings does not know', () => {
    const { body } = markdownToLatexBody('```brainfuck\n+++.\n```\n');
    expect(body).toContain('\\begin{lstlisting}\n');
    expect(body).not.toContain('language=brainfuck');
  });

  it('falls back to verbatim when the code would escape the listing', () => {
    const { body } = markdownToLatexBody('```\n\\end{lstlisting}\n```\n');
    expect(body).toContain('\\begin{verbatim}');
  });

  it('routes images through resolveImage and drops unresolvable ones', () => {
    const seen = [];
    const { body, warnings, stats } = markdownToLatexBody(
      '![Fig one](a.png)\n\n![Fig two](missing.png)\n',
      { resolveImage: (src) => { seen.push(src); return src === 'a.png' ? 'image-1.png' : null; } },
    );
    expect(seen).toEqual(['a.png', 'missing.png']);
    expect(body).toContain('\\includegraphics[width=0.85\\linewidth,keepaspectratio]{image-1.png}');
    expect(body).toContain('\\caption{Fig one}');
    expect(body).not.toContain('missing.png');
    expect(warnings.some(w => w.includes('missing.png'))).toBe(true);
    expect(stats.images).toBe(1);
  });

  it('inlines footnotes', () => {
    const { body } = markdownToLatexBody('Text[^a]\n\n[^a]: The note.\n');
    expect(body).toContain('\\footnote{');
    expect(body).toContain('The note.');
  });

  it('converts blockquotes and horizontal rules', () => {
    const { body } = markdownToLatexBody('> Quoted\n\n---\n');
    expect(body).toContain('\\begin{quote}');
    expect(body).toContain('\\rule{\\linewidth}');
  });

  it('preserves every equation in a long mixed document', () => {
    const parts = [];
    for (let i = 0; i < 20; i++) {
      parts.push(`## Section ${i}`, '', `Inline $a_{${i}}$ and more.`, '', '$$', `E_{${i}} = mc^2`, '$$', '');
    }
    const { body, stats } = markdownToLatexBody(parts.join('\n'));
    expect(stats.mathInline).toBe(20);
    expect(stats.mathBlock).toBe(20);
    for (let i = 0; i < 20; i++) {
      expect(body).toContain(`\\(a_{${i}}\\)`);
      expect(body).toContain(`E_{${i}} = mc^2`);
    }
  });
});

describe('PDF templates', () => {
  it('lists the built-in templates', () => {
    const templates = listPdfTemplates();
    expect(templates.map(t => t.id).sort()).toEqual(['academic', 'default', 'notes']);
    for (const t of templates) expect(t.description).toBeTruthy();
  });

  it('fills every placeholder', () => {
    const template = loadPdfTemplate('default');
    const filled = renderPdfTemplate(template, {
      fontSetup: '\\usepackage{fontspec}',
      title: 'A Title',
      author: 'An Author',
      date: '',
      titleBlock: '\\maketitle',
      body: 'Body text.',
    });

    expect(filled).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(filled).toContain('\\title{A Title}');
    expect(filled).toContain('\\author{An Author}');
    expect(filled).toContain('Body text.');
    expect(filled).toContain('\\begin{document}');
    expect(filled).toContain('\\end{document}');
  });

  it('rejects an unknown template by name', () => {
    expect(() => loadPdfTemplate('no-such-template')).toThrow(/Unknown PDF template/);
  });

  it('defines the modern listings languages the converter maps to', () => {
    const source = loadPdfTemplate('default').source;
    for (const language of ['Rust', 'Go', 'JavaScript', 'TypeScript', 'Kotlin', 'Swift', 'JSON', 'YAML']) {
      expect(source).toContain(`\\lstdefinelanguage{${language}}`);
    }
  });
});

describe('buildFontSetup', () => {
  const planFor = (engine, overrides = {}) => planCjk({
    language: 'zh-CN',
    engine,
    fonts: { byScript: { sc: ['Noto Serif CJK SC', 'Noto Sans Mono CJK SC'] } },
    packages: { checked: true, xecjk: true, luatexja: true },
    ...overrides,
  });

  it('uses fontspec for XeLaTeX', () => {
    const { setup } = buildFontSetup({ engine: 'xelatex', language: 'en' });
    expect(setup).toContain('\\usepackage{fontspec}');
  });

  it('uses inputenc for pdfLaTeX', () => {
    const { setup } = buildFontSetup({ engine: 'pdflatex', language: 'en' });
    expect(setup).toContain('inputenc');
    expect(setup).not.toContain('fontspec');
  });

  it('leaves a non-CJK document exactly as it was', () => {
    const { setup, warnings } = buildFontSetup({ engine: 'xelatex', language: 'en', cjk: planCjk({ language: 'en', engine: 'xelatex' }) });
    expect(setup).toBe('\\usepackage{fontspec}\n\\defaultfontfeatures{Ligatures=TeX}');
    expect(warnings).toHaveLength(0);
  });

  it('sets a CJK font, not just the package', () => {
    const { setup, warnings } = buildFontSetup({ engine: 'xelatex', language: 'zh-CN', cjk: planFor('xelatex') });
    expect(setup).toContain('\\usepackage{xeCJK}');
    expect(setup).toContain('\\setCJKmainfont{Noto Serif CJK SC}');
    expect(setup).toContain('\\setCJKmonofont{Noto Sans Mono CJK SC}');
    expect(warnings).toHaveLength(0);
  });

  it('never emits xeCJK under LuaLaTeX, which cannot load it', () => {
    const { setup } = buildFontSetup({ engine: 'lualatex', language: 'zh-CN', cjk: planFor('lualatex') });
    expect(setup).not.toContain('xeCJK');
    expect(setup).toContain('\\usepackage{luatexja-fontspec}');
    expect(setup).toContain('\\setmainjfont{Noto Serif CJK SC}');
  });

  it('never emits XeTeX primitives under LuaLaTeX', () => {
    const { setup } = buildFontSetup({
      engine: 'lualatex',
      language: 'zh-CN',
      cjk: planFor('lualatex', { packages: { checked: true, xecjk: false, luatexja: false } }),
    });
    expect(setup).not.toContain('XeTeXlinebreaklocale');
    expect(setup).toContain('\\setmainfont{Noto Serif CJK SC}');
  });

  it('still typesets CJK when xeCJK is absent, using the font alone', () => {
    const cjk = planFor('xelatex', { packages: { checked: true, xecjk: false, luatexja: false } });
    const { setup, warnings } = buildFontSetup({ engine: 'xelatex', language: 'zh-CN', cjk });

    expect(cjk.usable).toBe(true);
    expect(cjk.quality).toBe('glyphs-only');
    expect(setup).toContain('\\setmainfont{Noto Serif CJK SC}');
    expect(setup).toContain('XeTeXlinebreaklocale');
    expect(warnings.join(' ')).toMatch(/line breaking/);
  });

  it('reports pdfLaTeX as unable rather than merely unadvisable', () => {
    const cjk = planFor('pdflatex');
    expect(cjk.usable).toBe(false);
    const { warnings } = buildFontSetup({ engine: 'pdflatex', language: 'zh-CN', cjk });
    expect(warnings.join(' ')).toMatch(/pdfLaTeX cannot typeset/);
  });
});

describe('planCjk', () => {
  const FONTS = { byScript: { sc: ['Noto Serif CJK SC'], tc: ['Noto Serif CJK TC'], jp: [], kr: [] } };
  const PACKAGES = { checked: true, xecjk: true, luatexja: false };

  it('refuses when no font on the machine can draw the script', () => {
    const plan = planCjk({ language: 'ja', engine: 'xelatex', fonts: FONTS, packages: PACKAGES });
    expect(plan.needed).toBe(true);
    expect(plan.usable).toBe(false);
    expect(plan.blocker).toMatch(/No font on this machine/);
  });

  it('picks the script the language asks for', () => {
    expect(planCjk({ language: 'zh-TW', engine: 'xelatex', fonts: FONTS, packages: PACKAGES }).mainFont)
      .toBe('Noto Serif CJK TC');
    expect(planCjk({ language: 'zh-CN', engine: 'xelatex', fonts: FONTS, packages: PACKAGES }).mainFont)
      .toBe('Noto Serif CJK SC');
  });

  it('honours a requested font, and says so when it cannot', () => {
    const ok = planCjk({
      language: 'zh-CN', engine: 'xelatex', packages: PACKAGES,
      fonts: { byScript: { sc: ['Noto Serif CJK SC', 'Songti SC'] } },
      preferredFont: 'Songti SC',
    });
    expect(ok.mainFont).toBe('Songti SC');
    expect(ok.warnings).toHaveLength(0);

    const missing = planCjk({
      language: 'zh-CN', engine: 'xelatex', fonts: FONTS, packages: PACKAGES,
      preferredFont: 'Not Installed CJK',
    });
    expect(missing.mainFont).toBe('Noto Serif CJK SC');
    expect(missing.warnings.join(' ')).toMatch(/not installed/);
  });

  it('needs nothing for a document with no CJK in it', () => {
    const plan = planCjk({ language: 'en', engine: 'xelatex', fonts: FONTS, packages: PACKAGES });
    expect(plan.needed).toBe(false);
    expect(plan.usable).toBe(true);
  });
});

describe('containsCjk', () => {
  it('sees CJK wherever it appears', () => {
    expect(containsCjk('中文')).toBe(true);
    expect(containsCjk('ひらがな')).toBe(true);
    expect(containsCjk('한글')).toBe(true);
    expect(containsCjk('A title with 一 character')).toBe(true);
  });

  it('does not mistake accented Latin for CJK', () => {
    expect(containsCjk('Übergrößenträger, naïve café')).toBe(false);
    expect(containsCjk('plain ascii')).toBe(false);
  });
});
