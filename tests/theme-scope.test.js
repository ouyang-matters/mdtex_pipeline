import { describe, it, expect } from 'vitest';
import { resolveCssVariables, scopeThemeCss } from '../src/ui/browser-compiler.js';

describe('A theme in the preview', () => {
  const theme = `/* a theme */
:root {
  --text: #2b2f36;
  --accent: #2f6fdf;
}

#nice { color: var(--text); }
#nice h2 { border-left: 4px solid var(--accent); }
`;

  it('cannot redefine the interface’s own variables', () => {
    // The preview shares the application's document: a :root block would set
    // --text for every button in MDTeX.
    const css = scopeThemeCss(resolveCssVariables(theme));
    expect(css).not.toMatch(/:root/);
    expect(css).not.toMatch(/--text/);
  });

  it('still gets the values it declared', () => {
    const css = scopeThemeCss(resolveCssVariables(theme));
    expect(css).toContain('#nice { color: #2b2f36; }');
    expect(css).toContain('border-left: 4px solid #2f6fdf;');
  });

  it('leaves selectors that merely contain the word alone', () => {
    const css = '#nice .rootish { color: red; }\n#nice p:root-like { color: blue; }';
    expect(scopeThemeCss(css)).toBe(css);
  });
});
