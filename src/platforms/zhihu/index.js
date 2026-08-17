import { PlatformAdapter } from '../base.js';

/**
 * Zhihu adapter.
 *
 * Zhihu editor constraints:
 * - Supports a subset of HTML
 * - Has its own CSS that may conflict
 * - Supports LaTeX via its own renderer (but we provide pre-rendered)
 * - Links are allowed but may get nofollow
 * - Images can be external URLs
 * - Tables supported but with limited styling
 * - Code blocks have native support
 * - No custom fonts
 * - No position: fixed/absolute
 */
export class ZhihuAdapter extends PlatformAdapter {
  constructor() {
    super('zhihu');
  }

  transform(html) {
    let result = html;

    // Zhihu uses div containers
    // Keep divs as-is (unlike WeChat which prefers sections)

    // Zhihu handles external links differently
    // Add data attributes for link tracking
    result = result.replace(/<a\s+href="/g, '<a target="_blank" href="');

    return result;
  }

  sanitize(html) {
    let result = html;

    // Remove script tags
    result = result.replace(/<script[\s\S]*?<\/script>/gi, '');

    // Remove style tags
    result = result.replace(/<style[\s\S]*?<\/style>/gi, '');

    // Remove link tags
    result = result.replace(/<link[^>]*>/gi, '');

    // Remove iframes
    result = result.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');

    // Remove on* event handlers
    result = result.replace(/\s+on\w+="[^"]*"/gi, '');
    result = result.replace(/\s+on\w+='[^']*'/gi, '');

    // Zhihu: keep classes (Zhihu may use some for its own styling)
    // But remove IDs
    result = result.replace(/\s+id="[^"]*"/gi, '');

    return result;
  }

  validate(html) {
    const warnings = [];
    const errors = [];

    if (/<details[\s>]/i.test(html)) {
      warnings.push('Zhihu: <details> elements may not render correctly');
    }

    if (/<summary[\s>]/i.test(html)) {
      warnings.push('Zhihu: <summary> elements may not render correctly');
    }

    // Check for fonts that won't work
    if (/font-family\s*:[^;]*(?:Comic|Papyrus|Impact)/i.test(html)) {
      warnings.push('Zhihu: Custom fonts may not be available');
    }

    return { valid: errors.length === 0, warnings, errors };
  }

  getCssOverrides() {
    return `
      /* Zhihu compatibility overrides */
      #nice {
        max-width: 100%;
        word-wrap: break-word;
        overflow-wrap: break-word;
      }
      #nice img {
        max-width: 100%;
        height: auto;
      }
    `;
  }
}
