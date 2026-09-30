import { describe, it, expect } from 'vitest';
import { decodeHtmlEntities } from '../src/core/html-entities.js';
import { renderMarkdown } from '../src/core/parser/index.js';
import { replaceKatexWithImages } from '../src/core/math/post-processor.js';

describe('decodeHtmlEntities', () => {
  it('decodes every spelling of an apostrophe', () => {
    expect(decodeHtmlEntities('a&#x27;b&#39;c&apos;d&#X27;e')).toBe("a'b'c'd'e");
  });

  it('decodes in a single pass, so an escaped entity stays escaped once', () => {
    expect(decodeHtmlEntities('&amp;lt;')).toBe('&lt;');
  });

  it('leaves unknown or malformed references alone', () => {
    expect(decodeHtmlEntities('&bogus; & &#xZZ;')).toBe('&bogus; & &#xZZ;');
  });
});

describe('published formulas with a prime', () => {
  // KaTeX writes the apostrophe of \gamma' as &#x27;. Before the shared decoder
  // it reached MathJax undecoded and rendered as a black "Misplaced &" box.
  it('renders \\gamma\'(t) without a MathJax error', async () => {
    const { html, errors } = await replaceKatexWithImages(
      renderMarkdown("Then $\\gamma'(t) = V_{\\gamma(t)}$ and\n\n$$\n\\gamma_X'(0) = X.\n$$"),
    );
    expect(errors).toEqual([]);
    expect(html).toContain('data-mdtex-math="inline"');
    expect(html).toContain('data-mdtex-math="display"');
    expect(html).not.toContain('data-mjx-error');
    expect(html).not.toContain('&amp;#x27;');
  });
});
