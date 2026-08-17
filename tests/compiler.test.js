import { describe, it, expect } from 'vitest';
import { renderToHtml } from '../src/core/renderer/index.js';
import { inlineCss } from '../src/core/compiler/css-inliner.js';
import { validate } from '../src/core/compiler/validator.js';
import { Compiler } from '../src/core/compiler/index.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const fixtureDir = resolve(import.meta.dirname, 'fixtures');

describe('Renderer', () => {
  it('should wrap output in #nice div', () => {
    const html = renderToHtml('Hello');
    expect(html).toContain('<div id="nice">');
    expect(html).toContain('</div>');
  });

  it('should render code blocks with wrapper', () => {
    const html = renderToHtml('```python\nprint("hi")\n```');
    expect(html).toContain('code-block-wrapper');
    expect(html).toContain('code-block');
  });

  it('should preserve all headings', () => {
    const source = '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6';
    const html = renderToHtml(source);
    expect(html).toContain('<h1>');
    expect(html).toContain('<h2>');
    expect(html).toContain('<h3>');
    expect(html).toContain('<h4>');
    expect(html).toContain('<h5>');
    expect(html).toContain('<h6>');
  });
});

describe('CSS Inliner', () => {
  it('should inline basic styles', () => {
    const html = '<div id="nice"><p>Hello</p></div>';
    const css = '#nice p { color: red; font-size: 15px; }';
    const result = inlineCss(html, css);
    expect(result).toContain('color: red');
    expect(result).toContain('font-size: 15px');
  });

  it('should handle nested selectors', () => {
    const html = '<div id="nice"><blockquote><p>Quote</p></blockquote></div>';
    const css = '#nice blockquote { border-left: 4px solid blue; } #nice blockquote p { color: gray; }';
    const result = inlineCss(html, css);
    expect(result).toContain('border-left');
    expect(result).toContain('color: gray');
  });

  it('should remove style tags after inlining', () => {
    const html = '<div id="nice"><p>Test</p></div>';
    const css = '#nice p { color: red; }';
    const result = inlineCss(html, css);
    expect(result).not.toContain('<style>');
  });
});

describe('Validator', () => {
  it('should count elements correctly', () => {
    const html = '<div id="nice"><p>A</p><p>B</p><h1>Title</h1></div>';
    const source = '# Title\n\nA\n\nB';
    const result = validate(html, source, {});
    expect(result.stats.paragraphs).toBe(2);
    expect(result.stats.headings).toBe(1);
  });

  it('should detect script tags', () => {
    const html = '<div id="nice"><script>alert("xss")</script></div>';
    const result = validate(html, '', {});
    expect(result.errors).toContain('Script tags detected in output');
  });

  it('should detect iframe tags', () => {
    const html = '<div id="nice"><iframe src="evil.com"></iframe></div>';
    const result = validate(html, '', {});
    expect(result.errors).toContain('Iframe tags detected in output');
  });

  it('should warn about unresolved CSS variables', () => {
    const html = '<div id="nice" style="color: var(--undefined-var)"><p>Test</p></div>';
    const result = validate(html, '', {});
    expect(result.warnings.some(w => w.includes('CSS variable'))).toBe(true);
  });

  it('should warn about local images needing upload', () => {
    const { ImageNode } = require('../src/core/images/index.js');
    const img = new ImageNode('local.png', 'test');
    const result = validate('<div id="nice"><img src="local.png"></div>', '', { images: [img] });
    expect(result.warnings.some(w => w.includes('local path'))).toBe(true);
  });
});

describe('Full Compiler', () => {
  it('should compile simple markdown for wechat', () => {
    const compiler = new Compiler();
    const result = compiler.compile('# Hello\n\nWorld', {
      theme: 'default',
      platform: 'wechat',
      baseDir: '.',
    });

    expect(result.html).toBeTruthy();
    expect(result.platform).toBe('wechat');
    expect(result.validation).toBeTruthy();
    expect(result.validation.stats.headings).toBe(1);
    expect(result.validation.stats.paragraphs).toBeGreaterThanOrEqual(1);
  });

  it('should compile simple markdown for zhihu', () => {
    const compiler = new Compiler();
    const result = compiler.compile('# Hello\n\nWorld', {
      theme: 'default',
      platform: 'zhihu',
      baseDir: '.',
    });

    expect(result.html).toBeTruthy();
    expect(result.platform).toBe('zhihu');
  });

  it('should compile the fixture article', () => {
    const source = readFileSync(resolve(fixtureDir, 'math_article.md'), 'utf-8');
    const compiler = new Compiler();
    const result = compiler.compile(source, {
      theme: 'default',
      platform: 'wechat',
      baseDir: fixtureDir,
    });

    expect(result.html).toBeTruthy();
    expect(result.validation.stats.headings).toBeGreaterThan(0);
    expect(result.validation.stats.paragraphs).toBeGreaterThan(0);
    expect(result.validation.stats.mathTotal).toBeGreaterThan(0);
    expect(result.validation.stats.codeBlocks).toBeGreaterThan(0);
    expect(result.validation.stats.tables).toBeGreaterThan(0);
  });

  it('should not lose paragraphs when styling fails', () => {
    const compiler = new Compiler();
    const source = 'Paragraph one.\n\nParagraph two.\n\nParagraph three.';
    const result = compiler.compile(source, {
      theme: 'default',
      platform: 'wechat',
      baseDir: '.',
    });

    // All three paragraphs must appear in output
    expect(result.html).toContain('Paragraph one');
    expect(result.html).toContain('Paragraph two');
    expect(result.html).toContain('Paragraph three');
  });

  it('should compile with academic-orange theme', () => {
    const compiler = new Compiler();
    const result = compiler.compile('# Test\n\nHello $x^2$', {
      theme: 'academic-orange',
      platform: 'wechat',
      baseDir: '.',
    });

    expect(result.html).toBeTruthy();
    expect(result.theme.name).toBe('academic-orange');
  });
});
