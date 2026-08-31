import { describe, it, expect } from 'vitest';
import { markdownToLatexBody } from '../src/core/latex/markdown-to-latex.js';
import { latexToMarkdownBody } from '../src/core/latex/latex-to-markdown.js';
import { renderPdfTemplate, loadPdfTemplate, buildFontSetup } from '../src/core/latex/templates.js';

/**
 * LaTeX -> Markdown conversion.
 *
 * The strongest check is a round trip through the forward converter:
 * Markdown -> LaTeX -> Markdown -> LaTeX should produce the same LaTeX body
 * twice, for every construct the forward converter itself emits. That proves
 * the reverse direction inverts the grammar rather than merely looking
 * plausible on one example.
 */

function toDocument(markdown, title = 'Doc') {
  const { body } = markdownToLatexBody(markdown);
  const template = loadPdfTemplate();
  const font = buildFontSetup({ engine: 'pdflatex', language: 'en', cjk: null });
  return renderPdfTemplate(template, {
    fontSetup: font.setup, title, author: '', date: '', titleBlock: '\\maketitle\n', body,
  });
}

function roundTripBody(markdown, title = 'Doc') {
  const tex1 = toDocument(markdown, title);
  const { markdown: md2 } = latexToMarkdownBody(tex1);
  const tex2 = toDocument(md2.replace(/^#\s+.*\n\n/, ''), title);
  return { tex1, md2, tex2 };
}

describe('latexToMarkdownBody', () => {
  it('recovers the title and demotes headings back', () => {
    const tex = toDocument('# The Title\n\n## A Section\n\nText.\n', 'The Title');
    const { markdown, title } = latexToMarkdownBody(tex);
    expect(title).toBe('The Title');
    expect(markdown).toContain('# The Title');
    expect(markdown).toContain('## A Section');
  });

  it('round-trips emphasis, code and links', () => {
    const md = '**bold** *em* `code_x` [text](http://a.b/c#d) ~~gone~~\n';
    const { tex1, tex2 } = roundTripBody(md);
    expect(tex2).toBe(tex1);
  });

  it('round-trips inline and display math verbatim', () => {
    const md = 'Cost is $\\mathcal{O}(n \\log n)$ per step.\n\n$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$\n';
    const { tex1, tex2 } = roundTripBody(md);
    expect(tex2).toBe(tex1);
  });

  it('round-trips a flat bullet list', () => {
    const md = '- one\n- two\n- three\n';
    const { tex1, tex2 } = roundTripBody(md);
    expect(tex2).toBe(tex1);
  });

  it('round-trips an ordered list with a custom start', () => {
    const md = '5. five\n6. six\n7. seven\n';
    const { tex1, tex2 } = roundTripBody(md);
    expect(tex2).toBe(tex1);
  });

  it('round-trips a table', () => {
    const md = '| A | B |\n| --- | :---: |\n| 1 | 2 |\n| 3 | 4 |\n';
    const { tex1, tex2 } = roundTripBody(md);
    expect(tex2).toBe(tex1);
  });

  it('round-trips a fenced code block with a known language', () => {
    const md = '```python\nprint("hi")\n```\n';
    const { tex1, tex2 } = roundTripBody(md);
    expect(tex2).toBe(tex1);
  });

  it('round-trips a blockquote', () => {
    const md = '> A quoted line.\n>\n> A second paragraph.\n';
    const { tex1, tex2 } = roundTripBody(md);
    expect(tex2).toBe(tex1);
  });

  it('round-trips a horizontal rule', () => {
    const md = 'Before.\n\n---\n\nAfter.\n';
    const { tex1, tex2 } = roundTripBody(md);
    expect(tex2).toBe(tex1);
  });

  it('round-trips an inline footnote', () => {
    const md = 'A claim.^[The footnote text.]\n';
    const { tex1, tex2 } = roundTripBody(md);
    expect(tex2).toBe(tex1);
  });

  it('round-trips an image with alt text', () => {
    const md = '![A caption](assets/figure.png)\n';
    const { tex1, tex2 } = roundTripBody(md);
    expect(tex2).toBe(tex1);
  });

  it('reports unrecognised LaTeX rather than dropping it', () => {
    const tex = '\\begin{document}\nSee \\ref{fig:one} for details.\n\\end{document}\n';
    const { markdown, warnings } = latexToMarkdownBody(tex);
    expect(markdown).toContain('\\ref{fig:one}');
    expect(warnings.some(w => w.includes('\\ref'))).toBe(true);
  });

  it('converts an \\begin{equation} block to $$ … $$ and warns about the numbering', () => {
    const tex = '\\begin{document}\n\\begin{equation}\nE = mc^2\n\\end{equation}\n\\end{document}\n';
    const { markdown, warnings } = latexToMarkdownBody(tex);
    expect(markdown).toBe('$$E = mc^2$$');
    expect(warnings.some(w => w.includes('equation'))).toBe(true);
  });

  it('treats the whole input as the body when there is no \\begin{document}', () => {
    const { markdown, warnings } = latexToMarkdownBody('Just \\textbf{bold} text.');
    expect(markdown).toBe('Just **bold** text.');
    expect(warnings.some(w => w.includes('\\begin{document}'))).toBe(true);
  });
});
