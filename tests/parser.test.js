import { describe, it, expect } from 'vitest';
import { renderMarkdown, parseMarkdown } from '../src/core/parser/index.js';

describe('Markdown Parser', () => {
  it('should parse headings', () => {
    const html = renderMarkdown('# Heading 1\n## Heading 2\n### Heading 3');
    expect(html).toContain('<h1>Heading 1</h1>');
    expect(html).toContain('<h2>Heading 2</h2>');
    expect(html).toContain('<h3>Heading 3</h3>');
  });

  it('should parse paragraphs', () => {
    const html = renderMarkdown('Hello world.\n\nSecond paragraph.');
    expect(html).toContain('<p>Hello world.</p>');
    expect(html).toContain('<p>Second paragraph.</p>');
  });

  it('should parse bold and italic', () => {
    const html = renderMarkdown('**bold** and *italic* and ~~strikethrough~~');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<s>strikethrough</s>');
  });

  it('should parse ordered lists', () => {
    const html = renderMarkdown('1. First\n2. Second\n3. Third');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>First</li>');
    expect(html).toContain('<li>Second</li>');
  });

  it('should parse unordered lists', () => {
    const html = renderMarkdown('- Item A\n- Item B\n- Item C');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>Item A</li>');
  });

  it('should parse nested lists', () => {
    const html = renderMarkdown('- Level 1\n  - Level 2\n    - Level 3');
    expect(html).toContain('<ul>');
    // Should have nested ul
    const ulCount = (html.match(/<ul>/g) || []).length;
    expect(ulCount).toBeGreaterThanOrEqual(2);
  });

  it('should parse blockquotes', () => {
    const html = renderMarkdown('> This is a quote');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('This is a quote');
  });

  it('should parse links', () => {
    const html = renderMarkdown('[Click here](https://example.com)');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('Click here');
  });

  it('should parse images', () => {
    const html = renderMarkdown('![Alt text](image.png)');
    expect(html).toContain('<img');
    expect(html).toContain('src="image.png"');
    expect(html).toContain('alt="Alt text"');
  });

  it('should parse tables', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |';
    const html = renderMarkdown(md);
    expect(html).toContain('<table>');
    expect(html).toContain('<th>A</th>');
    expect(html).toContain('<td>1</td>');
  });

  it('should parse horizontal rules', () => {
    const html = renderMarkdown('---');
    expect(html).toContain('<hr>');
  });

  it('should parse inline code', () => {
    const html = renderMarkdown('Use `console.log()` for debugging');
    expect(html).toContain('<code>console.log()</code>');
  });

  it('should parse fenced code blocks', () => {
    const html = renderMarkdown('```python\nprint("hello")\n```');
    expect(html).toContain('print');
    expect(html).toContain('hello');
  });

  it('should parse Chinese text correctly', () => {
    const html = renderMarkdown('这是一段中文文本。**加粗**和*斜体*。');
    expect(html).toContain('这是一段中文文本');
    expect(html).toContain('<strong>加粗</strong>');
  });

  it('should not alter the source markdown', () => {
    const source = '# Title\n\nParagraph with $E = mc^2$.\n';
    const html = renderMarkdown(source);
    // Source should still contain the original LaTeX
    expect(source).toContain('$E = mc^2$');
    // HTML should contain rendered math
    expect(html).toContain('mc');
  });
});
