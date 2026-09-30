import { describe, it, expect } from 'vitest';
import { Compiler } from '../src/core/compiler/index.js';
import { htmlToPlainText } from '../src/core/compiler/plain-text.js';
import { validate } from '../src/core/compiler/validator.js';

const SOURCE = 'Before $a<b$ and $c>d$ after.\n\n$$\\int_0^1 f < 1$$\n\nTail text.';

describe('text/plain clipboard flavour', () => {
  for (const platform of ['wechat', 'zhihu']) {
    it(`keeps every formula and all the prose on ${platform}`, async () => {
      const result = await new Compiler().compile(SOURCE, { theme: 'default', platform, includePlainText: true });
      expect(result.plainText).toBe('Before $a<b$ and $c>d$ after.\n\n$$\\int_0^1 f < 1$$\n\nTail text.');
    });
  }

  it('does not let a display <img>, which has no closing tag, swallow the rest', () => {
    const html = '<p><img data-latex="x" data-display="true" src="u"></p><p>after</p>';
    expect(htmlToPlainText(html)).toBe('$$x$$\n\nafter');
  });
});

describe('formula count', () => {
  it('counts a one-line $$…$$ once', () => {
    const { stats } = validate('', 'Inline $x$.\n\n$$y$$\n\n$$\nz\n$$', {});
    expect(stats.mathDisplay).toBe(2);
    expect(stats.mathInline).toBe(1);
    expect(stats.mathTotal).toBe(3);
  });
});
