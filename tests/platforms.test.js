import { describe, it, expect } from 'vitest';
import { WeChatAdapter } from '../src/platforms/wechat/index.js';
import { ZhihuAdapter } from '../src/platforms/zhihu/index.js';

describe('WeChat Adapter', () => {
  const adapter = new WeChatAdapter();

  it('should have correct name', () => {
    expect(adapter.name).toBe('wechat');
  });

  it('should sanitize script tags', () => {
    const html = '<div id="nice"><script>alert(1)</script><p>Hello</p></div>';
    const result = adapter.sanitize(html);
    expect(result).not.toContain('<script');
    expect(result).toContain('Hello');
  });

  it('should sanitize style tags', () => {
    const html = '<div id="nice"><style>.x{color:red}</style><p>Hello</p></div>';
    const result = adapter.sanitize(html);
    expect(result).not.toContain('<style');
  });

  it('should remove class attributes', () => {
    const html = '<div id="nice"><p class="some-class">Text</p></div>';
    const result = adapter.sanitize(html);
    expect(result).not.toContain('class=');
  });

  it('should remove event handlers', () => {
    const html = '<div id="nice"><p onclick="alert(1)">Text</p></div>';
    const result = adapter.sanitize(html);
    expect(result).not.toContain('onclick');
  });

  it('should provide CSS overrides', () => {
    const overrides = adapter.getCssOverrides();
    expect(overrides).toContain('max-width');
    expect(overrides).toContain('overflow');
  });
});

describe('Zhihu Adapter', () => {
  const adapter = new ZhihuAdapter();

  it('should have correct name', () => {
    expect(adapter.name).toBe('zhihu');
  });

  it('should sanitize script tags', () => {
    const html = '<div id="nice"><script>alert(1)</script><p>Hello</p></div>';
    const result = adapter.sanitize(html);
    expect(result).not.toContain('<script');
    expect(result).toContain('Hello');
  });

  it('should remove IDs', () => {
    const html = '<div id="nice"><p id="custom">Text</p></div>';
    const result = adapter.sanitize(html);
    // All IDs should be removed
    expect(result).not.toContain('id=');
  });

  it('should add target blank to links', () => {
    const html = '<div id="nice"><a href="https://example.com">Link</a></div>';
    const result = adapter.transform(html);
    expect(result).toContain('target="_blank"');
  });

  it('should validate and warn about details elements', () => {
    const html = '<details><summary>Click</summary>Content</details>';
    const result = adapter.validate(html);
    expect(result.warnings.some(w => w.includes('details'))).toBe(true);
  });
});

describe('Platform adapters should not lose content', () => {
  it('WeChat: should preserve all text content after sanitization', () => {
    const adapter = new WeChatAdapter();
    const html = `<div id="nice">
      <h1 class="heading">Title</h1>
      <p class="para">Paragraph with <strong>bold</strong> and <em>italic</em>.</p>
      <blockquote class="quote"><p>A quote</p></blockquote>
      <ul class="list"><li>Item 1</li><li>Item 2</li></ul>
    </div>`;
    const result = adapter.sanitize(html);
    expect(result).toContain('Title');
    expect(result).toContain('Paragraph with');
    expect(result).toContain('bold');
    expect(result).toContain('italic');
    expect(result).toContain('A quote');
    expect(result).toContain('Item 1');
    expect(result).toContain('Item 2');
  });

  it('Zhihu: should preserve all text content after sanitization', () => {
    const adapter = new ZhihuAdapter();
    const html = `<div id="nice">
      <h1>Title</h1>
      <p>Paragraph with <strong>bold</strong>.</p>
      <pre><code>code block</code></pre>
    </div>`;
    const result = adapter.sanitize(html);
    expect(result).toContain('Title');
    expect(result).toContain('Paragraph with');
    expect(result).toContain('bold');
    expect(result).toContain('code block');
  });
});
